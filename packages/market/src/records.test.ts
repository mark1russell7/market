import { describe, expect, it } from "vitest";
import {
  gtinSchema,
  instantSchema,
  moneySchema,
  offerId,
  offerSchema,
  priceReadingSchema,
  productSchema,
  sellerSchema,
  sourceOfOffer,
  sourceSchema,
  textSchema,
  type Offer,
  type PriceReading,
  type Product,
} from "./records.ts";

const usd = (value: number) => ({ value, unit: "USD" });

const product: Product = {
  id: "ssd-samsung-990-evo-1tb",
  title: "Samsung 990 EVO 1 TB NVMe SSD",
  brand: "Samsung",
  category: ["Storage", "SSD"],
  gtins: ["00036000291452"],
  partNumbers: [{ brand: "Samsung", partNumber: "MZ-V9E1T0B/AM" }],
  specs: [{ name: "Capacity", value: "1 TB" }],
};

const offer: Offer = {
  id: "ebay:123456789012",
  source: "ebay",
  sourceId: "123456789012",
  productId: product.id,
  title: "Samsung 990 EVO 1TB",
  url: "https://www.example.com/itm/123456789012",
  seller: { id: "s-1", name: "A seller", rating: { percent: 99.5, count: 1200 } },
  condition: "used",
  grade: "Used - Very Good",
  format: "fixed-price",
  gtins: ["00036000291452"],
  partNumbers: [],
  specs: [],
};

const reading: PriceReading = {
  offerId: offer.id,
  at: "2026-11-12T18:00:00Z",
  price: usd(64.99),
  listPrice: usd(89.99),
  shipping: { kind: "fixed", cost: usd(4.5) },
  availability: "in-stock",
  available: 3,
};

const problems = (result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string[] =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message);

describe("the text and the names", () => {
  it("accepts a text with no space at an end", () => {
    expect(textSchema.safeParse("a b").success).toBe(true);
  });

  it("refuses an empty text and a text with a space at an end", () => {
    for (const text of ["", " ", " a", "a ", "a\n"]) {
      expect(problems(textSchema.safeParse(text))).toEqual(["The text is empty, or it has a space at an end."]);
    }
  });

  it("accepts a source name of small letters, digits and hyphens", () => {
    for (const name of ["ebay", "best-buy", "digikey4", "a"]) expect(sourceSchema.safeParse(name).success).toBe(true);
    for (const name of ["", "eBay", "4ebay", "-ebay", "e_bay", "e bay"]) expect(sourceSchema.safeParse(name).success).toBe(false);
  });

  it("accepts a GTIN-14 only", () => {
    expect(gtinSchema.safeParse("00036000291452").success).toBe(true);
    for (const text of ["036000291452", "00036000291453", "0003600029145a", "00000000000000"]) {
      expect(problems(gtinSchema.safeParse(text))).toEqual(["The GTIN is not a GTIN-14 with a correct check digit."]);
    }
  });

  it("accepts money of zero or more in a canonical unit", () => {
    expect(moneySchema.safeParse(usd(0)).success).toBe(true);
    expect(moneySchema.safeParse(usd(-0.01)).success).toBe(false);
    expect(moneySchema.safeParse({ value: 1, unit: "usd" }).success).toBe(false);
    expect(moneySchema.safeParse({ value: 1, unit: "s" }).success).toBe(false);
    expect(moneySchema.safeParse({ value: 1, unit: "USD", note: "x" }).success).toBe(false);
  });

  it("accepts an instant in UTC only", () => {
    expect(instantSchema.safeParse("2026-11-12T18:00:00.123Z").success).toBe(true);
    expect(instantSchema.safeParse("2026-11-12T18:00:00+01:00").success).toBe(false);
    expect(instantSchema.safeParse("2026-11-12T18:00:00").success).toBe(false);
    expect(instantSchema.safeParse("2026-11-12").success).toBe(false);
  });

  it("accepts a rating from 0 to 100 percent with a whole count", () => {
    expect(sellerSchema.safeParse({}).success).toBe(true);
    expect(sellerSchema.safeParse({ rating: { percent: 100, count: 0 } }).success).toBe(true);
    expect(sellerSchema.safeParse({ rating: { percent: 100.1, count: 0 } }).success).toBe(false);
    expect(sellerSchema.safeParse({ rating: { percent: -1, count: 0 } }).success).toBe(false);
    expect(sellerSchema.safeParse({ rating: { percent: 50, count: 1.5 } }).success).toBe(false);
  });
});

describe("the offer ids", () => {
  it("joins the source and the source id", () => {
    expect(offerId("ebay", "1:2")).toBe("ebay:1:2");
    expect(sourceOfOffer("ebay:1:2")).toBe("ebay");
  });

  it("refuses an id with no source", () => {
    expect(() => sourceOfOffer("ebay")).toThrow(new RangeError('The offer id "ebay" has no source.'));
    expect(() => sourceOfOffer(":1")).toThrow(RangeError);
  });
});

