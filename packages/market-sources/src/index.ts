/**
 * The adapters of the sellers of a market. Each parser reads the answer of an official API at one instant, and
 * gives the current offers and price readings as records of `@mark1russell7/market`. A parser keeps no store,
 * and it sends no request. Each source also has the terms of its API. The Azure parser gives the metered prices
 * of cloud resources as metered offers. The plan parser reads the plan list of each provider record as metered offers.
 * The BLS parser reads the average prices of the Consumer Price Index as average prices of `@mark1russell7/market`.
 * The Kroger parsers read the offers of food and other goods at one store.
 *
 * Each client sends the requests of one API through a transport that its host gives. The scheduler of
 * `polite-crawler/api` keeps the pace of each host. A client keeps no store, and no message of a client has a key.
 */
import type { SourceTerms } from "@mark1russell7/market";
import { AZURE_TERMS } from "./azure.ts";
export {
  AZURE_PLACE_COUNTRIES,
  AZURE_REGION_TABLE,
  AZURE_REGIONS_SOURCE,
  azureRegion,
  azureRegionsDataText,
  parseAzureRegionsPage,
  type AzureRegion,
  type AzureRegionsResult,
  type AzureRegionsSource,
} from "./azure-regions.ts";
export {
  AZURE_VM_SIZE_TABLE,
  AZURE_VM_SIZES_SOURCE,
  azureVmSize,
  parseAzureSizeTables,
  type AzureSizeTablesResult,
  type AzureVmSize,
  type AzureVmSizesSource,
} from "./azure-sizes.ts";
import { BEST_BUY_TERMS } from "./bestbuy.ts";
import { BLS_TERMS } from "./bls.ts";
import { DIGIKEY_TERMS } from "./digikey.ts";
import { EBAY_TERMS } from "./ebay.ts";
import { KROGER_TERMS } from "./kroger.ts";
import { LINODE_TERMS, VULTR_TERMS } from "./providers.ts";

export {
  AZURE_API_VERSION,
  AZURE_FILTER_FIELDS,
  AZURE_PRICES_URL,
  AZURE_PROVIDER,
  AZURE_SOURCE,
  AZURE_TERMS,
  azureNextPage,
  azurePricesUrl,
  azureUnit,
  azureVmOs,
  isAzurePricesUrl,
  parseAzureRetailPricePages,
  parseAzureRetailPrices,
  type AzureFilter,
  type AzureFilterField,
  type AzureUnit,
} from "./azure.ts";
export {
  BLS_API_URL,
  BLS_SERIES_LIMIT,
  BLS_SOURCE,
  BLS_STAPLES,
  BLS_STATEMENT,
  BLS_TERMS,
  BLS_YEAR_LIMIT,
  blsRequest,
  parseBlsSeries,
  type AverageParseResult,
  type BlsSeries,
} from "./bls.ts";
export { BLS_HOST, BLS_PACE_MS, BLS_QUOTA, BLS_QUOTA_KEY, createBlsClient, type BlsClient, type BlsClientOptions } from "./bls-client.ts";
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
export type { MeteredObservation, MeteredParseResult, Observation, ParseResult } from "./parse.ts";
export { ApiError, SECRET_MARK, redact } from "./client.ts";
export type { ApiScheduler, Exchange, Pace, Reply, Signal, Transport } from "./client.ts";
export {
  DIGIKEY_HOST,
  DIGIKEY_PACE_MS,
  DIGIKEY_QUOTA,
  DIGIKEY_QUOTA_KEY,
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
export { KROGER_SOURCE, KROGER_TERMS, checkKrogerLocation, krogerGtin, parseKrogerProduct, parseKrogerProducts } from "./kroger.ts";
export {
  KROGER_HOST,
  KROGER_PACE_MS,
  KROGER_QUOTA,
  KROGER_QUOTA_KEY,
  KROGER_SANDBOX_HOST,
  KROGER_SCOPE,
  KROGER_SEARCH_LIMIT,
  KROGER_START_LIMIT,
  createKrogerClient,
} from "./kroger-client.ts";
export type { KrogerClient, KrogerClientOptions } from "./kroger-client.ts";
export { AZURE_HOST, AZURE_PACE_MS, AZURE_PAGE_LIMIT, createAzureClient } from "./azure-client.ts";
export type { AzureClient, AzureClientOptions, AzureReadOptions } from "./azure-client.ts";
export { BEST_BUY_HOST, BEST_BUY_PACE_MS, BEST_BUY_PAGE_LIMIT, BEST_BUY_QUOTA, BEST_BUY_QUOTA_KEY, createBestBuyClient } from "./bestbuy-client.ts";
export type { BestBuyClient, BestBuyClientOptions } from "./bestbuy-client.ts";
export {
  PLAN_METER,
  PLAN_PRICING_SPEC,
  parsePlanLists,
  parsePlanProvider,
  planListUrl,
  planNextPage,
  planProviderSchema,
  type PlanAnswers,
  type PlanListRead,
  type PlanNextPage,
  type PlanPaging,
  type PlanPlaces,
  type PlanProvider,
  type PlanProviderRead,
  type PlanRegionPrices,
  type PlanRegions,
  type PlanSpec,
  type PlanTerm,
} from "./plans.ts";
export { LINODE_PLANS, LINODE_SOURCE, LINODE_TERMS, PLAN_PROVIDERS, VULTR_PLANS, VULTR_SOURCE, VULTR_TERMS } from "./providers.ts";
export { PLAN_PAGE_LIMIT, createPlanClient } from "./plans-client.ts";
export type { PlanClient, PlanClientOptions, PlanReadOptions } from "./plans-client.ts";

/**
 * The terms of each source of this package: the sellers in the order of the hand crawl, then Azure, then the plan
 * lists, then BLS, then the grocery sellers.
 */
export const SOURCE_TERMS: readonly SourceTerms[] = [
  EBAY_TERMS,
  BEST_BUY_TERMS,
  DIGIKEY_TERMS,
  AZURE_TERMS,
  LINODE_TERMS,
  VULTR_TERMS,
  BLS_TERMS,
  KROGER_TERMS,
];
