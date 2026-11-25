import { isKept, keepUntil, permitsHistory, permitsTrend, sourceTermsSchema } from "@mark1russell7/market";
import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import { AZURE_TERMS, BEST_BUY_TERMS, DIGIKEY_TERMS, EBAY_TERMS, SOURCE_TERMS } from "./index.ts";

describe("the entry", () => {
  it("exports the parsers, the terms and the clients", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "AZURE_API_VERSION",
      "AZURE_FILTER_FIELDS",
      "AZURE_HOST",
      "AZURE_PACE_MS",
      "AZURE_PAGE_LIMIT",
      "AZURE_PLACE_COUNTRIES",
      "AZURE_PRICES_URL",
      "AZURE_PROVIDER",
      "AZURE_REGIONS_SOURCE",
      "AZURE_REGION_TABLE",
      "AZURE_SOURCE",
      "AZURE_TERMS",
      "AZURE_VM_SIZES_SOURCE",
      "AZURE_VM_SIZE_TABLE",
      "ApiError",
      "BEST_BUY_HOST",
      "BEST_BUY_PACE_MS",
      "BEST_BUY_PAGE_LIMIT",
      "BEST_BUY_QUOTA",
      "BEST_BUY_QUOTA_KEY",
      "BEST_BUY_SOURCE",
      "BEST_BUY_TERMS",
      "BLS_API_URL",
      "BLS_HOST",
      "BLS_PACE_MS",
      "BLS_QUOTA",
      "BLS_QUOTA_KEY",
      "BLS_SERIES_LIMIT",
      "BLS_SOURCE",
      "BLS_STAPLES",
      "BLS_STATEMENT",
      "BLS_TERMS",
      "BLS_YEAR_LIMIT",
      "DIGIKEY_HOST",
      "DIGIKEY_PACE_MS",
      "DIGIKEY_QUOTA",
      "DIGIKEY_QUOTA_KEY",
      "DIGIKEY_SANDBOX_HOST",
      "DIGIKEY_SEARCH_LIMIT",
      "DIGIKEY_SELLER",
      "DIGIKEY_SOURCE",
      "DIGIKEY_TERMS",
      "DIGIKEY_US",
      "EBAY_HOST",
      "EBAY_PACE_MS",
      "EBAY_SANDBOX_HOST",
      "EBAY_SCOPE",
      "EBAY_SEARCH_LIMIT",
      "EBAY_SOURCE",
      "EBAY_TERMS",
      "EBAY_US",
      "LINODE_PLANS",
      "LINODE_SOURCE",
      "LINODE_TERMS",
      "PLAN_METER",
      "PLAN_PAGE_LIMIT",
      "PLAN_PRICING_SPEC",
      "PLAN_PROVIDERS",
      "SECRET_MARK",
      "SOURCE_TERMS",
      "VULTR_PLANS",
      "VULTR_SOURCE",
      "VULTR_TERMS",
      "azureNextPage",
      "azurePricesUrl",
      "azureRegion",
      "azureRegionsDataText",
      "azureUnit",
      "azureVmOs",
      "azureVmSize",
      "bestBuyCondition",
      "blsRequest",
      "createAzureClient",
      "createBestBuyClient",
      "createBlsClient",
      "createDigiKeyClient",
      "createEbayClient",
      "createPlanClient",
      "ebayCondition",
      "isAzurePricesUrl",
      "parseAzureRegionsPage",
      "parseAzureRetailPricePages",
      "parseAzureRetailPrices",
      "parseAzureSizeTables",
      "parseBestBuyOpenBox",
      "parseBestBuyProduct",
      "parseBestBuyProducts",
      "parseBlsSeries",
      "parseDigiKeyKeywordSearch",
      "parseDigiKeyProductDetails",
      "parseEbayItem",
      "parseEbaySearch",
      "parsePlanLists",
      "parsePlanProvider",
      "planListUrl",
      "planNextPage",
      "planProviderSchema",
      "redact",
    ]);
  });
});

describe("the terms of each source", () => {
  it("are valid under the schema of the market, with one entry for each source", () => {
    for (const terms of SOURCE_TERMS) expect(sourceTermsSchema.parse(terms)).toEqual(terms);
    expect(SOURCE_TERMS.map((terms) => terms.source)).toEqual([
      entry.EBAY_SOURCE,
      entry.BEST_BUY_SOURCE,
      entry.DIGIKEY_SOURCE,
      entry.AZURE_SOURCE,
      entry.LINODE_SOURCE,
      entry.VULTR_SOURCE,
      entry.BLS_SOURCE,
    ]);
  });

  it("permit no stored history and no trend for any seller and any plan list", () => {
    for (const terms of [EBAY_TERMS, BEST_BUY_TERMS, DIGIKEY_TERMS, entry.LINODE_TERMS, entry.VULTR_TERMS]) {
      expect(permitsHistory(terms)).toBe(false);
      expect(permitsTrend(terms)).toBe(false);
    }
  });

  it("keep each Azure reading, with a history and a trend", () => {
    expect(keepUntil(AZURE_TERMS, { at: "2026-11-12T12:00:00Z" })).toBeNull();
    expect(isKept(AZURE_TERMS, { at: "2026-11-12T12:00:00Z" }, "2027-11-12T12:00:00Z", true)).toBe(true);
    expect(permitsHistory(AZURE_TERMS)).toBe(true);
    expect(permitsTrend(AZURE_TERMS)).toBe(true);
  });

  it("keep each BLS average price, with a history and a trend", () => {
    expect(keepUntil(entry.BLS_TERMS, { at: "2026-11-22T16:00:00Z" })).toBeNull();
    expect(permitsHistory(entry.BLS_TERMS)).toBe(true);
    expect(permitsTrend(entry.BLS_TERMS)).toBe(true);
    expect(entry.BLS_TERMS.clause).toContain("BLS_STATEMENT");
  });

  it("keep an eBay reading for 6 hours, and no reading of an ended listing", () => {
    const reading = { at: "2026-11-12T12:00:00Z" };
    expect(keepUntil(EBAY_TERMS, reading)).toBe("2026-11-12T18:00:00.000Z");
    expect(isKept(EBAY_TERMS, reading, "2026-11-12T17:59:59Z")).toBe(true);
    expect(isKept(EBAY_TERMS, reading, "2026-11-12T18:00:01Z")).toBe(false);
    expect(isKept(EBAY_TERMS, reading, "2026-11-12T12:00:01Z", true)).toBe(false);
  });

  it("keep a Best Buy reading for 72 hours", () => {
    expect(keepUntil(BEST_BUY_TERMS, { at: "2026-11-12T12:00:00Z" })).toBe("2026-11-15T12:00:00.000Z");
  });

  it("keep no Digi-Key reading at all", () => {
    expect(isKept(DIGIKEY_TERMS, { at: "2026-11-12T12:00:00Z" }, "2026-11-12T12:00:00Z")).toBe(false);
  });
});
