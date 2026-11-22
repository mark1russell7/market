import { checkSources } from "@mark1russell7/guidebook";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACTIVITY_LEVELS, CALORIE_AGES, CALORIE_GROUPS, CALORIE_SEXES, calorieNeed, foodEnergyCheck, type ActivityLevel, type CalorieAge, type CalorieMember, type CalorieSex } from "./food-energy.ts";
import { CALORIE_TABLES } from "./food-energy-data.ts";
import type { SupplyCatalog } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const dga = CALORIE_TABLES[0]!;
const TODDLER_AGES = new Set<CalorieAge>(["12-months", "15-months", "18-months", "21-23-months"]);

/** The need of a group at a level, in kcal/d. A toddler has one need for each level. */
function need(sex: CalorieSex, age: CalorieAge, level: ActivityLevel): number {
  const row = dga.needs[`${sex}-${age}`];
  return row.levels === undefined ? row.each.value : row.levels[level].value;
}

/** The needs of the rows of the ages, for each sex and level. */
function needs(ages: readonly CalorieAge[], sexes: readonly CalorieSex[] = CALORIE_SEXES): number[] {
  return sexes.flatMap((sex) => ages.flatMap((age) => ACTIVITY_LEVELS.map((level) => need(sex, age, level))));
}

const YEARS = CALORIE_AGES.filter((age) => !TODDLER_AGES.has(age));
const ADULTS = YEARS.slice(YEARS.indexOf("19-20"));

/** Two adults of 31 to 35 years. */
const adults: CalorieMember[] = [
  { group: "male-31-35", count: 1 },
  { group: "female-31-35", count: 1 },
];

describe("the data of the calorie tables", () => {
  it("cites a source with a license, and has a need in kcal/d for each group", () => {
    expect(checkSources([dga.source], { at: "2026-11-22" }).filter((finding) => finding.level === "error")).toEqual([]);
    expect(Object.keys(dga.needs).sort()).toEqual([...CALORIE_GROUPS].sort());
    expect(CALORIE_GROUPS).toHaveLength(68);
    for (const group of CALORIE_GROUPS) {
      const row = dga.needs[group];
      const toddler = TODDLER_AGES.has(group.replace(/^(female|male)-/, "") as CalorieAge);
      // Table A2-1 gives one need for each age and sex of a toddler. Table A2-2 gives a need for each level.
      expect(row.each !== undefined, group).toBe(toddler);
      for (const quantity of row.each === undefined ? Object.values(row.levels) : [row.each]) expect(quantity.unit, group).toBe("kcal/d");
    }
  });

  it("adds each column of Table A2-2 to the sum of the PDF text", () => {
    // The sums come from a machine read of the text of pages 140 and 141 of the PDF, apart from the values of the data.
    const sum = (sex: CalorieSex, level: ActivityLevel): number => YEARS.reduce((total, age) => total + need(sex, age, level), 0);
    expect(ACTIVITY_LEVELS.map((level) => sum("male", level))).toEqual([57800, 65600, 74000]);
    expect(ACTIVITY_LEVELS.map((level) => sum("female", level))).toEqual([47400, 54000, 61200]);
  });

  it("holds the ranges of the text of Appendix 2", () => {
    const range = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];
    // The text gives 700 to 1,000 calories for the toddlers. The lowest value of Table A2-1 is 800.
    expect(range(needs([...TODDLER_AGES]))).toEqual([800, 1000]);
    expect(range(needs(YEARS.slice(0, YEARS.indexOf("9"))))).toEqual([1000, 2000]);
    expect(range(needs(YEARS.slice(YEARS.indexOf("9"), YEARS.indexOf("19-20"))))).toEqual([1400, 3200]);
    expect(range(needs(ADULTS, ["female"]))).toEqual([1600, 2400]);
    expect(range(needs(ADULTS, ["male"]))).toEqual([2000, 3000]);
  });

  it("has the values of some rows of the tables", () => {
    const row = (sex: CalorieSex, age: CalorieAge): number[] => ACTIVITY_LEVELS.map((level) => need(sex, age, level));
    expect(row("male", "12-months")).toEqual([800, 800, 800]);
    expect(row("female", "18-months")).toEqual([900, 900, 900]);
    expect(row("male", "3")).toEqual([1000, 1400, 1400]);
    expect(row("female", "3")).toEqual([1000, 1200, 1400]);
    expect(row("male", "16")).toEqual([2400, 2800, 3200]);
    expect(row("male", "19-20")).toEqual([2600, 2800, 3000]);
    expect(row("female", "26-30")).toEqual([1800, 2000, 2400]);
    expect(row("female", "51-55")).toEqual([1600, 1800, 2200]);
    expect(row("male", "61-65")).toEqual([2000, 2400, 2600]);
    expect(row("male", "76-up")).toEqual([2000, 2200, 2400]);
    expect(row("female", "76-up")).toEqual([1600, 1800, 2000]);
  });

  it("gives a need that does not decrease from sedentary to active in each row", () => {
    for (const sex of CALORIE_SEXES)
      for (const age of YEARS) {
        const [sedentary, moderate, active] = ACTIVITY_LEVELS.map((level) => need(sex, age, level));
        expect(sedentary! <= moderate! && moderate! <= active!, `${sex}-${age}`).toBe(true);
      }
  });
});

