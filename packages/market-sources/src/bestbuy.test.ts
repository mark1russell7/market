import { describe, expect, it } from "vitest";
import { AT, bestBuyOpenBox, bestBuyProduct, bestBuyProducts, notes, observations, usd } from "../test/fixtures.ts";
import { bestBuyCondition, parseBestBuyOpenBox, parseBestBuyProduct, parseBestBuyProducts } from "./bestbuy.ts";

function only(changes: Record<string, unknown>) {
  const [first, ...rest] = observations(parseBestBuyProduct({ ...bestBuyProduct, ...changes }, AT));
  expect(rest).toEqual([]);
  if (first === undefined) throw new Error("The parser gave no observation.");
  return first;
}

describe("parseBestBuyProduct", () => {
  it("maps the documented product to one offer and one reading", () => {
    const result = parseBestBuyProduct(bestBuyProduct, AT);
    expect(notes(result)).toEqual([]);
    expect(observations(result)).toEqual([
      {
        offer: {
          id: "bestbuy:1234567",
          source: "bestbuy",
          sourceId: "1234567",
          title: "ExampleBrand - Example Widget 1000 - Black",
          url: "https://www.example.com/click/-/1234567/pdp",
          seller: {},
          condition: "new",
          grade: "New",
          format: "fixed-price",
          gtins: ["00036000291452"],
          partNumbers: [{ brand: "ExampleBrand", partNumber: "EXW-1000" }],
          specs: [],
        },
        reading: {
          offerId: "bestbuy:1234567",
          at: AT,
          price: usd(99.99),
          listPrice: usd(129.99),
          shipping: { kind: "unknown" },
          availability: "in-stock",
        },
      },
    ]);
  });

  it("gives no list price when the regular price equals the sale price, even with onSale true", () => {
    expect(only({ salePrice: 129.99, regularPrice: 129.99, onSale: true }).reading.listPrice).toBeUndefined();
  });

  it("reads the shipping", () => {
    expect(only({ freeShipping: true }).reading.shipping).toEqual({ kind: "free" });
    expect(only({ shippingCost: "5.99" }).reading.shipping).toEqual({ kind: "fixed", cost: usd(5.99) });
    expect(only({ shippingCost: 5.99 }).reading.shipping).toEqual({ kind: "fixed", cost: usd(5.99) });
    expect(only({ shippingCost: 0 }).reading.shipping).toEqual({ kind: "unknown" });
    expect(only({ shippingCost: null }).reading.shipping).toEqual({ kind: "unknown" });
    expect(only({ shippingCost: "-2" }).reading.shipping).toEqual({ kind: "unknown" });
  });

  it("reads the stock", () => {
    expect(only({ onlineAvailability: false }).reading.availability).toBe("out-of-stock");
    expect(only({ active: false }).reading.availability).toBe("out-of-stock");
    expect(only({ orderable: "SoldOut" }).reading.availability).toBe("unknown");
    expect(only({ orderable: null }).reading.availability).toBe("in-stock");
    expect(only({ orderable: null, onlineAvailability: null }).reading.availability).toBe("unknown");
  });

  it("maps the condition", () => {
    expect(bestBuyCondition("New", false)).toBe("new");
    expect(bestBuyCondition("Refurbished", false)).toBe("refurbished");
    expect(bestBuyCondition("Geek Squad Certified Refurbished", false)).toBe("refurbished");
    expect(bestBuyCondition("Pre-Owned", false)).toBe("used");
    expect(bestBuyCondition(null, true)).toBe("used");
    expect(bestBuyCondition("Other", false)).toBe("unknown");
    expect(bestBuyCondition(undefined, undefined)).toBe("unknown");
  });

  it("reads a sku as a number or as a text of digits", () => {
    expect(only({ sku: "7654321" }).offer.id).toBe("bestbuy:7654321");
    expect(notes(parseBestBuyProduct({ ...bestBuyProduct, sku: 1.5 }, AT))).toEqual([
      "The product of the answer is skipped: it has no sku.",
    ]);
    expect(notes(parseBestBuyProduct({ ...bestBuyProduct, sku: "12a" }, AT))).toHaveLength(1);
  });

  it("keeps the details as specs, and skips a bad UPC with a note", () => {
    const { offer } = only({ details: [{ name: "Capacity", value: "16 GB" }, { name: "Empty", value: "" }] });
    expect(offer.specs).toEqual([{ name: "Capacity", value: "16 GB" }]);
    const result = parseBestBuyProduct({ ...bestBuyProduct, upc: "036000291453" }, AT);
    expect(observations(result)[0]?.offer.gtins).toEqual([]);
    expect(notes(result)).toEqual(['The offer bestbuy:1234567 has no GTIN: "036000291453" is not a valid UPC.']);
  });

  it("skips a product with no valid sale price", () => {
    const result = parseBestBuyProduct({ ...bestBuyProduct, salePrice: -1 }, AT);
    expect(observations(result)).toEqual([]);
    expect(notes(result)[0]).toContain("its salePrice is not valid");
  });

  it("refuses an answer that is not an object", () => {
    expect(parseBestBuyProduct(null, AT).ok).toBe(false);
  });
});

