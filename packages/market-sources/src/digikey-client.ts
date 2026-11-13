import {
  checkName,
  checkSecret,
  formBody,
  instantOf,
  readAnswer,
  readGrant,
  send,
  sendWithToken,
  tokenStore,
  type Pace,
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
}

/** A client of the Digi-Key Product Information API v4. Each method gives the result of a parser of this package. */
export interface DigiKeyClient<S extends Signal> {
  /** This method reads `ProductDetails` of a Digi-Key or maker product number. */
  productDetails(productNumber: string, signal?: S): Promise<ParseResult>;
  /** This method reads `KeywordSearch` of the keywords, with `limit` products at most (1 to 50, the default 10). */
  keywordSearch(keywords: string, limit?: number, signal?: S): Promise<ParseResult>;
}

const SOURCE = "Digi-Key";

/**
 * This function makes a client of the Digi-Key Product Information API v4. The client gets a token with the
 * 2-legged OAuth flow (the client credentials grant), and it keeps the token until 1 minute before its end. Each
 * request sends the token, the client id and the locale.
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
  const context = { source: SOURCE, host, minIntervalMs: DIGIKEY_PACE_MS, secrets };

  const tokens = tokenStore<S>(async (signal) => {
    const issuedAt = pace.now();
    const exchange = {
      method: "POST" as const,
      url: `${base}/v1/oauth2/token`,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: formBody({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    };
    const { reply } = await send(pace, transport, { ...context, what: "the token", exchange }, signal);
    return readGrant(reply, SOURCE, issuedAt, secrets);
  }, pace.now);

  const headers = (token: string): Readonly<Record<string, string>> => ({
    authorization: `Bearer ${token}`,
    "x-digikey-client-id": clientId,
    "x-digikey-locale-site": locale.site,
    "x-digikey-locale-language": locale.language,
    "x-digikey-locale-currency": locale.currency,
  });

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
      const answer = await sendWithToken(pace, transport, tokens, { ...context, what, exchange }, headers, signal);
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
      const answer = await sendWithToken(pace, transport, tokens, { ...context, what, exchange }, headers, signal);
      return readAnswer(answer, { ...context, what }, parseDigiKeyKeywordSearch, instantOf(pace.now()));
    },
  };
}
