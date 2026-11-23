import type { Source } from "@mark1russell7/guidebook";
import { atomAbove, convertible, quantity, valueIn, type Quantity } from "@mark1russell7/quantity";

/** This function gives the money of a cost for each unit of time, for example `USD` for `USD/wk`. */
function moneyOfRate(unit: string): string | undefined {
  const money = atomAbove(unit, "money");
  return money !== undefined && convertible(unit, `${money}/d`) ? money : undefined;
}

/*
 * This module has the cost of a food plan: the cost of the food of one week for one person of each age and sex, from
 * an official source. A check compares the food of a buy list with the cost of the plan for the same people and days.
 * The module names no person. The members of a household are input data.
 */

/** The age and sex groups of a food plan of USDA. */
export const FOOD_PLAN_GROUPS = [
  "child-1",
  "child-2-3",
  "child-4-5",
  "child-6-8",
  "child-9-11",
  "female-12-13",
  "female-14-19",
  "female-20-50",
  "female-51-70",
  "female-71-up",
  "male-12-13",
  "male-14-19",
  "male-20-50",
  "male-51-70",
  "male-71-up",
] as const;

/** An age and sex group of a food plan. */
export type FoodPlanGroup = (typeof FOOD_PLAN_GROUPS)[number];

/** The change of the cost for a size of household, for example 0.2 for one person. */
export interface FoodPlanSize {
  /** The smallest count of persons. */
  readonly from: number;
  /** The largest count of persons. Without it, the change applies to each larger household. */
  readonly to?: number | undefined;
  /** The change of the cost, as a fraction: 0.2 adds 20 percent, and -0.05 subtracts 5 percent. */
  readonly change: number;
}

/** The cost of a food plan in one area and one month, from one source. */
export interface FoodPlan {
  /** The id, for example `usda.thrifty:2026-10`. */
  readonly id: string;
  readonly title: string;
  /** The area, as the source names it, for example `U.S. average`. */
  readonly area: string;
  /** The month of the costs, in the form `YYYY-MM`. */
  readonly period: string;
  readonly source: Source;
  /** The place of the table in the source. */
  readonly locator: string;
  /** The cost of the food of one week for one person of each group, for example `{ "value": 58.7, "unit": "USD/wk" }`. */
  readonly weekly: Readonly<Record<FoodPlanGroup, Quantity>>;
  /** The change of the cost for each size of household. The costs of `weekly` are for the size with the change 0. */
  readonly sizes: readonly FoodPlanSize[];
}

/** A group of the members of a household, and the count of its persons. */
export interface FoodPlanMember {
  readonly group: FoodPlanGroup;
  readonly count: number;
}

/** The result of a check of the cost of food against a food plan. */
export interface FoodPlanCheck {
  /** The cost of the plan for the same members and days. */
  readonly plan: Quantity;
  /** The cost of the food, in the money of the plan. */
  readonly cost: Quantity;
  /** The cost of the food divided by the cost of the plan. */
  readonly ratio: number;
  /**
   * True when the food costs more than the plan. The Thrifty plan is the lowest of the four plans of USDA. Thus a list
   * above the cost of the Thrifty plan is not wrong when it has foods that cost more than staples.
   */
  readonly above: boolean;
}

/**
 * This function gives the cost of a food plan for the members of a household and a count of days. It adds the cost of
 * each person, and then it applies the change for the size of the household.
 *
 * @param plan - The food plan
 * @param members - The groups of the members of the household, each with its count of persons
 * @param days - The count of days, a finite number of 0 or more
 * @throws RangeError when a count of persons is not a whole number of 0 or more, or when the household has no person
 * @throws RangeError when a group is not in the plan, or when the plan has no change for the size of the household
 * @throws RangeError when the count of days is not a finite number of 0 or more
 */
export function foodPlanCost(plan: FoodPlan, members: readonly FoodPlanMember[], days: number): Quantity {
  if (!(Number.isFinite(days) && days >= 0)) throw new RangeError(`The count of days is ${String(days)}. It must be a finite number of 0 or more.`);
  let persons = 0;
  let money: string | undefined;
  let total = 0;
  for (const member of members) {
    if (!(Number.isSafeInteger(member.count) && member.count >= 0)) throw new RangeError(`The count of the group ${member.group} is ${String(member.count)}. It must be a whole number of 0 or more.`);
    const weekly = plan.weekly[member.group] as Quantity | undefined;
    const symbol = weekly === undefined ? undefined : moneyOfRate(weekly.unit);
    if (weekly === undefined || symbol === undefined) throw new RangeError(`The plan ${plan.id} has no cost for each unit of time of the group ${String(member.group)}.`);
    if (money !== undefined && symbol !== money) throw new RangeError(`The plan ${plan.id} has costs in ${money} and in ${symbol}.`);
    money = symbol;
    persons += member.count;
    total += member.count * valueIn(weekly, `${symbol}/d`) * days;
  }
  if (persons === 0 || money === undefined) throw new RangeError("The household has no person.");
  const size = plan.sizes.find((each) => persons >= each.from && (each.to === undefined || persons <= each.to));
  if (size === undefined) throw new RangeError(`The plan ${plan.id} has no change for a household of ${String(persons)} persons.`);
  return quantity(total * (1 + size.change), money);
}

/**
 * This function compares the cost of the food of a buy list with the cost of a food plan for the same members and
 * days. A list of dry staples costs less than the plan, because the plan is a full diet. A ratio above 1 tells that
 * a price or an amount of the list is possibly wrong. A low ratio is normal, because a list can be any part of a diet.
 * The check of the amount of food is a check of its energy, not of its cost.
 *
 * @param cost - The cost of the food, in a money that converts to the money of the plan
 * @param plan - The food plan
 * @param members - The groups of the members of the household, each with its count of persons
 * @param days - The count of days of the food
 * @throws RangeError for the errors of `foodPlanCost`
 * @throws The error of `valueIn` of `@mark1russell7/quantity` when the money of the cost does not convert to the money of the plan
 */
export function foodPlanCheck(cost: Quantity, plan: FoodPlan, members: readonly FoodPlanMember[], days: number): FoodPlanCheck {
  const planned = foodPlanCost(plan, members, days);
  const value = valueIn(cost, planned.unit);
  const ratio = planned.value === 0 ? (value === 0 ? 0 : Number.POSITIVE_INFINITY) : value / planned.value;
  return { plan: planned, cost: quantity(value, planned.unit), ratio, above: ratio > 1 };
}
