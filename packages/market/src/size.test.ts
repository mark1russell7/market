import { describe, expect, it } from "vitest";
import { priceReadingSchema } from "./records.ts";
import { EACH_UNIT, parseSize, sizePrice } from "./size.ts";

const USD = (value: number) => ({ value, unit: "USD" });

describe("parseSize", () => {
  it("reads one amount of mass, volume or count", () => {
    expect(parseSize("16.9 fl oz")).toEqual({ ok: true, amount: { value: 16.9, unit: "fl oz" } });
    expect(parseSize("5 lb")).toEqual({ ok: true, amount: { value: 5, unit: "lb" } });
    expect(parseSize("12 oz")).toEqual({ ok: true, amount: { value: 12, unit: "oz" } });
    expect(parseSize("500 mL")).toEqual({ ok: true, amount: { value: 500, unit: "mL" } });
    expect(parseSize("2 L")).toEqual({ ok: true, amount: { value: 2, unit: "L" } });
    expect(parseSize("1 gal")).toEqual({ ok: true, amount: { value: 1, unit: "gal" } });
    expect(parseSize("24 ct")).toEqual({ ok: true, amount: { value: 24, unit: EACH_UNIT } });
  });

  it("reads the spellings of the sellers, in any case and with points", () => {
    expect(parseSize("16.9 FL. OZ.")).toEqual({ ok: true, amount: { value: 16.9, unit: "fl oz" } });
    expect(parseSize("3 LBS")).toEqual({ ok: true, amount: { value: 3, unit: "lb" } });
    expect(parseSize("750 ml")).toEqual({ ok: true, amount: { value: 750, unit: "mL" } });
    expect(parseSize("6 pk")).toEqual({ ok: true, amount: { value: 6, unit: EACH_UNIT } });
    expect(parseSize(".5 gal")).toEqual({ ok: true, amount: { value: 0.5, unit: "gal" } });
  });

  it("reads a pack as the count times the amount of each", () => {
    const each = { value: 16.9, unit: "fl oz" };
    expect(parseSize("24 ct / 16.9 fl oz")).toEqual({ ok: true, amount: { value: 24 * 16.9, unit: "fl oz" }, count: 24, each });
    expect(parseSize("16.9 fl oz / 24 ct")).toEqual({ ok: true, amount: { value: 24 * 16.9, unit: "fl oz" }, count: 24, each });
    expect(parseSize("6 x 8 oz")).toEqual({ ok: true, amount: { value: 48, unit: "oz" }, count: 6, each: { value: 8, unit: "oz" } });
    expect(parseSize("6 × 8 oz")).toEqual(parseSize("6 x 8 oz"));
  });

  it("reads two amounts of one size as the first, when they agree", () => {
    expect(parseSize("16 oz / 454 g")).toEqual({ ok: true, amount: { value: 16, unit: "oz" } });
    expect(parseSize("16 oz / 300 g").ok).toBe(false);
  });

  it("refuses a text that is not a size, with the reason", () => {
    for (const text of ["", "large", "16.9", "2 h", "3 kcal", "0 oz", "-2 lb", "1 lb / 1 L", "2 ct / 3 ct", "1 / 2 / 3 oz", "x 8 oz"]) {
      const size = parseSize(text);
      expect(size.ok, text).toBe(false);
      if (!size.ok) expect(size.why).toContain(`The size ${JSON.stringify(text)} is not read`);
    }
  });
});

describe("parseSize on long texts", () => {
  it("refuses a long text of spaces in linear time", () => {
    // A pattern with two quantifiers over the same spaces takes polynomial time on such a text.
    for (const text of [`0x${" ".repeat(50_000)}`, `0 ${" ".repeat(50_000)}x`, `1${" ".repeat(50_000)}/`, `${"1".repeat(50_000)} `]) {
      const start = performance.now();
      expect(parseSize(text).ok).toBe(false);
      expect(performance.now() - start).toBeLessThan(1_000);
    }
  });
});

describe("sizePrice", () => {
  it("gives a price for each unit of the amount that a price reading accepts", () => {
    const reading = { offerId: "kroger:1@2", at: "2026-11-26T12:00:00Z", price: USD(3.99), shipping: { kind: "unknown" }, availability: "in-stock" } as const;
    for (const [text, unit, value] of [
      ["24 ct / 16.9 fl oz", "USD/fl oz", 3.99 / (24 * 16.9)],
      ["5 lb", "USD/lb", 3.99 / 5],
      ["24 ct", `USD/${EACH_UNIT}`, 3.99 / 24],
      ["500 mL", "USD/mL", 3.99 / 500],
    ] as const) {
      const size = parseSize(text);
      if (!size.ok) throw new Error(size.why);
      const price = sizePrice(USD(3.99), size);
      expect(price.unit).toBe(unit);
      expect(price.value).toBeCloseTo(value, 12);
      expect(priceReadingSchema.safeParse({ ...reading, amountPrice: price }).success, text).toBe(true);
    }
  });
});
