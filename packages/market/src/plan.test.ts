import { describe, expect, it } from "vitest";
import type { Observation } from "./offers.ts";
import { NEED_FORMAT, needProblems, planBuys, type BuyNeed, type NeedPart, type NeedSlot } from "./plan.ts";
import type { Availability, Shipping } from "./records.ts";

const usd = (value: number) => ({ value, unit: "USD" });

/* The IR of the programs of the tests, as plain JSON. */
const lit = (value: unknown) => ({ tag: "lit", value });
const ref = (...path: string[]) => ({ tag: "ref", path });
const app = (op: string, ...args: unknown[]) => ({ tag: "app", op, args });
const others = (body: unknown) => ({ tag: "each", axis: { t: "others" }, body });
const total = (field: string) => app("sum", others(app("multiply", ref(field), ref("count"))));

interface Make {
  readonly id: string;
  readonly part: string;
  readonly price: number;
  readonly availability?: Availability;
  readonly shipping?: Shipping;
  readonly minimumQuantity?: number;
}

function observation(make: Make): Observation {
  return {
    offer: {
      id: make.id,
      source: make.id.split(":")[0] ?? "example",
      sourceId: make.id.split(":")[1] ?? make.id,
      title: `Offer ${make.id}`,
      seller: {},
      condition: "new",
      format: "fixed-price",
      gtins: [],
      partNumbers: [{ brand: "Acme", partNumber: make.part }],
      specs: [],
    },
    reading: { offerId: make.id, at: "2026-11-15T02:00:00Z", price: usd(make.price), shipping: make.shipping ?? { kind: "free" }, availability: make.availability ?? "in-stock", ...(make.minimumQuantity === undefined ? {} : { minimumQuantity: make.minimumQuantity }) },
  };
}

const part = (key: string, facts: NeedPart["facts"] = {}): NeedPart => ({ key, want: { brands: ["Acme"], partNumbers: [key] }, facts });

/**
 * The need of the tests: a UPS for a load of 300 watts, with one or two extra battery packs. The measure `minutes`
 * is the time of the batteries at the load, and the rule keeps the output of the UPS at the load or above.
 */
const UPS_SLOT: NeedSlot = { name: "ups", parts: [part("UPS-600", { wattHours: 100, outputWatts: 360 }), part("UPS-1000", { wattHours: 200, outputWatts: 600 }), part("UPS-250", { wattHours: 60, outputWatts: 250 })] };
const PACK = part("PACK-1", { wattHours: 150, outputWatts: 0 });
const UPS_NEED: BuyNeed = {
  format: NEED_FORMAT,
  id: "closet-ups",
  currency: "USD",
  inputs: { loadWatts: 300 },
  slots: [UPS_SLOT, { name: "battery", parts: [PACK], count: { min: 0, max: 2 } }],
  measures: [{ name: "minutes", goal: "max", unit: "min", program: app("multiply", app("divide", total("wattHours"), ref("loadWatts")), lit(60)) }],
  rules: [{ name: "output", program: app("gte", app("max", others(ref("outputWatts"))), ref("loadWatts")) }],
};

const UPS_OFFERS: readonly Observation[] = [
  observation({ id: "a:1", part: "UPS-600", price: 120 }),
  observation({ id: "b:1", part: "UPS-600", price: 110, shipping: { kind: "fixed", cost: usd(15) } }),
  observation({ id: "a:2", part: "UPS-1000", price: 260 }),
  observation({ id: "a:3", part: "UPS-250", price: 60 }),
  observation({ id: "a:4", part: "PACK-1", price: 80 }),
];

