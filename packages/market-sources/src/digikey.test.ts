import { costOf, unitPriceFor } from "@mark1russell7/market";
import { describe, expect, it } from "vitest";
import { AT, digiKeyDetails, digiKeyKeyword, digiKeyProduct, notes, observations, usd } from "../test/fixtures.ts";
import { parseDigiKeyKeywordSearch, parseDigiKeyProductDetails } from "./digikey.ts";

const [cutTape] = digiKeyProduct.ProductVariations;

function withVariation(changes: Record<string, unknown>) {
  const variation = { ...cutTape, ...changes };
  return { ...digiKeyDetails, Product: { ...digiKeyProduct, ProductVariations: [variation] } };
}

function only(changes: Record<string, unknown>) {
  const [first, ...rest] = observations(parseDigiKeyProductDetails(withVariation(changes), AT));
  expect(rest).toEqual([]);
  if (first === undefined) throw new Error("The parser gave no observation.");
  return first;
}

const breaks = (...pairs: readonly [number, number][]) =>
  pairs.map(([quantity, price]) => ({ BreakQuantity: quantity, UnitPrice: price, TotalPrice: quantity * price }));

describe("parseDigiKeyProductDetails", () => {
  it("maps each variation of the documented product to one offer", () => {
    const result = parseDigiKeyProductDetails(digiKeyDetails, AT);
    expect(notes(result)).toEqual([]);
    const [cut, reel, ...rest] = observations(result);
    expect(rest).toEqual([]);
    expect(cut).toEqual({
      offer: {
        id: "digikey:EXR-0603-10KCT-ND",
        source: "digikey",
        sourceId: "EXR-0603-10KCT-ND",
        title: "RES 10K OHM 1% 1/10W 0603",
        url: "https://www.example.com/en/products/detail/examplebrand/EXR-0603-10K/1000001",
        seller: { name: "Digi-Key" },
        condition: "new",
        format: "fixed-price",
        gtins: [],
        partNumbers: [{ brand: "ExampleBrand", partNumber: "EXR-0603-10K" }],
        specs: [
          { name: "Resistance", value: "10 kOhms" },
          { name: "Tolerance", value: "±1%" },
          { name: "Product status", value: "Active" },
          { name: "Package type", value: "Cut Tape (CT)" },
        ],
      },
      reading: {
        offerId: "digikey:EXR-0603-10KCT-ND",
        at: AT,
        price: usd(0.1),
        shipping: { kind: "unknown" },
        availability: "in-stock",
        available: 25000,
        priceBreaks: [
          { quantity: 10, unitPrice: usd(0.05) },
          { quantity: 100, unitPrice: usd(0.02) },
        ],
      },
    });
    expect(reel?.reading).toEqual({
      offerId: "digikey:EXR-0603-10KTR-ND",
      at: AT,
      price: usd(0.004),
      shipping: { kind: "unknown" },
      availability: "out-of-stock",
      available: 0,
      minimumQuantity: 5000,
      priceBreaks: [{ quantity: 10000, unitPrice: usd(0.003) }],
    });
  });

  it("gives the market functions the price of Digi-Key for each count", () => {
    const [cut] = observations(parseDigiKeyProductDetails(digiKeyDetails, AT));
    if (cut === undefined) throw new Error("The parser gave no observation.");
    expect(unitPriceFor(cut.reading, 1)).toEqual(usd(0.1));
    expect(unitPriceFor(cut.reading, 99)).toEqual(usd(0.05));
    expect(unitPriceFor(cut.reading, 100)).toEqual(usd(0.02));
    expect(costOf(cut.reading, 10)).toBeNull();
  });

  it("prices a minimum order between two breaks by the break below it", () => {
    const { reading } = only({ MinimumOrderQuantity: 25 });
    expect(reading.minimumQuantity).toBe(25);
    expect(reading.price).toEqual(usd(0.05));
    expect(reading.priceBreaks).toEqual([{ quantity: 100, unitPrice: usd(0.02) }]);
  });

  it("raises the minimum to the lowest break", () => {
    const { reading } = only({ MinimumOrderQuantity: 1, StandardPricing: breaks([50, 0.04], [500, 0.03]) });
    expect(reading.minimumQuantity).toBe(50);
    expect(reading.price).toEqual(usd(0.04));
    expect(reading.priceBreaks).toEqual([{ quantity: 500, unitPrice: usd(0.03) }]);
  });

  it("sorts the breaks, keeps the first of a repeated quantity, and drops a bad break", () => {
    const pricing = [...breaks([100, 0.02], [1, 0.1], [10, 0.05], [10, 0.07]), { BreakQuantity: 0, UnitPrice: 1 }, { UnitPrice: 1 }];
    const { reading } = only({ StandardPricing: pricing });
    expect(reading.price).toEqual(usd(0.1));
    expect(reading.priceBreaks).toEqual([
      { quantity: 10, unitPrice: usd(0.05) },
      { quantity: 100, unitPrice: usd(0.02) },
    ]);
  });

  it("skips a variation with no valid price, with a note", () => {
    const result = parseDigiKeyProductDetails(withVariation({ StandardPricing: [] }), AT);
    expect(observations(result)).toEqual([]);
    expect(notes(result)).toEqual(["The offer digikey:EXR-0603-10KCT-ND is skipped: it has no valid StandardPricing."]);
  });

  it("names the supplier of a marketplace offer as its seller", () => {
    const { offer } = only({ MarketPlace: true, Supplier: { Id: 4242, Name: "Example Supplier" } });
    expect(offer.seller).toEqual({ id: "4242", name: "Example Supplier" });
    expect(only({ MarketPlace: true, Supplier: null }).offer.seller).toEqual({});
  });

  it("accepts null, an empty text and a missing key for each optional field", () => {
    const product = {
      ...digiKeyProduct,
      Description: null,
      ProductUrl: "",
      Manufacturer: { Id: 1, Name: null },
      ProductStatus: null,
      Parameters: null,
      ProductVariations: [{ ...cutTape, PackageType: null, QuantityAvailableforPackageType: null, MinimumOrderQuantity: "" }],
    };
    const result = parseDigiKeyProductDetails({ ...digiKeyDetails, Product: product }, AT);
    expect(notes(result)).toEqual([]);
    const [observation] = observations(result);
    expect(observation?.offer).toMatchObject({ title: "EXR-0603-10K", partNumbers: [], specs: [] });
    expect(observation?.offer.url).toBeUndefined();
    expect(observation?.reading.availability).toBe("unknown");
    expect(observation?.reading.available).toBeUndefined();
  });

  it("notes a product with no variations", () => {
    const result = parseDigiKeyProductDetails({ ...digiKeyDetails, Product: { ...digiKeyProduct, ProductVariations: [] } }, AT);
    expect(observations(result)).toEqual([]);
    expect(notes(result)).toEqual(["The product Product has no ProductVariations, so it gives no offer."]);
  });

  it("refuses an answer with no currency, with a currency that quantity does not know, or with no product", () => {
    expect(parseDigiKeyProductDetails({ ...digiKeyDetails, SearchLocaleUsed: null }, AT)).toEqual({
      ok: false,
      problems: ["The answer names no currency in SearchLocaleUsed.Currency."],
    });
    expect(parseDigiKeyProductDetails({ ...digiKeyDetails, SearchLocaleUsed: { Currency: "EUR" } }, AT)).toEqual({
      ok: false,
      problems: ['The currency "EUR" of the answer is not a money unit of @mark1russell7/quantity.'],
    });
    expect(parseDigiKeyProductDetails({ ...digiKeyDetails, Product: null }, AT).ok).toBe(false);
    expect(parseDigiKeyProductDetails("x", AT).ok).toBe(false);
  });
});

describe("parseDigiKeyKeywordSearch", () => {
  it("counts a product in Products and in ExactMatches once", () => {
    const result = parseDigiKeyKeywordSearch(digiKeyKeyword, AT);
    expect(observations(result).map((each) => each.offer.id)).toEqual([
      "digikey:EXR-0603-10KCT-ND",
      "digikey:EXR-0603-10KTR-ND",
    ]);
  });

  it("reads an answer with only one of the two lists", () => {
    expect(observations(parseDigiKeyKeywordSearch({ ...digiKeyKeyword, ExactMatches: null }, AT))).toHaveLength(2);
    expect(observations(parseDigiKeyKeywordSearch({ ...digiKeyKeyword, Products: [] }, AT))).toHaveLength(2);
  });

  it("refuses an answer with neither list", () => {
    expect(parseDigiKeyKeywordSearch({ SearchLocaleUsed: { Currency: "USD" } }, AT).ok).toBe(false);
  });
});
