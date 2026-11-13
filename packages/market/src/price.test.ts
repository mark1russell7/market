import { describe, expect, it } from "vitest";
import { costOf, unitPriceFor } from "./price.ts";
import type { PriceReading } from "./records.ts";

const usd = (value: number) => ({ value, unit: "USD" });

const reading: PriceReading = {
  offerId: "digikey:SC1111-ND",
  at: "2026-11-12T18:00:00Z",
  price: usd(1),
  shipping: { kind: "free" },
  availability: "in-stock",
  priceBreaks: [
    { quantity: 10, unitPrice: usd(0.9) },
    { quantity: 100, unitPrice: usd(0.8) },
  ],
};

describe("unitPriceFor", () => {
  it("gives the price of the largest break at or below the count", () => {
    const at = (count: number) => unitPriceFor(reading, count).value;
    expect([1, 9, 10, 99, 100, 1000].map(at)).toEqual([1, 1, 0.9, 0.9, 0.8, 0.8]);
  });

  it("gives the price of the reading when the reading has no breaks", () => {
    const { priceBreaks: _, ...plain } = reading;
    expect(unitPriceFor(plain, 500)).toEqual(usd(1));
  });

  it("refuses a count below the minimum, and a count that is not whole", () => {
    expect(() => unitPriceFor(reading, 0)).toThrow(new RangeError("The count 0 is not a whole number of 1 or more."));
    expect(() => unitPriceFor({ ...reading, minimumQuantity: 5 }, 4)).toThrow(
      new RangeError("The count 4 is not a whole number of 5 or more."),
    );
    expect(unitPriceFor({ ...reading, minimumQuantity: 5 }, 5)).toEqual(usd(1));
    expect(() => unitPriceFor(reading, 2.5)).toThrow(RangeError);
    expect(() => unitPriceFor(reading, Number.NaN)).toThrow(RangeError);
    expect(() => unitPriceFor(reading, 2 ** 53)).toThrow(RangeError);
  });
});

describe("costOf", () => {
  const cents = { ...reading, price: usd(0.1), priceBreaks: [] };

  it("gives the exact cost with free shipping", () => {
    expect(costOf(cents, 3)).toEqual(usd(0.3));
    expect(costOf(reading, 10)).toEqual(usd(9));
  });

  it("adds a fixed shipping cost one time", () => {
    expect(costOf({ ...cents, shipping: { kind: "fixed", cost: usd(0.2) } }, 3)).toEqual(usd(0.5));
  });

  it("gives null when the shipping cost is not known", () => {
    expect(costOf({ ...cents, shipping: { kind: "calculated" } }, 3)).toBeNull();
    expect(costOf({ ...cents, shipping: { kind: "unknown" } }, 3)).toBeNull();
  });

  it("refuses a count below the minimum", () => {
    expect(() => costOf(cents, 0)).toThrow(RangeError);
  });
});
