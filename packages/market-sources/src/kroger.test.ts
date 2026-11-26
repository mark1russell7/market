import { describe, expect, it } from "vitest";
import { AT, KROGER_LOCATION, krogerDetails, krogerProduct, krogerSearch, notes, observations, usd } from "../test/fixtures.ts";
import { KROGER_TERMS, krogerGtin, parseKrogerProduct, parseKrogerProducts } from "./kroger.ts";

const [item] = krogerProduct.items;
if (item === undefined) throw new Error("The fixture has no item.");

function withItem(changes: Record<string, unknown>) {
  return { data: { ...krogerProduct, items: [{ ...item, ...changes }] } };
}

function only(changes: Record<string, unknown>) {
  const [first, ...rest] = observations(parseKrogerProduct(withItem(changes), AT, KROGER_LOCATION));
  expect(rest).toEqual([]);
  if (first === undefined) throw new Error("The parser gave no observation.");
  return first;
}

describe("parseKrogerProduct", () => {
  it("maps the documented product to one offer and one reading at the location", () => {
    const result = parseKrogerProduct(krogerDetails, AT, KROGER_LOCATION);
    expect(notes(result)).toEqual([]);
    expect(observations(result)).toEqual([
      {
        offer: {
          id: "kroger:0003600029145@01234567",
          source: "kroger",
          sourceId: "0003600029145@01234567",
          title: "ExampleBrand Spring Water 24 Bottles",
          url: "https://www.kroger.com/p/examplebrand-spring-water/0003600029145",
          seller: { id: "01234567" },
          condition: "new",
          format: "fixed-price",
          gtins: ["00036000291452"],
          partNumbers: [],
          specs: [
            { name: "size", value: "24 ct / 16.9 fl oz" },
            { name: "sold by", value: "unit" },
            { name: "fulfillment", value: "in store, curbside, delivery" },
          ],
        },
        reading: {
          offerId: "kroger:0003600029145@01234567",
          at: AT,
          price: usd(3.99),
          listPrice: usd(4.99),
          shipping: { kind: "unknown" },
          availability: "in-stock",
        },
      },
    ]);
  });

  it("gives the regular price with no list price when the promo is 0, absent or not lower", () => {
    for (const promo of [0, null, undefined, 4.99, 6]) {
      const { reading } = only({ price: { regular: 4.99, promo } });
      expect(reading.price).toEqual(usd(4.99));
      expect(reading.listPrice).toBeUndefined();
    }
  });

  it("skips an item with no price at the location, with a note", () => {
    for (const price of [undefined, null, {}, { regular: 0, promo: 0 }]) {
      const result = parseKrogerProduct(withItem({ price }), AT, KROGER_LOCATION);
      expect(observations(result)).toEqual([]);
      expect(notes(result)).toEqual(["The offer kroger:0003600029145@01234567 is skipped: it has no price at the location."]);
    }
  });

  it("skips an item with a regular price that is not a decimal of zero or more", () => {
    const result = parseKrogerProduct(withItem({ price: { regular: -1 } }), AT, KROGER_LOCATION);
    expect(observations(result)).toEqual([]);
    expect(notes(result)[0]).toContain("its regular price is not valid");
  });

  describe("an item sold by weight", () => {
    const estimates = { regular: 1.99, promo: 0, regularPerUnitEstimate: 2.5, promoPerUnitEstimate: 0 };
    const byWeight = (price: Record<string, unknown>, itemInformation: unknown = { averageWeightPerUnit: "1.25 [lb_av]" }) =>
      parseKrogerProduct(
        { data: { ...krogerProduct, itemInformation, items: [{ ...item, soldBy: "WEIGHT", price }] } },
        AT,
        KROGER_LOCATION,
      );

    it("gives the estimated price of one unit, and the price for each unit of mass", () => {
      const result = byWeight(estimates);
      expect(notes(result)).toEqual([]);
      const [first] = observations(result);
      expect(first?.reading.price).toEqual(usd(2.5));
      expect(first?.reading.listPrice).toBeUndefined();
      expect(first?.reading.estimate).toBe(true);
      expect(first?.reading.amountPrice).toEqual({ value: 2, unit: "USD/lb" });
    });

    it("gives the estimated sale price, with the estimated regular price as the list price", () => {
      const [first] = observations(byWeight({ ...estimates, promoPerUnitEstimate: 2 }));
      expect(first?.reading.price).toEqual(usd(2));
      expect(first?.reading.listPrice).toEqual(usd(2.5));
      expect(first?.reading.amountPrice).toEqual({ value: 1.6, unit: "USD/lb" });
    });

    it("reads each UCUM unit of mass", () => {
      for (const [weight, unit] of [["8 [oz_av]", "USD/oz"], ["0.5 kg", "USD/kg"], ["500 g", "USD/g"]] as const) {
        expect(observations(byWeight(estimates, { averageWeightPerUnit: weight }))[0]?.reading.amountPrice?.unit).toBe(unit);
      }
    });

    it("skips the item with no estimated price, also when it has a regular price", () => {
      const result = byWeight({ regular: 1.99 });
      expect(observations(result)).toEqual([]);
      expect(notes(result)).toEqual([
        "The offer kroger:0003600029145@01234567 is skipped: it is sold by weight, and it has no estimated price of one unit.",
      ]);
    });

    it("keeps the estimate with no price for each unit of mass when the average weight is not valid, with a note", () => {
      const weights = ["", "heavy", "0 [lb_av]", "8.62 [stone]", "8.62 [in_i]", "8.62 [lb_av]^2", "8.62  [lb_av]", 8.62].map((averageWeightPerUnit) => ({ averageWeightPerUnit }));
      for (const weight of [null, {}, ...weights]) {
        const result = byWeight(estimates, weight);
        const [first] = observations(result);
        expect(first?.reading.estimate, JSON.stringify(weight)).toBe(true);
        expect(first?.reading.amountPrice, JSON.stringify(weight)).toBeUndefined();
        expect(notes(result), JSON.stringify(weight)).toEqual([
          "The offer kroger:0003600029145@01234567 has no average weight, thus it has no price for each unit of mass.",
        ]);
      }
    });

    it("leaves an item sold by unit with no estimate and no price for each unit of mass", () => {
      const reading = only({}).reading;
      expect(reading.estimate).toBeUndefined();
      expect(reading.amountPrice).toBeUndefined();
    });
  });

  it("reads the stock level, and gives unknown when the level is absent", () => {
    expect(only({ inventory: { stockLevel: "LOW" } }).reading.availability).toBe("low-stock");
    expect(only({ inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" } }).reading.availability).toBe("out-of-stock");
    expect(only({ inventory: undefined }).reading.availability).toBe("unknown");
    expect(only({ inventory: { stockLevel: "SOMETIMES" } }).reading.availability).toBe("unknown");
  });

  it("gives no fulfillment spec when no fulfillment is true", () => {
    const { offer } = only({ fulfillment: { instore: false } });
    expect(offer.specs.map((spec) => spec.name)).toEqual(["size", "sold by"]);
  });

  it("gives no URL for a page path that is not a path of the site", () => {
    for (const uri of ["https://example.com/p/1", "//example.com/p/1", "p/1", 7]) {
      const [first] = observations(parseKrogerProduct({ data: { ...krogerProduct, productPageURI: uri } }, AT, KROGER_LOCATION));
      expect(first?.offer.url).toBeUndefined();
    }
  });

  it("uses the product id as the item id when an item has no itemId", () => {
    expect(only({ itemId: undefined }).offer.sourceId).toBe("0003600029145@01234567");
  });

  it("gives one offer for each location, so the price of each store is its own offer", () => {
    const [here] = observations(parseKrogerProduct(krogerDetails, AT, KROGER_LOCATION));
    const [there] = observations(parseKrogerProduct(krogerDetails, AT, "07654321"));
    expect(here?.offer.id).not.toBe(there?.offer.id);
    expect(there?.offer.seller).toEqual({ id: "07654321" });
  });

  it("skips a product with no items and an item that is not an object", () => {
    expect(notes(parseKrogerProduct({ data: { ...krogerProduct, items: [] } }, AT, KROGER_LOCATION))).toEqual([
      "The product data is skipped: it has no items.",
    ]);
    expect(notes(parseKrogerProduct({ data: { ...krogerProduct, items: [7] } }, AT, KROGER_LOCATION))).toEqual([
      "The item data.items[0] is skipped: it is not an object with an itemId.",
    ]);
  });

  it("skips a product with no description", () => {
    const result = parseKrogerProduct({ data: { ...krogerProduct, description: "" } }, AT, KROGER_LOCATION);
    expect(notes(result)).toEqual(["The offer kroger:0003600029145@01234567 is skipped: it has no description."]);
  });

  it("refuses an answer that is not the documented shape", () => {
    expect(parseKrogerProduct([], AT, KROGER_LOCATION)).toEqual({ ok: false, problems: ["The answer of Product details is not an object."] });
    expect(parseKrogerProduct({ errors: { reason: "x" } }, AT, KROGER_LOCATION)).toEqual({
      ok: false,
      problems: ["The field data of the answer is not an object."],
    });
  });

  it("throws a RangeError on a location id that is not 8 letters or digits", () => {
    for (const bad of ["", "0123456", "012345678", "0123 567"]) {
      expect(() => parseKrogerProduct(krogerDetails, AT, bad)).toThrow(RangeError);
    }
  });
});

describe("parseKrogerProducts", () => {
  it("maps each product of a search to its offer", () => {
    const result = parseKrogerProducts(krogerSearch, AT, KROGER_LOCATION);
    expect(notes(result)).toEqual([]);
    const found = observations(result);
    expect(found.map(({ offer }) => offer.id)).toEqual(["kroger:0003600029145@01234567", "kroger:0001111041700@01234567"]);
    expect(found[1]?.offer.gtins).toEqual(["00011110417008"]);
    expect(found[1]?.reading).toMatchObject({ price: usd(1.99), availability: "low-stock" });
    expect(found[1]?.reading.listPrice).toBeUndefined();
  });

  it("gives no observations for an empty search", () => {
    expect(parseKrogerProducts({ data: [], meta: {} }, AT, KROGER_LOCATION)).toEqual({ ok: true, observations: [], notes: [] });
  });

  it("refuses an answer with no list of data", () => {
    expect(parseKrogerProducts({ data: {} }, AT, KROGER_LOCATION)).toEqual({ ok: false, problems: ["The field data of the answer is not a list."] });
  });
});

describe("krogerGtin", () => {
  it("adds the check digit to a product id of 13 digits", () => {
    expect(krogerGtin("0003600029145")).toBe("00036000291452");
    expect(krogerGtin("0001111041700")).toBe("00011110417008");
  });

  it("gives no GTIN for a PLU code, a number of the store and a text that is not 13 digits", () => {
    expect(krogerGtin("0000000004011")).toBeNull();
    expect(krogerGtin("0020000012345")).toBeNull();
    expect(krogerGtin("0040000012345")).toBeNull();
    expect(krogerGtin("0200000012345")).toBeNull();
    expect(krogerGtin("000360002914")).toBeNull();
    expect(krogerGtin("000360002914x")).toBeNull();
    expect(krogerGtin(3600029145)).toBeNull();
  });
});

describe("KROGER_TERMS", () => {
  it("keep no reading and permit no model of prices", () => {
    expect(KROGER_TERMS.retention).toEqual({ kind: "no-store" });
    expect(KROGER_TERMS.priceModel).toBe(false);
  });
});
