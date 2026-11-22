import type { Source } from "@mark1russell7/guidebook";
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import type { SupplyCatalog } from "./supplies.ts";

/*
 * This module has the energy need of the members of a household, from a cited table of estimated calorie needs. A
 * check compares the food energy of a buy list with that need, and gives the days of food of the list and the
 * shortfall. The module names no person. The members of a household and their activity level are input data.
 *
 * The age groups of the table are not the groups of a food plan (`FOOD_PLAN_GROUPS`). The table gives one row for
 * each year of age from 2 to 18 years, and adult groups of 5 years from 21 years. The food plan has children of the
 * two sexes in one group, and adult groups of 20 to 50 years and of 51 to 70 years. No source gives a map from the
 * groups of one table to the groups of the other. Thus this module keeps the groups of its table.
 */

/** The activity levels of the table, as the source names them: sedentary, moderately active and active. */
export const ACTIVITY_LEVELS = ["sedentary", "moderately-active", "active"] as const;

/** An activity level of the table. */
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** The sexes of the table. */
export const CALORIE_SEXES = ["female", "male"] as const;

/** A sex of the table. */
export type CalorieSex = (typeof CALORIE_SEXES)[number];

/**
 * The ages of the rows of the table, in the order of the source. The first four rows are ages in months of a
 * toddler. The other rows are ages in years: one row for each year from 2 to 18, and then the groups of the source.
 */
export const CALORIE_AGES = [
  "12-months",
  "15-months",
  "18-months",
  "21-23-months",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19-20",
  "21-25",
  "26-30",
  "31-35",
  "36-40",
  "41-45",
  "46-50",
  "51-55",
  "56-60",
  "61-65",
  "66-70",
  "71-75",
  "76-up",
] as const;

/** An age of a row of the table. */
export type CalorieAge = (typeof CALORIE_AGES)[number];

/** An age and sex group of the table, for example `female-31-35` or `male-12-months`. */
export type CalorieGroup = `${CalorieSex}-${CalorieAge}`;

/** The age and sex groups of the table: the female groups, and then the male groups, each in the order of the ages. */
export const CALORIE_GROUPS: readonly CalorieGroup[] = CALORIE_SEXES.flatMap((sex) => CALORIE_AGES.map((age): CalorieGroup => `${sex}-${age}`));

/**
 * The estimated calorie need of one person of a group for each day. A row of the source gives a need for each
 * activity level, or one need for each level. The table of the toddlers gives one need for each age and sex only.
 * Each need is in a unit of energy for each unit of time, for example `{ "value": 2000, "unit": "kcal/d" }`.
 */
export type CalorieNeed =
  | { readonly levels: Readonly<Record<ActivityLevel, Quantity>>; readonly each?: never }
  | { readonly each: Quantity; readonly levels?: never };

/** A table of estimated calorie needs from one source. */
export interface CalorieTable {
  /** The id, for example `dga.2020-2025:calorie-needs`. */
  readonly id: string;
  readonly title: string;
  readonly source: Source;
  /** The place of the tables in the source. */
  readonly locator: string;
  /** The need of each group. */
  readonly needs: Readonly<Record<CalorieGroup, CalorieNeed>>;
}

/** A group of the members of a household, and the count of its persons. */
export interface CalorieMember {
  readonly group: CalorieGroup;
  readonly count: number;
  /** The activity level of the persons of the group. Without it, the level of the call applies. */
  readonly level?: ActivityLevel | undefined;
}

/** The unit of each food energy of a check. */
const ENERGY_UNIT = "kcal";
/** The unit of each daily need of a check. */
const DAILY_UNIT = "kcal/d";

/**
 * This function gives the energy need of the members of a household for each day, in `kcal/d`.
 *
 * @throws RangeError for the errors of `calorieNeed`, other than the count of days
 */
function dailyNeed(table: CalorieTable, members: readonly CalorieMember[], level: ActivityLevel): Quantity {
  if (!(ACTIVITY_LEVELS as readonly string[]).includes(level)) throw new RangeError(`The activity level ${String(level)} is not a level of the table.`);
  let persons = 0;
  let total = 0;
  for (const member of members) {
    if (!(Number.isSafeInteger(member.count) && member.count >= 0)) throw new RangeError(`The count of the group ${member.group} is ${String(member.count)}. It must be a whole number of 0 or more.`);
    const own = member.level ?? level;
    if (!(ACTIVITY_LEVELS as readonly string[]).includes(own)) throw new RangeError(`The activity level ${String(own)} of the group ${member.group} is not a level of the table.`);
    const need = table.needs[member.group] as CalorieNeed | undefined;
    const daily = need === undefined ? undefined : (need.levels?.[own] ?? need.each);
    if (daily === undefined) throw new RangeError(`The table ${table.id} has no need for the group ${String(member.group)}.`);
    persons += member.count;
    total += member.count * valueIn(daily, DAILY_UNIT);
  }
  if (persons === 0) throw new RangeError("The household has no person.");
  return quantity(total, DAILY_UNIT);
}

