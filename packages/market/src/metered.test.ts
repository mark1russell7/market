import type { Quantity } from "@mark1russell7/quantity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  freeAmountSchema,
  locationSchema,
  meteredCost,
  meteredKindOf,
  meteredObservationSchema,
  meteredOfferSchema,
  meteredPriceSchema,
  meteredReadingSchema,
  meterSchema,
  priceTermSchema,
  tierSchema,
  type Meter,
  type MeteredObservation,
  type MeteredOffer,
  type MeteredReading,
  type PriceTerm,
} from "./metered.ts";
import { isKept, keepUntil, permitsHistory, type SourceTerms } from "./terms.ts";

const q = (value: number, unit: string): Quantity => ({ value, unit });
const usd = (value: number) => q(value, "USD");

const offer = (term: PriceTerm = { kind: "on-demand" }, sourceId = "vm-small/region-1"): MeteredOffer => ({
  id: `example-cloud:${sourceId}`,
  source: "example-cloud",
  sourceId,
  title: "A small machine",
  location: { provider: "example-cloud", region: "region-1", zone: "region-1a" },
  term,
  specs: [{ name: "vCPUs", value: "2" }],
});

const machine: Meter = { name: "compute", tiers: [{ from: q(0, "h"), unitPrice: q(0.0116, "USD/h") }] };
const storage: Meter = { name: "storage", tiers: [{ from: q(0, "GiB·mo"), unitPrice: q(0.023, "USD/(GiB·mo)") }] };
const egress: Meter = {
  name: "egress",
  tiers: [
    { from: q(0, "GiB"), unitPrice: q(0.09, "USD/GiB") },
    { from: q(10, "TiB"), unitPrice: q(0.085, "USD/GiB") },
    { from: q(50, "TiB"), unitPrice: q(0.07, "USD/GiB") },
  ],
  free: { amount: q(100, "GiB"), scope: "account" },
};
const requests: Meter = {
  name: "requests",
  tiers: [{ from: q(0, "{request}"), unitPrice: q(0.0000004, "USD/{request}") }],
  free: { amount: q(1_000_000, "{request}"), scope: "region" },
};

const reading = (meters: readonly Meter[], more: Partial<MeteredReading> = {}): MeteredReading => ({
  offerId: offer().id,
  at: "2026-11-12T18:00:00Z",
  period: q(1, "mo"),
  meters,
  ...more,
});

const observe = (meters: readonly Meter[], term?: PriceTerm, more: Partial<MeteredReading> = {}): MeteredObservation => ({
  offer: offer(term),
  reading: reading(meters, more),
});

const problems = (result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string[] =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message);

describe("meteredKindOf", () => {
  it("gives the kind of the metered amount of a price", () => {
    expect(meteredKindOf("USD/h")).toBe("time");
    expect(meteredKindOf("USD/mo")).toBe("time");
    expect(meteredKindOf("USD/({vCPU}·h)")).toBe("time");
    expect(meteredKindOf("USD/(GiB·mo)")).toBe("data-time");
    expect(meteredKindOf("USD/(GiB·h)")).toBe("data-time");
    expect(meteredKindOf("USD/GiB")).toBe("data");
    expect(meteredKindOf("USD/TiB")).toBe("data");
    expect(meteredKindOf("USD/{request}")).toBe("count");
  });

  it("refuses a unit that is not a price for each unit of a metered amount", () => {
    for (const unit of ["USD", "h", "GiB/h", "USD·h", "USD/m", "USD/(GiB·h·h)", "USD/kWh", "nothing/h", "USD/hr/x"]) {
      expect(() => meteredKindOf(unit), unit).toThrow(RangeError);
    }
  });
});

