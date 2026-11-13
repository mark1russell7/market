/**
 * The adapters of the sellers of a market. Each parser reads the answer of an official API at one instant, and
 * gives the current offers and price readings as records of `@mark1russell7/market`. A parser keeps no store,
 * and it sends no request. Each source also has the terms of its API.
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

/** The terms of each source of this package, in the order of the hand crawl. */
export const SOURCE_TERMS: readonly SourceTerms[] = [EBAY_TERMS, BEST_BUY_TERMS, DIGIKEY_TERMS];
