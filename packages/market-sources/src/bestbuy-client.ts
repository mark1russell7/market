import { quotaGate, withQuota, type Quota, type QuotaGate } from "polite-crawler/api";
import { checkName, checkSecret, formBody, instantOf, readAnswer, redact, send, type Answer, type Pace, type Send, type Signal, type Transport } from "./client.ts";
import { parseBestBuyOpenBox, parseBestBuyProduct, parseBestBuyProducts } from "./bestbuy.ts";
import type { ParseResult } from "./parse.ts";

/** The host of the Best Buy APIs. */
export const BEST_BUY_HOST = "api.bestbuy.com";

/**
 * The client sends one request each second at most: the API interval of the policy of `polite-crawler`. The
 * documentation of Best Buy gives no pace. It answers 403 when a key passes its limit of calls.
 */
export const BEST_BUY_PACE_MS = 1000;

/**
 * The quota of an API key: 50,000 calls each day. The section "Rate Limit" of the Best Buy API Operational Policy
 * gives 50,000 calls each day and 5 calls each second for Products, Buying Options and four other APIs
 * (https://developer.bestbuy.com/legal). The policy names no other plan, so the limit is the limit of each key. The
 * gate keeps 5,000 in reserve for calls that it does not see. The policy does not tell when the day of the count
 * starts, thus the window is a rolling 24 hours.
 */
export const BEST_BUY_QUOTA: Quota = {
  name: "Best Buy API calls",
  limit: 50_000,
  reserve: 5_000,
  window: { kind: "rolling", ms: 86_400_000 },
};

/**
 * The name of the key of `BEST_BUY_QUOTA`. The API counts the calls of each API key. The name has no key, because a
 * store keeps the name as text.
 */
export const BEST_BUY_QUOTA_KEY = "bestbuy:api-key";

/** The most products of one page of a search. */
export const BEST_BUY_PAGE_LIMIT = 100;

/** The options of a Best Buy client. */
export interface BestBuyClientOptions<S extends Signal> {
  /** The API key. It goes in the query of each request, and no message has it. */
  readonly apiKey: string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /**
   * The gate of `BEST_BUY_QUOTA`. The default is one gate in memory for each pace, with the clock of the pace. Thus each
   * client of one pace counts in one gate, as the pace keeps one interval for each host. A gate with a shared store
   * counts each process of one key in one record. An example store is `SqliteHostStateStore` of `polite-crawler`.
   */
  readonly quota?: QuotaGate | undefined;
}

/**
 * A client of the Best Buy Products API and Open Box API. Each method gives the result of a parser of this package.
 * Each method throws `QuotaError` of `polite-crawler/api` when the quota refuses the call. Its `resetAt` tells when the
 * gate gives a call again. The client sent nothing.
 */
export interface BestBuyClient<S extends Signal> {
  /** This method reads one product of a SKU. */
  product(sku: string, signal?: S): Promise<ParseResult>;
  /** This method reads the first page of a search of the words, with `pageSize` products at most (1 to 100, the default 10). */
  search(words: string, pageSize?: number, signal?: S): Promise<ParseResult>;
  /** This method reads the open-box offers of a SKU. */
  openBox(sku: string, signal?: S): Promise<ParseResult>;
}

const SOURCE = "Best Buy";

/** The default gate of each pace. A pace is the pace of the clients of one process. */
const PACE_GATES = new WeakMap<object, QuotaGate>();

function paceGate<S extends Signal>(pace: Pace<S>): QuotaGate {
  const found = PACE_GATES.get(pace);
  if (found !== undefined) return found;
  const gate = quotaGate(BEST_BUY_QUOTA, { key: BEST_BUY_QUOTA_KEY, now: pace.now });
  PACE_GATES.set(pace, gate);
  return gate;
}

const SKU = /^\d{1,12}$/;
const WORD = /^[A-Za-z0-9.-]{1,40}$/;

function checkSku(sku: string): string {
  const value = checkName("sku", sku);
  if (!SKU.test(value)) throw new RangeError(`The SKU ${JSON.stringify(value)} is not a number of 1 to 12 digits.`);
  return value;
}

/**
 * This function makes a client of the Best Buy APIs. The API key goes in the query of each request. A 401 or a
 * 403 stops the host for 1 hour, because Best Buy gives a 403 for a key that passed its limit.
 *
 * - The gate counts each call before the client sends it, and it refuses a call over the quota.
 * - A 403 sets the count to the limit. Then the gate refuses each call until the calls of the window go out of it, 24
 *   hours at most. Best Buy gives one status for a key that is not valid and for a key over its limit.
 *
 * @throws RangeError when the API key is not a key. The message does not show the value.
 */
export function createBestBuyClient<S extends Signal>(options: BestBuyClientOptions<S>): BestBuyClient<S> {
  checkSecret("apiKey", options.apiKey);
  const { apiKey, pace, transport } = options;
  const base = `https://${BEST_BUY_HOST}`;
  const secrets = [apiKey];
  const counted = withQuota(
    options.quota ?? paceGate(pace),
    async (input: Send, signal: S | undefined): Promise<Answer> => await send(pace, transport, input, signal),
    { read: (answer) => (answer.reply.status === 403 ? { remaining: 0 } : undefined) },
  );

  const read = async (
    what: string,
    path: string,
    query: Readonly<Record<string, string>>,
    parse: (json: unknown, at: string) => ParseResult,
    signal?: S,
  ) => {
    const exchange = {
      method: "GET" as const,
      url: `${base}${path}?${formBody({ ...query, apiKey })}`,
      headers: { accept: "application/json" },
      body: null,
    };
    const input = { source: SOURCE, host: BEST_BUY_HOST, minIntervalMs: BEST_BUY_PACE_MS, what, secrets, redact, exchange };
    const answer = await counted(input, signal);
    return readAnswer(answer, input, parse, instantOf(pace.now()));
  };

  return {
    async product(sku, signal) {
      const id = checkSku(sku);
      return read(`the product ${id}`, `/v1/products/${id}.json`, {}, parseBestBuyProduct, signal);
    },
    async search(words, pageSize = 10, signal) {
      const list = checkName("words", words).split(/\s+/);
      if (list.length > 10 || !list.every((word) => WORD.test(word))) {
        throw new RangeError("The words are not 1 to 10 words of letters, digits, points and hyphens.");
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > BEST_BUY_PAGE_LIMIT) {
        throw new RangeError(`The page size is not a whole number from 1 to ${BEST_BUY_PAGE_LIMIT}.`);
      }
      const filter = list.map((word) => `search=${word}`).join("&");
      const query = { format: "json", pageSize: String(pageSize) };
      return read(`the search ${JSON.stringify(list.join(" "))}`, `/v1/products(${filter})`, query, parseBestBuyProducts, signal);
    },
    async openBox(sku, signal) {
      const id = checkSku(sku);
      return read(`the open-box offers of ${id}`, `/beta/products/${id}/openBox`, {}, parseBestBuyOpenBox, signal);
    },
  };
}