describe("the calorie need of a household", () => {
  it("adds the need of each person for the days", () => {
    expect(calorieNeed(dga, adults, "sedentary", 1)).toEqual({ value: 2400 + 1800, unit: "kcal" });
    expect(calorieNeed(dga, adults, "active", 14)).toEqual({ value: (3000 + 2200) * 14, unit: "kcal" });
    expect(calorieNeed(dga, [{ group: "female-8", count: 3 }], "moderately-active", 2).value).toBe(3 * 1600 * 2);
  });

  it("uses the level of a member before the level of the call", () => {
    const members: CalorieMember[] = [
      { group: "male-31-35", count: 1, level: "active" },
      { group: "female-31-35", count: 1 },
    ];
    expect(calorieNeed(dga, members, "sedentary", 1).value).toBe(3000 + 1800);
  });

  it("gives the one need of a toddler at each level", () => {
    for (const level of ACTIVITY_LEVELS) expect(calorieNeed(dga, [{ group: "female-15-months", count: 1 }], level, 1).value, level).toBe(800);
  });

  it("is in proportion to the count of days", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), fc.constantFrom(...ACTIVITY_LEVELS), (a, b, level) => {
        const sum = calorieNeed(dga, adults, level, a).value + calorieNeed(dga, adults, level, b).value;
        expect(calorieNeed(dga, adults, level, a + b).value).toBeCloseTo(sum, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a household with no person, a bad count, an unknown group or level, and a bad count of days", () => {
    expect(() => calorieNeed(dga, [], "sedentary", 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ group: "male-31-35", count: 0 }], "sedentary", 7)).toThrow(RangeError);
    for (const count of [-1, 1.5, Number.NaN]) expect(() => calorieNeed(dga, [{ group: "male-31-35", count }], "sedentary", 7), String(count)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ group: "male-20-50" as never, count: 1 }], "sedentary", 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, adults, "lazy" as never, 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ group: "male-31-35", count: 1, level: "lazy" as never }], "active", 7)).toThrow(RangeError);
    for (const days of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => calorieNeed(dga, adults, "sedentary", days), String(days)).toThrow(RangeError);
  });
});