describe("productSchema", () => {
  it("accepts a product", () => {
    expect(productSchema.parse(product)).toEqual(product);
  });

  it("refuses an unknown field, a GTIN that is not in its 14-digit form and a blank part number", () => {
    expect(productSchema.safeParse({ ...product, price: 1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...product, gtins: ["036000291452"] }).success).toBe(false);
    expect(productSchema.safeParse({ ...product, partNumbers: [{ brand: "Samsung", partNumber: "" }] }).success).toBe(false);
  });
});

describe("offerSchema", () => {
  it("accepts an offer", () => {
    expect(offerSchema.parse(offer)).toEqual(offer);
  });

  it("refuses an id that is not the source and the source id", () => {
    expect(problems(offerSchema.safeParse({ ...offer, id: "ebay:999" }))).toEqual([
      "The id of an offer is its source and its source id, with a colon between them.",
    ]);
  });

  it("refuses a link that is not https, an unknown condition and an unknown format", () => {
    expect(offerSchema.safeParse({ ...offer, url: "http://www.example.com/itm/1" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, condition: "like-new" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, format: "best-offer" }).success).toBe(false);
  });

  it("accepts an auction with its end", () => {
    expect(offerSchema.safeParse({ ...offer, format: "auction", endsAt: "2026-11-15T20:00:00Z" }).success).toBe(true);
  });
});

describe("priceReadingSchema", () => {
  it("accepts a reading", () => {
    expect(priceReadingSchema.parse(reading)).toEqual(reading);
  });

  it("accepts each kind of shipping, and refuses a fixed shipping with no cost", () => {
    for (const shipping of [{ kind: "free" }, { kind: "calculated" }, { kind: "unknown" }]) {
      expect(priceReadingSchema.safeParse({ ...reading, shipping }).success).toBe(true);
    }
    expect(priceReadingSchema.safeParse({ ...reading, shipping: { kind: "fixed" } }).success).toBe(false);
    expect(priceReadingSchema.safeParse({ ...reading, shipping: { kind: "free", cost: usd(1) } }).success).toBe(false);
  });

  it("accepts breaks whose quantities increase above the minimum", () => {
    const breaks = { minimumQuantity: 5, priceBreaks: [{ quantity: 10, unitPrice: usd(0.9) }, { quantity: 100, unitPrice: usd(0.8) }] };
    expect(priceReadingSchema.safeParse({ ...reading, ...breaks }).success).toBe(true);
  });

  it("refuses a break that is not above the minimum or the break before it", () => {
    expect(
      problems(priceReadingSchema.safeParse({ ...reading, minimumQuantity: 10, priceBreaks: [{ quantity: 10, unitPrice: usd(1) }] })),
    ).toEqual(["The break 0 has the quantity 10, which is not more than 10."]);
    expect(
      problems(
        priceReadingSchema.safeParse({
          ...reading,
          priceBreaks: [
            { quantity: 100, unitPrice: usd(0.8) },
            { quantity: 10, unitPrice: usd(0.9) },
            { quantity: 50, unitPrice: usd(0.85) },
          ],
        }),
      ),
    ).toEqual([
      "The break 1 has the quantity 10, which is not more than 100.",
      "The break 2 has the quantity 50, which is not more than 100.",
    ]);
    expect(priceReadingSchema.safeParse({ ...reading, priceBreaks: [{ quantity: 1, unitPrice: usd(1) }] }).success).toBe(false);
  });

  it("refuses a count that does not agree with the availability", () => {
    expect(problems(priceReadingSchema.safeParse({ ...reading, availability: "in-stock", available: 0 }))).toEqual([
      "The availability in-stock does not agree with the count 0.",
    ]);
    expect(priceReadingSchema.safeParse({ ...reading, availability: "low-stock", available: 0 }).success).toBe(false);
    expect(priceReadingSchema.safeParse({ ...reading, availability: "out-of-stock", available: 2 }).success).toBe(false);
  });

  it("accepts a count that agrees with the availability, and each count of a preorder or an unknown state", () => {
    const pairs: [string, number][] = [
      ["in-stock", 1],
      ["low-stock", 2],
      ["out-of-stock", 0],
      ["preorder", 0],
      ["preorder", 5],
      ["unknown", 0],
      ["unknown", 5],
    ];
    for (const [availability, available] of pairs) {
      expect(priceReadingSchema.safeParse({ ...reading, availability, available }).success).toBe(true);
    }
    expect(priceReadingSchema.safeParse({ ...reading, availability: "out-of-stock", available: undefined }).success).toBe(true);
  });

  it("refuses a negative price, a count that is not whole and a minimum of 0", () => {
    expect(priceReadingSchema.safeParse({ ...reading, price: usd(-1) }).success).toBe(false);
    expect(priceReadingSchema.safeParse({ ...reading, available: 1.5 }).success).toBe(false);
    expect(priceReadingSchema.safeParse({ ...reading, minimumQuantity: 0 }).success).toBe(false);
  });
});
