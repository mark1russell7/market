import { quotaGate, readQuotaHeaders, withQuota, type Quota, type QuotaGate, type QuotaReading } from "polite-crawler/api";
import {
  checkName,
  checkSecret,
  formBody,
  instantOf,
  readAnswer,
  readGrant,
  redact,
  send,
  sendWithToken,
  tokenStore,
  type Answer,
  type Pace,
  type Send,
  type Signal,
  type Transport,
} from "./client.ts";
import { parseDigiKeyKeywordSearch, parseDigiKeyProductDetails } from "./digikey.ts";
import type { ParseResult } from "./parse.ts";

/** The host of the Digi-Key APIs. */
export const DIGIKEY_HOST = "api.digikey.com";

/** The host of the sandbox of the Digi-Key APIs. Its answers have example data. */
export const DIGIKEY_SANDBOX_HOST = "sandbox-api.digikey.com";

/** The burst limit of Product Information v4 is 120 requests each minute. Thus the client sends one request each 500 ms at most. */
export const DIGIKEY_PACE_MS = 500;

/**
 * The quota of Product Information v4 for standard products: 1000 requests each day. The table "Rate Limits" of the
 * documentation gives the row "Product Information | 120 per minute | 1000 per day"
 * (https://developer.digikey.com/documentation). The table is for standard products, the default plan. The gate
 * keeps 100 in reserve for requests that it does not see, for example a second send after a new token. The
 * documentation does not tell when the day of the count starts, thus the window is a rolling 24 hours.
 */
export const DIGIKEY_QUOTA: Quota = {
  name: "Digi-Key Product Information v4 requests",
  limit: 1000,
  reserve: 100,
  window: { kind: "rolling", ms: 86_400_000 },
};

/**
 * The name of the key of `DIGIKEY_QUOTA`. The API counts the requests of each application. The name has no client
 * id, because a store keeps the name as text.
 */
export const DIGIKEY_QUOTA_KEY = "digikey:product-information-v4";

/** The most products of one `KeywordSearch`. */
export const DIGIKEY_SEARCH_LIMIT = 50;

/** The locale of the answers: the site, the language and the currency of the prices. */
export interface DigiKeyLocale {
  readonly site: string;
  readonly language: string;
  readonly currency: string;
}

/** The locale of the US site, with prices in US dollars. */
export const DIGIKEY_US: DigiKeyLocale = { site: "US", language: "en", currency: "USD" };

/** The options of a Digi-Key client. */
export interface DigiKeyClientOptions<S extends Signal> {
  /** The client id of the API application. */
  readonly clientId: string;
  /** The client secret of the API application. */
  readonly clientSecret: string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /** With true, the client uses the sandbox host. */
  readonly sandbox?: boolean | undefined;
  /** The default is `DIGIKEY_US`. */
  readonly locale?: DigiKeyLocale | undefined;
  /**
   * The gate of `DIGIKEY_QUOTA`. The default is one gate in memory for each pace, with the clock of the pace. Thus each
   * client of one pace counts in one gate, as the pace keeps one interval for each host. A gate with a shared store
   * counts each process of one application in one record. An example store is `SqliteHostStateStore` of `polite-crawler`.
   */
  readonly quota?: QuotaGate | undefined;
}

/** A client of the Digi-Key Product Information API v4. Each method gives the result of a parser of this package. */
export interface DigiKeyClient<S extends Signal> {
  /**
   * This method reads `ProductDetails` of a Digi-Key or maker product number.
   *
   * @throws QuotaError of `polite-crawler/api` when the quota refuses the request. Its `resetAt` tells when the gate
   * gives a request again. The client sent nothing.
   */
  productDetails(productNumber: string, signal?: S): Promise<ParseResult>;
  /**
   * This method reads `KeywordSearch` of the keywords, with `limit` products at most (1 to 50, the default 10).
   *
   * @throws QuotaError of `polite-crawler/api` when the quota refuses the request. Its `resetAt` tells when the gate
   * gives a request again. The client sent nothing.
   */
  keywordSearch(keywords: string, limit?: number, signal?: S): Promise<ParseResult>;
}

const SOURCE = "Digi-Key";

/** The default gate of each pace. A pace is the pace of the clients of one process. */
const PACE_GATES = new WeakMap<object, QuotaGate>();

function paceGate<S extends Signal>(pace: Pace<S>): QuotaGate {
  const found = PACE_GATES.get(pace);
  if (found !== undefined) return found;
  const gate = quotaGate(DIGIKEY_QUOTA, { key: DIGIKEY_QUOTA_KEY, now: pace.now });
  PACE_GATES.set(pace, gate);
  return gate;
}

