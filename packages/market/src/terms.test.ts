import { describe, expect, it } from "vitest";
import { isKept, keepUntil, permitsHistory, permitsTrend, sourceTermsSchema, type SourceTerms } from "./terms.ts";

const at = "2026-11-12T18:00:00Z";
const reading = { at };

const terms = (retention: SourceTerms["retention"], more: Partial<SourceTerms> = {}): SourceTerms => ({
  source: "example",
  retention,
  deleteWhenEnded: false,
  priceModel: true,
  clause: "the terms of the example source",
  ...more,
});

const keep = terms({ kind: "keep" });
const hours72 = terms({ kind: "max-age", age: { value: 72, unit: "h" } });
const minutes10 = terms({ kind: "max-age", age: { value: 10, unit: "min" } });
const noStore = terms({ kind: "no-store" });

describe("sourceTermsSchema", () => {
  it("accepts each kind of retention", () => {
    for (const value of [keep, hours72, minutes10, noStore]) expect(sourceTermsSchema.parse(value)).toEqual(value);
  });

  it("refuses an age of zero, an age that is not a time, a bad source and a blank clause", () => {
    expect(sourceTermsSchema.safeParse(terms({ kind: "max-age", age: { value: 0, unit: "h" } })).success).toBe(false);
    expect(sourceTermsSchema.safeParse(terms({ kind: "max-age", age: { value: 1, unit: "USD" } })).success).toBe(false);
    expect(sourceTermsSchema.safeParse({ ...keep, source: "Example" }).success).toBe(false);
    expect(sourceTermsSchema.safeParse({ ...keep, clause: "" }).success).toBe(false);
    expect(sourceTermsSchema.safeParse({ ...keep, retention: { kind: "forever" } }).success).toBe(false);
  });
});

describe("keepUntil", () => {
  it("gives no limit for keep, the instant of the reading for no-store, and the instant plus the age", () => {
    expect(keepUntil(keep, reading)).toBeNull();
    expect(keepUntil(noStore, reading)).toBe("2026-11-12T18:00:00.000Z");
    expect(keepUntil(hours72, reading)).toBe("2026-11-15T18:00:00.000Z");
    expect(keepUntil(minutes10, reading)).toBe("2026-11-12T18:10:00.000Z");
    expect(keepUntil(terms({ kind: "max-age", age: { value: 1.5, unit: "ms" } }), reading)).toBe("2026-11-12T18:00:00.001Z");
    expect(keepUntil(terms({ kind: "max-age", age: { value: 400, unit: "d" } }), reading)).toBe("2027-12-17T18:00:00.000Z");
  });

  it("refuses a reading with no instant", () => {
    expect(() => keepUntil(hours72, { at: "soon" })).toThrow(new RangeError('The instant "soon" is not an instant.'));
    expect(() => keepUntil(noStore, { at: "soon" })).toThrow(RangeError);
    expect(keepUntil(keep, { at: "soon" })).toBeNull();
  });
});

describe("isKept", () => {
  it("keeps a reading of a max-age source to the end of the age, and not after it", () => {
    expect(isKept(minutes10, reading, "2026-11-12T18:10:00.000Z")).toBe(true);
    expect(isKept(minutes10, reading, "2026-11-12T18:10:00.001Z")).toBe(false);
    expect(isKept(minutes10, reading, at)).toBe(true);
  });

  it("keeps each reading of a keep source, and no reading of a no-store source", () => {
    expect(isKept(keep, reading, "2036-01-01T00:00:00Z")).toBe(true);
    expect(isKept(noStore, reading, at)).toBe(false);
    expect(isKept(noStore, reading, "2026-11-12T17:00:00Z")).toBe(false);
  });

  it("deletes the readings of an ended offer only when the terms say so", () => {
    expect(isKept(keep, reading, at, true)).toBe(true);
    expect(isKept({ ...keep, deleteWhenEnded: true }, reading, at, true)).toBe(false);
    expect(isKept({ ...keep, deleteWhenEnded: true }, reading, at, false)).toBe(true);
    expect(isKept({ ...keep, deleteWhenEnded: true }, reading, at)).toBe(true);
  });

  it("refuses a time of the check that is not an instant", () => {
    expect(() => isKept(hours72, reading, "later")).toThrow(new RangeError('The instant "later" is not an instant.'));
  });
});

describe("permitsHistory and permitsTrend", () => {
  it("permit a history only with keep, and a trend only with a history and a model of prices", () => {
    expect([keep, hours72, noStore].map(permitsHistory)).toEqual([true, false, false]);
    expect(permitsHistory({ ...keep, deleteWhenEnded: true })).toBe(false);
    expect(permitsTrend(keep)).toBe(true);
    expect(permitsTrend({ ...keep, priceModel: false })).toBe(false);
    expect(permitsTrend(hours72)).toBe(false);
    expect(permitsTrend({ ...keep, deleteWhenEnded: true })).toBe(false);
  });
});