describe("the schemas", () => {
  it("accepts a location, each term and an offer", () => {
    expect(locationSchema.parse({ provider: "example-cloud", region: "region-1" })).toEqual({ provider: "example-cloud", region: "region-1" });
    const terms: PriceTerm[] = [
      { kind: "on-demand" },
      { kind: "spot" },
      { kind: "spot", notice: q(2, "min") },
      { kind: "committed", length: q(1, "yr") },
    ];
    for (const term of terms) expect(priceTermSchema.parse(term)).toEqual(term);
    expect(meteredOfferSchema.parse(offer())).toEqual(offer());
  });

  it("refuses a bad provider, a blank region, a bad term and an id that does not agree", () => {
    expect(locationSchema.safeParse({ provider: "Example Cloud", region: "region-1" }).success).toBe(false);
    expect(locationSchema.safeParse({ provider: "example-cloud", region: " " }).success).toBe(false);
    expect(priceTermSchema.safeParse({ kind: "committed", length: q(0, "yr") }).success).toBe(false);
    expect(priceTermSchema.safeParse({ kind: "committed" }).success).toBe(false);
    expect(priceTermSchema.safeParse({ kind: "spot", notice: usd(1) }).success).toBe(false);
    expect(priceTermSchema.safeParse({ kind: "reserved" }).success).toBe(false);
    expect(problems(meteredOfferSchema.safeParse({ ...offer(), id: "example-cloud:other" }))).toEqual([
      "The id of an offer is its source and its source id, with a colon between them.",
    ]);
  });

  it("accepts a metered price, and refuses money alone, a negative price and a price of another kind", () => {
    expect(meteredPriceSchema.parse(q(0.023, "USD/(GiB·mo)"))).toEqual(q(0.023, "USD/(GiB·mo)"));
    expect(meteredPriceSchema.parse(q(0, "USD/h"))).toEqual(q(0, "USD/h"));
    expect(problems(meteredPriceSchema.safeParse(usd(1)))).toEqual([
      "The unit USD is not a price for each unit of a metered amount, for example USD/h.",
    ]);
    expect(meteredPriceSchema.safeParse(q(-1, "USD/h")).success).toBe(false);
    expect(meteredPriceSchema.safeParse(q(1, "USD/kWh")).success).toBe(false);
    expect(meteredPriceSchema.safeParse(q(1, "USD/hr")).success).toBe(false);
  });

  it("refuses a tier with a start that does not measure its price", () => {
    expect(tierSchema.parse({ from: q(10, "TiB"), unitPrice: q(0.085, "USD/GiB") })).toBeTruthy();
    expect(problems(tierSchema.safeParse({ from: q(0, "h"), unitPrice: q(0.09, "USD/GiB") }))).toEqual([
      "The start h does not measure the metered amount of the price USD/GiB.",
    ]);
    expect(tierSchema.safeParse({ from: q(0, "count"), unitPrice: q(1, "USD/{request}") }).success).toBe(false);
  });

  it("accepts each example meter", () => {
    for (const meter of [machine, storage, egress, requests]) expect(meterSchema.parse(meter)).toEqual(meter);
  });

  it("refuses a first tier above zero, starts that do not increase, and units of another amount", () => {
    const tiers = egress.tiers;
    expect(problems(meterSchema.safeParse({ ...egress, tiers: tiers.slice(1) }))).toEqual(["The first tier does not start at zero."]);
    expect(problems(meterSchema.safeParse({ ...egress, tiers: [tiers[0], tiers[2], tiers[1]] }))).toEqual([
      "The tier 2 does not start after the tier 1.",
    ]);
    expect(problems(meterSchema.safeParse({ ...egress, tiers: [tiers[0], { ...tiers[1], from: q(10240, "GiB") }] }))).toEqual([]);
    expect(problems(meterSchema.safeParse({ ...egress, tiers: [tiers[0], { ...tiers[1], from: q(0, "GiB") }] }))).toEqual([
      "The tier 1 does not start after the tier 0.",
    ]);
    expect(problems(meterSchema.safeParse({ ...egress, tiers: [...tiers, { from: q(100, "h"), unitPrice: q(1, "USD/h") }] }))).toEqual([
      "The tier 3 does not measure the metered amount of the price USD/GiB.",
    ]);
    expect(problems(meterSchema.safeParse({ ...egress, free: { amount: q(1, "h"), scope: "account" } }))).toEqual([
      "The free amount h does not measure the metered amount of the price USD/GiB.",
    ]);
    expect(meterSchema.safeParse({ ...egress, tiers: [] }).success).toBe(false);
    expect(freeAmountSchema.safeParse({ amount: q(0, "GiB"), scope: "account" }).success).toBe(false);
    expect(freeAmountSchema.safeParse({ amount: q(1, "GiB"), scope: "planet" }).success).toBe(false);
  });

  it("gives problems and does not throw for bad units and bad values", () => {
    const bad = [
      { ...egress, tiers: [{ from: q(0, "hr"), unitPrice: q(0.09, "USD/GiB") }] },
      { ...egress, tiers: [{ from: q(0, "GiB"), unitPrice: q(0.09, "USD/hr") }] },
      { ...egress, tiers: [{ from: q(Number.NaN, "GiB"), unitPrice: q(0.09, "USD/GiB") }] },
      { ...egress, tiers: [{ from: q(0, "GiB"), unitPrice: q(0.09, "USD/GiB") }, { from: q(Number.POSITIVE_INFINITY, "GiB"), unitPrice: q(0.09, "USD/GiB") }] },
      { ...egress, tiers: [{ from: { value: 0 }, unitPrice: q(0.09, "USD/GiB") }] },
      { ...egress, tiers: [{ from: q(0, "GiB"), unitPrice: "0.09" }] },
    ];
    for (const meter of bad) expect(meterSchema.safeParse(meter).success).toBe(false);
  });

  it("accepts a reading, and refuses two meters with one name and a period that is not a time", () => {
    const value = reading([machine, storage, egress, requests]);
    expect(meteredReadingSchema.parse(value)).toEqual(value);
    expect(problems(meteredReadingSchema.safeParse(reading([machine, machine])))).toEqual(["The reading has two meters with one name."]);
    expect(meteredReadingSchema.safeParse(reading([machine], { period: q(1, "GiB") })).success).toBe(false);
    expect(meteredReadingSchema.safeParse(reading([])).success).toBe(false);
    expect(meteredReadingSchema.safeParse(reading([machine], { upfront: q(-1, "USD") })).success).toBe(false);
  });

  it("accepts an observation, and refuses a reading of another offer and upfront money without a commitment", () => {
    const committed = observe([machine], { kind: "committed", length: q(1, "yr") }, { upfront: usd(120) });
    expect(meteredObservationSchema.parse(committed)).toEqual(committed);
    expect(problems(meteredObservationSchema.safeParse({ ...committed, reading: { ...committed.reading, offerId: "example-cloud:other" } }))).toEqual([
      "The reading is not a reading of the offer.",
    ]);
    expect(problems(meteredObservationSchema.safeParse(observe([machine], { kind: "spot" }, { upfront: usd(1) })))).toEqual([
      "The term spot has no upfront money.",
    ]);
  });
});

