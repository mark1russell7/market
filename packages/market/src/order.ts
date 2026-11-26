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
  /**
   * The kits: sets of units that one step buys together. Use a kit when no unit of its parts has a gain alone.
   * An example is a dry food and the fuel to cook it. The default is none. Since 0.11.6.
   */
  readonly kits?: readonly BuyKit[] | undefined;
}

/**
 * A kit of a buy order: the units of products that one step buys together. The cost of a kit is the sum of the prices
 * of its units. Each part is a product of the candidates.
 */
export interface BuyKit {
  /** The key of the kit. It is not the key of a product of the candidates. */
  readonly id: string;
  /** The count of units of each product in one kit, each a whole number of 1 or more. */
  readonly parts: Readonly<Record<string, number>>;
  /** The largest count of kits to buy. The default is the most kits that the max of each part permits. */
  readonly max?: number | undefined;
}

/**
 * One purchase of a buy order: one unit of a product or one kit, its offer and its cost, and its gain in its stage.
 * A kit has the key of the kit in `product`, its parts in `kit`, and the offers of its parts in `quote`, joined by ", ".
 */
export interface OrderBuy {
  readonly stage: string;
  readonly product: string;
  readonly quote: string;
  readonly cost: number;
  readonly gain: readonly number[];
  /** The units of each product of a kit. A purchase of one unit of a product has no field `kit`. Since 0.11.6. */
  readonly kit?: Readonly<Record<string, number>> | undefined;
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
  /** The units of each product after the order, with the units of `start` and the units of each kit. */
  readonly units: Selection;
  /** The count of each kit that the order buys. Since 0.11.6. */
  readonly kits: Selection;
  readonly stages: readonly OrderStageResult[];
}

/**
 * This function calculates a buy order with a budgeted greedy choice in each stage. Each step buys one unit of the
 * product with the largest gain for each unit of money. The choice is `greedy` of `@mark1russell7/strategy-search`.
 *
 * - A stage starts from the units of the stage before it, and it spends only the money that is left.
 * - A stage can give the best single unit in place of its steps, when that unit has a better value (`method: "single"`).
 * - A kit is one more item of the choice. Its cost is the sum of the prices of its units. The value of a stage gets the
 *   units of each product with the units of each kit. Thus one step of a kit can have a gain when no unit alone has one.
 * - The max of a product limits the units of that product alone, and the max of a kit limits the count of that kit.
 *   Thus the units of a product with its kits can be more than its max. Give a kit its own `max` to limit them.
 *
 * @param candidates - The candidates, from `buyCandidates`
 * @param options - The budget, the stages, the goal, the start and the kits
 * @returns The buy order
 * @throws RangeError when the options are bad, or when a value is not a list of finite numbers with one length
 * @throws RangeError when a kit has the key of a product or of another kit, or when it has no parts
 * @throws RangeError when a part of a kit is not a candidate, or when a kit has a bad count or max
 */
export function orderBuys(candidates: readonly BuyCandidate[], options: OrderOptions): BuyOrder {
  if (options.stages.length === 0) throw new RangeError("The order has no stage.");
  if (!(Number.isFinite(options.budget) && options.budget >= 0)) throw new RangeError(`The budget is ${String(options.budget)}. It must be a finite number of 0 or more.`);
  const byProduct = new Map(candidates.map((candidate) => [candidate.product, candidate]));
  const kits = new Map((options.kits ?? []).map((kit) => [kit.id, checkKit(kit, byProduct)]));
  if (kits.size !== (options.kits ?? []).length) throw new RangeError("Two kits have the same key.");
  const items = [
    ...candidates.map((candidate) => ({ id: candidate.product, cost: candidate.price, max: candidate.max })),
    ...[...kits.values()].map((kit) => ({ id: kit.id, cost: kit.cost, max: kit.max })),
  ];
  // The value of a stage gets the units of each product, with the units of each kit. A kit key is not a product.
  const expand = (selection: Selection): Selection => {
    const out: Record<string, number> = {};
    for (const [id, count] of Object.entries(selection)) {
      const kit = kits.get(id);
      if (kit === undefined) out[id] = (out[id] ?? 0) + count;
      else for (const [part, each] of Object.entries(kit.parts)) out[part] = (out[part] ?? 0) + count * each;
    }
    return out;
  };
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
      value: kits.size === 0 ? stage.value : (selection: Selection) => stage.value(expand(selection)),
      start: units,
      ...(options.goal === undefined ? {} : { goal: options.goal }),
      ...(options.lazy === undefined ? {} : { lazy: options.lazy }),
    });
    for (const pick of run.picks) {
      const kit = kits.get(pick.id);
      if (kit === undefined) buys.push({ stage: stage.name, product: pick.id, quote: byProduct.get(pick.id)?.quote ?? "", cost: pick.cost, gain: pick.gain });
      else buys.push({ stage: stage.name, product: pick.id, quote: kit.quotes, cost: pick.cost, gain: pick.gain, kit: kit.parts });
    }
    units = run.selection;
    left -= run.spent;
    spent += run.spent;
    stages.push({ name: stage.name, method: run.method, before: run.before, after: run.after, spent: run.spent, stop: run.stop, evaluations: run.evaluations });
  }
  const bought = Object.fromEntries(Object.entries(units).filter(([id, count]) => kits.has(id) && count > 0));
  return { budget: options.budget, spent, buys, units: expand(units), kits: bought, stages };
}

/** A kit with its cost, its max and the offers of its parts. */
interface CheckedKit {
  readonly id: string;
  readonly parts: Readonly<Record<string, number>>;
  readonly cost: number;
  readonly max: number;
  readonly quotes: string;
}

/** This function checks a kit against the candidates, and gives its cost, its max and the offers of its parts. */
function checkKit(kit: BuyKit, byProduct: ReadonlyMap<string, BuyCandidate>): CheckedKit {
  if (byProduct.has(kit.id)) throw new RangeError(`The kit ${kit.id} has the key of a product.`);
  const parts = Object.entries(kit.parts);
  if (parts.length === 0) throw new RangeError(`The kit ${kit.id} has no parts.`);
  let cost = 0;
  let most = Number.MAX_SAFE_INTEGER;
  const quotes: string[] = [];
  for (const [product, count] of parts) {
    const candidate = byProduct.get(product);
    if (candidate === undefined) throw new RangeError(`The kit ${kit.id} has the part ${product}, and that product is not a candidate.`);
    if (!(Number.isSafeInteger(count) && count >= 1)) throw new RangeError(`The kit ${kit.id} has ${String(count)} units of ${product}. It must be a whole number of 1 or more.`);
    cost += count * candidate.price;
    most = Math.min(most, Math.floor(candidate.max / count));
    quotes.push(candidate.quote);
  }
  const max = kit.max ?? most;
  if (!(Number.isSafeInteger(max) && max >= 0)) throw new RangeError(`The max of the kit ${kit.id} is ${String(max)}. It must be a whole number of 0 or more.`);
  return { id: kit.id, parts: kit.parts, cost, max, quotes: quotes.join(", ") };
}
