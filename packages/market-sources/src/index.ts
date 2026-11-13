/**
 * The adapters of the sellers of a market. Each parser reads the answer of an official API at one instant, and
 * gives the current offers and price readings as records of `@mark1russell7/market`. A parser keeps no store,
 * and it sends no request. Each source also has the terms of its API.
 *
 * Each client sends the requests of one API through a transport that its host gives. The scheduler of
 * `polite-crawler` keeps the pace of each host. A client keeps no store, and no message of a client has a key.
 */
import type { SourceTerms } from "@mark1russell7/market";
import { BEST_BUY_TERMS } from "./bestbuy.ts";
import { DIGIKEY_TERMS } from "./digikey.ts";
import { EBAY_TERMS } from "./ebay.ts";

export {
  BEST_BUY_SOURCE,
  BEST_BUY_TERMS,
  bestBuyCondition,
  parseBestBuyOpenBox,
  parseBestBuyProduct,
  parseBestBuyProducts,
} from "./bestbuy.ts";
export {
  DIGIKEY_SELLER,
  DIGIKEY_SOURCE,
  DIGIKEY_TERMS,
  parseDigiKeyKeywordSearch,
  parseDigiKeyProductDetails,
} from "./digikey.ts";
export { EBAY_SOURCE, EBAY_TERMS, ebayCondition, parseEbayItem, parseEbaySearch } from "./ebay.ts";
export type { Observation, ParseResult } from "./parse.ts";
export { SECRET_MARK, SourceError, redact } from "./client.ts";
export type { Exchange, Pace, Reply, Scheduler, Signal, Transport } from "./client.ts";
export {
  DIGIKEY_HOST,
  DIGIKEY_PACE_MS,
  DIGIKEY_SANDBOX_HOST,
  DIGIKEY_SEARCH_LIMIT,
  DIGIKEY_US,
  createDigiKeyClient,
} from "./digikey-client.ts";
export type { DigiKeyClient, DigiKeyClientOptions, DigiKeyLocale } from "./digikey-client.ts";
export {
  EBAY_HOST,
  EBAY_PACE_MS,
  EBAY_SANDBOX_HOST,
  EBAY_SCOPE,
  EBAY_SEARCH_LIMIT,
  EBAY_US,
  createEbayClient,
} from "./ebay-client.ts";
export type { EbayClient, EbayClientOptions } from "./ebay-client.ts";
export { BEST_BUY_HOST, BEST_BUY_PACE_MS, BEST_BUY_PAGE_LIMIT, createBestBuyClient } from "./bestbuy-client.ts";
export type { BestBuyClient, BestBuyClientOptions } from "./bestbuy-client.ts";

/** The terms of each source of this package, in the order of the hand crawl. */
export const SOURCE_TERMS: readonly SourceTerms[] = [EBAY_TERMS, BEST_BUY_TERMS, DIGIKEY_TERMS];
