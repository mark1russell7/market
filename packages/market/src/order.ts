import { valueIn } from "@mark1russell7/quantity";
import { greedy, type Goal, type GreedyStop, type Selection } from "@mark1russell7/strategy-search";
import { offersOfPart, priceOf, type Observation, type PartWant } from "./offers.ts";
import type { Condition } from "./records.ts";

/*
 * This module calculates a buy order: the purchases that give the most value for each unit of money under a budget.
 * The candidates come from the offers. The order is a budgeted greedy choice of strategy-search, in stages, for
 * example a first target and then a second target. The module knows no topic: the caller gives the value of a choice.
 */

/** One product that a buyer wants: its key, the part that the offers must match, and the largest count of its units. */
export interface ProductWant {
  readonly product: string;
  readonly want: PartWant;
  /** The largest count of units to buy. The default is 1. */
  readonly max?: number | undefined;
}

/** One candidate of a buy order: a product, the price of one unit, the largest count of units and the offer. */
export interface BuyCandidate {
  readonly product: string;
  /** The cost of one unit with its shipping, in the currency of the order. */
  readonly price: number;
  readonly max: number;
  /** The `id` of the offer of the price. */
  readonly quote: string;
}

/** The candidates of a buy order, and the products that have no usable offer. */
export interface BuyCandidates {
  readonly currency: string;
  readonly candidates: readonly BuyCandidate[];
  readonly unpriced: readonly { readonly product: string; readonly why: string }[];
}

/** The options of the candidates: the currency and the conditions that the buyer accepts. */
export interface CandidateOptions {
  /** The currency of the prices, a unit of money of `@mark1russell7/quantity`, for example `USD`. */
  readonly currency: string;
  /** The conditions that the buyer accepts. The default is `new` only. */
  readonly conditions?: readonly Condition[] | undefined;
}

/**
 * This function gives a candidate for each product with a usable offer. The price is the cost of one unit with its
 * shipping, from the in-stock offer with the lowest cost, as in `planBuys`. Each unit is one order, so the price is an
 * upper limit of the cost of more units.
 *
 * @param wants - The products, in the order of the result
 * @param observations - The observations of the offers
 * @param options - The currency and the conditions
 * @throws RangeError when the currency is not a unit of money, or when a product is twice in `wants`
 */
export function buyCandidates(wants: readonly ProductWant[], observations: readonly Observation[], options: CandidateOptions): BuyCandidates {
  const seen = new Set<string>();
  const candidates: BuyCandidate[] = [];
  const unpriced: { product: string; why: string }[] = [];
  for (const want of wants) {
    if (seen.has(want.product)) throw new RangeError(`The product ${want.product} is twice in the wants.`);
    seen.add(want.product);
    const max = want.max ?? 1;
    if (!(Number.isSafeInteger(max) && max >= 0)) throw new RangeError(`The max of the product ${want.product} is ${String(max)}. It must be a whole number of 0 or more.`);
    const priced = priceOf(offersOfPart(observations, want.want), 1, options);
    if (priced.ok) candidates.push({ product: want.product, price: valueIn(priced.cost, options.currency), max, quote: priced.offerId });
    else unpriced.push({ product: want.product, why: priced.why });
  }
  return { currency: options.currency, candidates, unpriced };
}

/** One stage of a buy order: its name and the value of a choice, the most important number first. */
export interface OrderStage {
  readonly name: string;
  /** The value of the units of each product. It is a pure function. */
  readonly value: (units: Selection) => readonly number[];
}

/** The options of a buy order. */
export interface OrderOptions {
  /** The money of the order, in the currency of the candidates. */
  readonly budget: number;
  /** The stages, in order. Each stage starts from the units of the stage before it, with the money that is left. */
  readonly stages: readonly OrderStage[];
  /** The goal of each number of a value. Use `min` for a shortfall. The default is `max`. */
  readonly goal?: Goal | undefined;
  /** The units that the buyer has before the order. Their cost is not in the budget. */
  readonly start?: Selection | undefined;
  /** With `false`, each step evaluates each product again. Use it when two products give more together than apart. */
  readonly lazy?: boolean | undefined;
}

/** One purchase of a buy order: one unit of a product, its offer and its cost, and its gain in its stage. */
export interface OrderBuy {
  readonly stage: string;
  readonly product: string;
  readonly quote: string;
  readonly cost: number;
  readonly gain: readonly number[];
}

/** The result of one stage: the value before and after it, the money that it spends and the reason that it stops. */
export interface OrderStageResult {
  readonly name: string;
  readonly method: "greedy" | "single";
  readonly before: readonly number[];
  readonly after: readonly number[];
  readonly spent: number;
  readonly stop: GreedyStop;
  readonly evaluations: number;
}

/** A buy order: the purchases in the order of the choice, the units of each product, and the result of each stage. */
export interface BuyOrder {
  readonly budget: number;
  readonly spent: number;
  readonly buys: readonly OrderBuy[];
  /** The units of each product after the order, with the units of `start`. */
  readonly units: Selection;
  readonly stages: readonly OrderStageResult[];
}

/**
 * This function calculates a buy order with a budgeted greedy choice in each stage. Each step buys one unit of the
 * product with the largest gain for each unit of money. The choice is `greedy` of `@mark1russell7/strategy-search`.
 *
 * - A stage starts from the units of the stage before it, and it spends only the money that is left.
 * - A stage can give the best single unit in place of its steps, when that unit has a better value (`method: "single"`).
 *
 * @param candidates - The candidates, from `buyCandidates`
 * @param options - The budget, the stages, the goal and the start
 * @returns The buy order
 * @throws RangeError when the options are bad, or when a value is not a list of finite numbers with one length
 */
export function orderBuys(candidates: readonly BuyCandidate[], options: OrderOptions): BuyOrder {
  if (options.stages.length === 0) throw new RangeError("The order has no stage.");
  if (!(Number.isFinite(options.budget) && options.budget >= 0)) throw new RangeError(`The budget is ${String(options.budget)}. It must be a finite number of 0 or more.`);
  const byProduct = new Map(candidates.map((candidate) => [candidate.product, candidate]));
  const items = candidates.map((candidate) => ({ id: candidate.product, cost: candidate.price, max: candidate.max }));
  const start: Selection = options.start ?? {};
  let units: Selection = start;
  let left = options.budget;
  let spent = 0;
  const buys: OrderBuy[] = [];
  const stages: OrderStageResult[] = [];
  for (const stage of options.stages) {
    // The max of each item is what is left after the stages before.
    const open = items.map((item) => ({ ...item, max: item.max - ((units[item.id] ?? 0) - (start[item.id] ?? 0)) }));
    const run = greedy({
      items: open,
      budget: Math.max(0, left),
      value: stage.value,
      start: units,
      ...(options.goal === undefined ? {} : { goal: options.goal }),
      ...(options.lazy === undefined ? {} : { lazy: options.lazy }),
    });
    for (const pick of run.picks) buys.push({ stage: stage.name, product: pick.id, quote: byProduct.get(pick.id)?.quote ?? "", cost: pick.cost, gain: pick.gain });
    units = run.selection;
    left -= run.spent;
    spent += run.spent;
    stages.push({ name: stage.name, method: run.method, before: run.before, after: run.after, spent: run.spent, stop: run.stop, evaluations: run.evaluations });
  }
  return { budget: options.budget, spent, buys, units, stages };
}
