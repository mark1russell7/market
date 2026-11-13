import { describe, expect, it } from "vitest";
import { ebayCondition, parseEbayItem, parseEbaySearch } from "./ebay.ts";
import { AT, ebayItem, ebaySearch, notes, observations, usd } from "../test/fixtures.ts";

function item(changes: Record<string, unknown>) {
  return { ...ebayItem, ...changes };
}

function only(changes: Record<string, unknown>) {
  const [first, ...rest] = observations(parseEbayItem(item(changes), AT));
  expect(rest).toEqual([]);
  if (first === undefined) throw new Error("The parser gave no observation.");
  return first;
}

describe("parseEbayItem", () => {
  it("maps the documented item to one offer and one reading", () => {
    const result = parseEbayItem(ebayItem, AT);
    expect(notes(result)).toEqual([]);
    expect(observations(result)).toEqual([
      {
        offer: {
          id: "ebay:v1|110000000001|0",
          source: "ebay",
          sourceId: "v1|110000000001|0",
          title: "ExampleBrand Example Widget 1000, 16 GB, Black",
          url: "https://www.example.com/itm/110000000001",
          seller: { name: "example_seller", rating: { percent: 99.2, count: 1234 } },
          condition: "used",
          grade: "Used",
          format: "fixed-price",
          endsAt: "2026-12-31T23:59:59.000Z",
          gtins: ["00036000291452"],
          partNumbers: [{ brand: "ExampleBrand", partNumber: "EXW-1000" }],
          specs: [
            { name: "Brand", value: "ExampleBrand" },
            { name: "MPN", value: "EXW-1000" },
            { name: "Storage Capacity", value: "16 GB" },
          ],
        },
        reading: {
          offerId: "ebay:v1|110000000001|0",
          at: AT,
          price: usd(129.99),
          listPrice: usd(159.99),
          shipping: { kind: "fixed", cost: usd(4.99) },
          availability: "in-stock",
          available: 3,
        },
      },
    ]);
  });

  it("prices an auction by its current bid, and gives it no list price", () => {
    const { offer, reading } = only({ buyingOptions: ["AUCTION"], currentBidPrice: { value: "12.50", currency: "USD" } });
    expect(offer.format).toBe("auction");
    expect(reading.price).toEqual(usd(12.5));
    expect(reading.listPrice).toBeUndefined();
  });

  it("prices an auction with no bid price by its price", () => {
    const { offer, reading } = only({ buyingOptions: ["AUCTION"] });
    expect(offer.format).toBe("auction");
    expect(reading.price).toEqual(usd(129.99));
  });

  it("treats an auction with Buy It Now as a fixed price, because a buyer can pay the price now", () => {
    const { offer, reading } = only({
      buyingOptions: ["AUCTION", "FIXED_PRICE"],
      currentBidPrice: { value: "12.50", currency: "USD" },
    });
    expect(offer.format).toBe("fixed-price");
    expect(reading.price).toEqual(usd(129.99));
  });

  it("treats an item with no buying options as a fixed price, the default of search", () => {
    const { buyingOptions: _, ...rest } = ebayItem;
    const [observation] = observations(parseEbayItem(rest, AT));
    expect(observation?.offer.format).toBe("fixed-price");
  });

  it("skips a classified ad, because it has no price to pay", () => {
    const result = parseEbayItem(item({ buyingOptions: ["CLASSIFIED_AD"] }), AT);
    expect(observations(result)).toEqual([]);
    expect(notes(result)).toEqual([
      "The offer ebay:v1|110000000001|0 is skipped: its buying options CLASSIFIED_AD have no price to pay.",
    ]);
  });

  it("skips an ended listing, because the terms delete it", () => {
    const result = parseEbayItem(item({ itemEndDate: "2026-11-12T17:59:59.000Z" }), AT);
    expect(observations(result)).toEqual([]);
    expect(notes(result)[0]).toContain("the listing ended at 2026-11-12T17:59:59.000Z");
    expect(observations(parseEbayItem(item({ itemEndDate: AT }), AT))).toEqual([]);
  });

  it("gives no list price when the original price is not more than the price, or is in another currency", () => {
    expect(only({ marketingPrice: { originalPrice: { value: "129.99", currency: "USD" } } }).reading.listPrice).toBeUndefined();
    expect(only({ marketingPrice: { originalPrice: { value: "100.00", currency: "USD" } } }).reading.listPrice).toBeUndefined();
    expect(only({ marketingPrice: { originalPrice: { value: "159.99", currency: "EUR" } } }).reading.listPrice).toBeUndefined();
    expect(only({ marketingPrice: null }).reading.listPrice).toBeUndefined();
  });

  describe("the shipping", () => {
    const fixed = (value: string) => ({ shippingCostType: "FIXED", shippingCost: { value, currency: "USD" } });

    it("is free when the cheapest fixed cost is 0", () => {
      expect(only({ shippingOptions: [fixed("7.00"), fixed("0.00")] }).reading.shipping).toEqual({ kind: "free" });
    });

    it("is the cheapest fixed cost", () => {
      expect(only({ shippingOptions: [fixed("7.00"), fixed("4.50")] }).reading.shipping).toEqual({
        kind: "fixed",
        cost: usd(4.5),
      });
    });

    it("is calculated when no option has a fixed cost and an option is calculated", () => {
      expect(only({ shippingOptions: [{ shippingCostType: "CALCULATED" }] }).reading.shipping).toEqual({ kind: "calculated" });
    });

    it("is a fixed cost when one option is fixed and one is calculated", () => {
      expect(only({ shippingOptions: [{ shippingCostType: "CALCULATED" }, fixed("3.00")] }).reading.shipping).toEqual({
        kind: "fixed",
        cost: usd(3),
      });
    });

    it("is unknown with no options, with an unknown type, or with a cost in another currency", () => {
      expect(only({ shippingOptions: [] }).reading.shipping).toEqual({ kind: "unknown" });
      expect(only({ shippingOptions: null }).reading.shipping).toEqual({ kind: "unknown" });
      expect(only({ shippingOptions: [{ shippingCostType: "PICKUP" }] }).reading.shipping).toEqual({ kind: "unknown" });
      const euro = [{ shippingCostType: "FIXED", shippingCost: { value: "1.00", currency: "EUR" } }];
      expect(only({ shippingOptions: euro }).reading.shipping).toEqual({ kind: "unknown" });
    });
  });

  describe("the stock", () => {
    const stock = (estimate: Record<string, unknown>) => only({ estimatedAvailabilities: [estimate] }).reading;

    it("maps each status of eBay", () => {
      expect(stock({ estimatedAvailabilityStatus: "LIMITED_STOCK" }).availability).toBe("low-stock");
      expect(stock({ estimatedAvailabilityStatus: "OUT_OF_STOCK" }).availability).toBe("out-of-stock");
      expect(stock({ estimatedAvailabilityStatus: "SOMETHING_NEW" }).availability).toBe("unknown");
      expect(only({ estimatedAvailabilities: null }).reading.availability).toBe("unknown");
    });

    it("gives no count with the threshold MORE_THAN, because the true count is above the threshold", () => {
      const reading = stock({
        estimatedAvailabilityStatus: "IN_STOCK",
        estimatedAvailableQuantity: 10,
        availabilityThreshold: 10,
        availabilityThresholdType: "MORE_THAN",
      });
      expect(reading.availability).toBe("in-stock");
      expect(reading.available).toBeUndefined();
    });

    it("gives the count 0 for an item out of stock", () => {
      const reading = stock({ estimatedAvailabilityStatus: "OUT_OF_STOCK", estimatedAvailableQuantity: 0 });
      expect(reading.available).toBe(0);
    });

    it("drops a count that does not agree with the status, with a note", () => {
      const result = parseEbayItem(
        item({ estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK", estimatedAvailableQuantity: 0 }] }),
        AT,
      );
      expect(observations(result)[0]?.reading.available).toBeUndefined();
      expect(notes(result)).toEqual(["The offer ebay:v1|110000000001|0 has no count: the count 0 does not agree with in-stock."]);
    });
  });

  describe("the price", () => {
    it.each(["1e3", "-1", "12.", ".5", " 12", "0x10", "12,00", "", "Infinity"])("skips the price %j with a note", (value) => {
      const result = parseEbayItem(item({ price: { value, currency: "USD" } }), AT);
      expect(observations(result)).toEqual([]);
      expect(notes(result)[0]).toContain(`its price is not valid: the amount ${JSON.stringify(value)} is not a decimal of zero or more.`);
    });

    it("reads a whole decimal and a decimal with many digits", () => {
      expect(only({ price: { value: "12", currency: "USD" } }).reading.price).toEqual(usd(12));
      expect(only({ price: { value: "0.001", currency: "USD" } }).reading.price).toEqual(usd(0.001));
    });

    it("skips a price in a currency that quantity does not know, and names the currency", () => {
      const result = parseEbayItem(item({ price: { value: "10.00", currency: "GBP" } }), AT);
      expect(observations(result)).toEqual([]);
      expect(notes(result)[0]).toContain('the currency "GBP" is not a money unit');
    });

    it("skips an item with no price", () => {
      const { price: _, ...rest } = ebayItem;
      expect(notes(parseEbayItem(rest, AT))).toEqual(["The offer ebay:v1|110000000001|0 is skipped: it has no price."]);
    });
  });

  describe("the seller and the identifiers", () => {
    it("gives no rating when the score is not a whole number of zero or more, or the percent is above 100", () => {
      expect(only({ seller: { username: "a", feedbackPercentage: "99.0", feedbackScore: -1 } }).offer.seller).toEqual({ name: "a" });
      expect(only({ seller: { username: "a", feedbackPercentage: "100.1", feedbackScore: 5 } }).offer.seller).toEqual({ name: "a" });
      expect(only({ seller: { username: "a", feedbackPercentage: "100.0", feedbackScore: 0 } }).offer.seller).toEqual({
        name: "a",
        rating: { percent: 100, count: 0 },
      });
      expect(only({ seller: null }).offer.seller).toEqual({});
    });

    it("keeps the immutable user id of a seller as its id", () => {
      expect(only({ seller: { username: "a", userId: "u-1" } }).offer.seller).toEqual({ id: "u-1", name: "a" });
    });

    it("skips the placeholder Does not apply, with no note", () => {
      const result = parseEbayItem(item({ gtin: "Does not apply", mpn: "Does not apply" }), AT);
      expect(notes(result)).toEqual([]);
      expect(observations(result)[0]?.offer.gtins).toEqual([]);
      expect(observations(result)[0]?.offer.partNumbers).toEqual([]);
    });

    it("skips a GTIN with a wrong check digit, with a note", () => {
      const result = parseEbayItem(item({ gtin: "036000291453" }), AT);
      expect(observations(result)[0]?.offer.gtins).toEqual([]);
      expect(notes(result)).toEqual(['The offer ebay:v1|110000000001|0 has no GTIN: "036000291453" is not a valid GTIN.']);
    });

    it("drops a URL that is not https", () => {
      expect(only({ itemWebUrl: "http://www.example.com/itm/1" }).offer.url).toBeUndefined();
    });
  });

  it("maps each condition id of the eBay table", () => {
    const table: Record<string, string> = {
      "1000": "new",
      "1500": "open-box",
      "1750": "new",
      "2000": "refurbished",
      "2010": "refurbished",
      "2020": "refurbished",
      "2030": "refurbished",
      "2500": "refurbished",
      "2750": "used",
      "2990": "used",
      "3000": "used",
      "3010": "used",
      "4000": "used",
      "5000": "used",
      "6000": "used",
      "7000": "for-parts",
      "9999": "unknown",
    };
    for (const [id, condition] of Object.entries(table)) expect(ebayCondition(id)).toBe(condition);
    expect(ebayCondition(3000)).toBe("used");
    expect(ebayCondition(undefined)).toBe("unknown");
  });

  it("refuses an answer that is not an object, and skips an item with no itemId", () => {
    expect(parseEbayItem([], AT)).toEqual({ ok: false, problems: ["The answer of getItem is not an object."] });
    expect(notes(parseEbayItem({ title: "x" }, AT))).toEqual(["The item of the answer is skipped: it has no itemId."]);
  });

  it("throws on an instant that is not UTC ISO 8601", () => {
    expect(() => parseEbayItem(ebayItem, "2026-11-12 18:00")).toThrow(RangeError);
    expect(() => parseEbayItem(ebayItem, "2026-11-12T18:00:00+01:00")).toThrow(RangeError);
  });
});

describe("parseEbaySearch", () => {
  it("maps an item summary, which has no identifiers and no stock", () => {
    const [observation, ...rest] = observations(parseEbaySearch(ebaySearch, AT));
    expect(rest).toEqual([]);
    expect(observation?.offer).toMatchObject({ gtins: [], partNumbers: [], specs: [], condition: "used" });
    expect(observation?.reading).toEqual({
      offerId: "ebay:v1|110000000001|0",
      at: AT,
      price: usd(129.99),
      shipping: { kind: "free" },
      availability: "unknown",
    });
  });

  it("gives no observations for an answer with total 0 and no itemSummaries", () => {
    expect(parseEbaySearch({ href: "x", total: 0, limit: 50, offset: 0 }, AT)).toEqual({ ok: true, observations: [], notes: [] });
  });

  it("refuses an answer with no itemSummaries and a total above 0, or with itemSummaries that is not a list", () => {
    expect(parseEbaySearch({ total: 3 }, AT).ok).toBe(false);
    expect(parseEbaySearch({ total: 1, itemSummaries: {} }, AT).ok).toBe(false);
    expect(parseEbaySearch({ errors: [{ errorId: 1001 }] }, AT).ok).toBe(false);
    expect(parseEbaySearch("x", AT).ok).toBe(false);
  });

  it("skips a bad summary with a note, keeps the good ones, and counts a repeated item once", () => {
    const [summary] = ebaySearch.itemSummaries;
    const second = { ...summary, itemId: "v1|110000000002|0" };
    const result = parseEbaySearch({ ...ebaySearch, itemSummaries: [summary, 7, { title: "no id" }, second, summary] }, AT);
    expect(observations(result).map((each) => each.offer.id)).toEqual(["ebay:v1|110000000001|0", "ebay:v1|110000000002|0"]);
    expect(notes(result)).toEqual([
      "The item itemSummaries[1] is skipped: it is not an object.",
      "The item itemSummaries[2] is skipped: it has no itemId.",
    ]);
  });
});
