import type { Selection } from "@mark1russell7/strategy-search";
import { describe, expect, it } from "vitest";
import type { Observation } from "./offers.ts";
import { buyCandidates, orderBuys, type BuyCandidate, type ProductWant } from "./order.ts";
import type { Availability, Shipping } from "./records.ts";

const usd = (value: number) => ({ value, unit: "USD" });

function observation(id: string, part: string, price: number, more: { availability?: Availability; shipping?: Shipping } = {}): Observation {
  return {
    offer: {
      id,
      source: id.split(":")[0] ?? "example",
      sourceId: id.split(":")[1] ?? id,
      title: `Offer ${id}`,
      seller: {},
      condition: "new",
      format: "fixed-price",
      gtins: [],
      partNumbers: [{ brand: "Acme", partNumber: part }],
      specs: [],
    },
    reading: { offerId: id, at: "2026-11-15T02:00:00Z", price: usd(price), shipping: more.shipping ?? { kind: "free" }, availability: more.availability ?? "in-stock" },
  };
}

const want = (product: string, max?: number): ProductWant => ({ product, want: { brands: ["Acme"], partNumbers: [product] }, ...(max === undefined ? {} : { max }) });

describe("buyCandidates", () => {
  it("gives the in-stock offer with the lowest cost of one unit, with its shipping", () => {
    const offers = [
      observation("a:1", "JUG", 5),
      observation("b:1", "JUG", 3, { shipping: { kind: "fixed", cost: usd(4) } }),
      observation("c:1", "JUG", 2, { availability: "out-of-stock" }),
      observation("a:2", "CAN", 2),
    ];
    const result = buyCandidates([want("JUG", 4), want("CAN"), want("LAMP")], offers, { currency: "USD" });
    expect(result.candidates).toEqual([
      { product: "JUG", price: 5, max: 4, quote: "a:1" },
      { product: "CAN", price: 2, max: 1, quote: "a:2" },
    ]);
    expect(result.unpriced.map((item) => item.product)).toEqual(["LAMP"]);
  });

  it("refuses a product that is twice in the wants, and a bad max", () => {
    expect(() => buyCandidates([want("JUG"), want("JUG")], [], { currency: "USD" })).toThrow(RangeError);
    expect(() => buyCandidates([want("JUG", -1)], [], { currency: "USD" })).toThrow(RangeError);
  });
});

/*
 * The toy measure: a jug of 4 L gives 4/3 days of water, and a can gives 1 day of food. The value of a target of h days
 * is the days short of it: water first, then food. A smaller value is better.
 */
const candidates: BuyCandidate[] = [
  { product: "JUG", price: 4, max: 10, quote: "a:1" },
  { product: "CAN", price: 1, max: 10, quote: "a:2" },
];
const short = (target: number) => (units: Selection) => [Math.max(0, target - ((units["JUG"] ?? 0) * 4) / 3), Math.max(0, target - (units["CAN"] ?? 0))];

