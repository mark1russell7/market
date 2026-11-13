import { isKept, keepUntil, permitsHistory, permitsTrend, sourceTermsSchema } from "@mark1russell7/market";
import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import { BEST_BUY_TERMS, DIGIKEY_TERMS, EBAY_TERMS, SOURCE_TERMS } from "./index.ts";

describe("the entry", () => {
  it("exports the parsers and the terms", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "BEST_BUY_SOURCE",
      "BEST_BUY_TERMS",
      "DIGIKEY_SELLER",
      "DIGIKEY_SOURCE",
      "DIGIKEY_TERMS",
      "EBAY_SOURCE",
      "EBAY_TERMS",
      "SOURCE_TERMS",
      "bestBuyCondition",
      "ebayCondition",
      "parseBestBuyOpenBox",
      "parseBestBuyProduct",
      "parseBestBuyProducts",
      "parseDigiKeyKeywordSearch",
      "parseDigiKeyProductDetails",
      "parseEbayItem",
      "parseEbaySearch",
    ]);
  });
});

describe("the terms of each source", () => {
  it("are valid under the schema of the market, with one entry for each source", () => {
    for (const terms of SOURCE_TERMS) expect(sourceTermsSchema.parse(terms)).toEqual(terms);
    expect(SOURCE_TERMS.map((terms) => terms.source)).toEqual([entry.EBAY_SOURCE, entry.BEST_BUY_SOURCE, entry.DIGIKEY_SOURCE]);
  });

  it("permit no stored history and no trend for any source", () => {
    for (const terms of SOURCE_TERMS) {
      expect(permitsHistory(terms)).toBe(false);
      expect(permitsTrend(terms)).toBe(false);
    }
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