describe("parseBestBuyProducts", () => {
  it("maps each product of the list, and skips a product with no sku", () => {
    const answer = { ...bestBuyProducts, products: [bestBuyProduct, { name: "no sku" }, { ...bestBuyProduct, sku: 7654321 }] };
    const result = parseBestBuyProducts(answer, AT);
    expect(observations(result).map((each) => each.offer.id)).toEqual(["bestbuy:1234567", "bestbuy:7654321"]);
    expect(notes(result)).toEqual(["The product products[1] is skipped: it has no sku."]);
  });

  it("refuses an answer with no list products", () => {
    expect(parseBestBuyProducts({ errorCode: "403", errorMessage: "Over the limit" }, AT).ok).toBe(false);
  });
});

describe("parseBestBuyOpenBox", () => {
  it("maps each open-box offer to its own offer", () => {
    const result = parseBestBuyOpenBox(bestBuyOpenBox, AT);
    expect(notes(result)).toEqual([]);
    const [excellent, certified, ...rest] = observations(result);
    expect(rest).toEqual([]);
    expect(excellent).toEqual({
      offer: {
        id: "bestbuy:1234567/open-box/2",
        source: "bestbuy",
        sourceId: "1234567/open-box/2",
        title: "ExampleBrand - Example Widget 1000 - Black",
        url: "https://www.example.com/click/-/1234567/pdp#tab=buyingOptions",
        seller: {},
        condition: "open-box",
        grade: "excellent",
        format: "fixed-price",
        gtins: [],
        partNumbers: [],
        specs: [],
      },
      reading: {
        offerId: "bestbuy:1234567/open-box/2",
        at: AT,
        price: usd(84.99),
        listPrice: usd(129.99),
        shipping: { kind: "unknown" },
        availability: "in-stock",
      },
    });
    expect(certified?.offer.grade).toBe("certified");
    expect(certified?.reading.availability).toBe("out-of-stock");
  });

  it("names an offer with no listingId by its condition, and skips an offer with neither", () => {
    const [result] = bestBuyOpenBox.results;
    const offers = [
      { condition: "excellent", prices: { current: 80 } },
      { prices: { current: 70 } },
    ];
    const parsed = parseBestBuyOpenBox({ ...bestBuyOpenBox, results: [{ ...result, offers }] }, AT);
    expect(observations(parsed).map((each) => each.offer.id)).toEqual(["bestbuy:1234567/open-box/excellent"]);
    expect(notes(parsed)).toEqual(["The offer results[0].offers[1] is skipped: it has no listingId and no condition."]);
  });

  it("gives no observations for an empty result set", () => {
    expect(parseBestBuyOpenBox({ metadata: { resultSet: { count: 0 } }, results: [] }, AT)).toEqual({
      ok: true,
      observations: [],
      notes: [],
    });
    expect(parseBestBuyOpenBox({ metadata: { resultSet: { count: 0 } } }, AT).ok).toBe(true);
  });

  it("refuses an answer with no results and a count above 0", () => {
    expect(parseBestBuyOpenBox({ metadata: { resultSet: { count: 2 } } }, AT).ok).toBe(false);
    expect(parseBestBuyOpenBox({}, AT).ok).toBe(false);
  });
});