describe("orderBuys", () => {
  it("buys the water before the food, and stops at the target", () => {
    const order = orderBuys(candidates, { budget: 100, goal: "min", stages: [{ name: "2 days", value: short(2) }] });
    // Two jugs give 8/3 days, more than 2. Then two cans give 2 days of food.
    expect(order.buys.map((buy) => buy.product)).toEqual(["JUG", "JUG", "CAN", "CAN"]);
    expect(order.units).toEqual({ JUG: 2, CAN: 2 });
    expect(order.spent).toBe(10);
    expect(order.stages[0]?.stop).toBe("no-gain");
    expect(order.stages[0]?.after).toEqual([0, 0]);
    expect(order.buys[0]).toMatchObject({ stage: "2 days", product: "JUG", quote: "a:1", cost: 4 });
    expect(order.buys[0]?.gain[0]).toBeCloseTo(4 / 3, 12);
  });

  it("goes to a second target with the money that is left", () => {
    const order = orderBuys(candidates, { budget: 15, goal: "min", stages: [{ name: "2 days", value: short(2) }, { name: "5 days", value: short(5) }] });
    expect(order.stages.map((stage) => stage.spent)).toEqual([10, 5]);
    // The second stage starts at 2 jugs and 2 cans, and it buys one more jug (4) and one can (1).
    expect(order.buys.filter((buy) => buy.stage === "5 days").map((buy) => buy.product)).toEqual(["JUG", "CAN"]);
    expect(order.stages[1]?.before).toEqual([5 - 8 / 3, 3]);
    expect(order.units).toEqual({ JUG: 3, CAN: 3 });
    expect(order.spent).toBe(15);
    expect(order.stages[1]?.stop).toBe("budget");
  });

  it("keeps the max of a product over the stages, and counts the units of start", () => {
    const one: BuyCandidate[] = [{ product: "CAN", price: 1, max: 3, quote: "a:2" }];
    const food = (target: number) => (units: Selection) => [Math.max(0, target - (units["CAN"] ?? 0))];
    const order = orderBuys(one, { budget: 100, goal: "min", start: { CAN: 1 }, stages: [{ name: "2", value: food(2) }, { name: "9", value: food(9) }] });
    expect(order.units).toEqual({ CAN: 4 });
    expect(order.stages[1]?.stop).toBe("units");
  });

  /*
   * The complements: one day of food takes 1 rice and 2 fuel. A unit of rice or of fuel alone gives no day, so the
   * order with no kit stops at once. A kit of 1 rice and 2 fuel gives one day for 2 + 2 * 3 = 8.
   */
  const complements: BuyCandidate[] = [
    { product: "RICE", price: 2, max: 10, quote: "a:1" },
    { product: "FUEL", price: 3, max: 10, quote: "a:2" },
  ];
  const meals = (target: number) => (units: Selection) => [Math.max(0, target - Math.min(units["RICE"] ?? 0, Math.floor((units["FUEL"] ?? 0) / 2)))];

  it("buys nothing when no unit alone has a gain, and buys a kit of the complements", () => {
    const stages = [{ name: "3 days", value: meals(3) }];
    const alone = orderBuys(complements, { budget: 100, goal: "min", stages });
    expect(alone.buys).toEqual([]);
    expect(alone.stages[0]?.stop).toBe("no-gain");
    expect(alone.kits).toEqual({});
    const order = orderBuys(complements, { budget: 100, goal: "min", stages, kits: [{ id: "MEAL", parts: { RICE: 1, FUEL: 2 } }] });
    expect(order.buys.map((buy) => buy.product)).toEqual(["MEAL", "MEAL", "MEAL"]);
    expect(order.buys[0]).toMatchObject({ stage: "3 days", product: "MEAL", quote: "a:1, a:2", cost: 8, kit: { RICE: 1, FUEL: 2 } });
    expect(order.units).toMatchObject({ RICE: 3, FUEL: 6 });
    expect(order.units["MEAL"]).toBeUndefined();
    expect(order.kits).toEqual({ MEAL: 3 });
    expect(order.spent).toBe(24);
    expect(order.stages[0]?.after).toEqual([0]);
  });

  it("gives a kit the max that its parts permit, or its own max", () => {
    const stages = [{ name: "9 days", value: meals(9) }];
    // The fuel has a max of 10, so 5 kits of 2 fuel.
    expect(orderBuys(complements, { budget: 100, goal: "min", stages, kits: [{ id: "MEAL", parts: { RICE: 1, FUEL: 2 } }] }).kits).toEqual({ MEAL: 5 });
    expect(orderBuys(complements, { budget: 100, goal: "min", stages, kits: [{ id: "MEAL", parts: { RICE: 1, FUEL: 2 }, max: 2 }] }).kits).toEqual({ MEAL: 2 });
  });

  it("refuses a bad kit", () => {
    const stages = [{ name: "x", value: meals(1) }];
    const order = (kits: Parameters<typeof orderBuys>[1]["kits"]) => () => orderBuys(complements, { budget: 10, stages, kits });
    expect(order([{ id: "RICE", parts: { FUEL: 1 } }])).toThrow(RangeError);
    expect(order([{ id: "MEAL", parts: {} }])).toThrow(RangeError);
    expect(order([{ id: "MEAL", parts: { SALT: 1 } }])).toThrow(RangeError);
    expect(order([{ id: "MEAL", parts: { RICE: 0.5 } }])).toThrow(RangeError);
    expect(order([{ id: "MEAL", parts: { RICE: 1 }, max: -1 }])).toThrow(RangeError);
    expect(order([{ id: "MEAL", parts: { RICE: 1 } }, { id: "MEAL", parts: { FUEL: 1 } }])).toThrow(RangeError);
  });

  it("refuses an order with no stage or a bad budget", () => {
    expect(() => orderBuys(candidates, { budget: 10, stages: [] })).toThrow(RangeError);
    expect(() => orderBuys(candidates, { budget: Number.NaN, stages: [{ name: "x", value: short(1) }] })).toThrow(RangeError);
  });
});
