import { checkSources } from "@mark1russell7/guidebook";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FOOD_PLAN_GROUPS, foodPlanCheck, foodPlanCost, type FoodPlanMember } from "./food-plan.ts";
import { FOOD_PLANS } from "./food-plan-data.ts";
import { averageSupplyPrices } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const thrifty = FOOD_PLANS[0]!;

/** The reference family of the report: a male and a female of 20 to 50 years, and two children of 6 to 8 and 9 to 11 years. */
const family: FoodPlanMember[] = [
  { group: "male-20-50", count: 1 },
  { group: "female-20-50", count: 1 },
  { group: "child-6-8", count: 1 },
  { group: "child-9-11", count: 1 },
];

describe("the data of the food plans", () => {
  it("cites a source with a license and a cost in USD/wk for each group", () => {
    for (const plan of FOOD_PLANS) {
      expect(checkSources([plan.source], { at: "2026-11-22" }).filter((finding) => finding.level === "error")).toEqual([]);
      expect(Object.keys(plan.weekly).sort()).toEqual([...FOOD_PLAN_GROUPS].sort());
      for (const group of FOOD_PLAN_GROUPS) expect(plan.weekly[group].unit).toBe("USD/wk");
    }
  });

  it("reads each row of the table at its group: the four groups of the reference family add up to its row, $236.50", () => {
    // The text of the report puts each label one row under its values. This sum holds only for the right reading.
    const sum = family.reduce((total, member) => total + thrifty.weekly[member.group].value, 0);
    expect(sum).toBeCloseTo(236.5, 10);
  });
});

describe("the cost of a food plan", () => {
  it("gives the cost of the reference family for one week, with no change for a household of four", () => {
    expect(foodPlanCost(thrifty, family, 7)).toEqual({ value: expect.closeTo(236.5, 10) as number, unit: "USD" });
  });

  it("applies the change for the size of the household", () => {
    const one = (count: number): FoodPlanMember[] => [{ group: "female-20-50", count }];
    expect(foodPlanCost(thrifty, one(1), 7).value).toBeCloseTo(58.7 * 1.2, 10);
    expect(foodPlanCost(thrifty, one(2), 7).value).toBeCloseTo(2 * 58.7 * 1.1, 10);
    expect(foodPlanCost(thrifty, one(3), 7).value).toBeCloseTo(3 * 58.7 * 1.05, 10);
    expect(foodPlanCost(thrifty, one(6), 7).value).toBeCloseTo(6 * 58.7 * 0.95, 10);
    expect(foodPlanCost(thrifty, one(9), 7).value).toBeCloseTo(9 * 58.7 * 0.9, 10);
  });

  it("is in proportion to the count of days", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), (a, b) => {
        const sum = foodPlanCost(thrifty, family, a).value + foodPlanCost(thrifty, family, b).value;
        expect(foodPlanCost(thrifty, family, a + b).value).toBeCloseTo(sum, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a household with no person, a bad count, an unknown group and a bad count of days", () => {
    expect(() => foodPlanCost(thrifty, [], 7)).toThrow(RangeError);
    expect(() => foodPlanCost(thrifty, [{ group: "male-20-50", count: 0 }], 7)).toThrow(RangeError);
    for (const count of [-1, 1.5, Number.NaN]) expect(() => foodPlanCost(thrifty, [{ group: "male-20-50", count }], 7), String(count)).toThrow(RangeError);
    expect(() => foodPlanCost(thrifty, [{ group: "unknown" as never, count: 1 }], 7)).toThrow(RangeError);
    for (const days of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => foodPlanCost(thrifty, family, days), String(days)).toThrow(RangeError);
  });
});

describe("the check of the food of a buy list against a food plan", () => {
  it("finds that 14 days of rice for the reference family cost less than the plan, and marks a cost above it", () => {
    const [rice] = averageSupplyPrices(SUPPLY_CATALOG, [
      {
        id: "bls-ap:APU0000701312:2026-10",
        source: "bls-ap",
        series: "APU0000701312",
        item: "Rice, white, long grain, uncooked, per lb. (453.6 gm)",
        area: "U.S. city average",
        period: "2026-10",
        price: { value: 1.101, unit: "USD/lb" },
        at: "2026-11-22T16:00:00Z",
      },
    ]);
    if (rice?.read !== true) throw new Error("The rice has no price.");
    // 2000 kcal for each person and day, and 3650 kcal in 1 kg of rice: 4 persons and 14 days need 31 units of 1 kg.
    const units = Math.ceil((2000 * 4 * 14) / 3650);
    expect(units).toBe(31);
    const check = foodPlanCheck({ value: units * rice.price.value, unit: rice.price.unit }, thrifty, family, 14);
    expect(check.plan.value).toBeCloseTo(473, 10);
    expect(check.ratio).toBeGreaterThan(0.1);
    expect(check.ratio).toBeLessThan(0.2);
    expect(check.above).toBe(false);
    expect(foodPlanCheck({ value: 600, unit: "USD" }, thrifty, family, 14).above).toBe(true);
  });

  it("refuses a cost in a money that does not convert to the money of the plan", () => {
    expect(() => foodPlanCheck({ value: 1, unit: "kg" }, thrifty, family, 7)).toThrow();
  });
});