describe("the check of the food energy of a buy list", () => {
  it("gives the days of food of a list and its shortfall", () => {
    // 14 kg of rice give 51,100 kcal. Two sedentary adults need 4200 kcal each day.
    const check = foodEnergyCheck(SUPPLY_CATALOG, { "food.rice-white-1kg": 14, "water.jug-1gal": 20 }, dga, adults, "sedentary", 14);
    expect(check.daily).toEqual({ value: 4200, unit: "kcal/d" });
    expect(check.need).toEqual({ value: 58800, unit: "kcal" });
    expect(check.lines).toEqual([{ product: "food.rice-white-1kg", units: 14, read: true, energy: { value: 51100, unit: "kcal" } }]);
    expect(check.read).toBe(true);
    expect(check.energy).toEqual({ value: 51100, unit: "kcal" });
    expect(check.days).toBeCloseTo(51100 / 4200, 10);
    expect(check.shortfall).toEqual({ value: 7700, unit: "kcal" });
    expect(check.enough).toBe(false);
  });

  it("gives no shortfall for a list with enough food", () => {
    const check = foodEnergyCheck(SUPPLY_CATALOG, { "food.rice-white-1kg": 10, "food.peanut-butter-1kg": 2, "food.soup-can": 4 }, dga, adults, "sedentary", 10);
    expect(check.energy.value).toBeCloseTo(36500 + 11960 + 869.2, 6);
    expect(check.shortfall.value).toBe(0);
    expect(check.enough).toBe(true);
    expect(check.days).toBeGreaterThan(10);
  });

  it("keeps a no read of energy as a line with no read, not as 0", () => {
    const catalog: SupplyCatalog = {
      ...SUPPLY_CATALOG,
      products: [
        ...SUPPLY_CATALOG.products,
        { id: "food.mystery", title: "A food with no label", kind: "food", gives: [], basis: "ready.kit-first-aid", energy: { read: false, why: "The label is lost." }, shelf: { read: false, why: "No label." } },
        { id: "food.unlisted", title: "A food with no energy field", kind: "food", gives: [], basis: "ready.kit-first-aid", shelf: { read: false, why: "No label." } },
      ],
    };
    const check = foodEnergyCheck(catalog, { "food.oats-1kg": 2, "food.mystery": 3, "food.unlisted": 1 }, dga, adults, "sedentary", 7);
    expect(check.read).toBe(false);
    expect(check.lines.map((line) => [line.product, line.read])).toEqual([
      ["food.oats-1kg", true],
      ["food.mystery", false],
      ["food.unlisted", false],
    ]);
    expect(check.lines[1]).toEqual({ product: "food.mystery", units: 3, read: false, why: "The label is lost." });
    expect(check.energy).toEqual({ value: 7580, unit: "kcal" });
    expect(check.enough).toBe(false);
  });

  it("gives no line for a product with 0 units, and converts an energy in kJ", () => {
    const catalog: SupplyCatalog = {
      ...SUPPLY_CATALOG,
      products: [...SUPPLY_CATALOG.products, { id: "food.bar", title: "A ration bar", kind: "food", gives: [], basis: "ready.kit-first-aid", energy: { read: true, amount: 4184, unit: "kJ", definition: "A test value." }, shelf: { read: false, why: "No label." } }],
    };
    const check = foodEnergyCheck(catalog, { "food.bar": 2, "food.oats-1kg": 0 }, dga, adults, "sedentary", 1);
    expect(check.lines).toHaveLength(1);
    expect(check.energy.value).toBeCloseTo(2000, 6);
  });

  it("refuses an unknown product, a bad count of units, and the errors of the need", () => {
    expect(() => foodEnergyCheck(SUPPLY_CATALOG, { "food.unknown": 1 }, dga, adults, "sedentary", 7)).toThrow(RangeError);
    for (const units of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => foodEnergyCheck(SUPPLY_CATALOG, { "food.oats-1kg": units }, dga, adults, "sedentary", 7), String(units)).toThrow(RangeError);
    expect(() => foodEnergyCheck(SUPPLY_CATALOG, {}, dga, [], "sedentary", 7)).toThrow(RangeError);
  });
});