describe("meteredCost", () => {
  it("gives the exact cost of the hours of a machine and of stored data", () => {
    const result = meteredCost(observe([machine, storage]), { compute: q(730, "h"), storage: q(100, "GiB·mo") });
    expect(result.meters).toEqual([
      { name: "compute", cost: usd(8.468) },
      { name: "storage", cost: usd(2.3) },
    ]);
    expect(result.upfront).toEqual(usd(0));
    expect(result.total).toEqual(usd(10.768));
  });

  it("adds decimal prices exactly", () => {
    const cheap: Meter = { name: "compute", tiers: [{ from: q(0, "h"), unitPrice: q(0.1, "USD/h") }] };
    expect(meteredCost(observe([cheap]), { compute: q(3, "h") }).total).toEqual(usd(0.3));
  });

  it("converts the usage to the unit of the price with exact factors", () => {
    expect(meteredCost(observe([storage]), { storage: q(1, "TiB·mo") }).total).toEqual(usd(23.552));
    // A month of the quantity package is 730.485 h.
    expect(meteredCost(observe([storage]), { storage: q(730.485, "GiB·h") }).total).toEqual(usd(0.023));
    expect(meteredCost(observe([machine]), { compute: q(1, "mo") }).total).toEqual(usd(8.473626));
  });

  it("gives zero for a meter with no usage", () => {
    const result = meteredCost(observe([machine, storage]), { compute: q(10, "h") });
    expect(result.meters.map((each) => each.cost)).toEqual([usd(0.116), usd(0)]);
    expect(result.total).toEqual(usd(0.116));
  });

  it("applies each tier to its part of the usage, with the edge in the higher tier", () => {
    const noFree: Meter = { ...egress, free: undefined };
    const cost = (gib: number) => meteredCost(observe([noFree]), { egress: q(gib, "GiB") }).total.value;
    expect(cost(0)).toBe(0);
    expect(cost(10_239)).toBe(921.51);
    expect(cost(10_240)).toBe(921.6);
    expect(cost(10_241)).toBe(921.685);
    expect(cost(51_200)).toBe(4403.2);
    expect(cost(51_201)).toBe(4403.27);
    expect(meteredCost(observe([noFree]), { egress: q(10, "TiB") }).total).toEqual(usd(921.6));
  });

  it("takes the free amount off the usage first, and then counts the tiers from zero", () => {
    const cost = (gib: number) => meteredCost(observe([egress]), { egress: q(gib, "GiB") }).total.value;
    expect(cost(100)).toBe(0);
    expect(cost(101)).toBe(0.09);
    expect(cost(10_340)).toBe(921.6);
    expect(cost(10_341)).toBe(921.685);
  });

  it("gives zero when the free amount is larger than the usage", () => {
    const result = meteredCost(observe([egress, requests]), { egress: q(50, "GiB"), requests: q(999_999, "{request}") });
    expect(result.meters).toEqual([
      { name: "egress", cost: usd(0) },
      { name: "requests", cost: usd(0) },
    ]);
    expect(result.total).toEqual(usd(0));
    expect(meteredCost(observe([requests]), { requests: q(3_000_000, "{request}") }).total).toEqual(usd(0.8));
  });

  it("takes off only the free amount that other usage in its scope did not use", () => {
    const cost = (used: Quantity) => meteredCost(observe([egress]), { egress: q(50, "GiB") }, { freeUsed: { egress: used } }).total;
    expect(cost(q(80, "GiB"))).toEqual(usd(2.7));
    expect(cost(q(150, "GiB"))).toEqual(usd(4.5));
    expect(cost(q(0, "GiB"))).toEqual(usd(0));
    expect(meteredCost(observe([machine]), { compute: q(10, "h") }, { freeUsed: { compute: q(5, "h") } }).total).toEqual(usd(0.116));
  });

  it("adds the part of the upfront money of a committed term for one period", () => {
    const meter: Meter = { name: "compute", tiers: [{ from: q(0, "h"), unitPrice: q(0.005, "USD/h") }] };
    const committed = observe([meter], { kind: "committed", length: q(1, "yr") }, { upfront: usd(120) });
    const result = meteredCost(committed, { compute: q(730, "h") });
    expect(result.upfront).toEqual(usd(10));
    expect(result.total).toEqual(usd(13.65));
    const threeYears = observe([meter], { kind: "committed", length: q(3, "yr") }, { upfront: usd(360) });
    expect(meteredCost(threeYears, {}).upfront).toEqual(usd(10));
    const noUpfront = observe([meter], { kind: "committed", length: q(1, "yr") });
    expect(meteredCost(noUpfront, { compute: q(730, "h") }).total).toEqual(usd(3.65));
  });

  it("gives the cost of a spot term as the cost of its tiers", () => {
    expect(meteredCost(observe([machine], { kind: "spot", notice: q(30, "s") }), { compute: q(730, "h") }).total).toEqual(usd(8.468));
  });

  it("refuses an unknown meter, a negative usage and a usage of another amount", () => {
    const value = observe([machine, requests]);
    expect(() => meteredCost(value, { gpu: q(1, "h") })).toThrow(new RangeError(`The reading of ${offer().id} has no meter gpu.`));
    expect(() => meteredCost(value, {}, { freeUsed: { gpu: q(1, "h") } })).toThrow(RangeError);
    expect(() => meteredCost(value, { compute: q(-1, "h") })).toThrow(
      new RangeError("The usage of the meter compute is -1, not an amount of zero or more."),
    );
    expect(() => meteredCost(value, { compute: q(1, "GiB") })).toThrow(
      new RangeError("The usage of the meter compute is in GiB, which does not measure the price USD/h."),
    );
    expect(() => meteredCost(value, { requests: q(1, "count") })).toThrow(RangeError);
    expect(() => meteredCost(value, { compute: q(1, "{request}/mo") })).toThrow(RangeError);
    expect(() => meteredCost(value, { requests: q(1, "{request}") }, { freeUsed: { requests: q(-1, "{request}") } })).toThrow(RangeError);
  });

  it("does not decrease when the usage increases, and a free amount does not increase the cost", () => {
    const tiersOf = fc
      .array(fc.tuple(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 10_000 })), { minLength: 0, maxLength: 4 })
      .map((steps) => {
        let from = 0;
        const tiers = [{ from: q(0, "GiB"), unitPrice: q(0.05, "USD/GiB") }];
        for (const [gap, cents] of steps) {
          from += gap;
          tiers.push({ from: q(from, "GiB"), unitPrice: q(cents / 10_000, "USD/GiB") });
        }
        return tiers;
      });
    fc.assert(
      fc.property(tiersOf, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 500 }), fc.integer({ min: 1, max: 500 }), (tiers, usage, more, free) => {
        const plain: Meter = { name: "egress", tiers };
        expect(meterSchema.safeParse(plain).success).toBe(true);
        const cost = (meter: Meter, gib: number) => meteredCost(observe([meter]), { egress: q(gib, "GiB") }).total.value;
        expect(cost(plain, usage + more)).toBeGreaterThanOrEqual(cost(plain, usage));
        expect(cost({ ...plain, free: { amount: q(free, "GiB"), scope: "account" } }, usage)).toBeLessThanOrEqual(cost(plain, usage));
      }),
    );
  });
});

describe("the terms of a source", () => {
  const terms: SourceTerms = {
    source: "example-cloud",
    retention: { kind: "max-age", age: q(72, "h") },
    deleteWhenEnded: false,
    priceModel: true,
    clause: "the terms of the example cloud",
  };

  it("apply to a metered reading as to a price reading", () => {
    const value = reading([machine]);
    expect(keepUntil(terms, value)).toBe("2026-11-15T18:00:00.000Z");
    expect(isKept(terms, value, "2026-11-14T00:00:00Z")).toBe(true);
    expect(isKept(terms, value, "2026-11-16T00:00:00Z")).toBe(false);
    expect(permitsHistory({ ...terms, retention: { kind: "keep" } })).toBe(true);
  });
});
