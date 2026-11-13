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
  type Pace,
  type Signal,
  type Transport,
} from "./client.ts";
import { parseEbayItem, parseEbaySearch } from "./ebay.ts";
import type { ParseResult } from "./parse.ts";

/** The host of the eBay APIs. */
export const EBAY_HOST = "api.ebay.com";

/** The host of the sandbox of the eBay APIs. */
export const EBAY_SANDBOX_HOST = "api.sandbox.ebay.com";

/** The scope of an application token for the Browse API. */
export const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";

/**
 * The client sends one request each second at most: the API interval of the policy of `polite-crawler`. The
 * Browse API documents a count of calls each day, but no pace.
 */
export const EBAY_PACE_MS = 1000;

/** The most items of one page of `search`. */
export const EBAY_SEARCH_LIMIT = 200;

/** The marketplace of the US. */
export const EBAY_US = "EBAY_US";

/** The options of an eBay client. */
export interface EbayClientOptions<S extends Signal> {
  /** The client id (the App ID) of the application. */
  readonly clientId: string;
  /** The client secret (the Cert ID) of the application. */
  readonly clientSecret: string;
  /** This function encodes a text in UTF-8, and gives its Base64 form. The host gives it, for example with `Buffer`. */
  readonly base64: (text: string) => string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /** With true, the client uses the sandbox host. */
  readonly sandbox?: boolean | undefined;
  /** The marketplace of the answers. The default is `EBAY_US`. */
  readonly marketplace?: string | undefined;
}

/** A client of the eBay Browse API. Each method gives the result of a parser of this package. */
export interface EbayClient<S extends Signal> {
  /** This method reads `getItem` of a RESTful item id, for example `v1|110000000001|0`. */
  item(itemId: string, signal?: S): Promise<ParseResult>;
  /** This method reads one page of `search` of the words, with `limit` items at most (1 to 200, the default 50). */
  search(words: string, limit?: number, signal?: S): Promise<ParseResult>;
}

const SOURCE = "eBay";

const ITEM_ID = /^v1\|\d{1,20}\|\d{1,20}$/;
const MARKETPLACE = /^EBAY_[A-Z]{2,4}$/;

/**
 * This function makes a client of the eBay Browse API. The client gets an application token with the client
 * credentials grant, and it keeps the token until 1 minute before its end. Each request sends the token and the
 * marketplace.
 *
 * @throws RangeError when the client id or the client secret is not a key, or the marketplace is not valid.
 */
export function createEbayClient<S extends Signal>(options: EbayClientOptions<S>): EbayClient<S> {
  checkSecret("clientId", options.clientId);
  checkSecret("clientSecret", options.clientSecret);
  const marketplace = options.marketplace ?? EBAY_US;
  if (!MARKETPLACE.test(marketplace)) throw new RangeError(`The marketplace ${JSON.stringify(marketplace)} is not an eBay marketplace id.`);
  const { clientId, clientSecret, pace, transport } = options;
  const host = options.sandbox === true ? EBAY_SANDBOX_HOST : EBAY_HOST;
  const base = `https://${host}`;
  const basic = options.base64(`${clientId}:${clientSecret}`);
  const secrets = [clientId, clientSecret, basic];
  const context = { source: SOURCE, host, minIntervalMs: EBAY_PACE_MS, secrets, redact };

  const tokens = tokenStore<S>(async (signal) => {
    const issuedAt = pace.now();
    const exchange = {
      method: "POST" as const,
      url: `${base}/identity/v1/oauth2/token`,
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody({ grant_type: "client_credentials", scope: EBAY_SCOPE }),
    };
    const { reply } = await send(pace, transport, { ...context, what: "the token", exchange }, signal);
    return readGrant(reply, SOURCE, issuedAt, secrets, redact);
  }, pace.now);

  const headers = (token: string): Readonly<Record<string, string>> => ({
    authorization: `Bearer ${token}`,
    "x-ebay-c-marketplace-id": marketplace,
  });

  const read = async (what: string, url: string, parse: (json: unknown, at: string) => ParseResult, signal?: S) => {
    const exchange = { method: "GET" as const, url, headers: { accept: "application/json" }, body: null };
    const answer = await sendWithToken(pace, transport, tokens, { ...context, what, exchange }, headers, signal);
    return readAnswer(answer, { ...context, what }, parse, instantOf(pace.now()));
  };

  return {
    async item(itemId, signal) {
      const id = checkName("itemId", itemId);
      if (!ITEM_ID.test(id)) throw new RangeError(`The item id ${JSON.stringify(id)} is not a RESTful item id (v1|#|#).`);
      return read(`getItem of ${id}`, `${base}/buy/browse/v1/item/${encodeURIComponent(id)}`, parseEbayItem, signal);
    },
    async search(words, limit = 50, signal) {
      const q = checkName("words", words);
      if (!Number.isInteger(limit) || limit < 1 || limit > EBAY_SEARCH_LIMIT) {
        throw new RangeError(`The limit is not a whole number from 1 to ${EBAY_SEARCH_LIMIT}.`);
      }
      const query = formBody({ q, limit: String(limit) });
      return read(`search of ${JSON.stringify(q)}`, `${base}/buy/browse/v1/item_summary/search?${query}`, parseEbaySearch, signal);
    },
  };
}