/**
 * This function gives the energy need of the members of a household for a count of days, in `kcal`. It adds the
 * need of each person at the activity level of that person.
 *
 * The activity level is an explicit input. This package has no default level. The planner picks it, also for the
 * worst case of a long power cut. In that case, work can make the level higher, for example the carry of water.
 * The table of the toddlers gives one need for each age and sex, so the level does not change the need of a toddler.
 *
 * @param table - The table of calorie needs
 * @param members - The groups of the members of the household, each with its count of persons and, as an option, its level
 * @param level - The activity level of each member with no level of its own
 * @param days - The count of days, a finite number of 0 or more
 * @throws RangeError when a count of persons is not a whole number of 0 or more, or when the household has no person
 * @throws RangeError when a level is not a level of the table, or when a group is not in the table
 * @throws RangeError when the count of days is not a finite number of 0 or more
 */
export function calorieNeed(table: CalorieTable, members: readonly CalorieMember[], level: ActivityLevel, days: number): Quantity {
  if (!(Number.isFinite(days) && days >= 0)) throw new RangeError(`The count of days is ${String(days)}. It must be a finite number of 0 or more.`);
  return quantity(dailyNeed(table, members, level).value * days, ENERGY_UNIT);
}

/** The food energy of the units of one product of a buy list, or no read with the reason. A no read is not 0. */
export type FoodEnergyLine =
  | { readonly product: string; readonly units: number; readonly read: true; readonly energy: Quantity }
  | { readonly product: string; readonly units: number; readonly read: false; readonly why: string };

/** The result of a check of the food energy of a buy list against the energy need of a household. */
export interface FoodEnergyCheck {
  /** The energy need of the members for each day, in `kcal/d`. */
  readonly daily: Quantity;
  /** The energy need of the members for the days of the check, in `kcal`. */
  readonly need: Quantity;
  /** The food energy of each product of the list, in the order of the list. */
  readonly lines: readonly FoodEnergyLine[];
  /** True when each line has a read. When it is false, `energy` and `days` are a lower limit, and `shortfall` is an upper limit. */
  readonly read: boolean;
  /** The sum of the food energy of the lines with a read, in `kcal`. */
  readonly energy: Quantity;
  /** The count of days of food that `energy` gives to the members: `energy` divided by `daily`. */
  readonly days: number;
  /** The energy that the list does not give for the days of the check, in `kcal`. It is 0 when the list gives enough. */
  readonly shortfall: Quantity;
  /** True when `energy` is equal to `need` or more. A line with no read does not make it true. */
  readonly enough: boolean;
}

/**
 * This function compares the food energy of a buy list with the energy need of the members of a household for a count
 * of days. The energy of each product is its field `energy` in the catalog, times its count of units.
 *
 * - A product with a no read for its energy gives a line with no read. A no read is not 0.
 * - A food product with no field `energy` also gives a line with no read.
 * - A product of another kind with no field `energy` is not food, for example water. It gives no line.
 * - A product with 0 units gives no line.
 *
 * The list can be the `units` of a buy order. The activity level is an explicit input, as for `calorieNeed`.
 *
 * @param catalog - The catalog of supplies
 * @param units - The count of units of each product of the list, by the `id` of the product
 * @param table - The table of calorie needs
 * @param members - The groups of the members of the household, each with its count of persons and, as an option, its level
 * @param level - The activity level of each member with no level of its own
 * @param days - The count of days of the check, a finite number of 0 or more
 * @throws RangeError for the errors of `calorieNeed`
 * @throws RangeError when a count of units is not a finite number of 0 or more, or when the catalog has no such product
 * @throws The error of `valueIn` of `@mark1russell7/quantity` when the unit of an energy does not convert to `kcal`
 */
export function foodEnergyCheck(
  catalog: SupplyCatalog,
  units: Readonly<Record<string, number>>,
  table: CalorieTable,
  members: readonly CalorieMember[],
  level: ActivityLevel,
  days: number,
): FoodEnergyCheck {
  const need = calorieNeed(table, members, level, days);
  const daily = dailyNeed(table, members, level);
  const lines: FoodEnergyLine[] = [];
  for (const [id, count] of Object.entries(units)) {
    if (!(Number.isFinite(count) && count >= 0)) throw new RangeError(`The count of units of the product ${id} is ${String(count)}. It must be a finite number of 0 or more.`);
    const product = catalog.products.find((each) => each.id === id);
    if (product === undefined) throw new RangeError(`The catalog has no product ${id}.`);
    if (count === 0) continue;
    const energy = product.energy;
    if (energy === undefined) {
      if (product.kind === "food") lines.push({ product: id, units: count, read: false, why: `The catalog has no food energy for the product ${id}.` });
      continue;
    }
    if (!energy.read) lines.push({ product: id, units: count, read: false, why: energy.why });
    else lines.push({ product: id, units: count, read: true, energy: quantity(count * valueIn(quantity(energy.amount, energy.unit), ENERGY_UNIT), ENERGY_UNIT) });
  }
  const total = lines.reduce((sum, line) => sum + (line.read ? line.energy.value : 0), 0);
  return {
    daily,
    need,
    lines,
    read: lines.every((line) => line.read),
    energy: quantity(total, ENERGY_UNIT),
    days: total / daily.value,
    shortfall: quantity(Math.max(0, need.value - total), ENERGY_UNIT),
    enough: total >= need.value,
  };
}