describe("planBuys", () => {
  it("gives the front of the price against the minutes, with the cheapest offer of each item", () => {
    const plan = planBuys(UPS_NEED, UPS_OFFERS);
    expect(plan.method).toBe("grid");
    expect(plan.seed).toBeNull();
    expect(plan.unpriced).toEqual([]);
    const front = plan.front.map((choice) => ({ price: choice.price.value, minutes: choice.values["minutes"], items: choice.items.map((item) => `${item.slot}:${item.part}x${String(item.count)}@${item.offerId}`) }));
    expect(front).toEqual([
      { price: 120, minutes: 20, items: ["ups:UPS-600x1@a:1"] },
      { price: 200, minutes: 50, items: ["ups:UPS-600x1@a:1", "battery:PACK-1x1@a:4"] },
      { price: 280, minutes: 80, items: ["ups:UPS-600x1@a:1", "battery:PACK-1x2@a:4"] },
      { price: 420, minutes: 100, items: ["ups:UPS-1000x1@a:2", "battery:PACK-1x2@a:4"] },
    ]);
    expect(plan.front.every((choice) => choice.price.unit === "USD")).toBe(true);
  });

  it("counts the baskets that break the rule, with the reason of the first one", () => {
    const plan = planBuys(UPS_NEED, UPS_OFFERS);
    // The UPS-250 gives 250 watts, below the load of 300 watts: 3 baskets, with 0, 1 and 2 packs.
    expect(plan.breaks).toEqual([{ name: "rule:output", count: 3, why: "The basket breaks the rule." }]);
    expect(plan.counts.breaks).toBe(3);
    expect(plan.counts.feasible).toBe(6);
  });

  it("puts a part with no usable offer in the unpriced parts, and the basket goes on without it", () => {
    const offers = UPS_OFFERS.map((one) => (one.offer.id === "a:2" ? observation({ id: "a:2", part: "UPS-1000", price: 260, availability: "out-of-stock" }) : one));
    const plan = planBuys(UPS_NEED, offers);
    expect(plan.unpriced).toEqual([{ slot: "ups", part: "UPS-1000", why: "No offer of 1 units is in stock with a known cost." }]);
    expect(plan.front.map((choice) => choice.price.value)).toEqual([120, 200, 280]);
  });

  it("gives the method none when a slot that must have a part has no part with an offer", () => {
    const plan = planBuys(UPS_NEED, UPS_OFFERS.filter((one) => one.offer.partNumbers[0]?.partNumber === "PACK-1"));
    expect(plan.method).toBe("none");
    expect(plan.front).toEqual([]);
    expect(plan.run).toBeNull();
    expect(plan.unpriced.map((one) => one.part)).toEqual(["UPS-600", "UPS-1000", "UPS-250"]);
  });

  it("leaves an optional slot empty when it has no part with an offer", () => {
    const plan = planBuys(UPS_NEED, UPS_OFFERS.filter((one) => one.offer.partNumbers[0]?.partNumber !== "PACK-1"));
    expect(plan.method).toBe("grid");
    expect(plan.front.map((choice) => [choice.price.value, choice.values["minutes"]])).toEqual([
      [120, 20],
      [260, 40],
    ]);
    expect(plan.unpriced).toEqual([{ slot: "battery", part: "PACK-1", why: "No offer matches the part." }]);
  });

  it("breaks a basket at a measure outside its limits, and at a measure that gives no number", () => {
    const need: BuyNeed = {
      ...UPS_NEED,
      measures: [
        { name: "minutes", goal: "max", program: app("multiply", app("divide", total("wattHours"), ref("loadWatts")), lit(60)), min: 30 },
        { name: "noise", program: app("divide", ref("missing"), lit(2)) },
      ],
      rules: [],
    };
    const plan = planBuys(need, UPS_OFFERS);
    expect(plan.front).toEqual([]);
    expect(plan.breaks.map((one) => one.name)).toEqual(["limit:minutes", "measure:noise"]);
    // Below 30 minutes: the UPS-600 alone (20 minutes) and the UPS-250 alone (12 minutes).
    expect(plan.breaks[0]?.count).toBe(2);
    expect(plan.breaks[1]?.count).toBe(9);
  });

  it("breaks a basket at a count with no usable offer", () => {
    const need: BuyNeed = { ...UPS_NEED, slots: [UPS_SLOT, { name: "battery", parts: [PACK], count: { min: 1, max: 3 } }] };
    const offers = [...UPS_OFFERS.filter((one) => one.offer.id !== "a:4"), observation({ id: "a:4", part: "PACK-1", price: 80, minimumQuantity: 2 })];
    const plan = planBuys(need, offers);
    expect(plan.breaks.find((one) => one.name === "price:battery")).toMatchObject({ count: 3 });
    expect(plan.front.every((choice) => choice.items.some((item) => item.slot === "battery" && item.count >= 2))).toBe(true);
  });

  it("runs a genetic search on a space with more baskets than the evaluations, and the seed fixes it", () => {
    const parts = Array.from({ length: 12 }, (_, index) => part(`P-${String(index)}`, { wattHours: 10 * (index + 1), outputWatts: 400 }));
    const need: BuyNeed = { ...UPS_NEED, slots: [{ name: "ups", parts }, { name: "battery", parts: [PACK], count: { min: 0, max: 8 } }] };
    const offers = [...parts.map((one, index) => observation({ id: `a:${one.key}`, part: one.key, price: 50 + 7 * index })), observation({ id: "a:4", part: "PACK-1", price: 80 })];
    const first = planBuys(need, offers, { evaluations: 60, seed: 7 });
    const second = planBuys(need, offers, { evaluations: 60, seed: 7 });
    expect(first.method).toBe("evolve");
    expect(first.seed).toBeTypeOf("number");
    expect(first.front.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("refuses a need with problems and a bad count of evaluations", () => {
    expect(() => planBuys({ ...UPS_NEED, slots: [UPS_SLOT, UPS_SLOT] }, UPS_OFFERS)).toThrow();
    expect(() => planBuys(UPS_NEED, UPS_OFFERS, { evaluations: 0 })).toThrow();
    expect(() => planBuys({ ...UPS_NEED, currency: "GBP-X" }, UPS_OFFERS)).toThrow();
  });
});

describe("needProblems", () => {
  it("gives no problem for a good need", () => {
    expect(needProblems(UPS_NEED)).toEqual([]);
  });

  it("names each problem of the names, the counts and the programs", () => {
    const need: BuyNeed = {
      ...UPS_NEED,
      slots: [
        { name: "need", parts: [part("A")] },
        { name: "ups", parts: [part("A", { cost: 3 }), part("A")], count: { min: 2, max: 1 } },
      ],
      measures: [
        { name: "price", program: lit(1) },
        { name: "minutes", program: { tag: "nothing" } },
      ],
      rules: [
        { name: "r", program: lit(true) },
        { name: "r", program: lit(true) },
      ],
    };
    const problems = needProblems(need);
    expect(problems).toHaveLength(7);
    expect(problems.join(" ")).toContain("The slot need has the name of the inputs.");
    expect(problems.join(" ")).toContain("Two parts of the slot ups have the name A.");
    expect(problems.join(" ")).toContain("The count of the slot ups is 2 to 1.");
    expect(problems.join(" ")).toContain("the fact cost, which is a field of the slot");
    expect(problems.join(" ")).toContain("A measure has the name price");
    expect(problems.join(" ")).toContain("The program of the measure minutes is not valid");
    expect(problems.join(" ")).toContain("Two rules have the name r.");
  });
});