/** The message of the answer of the daily limit. The answer of the burst limit has the message "BurstLimit exceeded". */
const DAILY_LIMIT = "Daily Ratelimit exceeded";

/**
 * This function reads an answer of the daily limit: a 429 with the message of the daily limit, or with the header
 * `X-RateLimit-Remaining: 0`. The reading sets the count to the limit. The header `X-RateLimit-Reset` gives the seconds
 * to the reset. Each other answer gives no reading.
 */
function dailyLimitReading(answer: Answer, now: number): QuotaReading | undefined {
  const { reply } = answer;
  if (reply.status !== 429) return undefined;
  const get = (name: string): string | undefined => reply.headers[name];
  if (get("x-ratelimit-remaining")?.trim() !== "0" && !reply.body.includes(DAILY_LIMIT)) return undefined;
  const reset = readQuotaHeaders(get, { resetAt: "x-ratelimit-reset" }, now)?.resetAt;
  return reset === undefined ? { remaining: 0 } : { remaining: 0, resetAt: reset };
}

/**
 * This function makes a client of the Digi-Key Product Information API v4. The client gets a token with the
 * 2-legged OAuth flow (the client credentials grant), and it keeps the token until 1 minute before its end. Each
 * request sends the token, the client id and the locale.
 *
 * - The gate counts each request of a product before the client sends it, and it refuses a request over the quota.
 *   A request of a token does not count.
 * - An answer of the daily limit sets the count to the limit. Then the gate refuses each request until the reset of
 *   the answer. With no reset, it refuses until the requests of the window go out of it, 24 hours at most.
 *
 * @throws RangeError when the client id or the client secret is not a key. The message does not show the value.
 */
export function createDigiKeyClient<S extends Signal>(options: DigiKeyClientOptions<S>): DigiKeyClient<S> {
  checkSecret("clientId", options.clientId);
  checkSecret("clientSecret", options.clientSecret);
  const { clientId, clientSecret, pace, transport } = options;
  const host = options.sandbox === true ? DIGIKEY_SANDBOX_HOST : DIGIKEY_HOST;
  const base = `https://${host}`;
  const locale = options.locale ?? DIGIKEY_US;
  const secrets = [clientId, clientSecret];
  const context = { source: SOURCE, host, minIntervalMs: DIGIKEY_PACE_MS, secrets, redact };

  const tokens = tokenStore<S>(async (signal) => {
    const issuedAt = pace.now();
    const exchange = {
      method: "POST" as const,
      url: `${base}/v1/oauth2/token`,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: formBody({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    };
    const { reply } = await send(pace, transport, { ...context, what: "the token", exchange }, signal);
    return readGrant(reply, SOURCE, issuedAt, secrets, redact);
  }, pace.now);

  const headers = (token: string): Readonly<Record<string, string>> => ({
    authorization: `Bearer ${token}`,
    "x-digikey-client-id": clientId,
    "x-digikey-locale-site": locale.site,
    "x-digikey-locale-language": locale.language,
    "x-digikey-locale-currency": locale.currency,
  });

  const read = withQuota(
    options.quota ?? paceGate(pace),
    async (input: Send, signal: S | undefined): Promise<Answer> => await sendWithToken(pace, transport, tokens, input, headers, signal),
    { read: (answer) => dailyLimitReading(answer, pace.now()) },
  );

  return {
    async productDetails(productNumber, signal) {
      const number = checkName("productNumber", productNumber);
      const what = `ProductDetails of ${number}`;
      const exchange = {
        method: "GET" as const,
        url: `${base}/products/v4/search/${encodeURIComponent(number)}/productdetails`,
        headers: { accept: "application/json" },
        body: null,
      };
      const answer = await read({ ...context, what, exchange }, signal);
      return readAnswer(answer, { ...context, what }, parseDigiKeyProductDetails, instantOf(pace.now()));
    },
    async keywordSearch(keywords, limit = 10, signal) {
      const words = checkName("keywords", keywords);
      if (!Number.isInteger(limit) || limit < 1 || limit > DIGIKEY_SEARCH_LIMIT) {
        throw new RangeError(`The limit is not a whole number from 1 to ${DIGIKEY_SEARCH_LIMIT}.`);
      }
      const what = `KeywordSearch of ${JSON.stringify(words)}`;
      const exchange = {
        method: "POST" as const,
        url: `${base}/products/v4/search/keyword`,
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ Keywords: words, Limit: limit, Offset: 0 }),
      };
      const answer = await read({ ...context, what, exchange }, signal);
      return readAnswer(answer, { ...context, what }, parseDigiKeyKeywordSearch, instantOf(pace.now()));
    },
  };
}
