import { offerSchema, priceReadingSchema } from "@mark1russell7/market";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AT,
  bestBuyOpenBox,
  bestBuyProduct,
  bestBuyProducts,
  digiKeyDetails,
  digiKeyKeyword,
  ebayItem,
  ebaySearch,
  mutated,
} from "../test/fixtures.ts";
import { parseBestBuyOpenBox, parseBestBuyProduct, parseBestBuyProducts } from "./bestbuy.ts";
import { parseDigiKeyKeywordSearch, parseDigiKeyProductDetails } from "./digikey.ts";
import { parseEbayItem, parseEbaySearch } from "./ebay.ts";
import type { ParseResult } from "./parse.ts";

const parsers: readonly { name: string; parse: (answer: unknown, at: string) => ParseResult; fixture: unknown }[] = [
  { name: "parseEbayItem", parse: parseEbayItem, fixture: ebayItem },
  { name: "parseEbaySearch", parse: parseEbaySearch, fixture: ebaySearch },
  { name: "parseBestBuyProduct", parse: parseBestBuyProduct, fixture: bestBuyProduct },
  { name: "parseBestBuyProducts", parse: parseBestBuyProducts, fixture: bestBuyProducts },
  { name: "parseBestBuyOpenBox", parse: parseBestBuyOpenBox, fixture: bestBuyOpenBox },
  { name: "parseDigiKeyProductDetails", parse: parseDigiKeyProductDetails, fixture: digiKeyDetails },
  { name: "parseDigiKeyKeywordSearch", parse: parseDigiKeyKeywordSearch, fixture: digiKeyKeyword },
];

/** This function examines the invariants of a result: each record is valid, and each reading belongs to its offer. */
function expectValid(result: ParseResult, at: string): void {
  if (!result.ok) {
    expect(result.problems.length).toBeGreaterThan(0);
    return;
  }
  const ids = new Set<string>();
  for (const { offer, reading } of result.observations) {
    expect(offerSchema.safeParse(offer).success).toBe(true);
    expect(priceReadingSchema.safeParse(reading).success).toBe(true);
    expect(reading.offerId).toBe(offer.id);
    expect(reading.at).toBe(at);
    expect(ids.has(offer.id)).toBe(false);
    ids.add(offer.id);
  }
}

describe.each(parsers)("$name", ({ parse, fixture }) => {
  it("reads its documented answer with no note", () => {
    const result = parse(fixture, AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notes).toEqual([]);
      expect(result.observations.length).toBeGreaterThan(0);
    }
  });

  it("never throws on a mutated answer, and gives only valid records", () => {
    fc.assert(
      fc.property(mutated(fixture), (answer) => {
        expectValid(parse(answer, AT), AT);
      }),
      { numRuns: 300 },
    );
  });

  it("never throws on a random JSON value, and gives only valid records", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (answer) => {
        expectValid(parse(answer, AT), AT);
      }),
      { numRuns: 200 },
    );
  });

  it("throws a RangeError on an instant that is not UTC ISO 8601", () => {
    fc.assert(
      fc.property(fc.string().filter((text) => Number.isNaN(Date.parse(text))), (at) => {
        expect(() => parse(fixture, at)).toThrow(RangeError);
      }),
      { numRuns: 50 },
    );
  });
});

describe("the strict decimal", () => {
  it("reads each decimal text of eBay as its number", () => {
    fc.assert(
      fc.property(fc.nat({ max: 99_999 }), fc.nat({ max: 99 }), (whole, cents) => {
        const value = `${whole}.${String(cents).padStart(2, "0")}`;
        const result = parseEbayItem({ ...ebayItem, price: { value, currency: "USD" }, marketingPrice: null }, AT);
        expect(result.ok && result.observations[0]?.reading.price).toEqual({ value: Number(value), unit: "USD" });
      }),
      { numRuns: 200 },
    );
  });
});
