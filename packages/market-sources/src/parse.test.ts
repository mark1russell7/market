import type { Offer, PriceReading } from "@mark1russell7/market";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AT, ebayItem, observations, usd } from "../test/fixtures.ts";
import { parseEbayItem } from "./ebay.ts";
import {
  checkAt,
  compact,
  decimal,
  done,
  field,
  httpsUrl,
  instant,
  isCurrency,
  observe,
  path,
  readMoney,
  show,
  text,
  wholeNumber,
  type Observation,
} from "./parse.ts";

function documented(): Observation {
  const [first] = observations(parseEbayItem(ebayItem, AT));
  if (first === undefined) throw new Error("The parser gave no observation.");
  return first;
}

describe("decimal", () => {
  it.each([
    [0, 0],
    [12.5, 12.5],
    ["0", 0],
    ["12", 12],
    ["129.99", 129.99],
    ["0.004", 0.004],
  ])("reads %j as %j", (value, expected) => {
    expect(decimal(value)).toBe(expected);
  });

  it.each([-1, -0.01, Number.NaN, Infinity, "-1", "+1", "1e3", "12.", ".5", " 12", "12 ", "0x10", "12,00", "", "Infinity", null, true, [1]])(
    "refuses %j",
    (value) => {
      expect(decimal(value)).toBeUndefined();
    },
  );

  it("gives zero or more for each value that it reads", () => {
    fc.assert(
      fc.property(fc.oneof(fc.double(), fc.string(), fc.stringMatching(/^-?\d{1,4}(\.\d{1,3})?$/)), (value) => {
        const result = decimal(value);
        if (result !== undefined) expect(result).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("readMoney", () => {
  it("reads an amount and a currency", () => {
    expect(readMoney("129.99", "USD")).toEqual({ ok: true, value: usd(129.99) });
    expect(readMoney(5, " USD ")).toEqual({ ok: true, value: usd(5) });
  });

  it("gives the reason for each refusal", () => {
    expect(readMoney("-1", "USD")).toEqual({ ok: false, why: 'the amount "-1" is not a decimal of zero or more' });
    expect(readMoney(-1, "USD")).toEqual({ ok: false, why: "the amount -1 is not a decimal of zero or more" });
    expect(readMoney("1", null)).toEqual({ ok: false, why: 'the amount "1" has no currency' });
    expect(readMoney("1", "GBP")).toEqual({ ok: false, why: 'the currency "GBP" is not a money unit of @mark1russell7/quantity' });
  });

  it("knows the money units of quantity", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("usd")).toBe(false);
    expect(isCurrency("h")).toBe(false);
  });
});

describe("the readers of JSON values", () => {
  it("read fields and paths without a throw", () => {
    expect(field({ a: 1 }, "a")).toBe(1);
    expect(field([1], "0")).toBeUndefined();
    expect(field(null, "a")).toBeUndefined();
    expect(field({}, "toString")).toBeUndefined();
    expect(path({ a: { b: { c: 2 } } }, "a", "b", "c")).toBe(2);
    expect(path({ a: null }, "a", "b")).toBeUndefined();
  });

  it("read texts, whole numbers, URLs and instants", () => {
    expect(text("  x ")).toBe("x");
    expect(text("   ")).toBeUndefined();
    expect(text(1)).toBeUndefined();
    expect(wholeNumber(3)).toBe(3);
    expect(wholeNumber(-1)).toBeUndefined();
    expect(wholeNumber(1.5)).toBeUndefined();
    expect(wholeNumber(2 ** 53)).toBeUndefined();
    expect(httpsUrl("https://www.example.com/x")).toBe("https://www.example.com/x");
    expect(httpsUrl("http://www.example.com/x")).toBeUndefined();
    expect(httpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(instant("2026-11-12T18:00:00.000Z")).toBe("2026-11-12T18:00:00.000Z");
    expect(instant("2026-11-12T18:00:00+01:00")).toBeUndefined();
    expect(instant("tomorrow")).toBeUndefined();
  });

  it("show a short JSON text of each value", () => {
    expect(show("x")).toBe('"x"');
    expect(show(undefined)).toBe("undefined");
    expect(show(10n)).toBe("bigint");
    expect(show("y".repeat(60))).toHaveLength(40);
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(show(cycle)).toBe("object");
  });

  it("remove the keys with the value undefined, and keep null", () => {
    expect(compact({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
    expect(Object.keys(compact({ a: undefined }))).toEqual([]);
  });

  it("throw a RangeError on an instant that is not UTC ISO 8601", () => {
    expect(() => checkAt(AT)).not.toThrow();
    expect(() => checkAt("2026-11-12")).toThrow(RangeError);
  });
});

describe("observe", () => {
  it("gives the observation when both schemas accept it", () => {
    const { offer, reading } = documented();
    const notes: string[] = [];
    expect(observe(offer, reading, notes)).toEqual({ offer, reading });
    expect(notes).toEqual([]);
  });

  it("removes the keys with the value undefined before the check", () => {
    const { offer, reading } = documented();
    const notes: string[] = [];
    const observed = observe({ ...offer, grade: undefined } as unknown as Offer, { ...reading, listPrice: undefined } as unknown as PriceReading, notes);
    expect(notes).toEqual([]);
    expect(observed !== undefined && "grade" in observed.offer).toBe(false);
    expect(observed !== undefined && "listPrice" in observed.reading).toBe(false);
  });

  it("skips an offer that the schema refuses, with a note", () => {
    const { offer, reading } = documented();
    const notes: string[] = [];
    expect(observe({ ...offer, sourceId: "other" }, reading, notes)).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.startsWith(`The offer ${offer.id} is skipped: the schema refuses it (`)).toBe(true);
  });

  it("skips a reading that the schema refuses, with a note", () => {
    const { offer, reading } = documented();
    const notes: string[] = [];
    const disordered: PriceReading = {
      ...reading,
      priceBreaks: [
        { quantity: 10, unitPrice: usd(1) },
        { quantity: 5, unitPrice: usd(2) },
      ],
    };
    expect(observe(offer, disordered, notes)).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("is skipped: the schema refuses its reading (priceBreaks.1.quantity: The break 1 has the quantity 5");
  });
});

describe("done", () => {
  it("keeps the first observation of each offer id, in order", () => {
    const first = documented();
    const second: Observation = { ...first, reading: { ...first.reading, price: usd(1) } };
    const result = done([first, second], ["a note"]);
    expect(result).toEqual({ ok: true, observations: [first], notes: ["a note"] });
  });
});
