import { compare, sum, valueIn, type Quantity } from "@mark1russell7/quantity";
import { evolve, frontOf, sweep, type EvaluationRow, type Measure, type Objective, type SweepCounts } from "@mark1russell7/strategy-search";
import { spaceSize, STRATEGY_SPACE_SCHEMA, type SpaceParam, type StrategyConfig, type StrategySpace } from "@mark1russell7/strategy-space";
import { compile, isFieldName, parse, space, type AnyDomain, type Program } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { z } from "zod";
import { bestOffer, offersOfPart, type Observation, type OfferChoice, type PartWant } from "./offers.ts";
import { CONDITIONS, textSchema, type Condition } from "./records.ts";

/*
 * This module calculates a buy plan. A need names the slots of a purchase, the parts that can fill each slot, and
 * the measures and the rules of a basket as Vex programs. The plan searches the baskets with strategy-search, and it
 * gives the front of the price against the measures. The module knows no part class: the facts of each part and the
 * programs come from the need. Each function of this module is a calculation with no effect.
 */

/** The format name of a need record. */
export const NEED_FORMAT = "buy-need/1";

/** The format name of a plan record. */
export const PLAN_FORMAT = "buy-plan/1";

/** The key of the inputs of a need in the space of a basket. A slot cannot have this name. */
export const NEED_KEY = "need";

/** The fields that the plan writes in the record of each slot. A fact of a part cannot have one of these names. */
export const SLOT_FIELDS = ["slot", "part", "count", "cost"] as const;

/** The largest count of evaluations of a plan, when the options do not give a count. */
export const PLAN_EVALUATIONS = 2000;

/** The domains of the programs of a need: numbers, booleans and texts. */
const DOMAINS: readonly AnyDomain[] = [NumDomain, BoolDomain, TextDomain];

/** A fact of a part, or an input of a need: a number, a text or a boolean. */
export type Fact = number | string | boolean;

/** One part that can fill a slot: its key in the slot, the part that the offers must match, and its facts. */
export interface NeedPart {
  readonly key: string;
  readonly want: PartWant;
  /** The facts of the part that the programs read, for example its watts. */
  readonly facts?: Readonly<Record<string, Fact>>;
}

/** The count of units of a slot. With `min` 0, a basket can leave the slot empty. */
export interface SlotCount {
  readonly min: number;
  readonly max: number;
}

/** One slot of a need: its name, the parts that can fill it, and the count of its units. The default count is 1. */
export interface NeedSlot {
  readonly name: string;
  readonly parts: readonly NeedPart[];
  readonly count?: SlotCount;
}

/**
 * One measure of a basket: a Vex program that gives a number. With `goal`, the measure is an objective of the search.
 * A value below `min` or above `max` breaks the basket.
 */
export interface NeedMeasure {
  readonly name: string;
  /** The program, as the JSON form of a Vex expression. */
  readonly program: unknown;
  readonly goal?: "min" | "max";
  /** The unit of the values, as text for a reader. */
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
}

/** One rule of a basket: a Vex program that gives `true` when the basket keeps the rule. */
export interface NeedRule {
  readonly name: string;
  /** The program, as the JSON form of a Vex expression. */
  readonly program: unknown;
}

/** This record is a need: the currency and the conditions of the offers, the inputs, the slots, the measures and the rules. */
export interface BuyNeed {
  readonly format: typeof NEED_FORMAT;
  readonly id: string;
  /** The currency of the prices, a unit of money of `@mark1russell7/quantity`, for example `USD`. */
  readonly currency: string;
  /** The conditions that the buyer accepts. The default is `new` only. */
  readonly conditions?: readonly Condition[];
  /** The inputs that the programs read at the key `need`, for example the load in watts. */
  readonly inputs?: Readonly<Record<string, Fact>>;
  readonly slots: readonly NeedSlot[];
  readonly measures?: readonly NeedMeasure[];
  readonly rules?: readonly NeedRule[];
}

const factSchema: z.ZodType<Fact> = z.union([z.number().refine(Number.isFinite, "The number is not finite."), z.string(), z.boolean()]);
const factsSchema: z.ZodType<Readonly<Record<string, Fact>>> = z.record(textSchema, factSchema);
const wantSchema: z.ZodType<PartWant> = z.strictObject({ brands: z.array(textSchema).min(1), partNumbers: z.array(textSchema).min(1) });
const wholeSchema = z.number().int().nonnegative();

/** This schema accepts the form of a need. `needProblems` examines the names, the counts and the programs. */
export const buyNeedSchema: z.ZodType<BuyNeed> = z.strictObject({
  format: z.literal(NEED_FORMAT),
  id: textSchema,
  currency: textSchema,
  conditions: z.array(z.enum(CONDITIONS)).min(1).optional(),
  inputs: factsSchema.optional(),
  slots: z
    .array(
      z.strictObject({
        name: textSchema,
        parts: z.array(z.strictObject({ key: textSchema, want: wantSchema, facts: factsSchema.optional() })).min(1),
        count: z.strictObject({ min: wholeSchema, max: wholeSchema }).optional(),
      }),
    )
    .min(1),
  measures: z
    .array(
      z.strictObject({
        name: textSchema,
        program: z.unknown(),
        goal: z.enum(["min", "max"]).optional(),
        unit: textSchema.optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
  rules: z.array(z.strictObject({ name: textSchema, program: z.unknown() })).optional(),
});

/** This function gives the count of a slot, with the default 1 to 1. */
function countOf(slot: NeedSlot): SlotCount {
  return slot.count ?? { min: 1, max: 1 };
}

/** This function reads a program of a need. It gives the expression, or the reason that the program is not valid. */
function readProgram(program: unknown): { readonly ok: true; readonly program: Program } | { readonly ok: false; readonly why: string } {
  const text = program === undefined ? undefined : JSON.stringify(program);
  if (text === undefined) return { ok: false, why: "The program is missing." };
  const read = parse(text, DOMAINS);
  return read.ok ? { ok: true, program: compile(read.value, { domains: DOMAINS }) } : { ok: false, why: read.error.message };
}

/** This function compiles a program that `needProblems` accepts. */
function programOf(program: unknown): Program {
  const read = readProgram(program);
  if (!read.ok) throw new RangeError(read.why);
  return read.program;
}

/**
 * This function gives the problems of a need. Two slots, parts, measures or rules with one name are a problem. A bad
 * count is a problem. The slot name `need` and the measure name `price` are problems. A fact with the name of a field
 * of a slot is a problem. A program that is not valid is a problem.
 */
export function needProblems(need: BuyNeed): string[] {
  const problems: string[] = [];
  const twice = (names: readonly string[], what: string): void => {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) problems.push(`Two ${what} have the name ${name}.`);
      seen.add(name);
    }
  };
  twice(
    need.slots.map((slot) => slot.name),
    "slots",
  );
  for (const name of Object.keys(need.inputs ?? {})) if (!isFieldName(name)) problems.push(`The input ${name} is not a name of a field.`);
  for (const slot of need.slots) {
    if (slot.name === NEED_KEY) problems.push(`The slot ${NEED_KEY} has the name of the inputs.`);
    else if (!isFieldName(slot.name)) problems.push(`The slot ${slot.name} is not a name of a field.`);
    twice(
      slot.parts.map((part) => part.key),
      `parts of the slot ${slot.name}`,
    );
    const { min, max } = countOf(slot);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < 1 || min > max)
      problems.push(`The count of the slot ${slot.name} is ${String(min)} to ${String(max)}. It must be whole numbers, with a maximum of 1 or more and not below the minimum.`);
    for (const part of slot.parts) {
      for (const name of Object.keys(part.facts ?? {})) {
        if ((SLOT_FIELDS as readonly string[]).includes(name)) problems.push(`The part ${part.key} of the slot ${slot.name} has the fact ${name}, which is a field of the slot.`);
        else if (!isFieldName(name)) problems.push(`The fact ${name} of the part ${part.key} is not a name of a field.`);
      }
    }
  }
  const measures = need.measures ?? [];
  const rules = need.rules ?? [];
  twice(
    measures.map((measure) => measure.name),
    "measures",
  );
  twice(
    rules.map((rule) => rule.name),
    "rules",
  );
  for (const measure of measures) {
    if (measure.name === "price") problems.push("A measure has the name price, which is the objective of the cost.");
    if (measure.min !== undefined && measure.max !== undefined && measure.min > measure.max) problems.push(`The measure ${measure.name} has a minimum above its maximum.`);
    const read = readProgram(measure.program);
    if (!read.ok) problems.push(`The program of the measure ${measure.name} is not valid: ${read.why}`);
  }
  for (const rule of rules) {
    const read = readProgram(rule.program);
    if (!read.ok) problems.push(`The program of the rule ${rule.name} is not valid: ${read.why}`);
  }
  return problems;
}

/** This record is one item of a basket: the slot, the part, the count, the offer to buy and the cost with the shipping. */
export interface BuyItem {
  readonly slot: string;
  readonly part: string;
  readonly count: number;
  readonly offerId: string;
  readonly cost: Quantity;
}

/** This record is one basket of the front: its config id, its price, the value of each measure and its items. */
export interface BuyChoice {
  readonly config: string;
  /** The sum of the cost of each item. Each item is one order, with its own shipping. */
  readonly price: Quantity;
  readonly values: Readonly<Record<string, number>>;
  readonly items: readonly BuyItem[];
}

/** This record counts the baskets that break one constraint, with the reason of the first such basket. */
export interface BuyBreak {
  /** The constraint: `price:<slot>`, `measure:<name>`, `limit:<name>` or `rule:<name>`. */
  readonly name: string;
  readonly count: number;
  readonly why: string;
}

/** This record is a part that no basket can have, because no offer of the part is usable at a count of its slot. */
export interface UnpricedPart {
  readonly slot: string;
  readonly part: string;
  readonly why: string;
}

/** This record is a buy plan: the method of the search, its counts, the front of the baskets and the reasons of the breaks. */
export interface BuyPlan {
  readonly format: typeof PLAN_FORMAT;
  /** The id of the need. */
  readonly need: string;
  readonly currency: string;
  /** `grid` evaluates each basket. `evolve` is a genetic search. `none` tells that a slot that must have a part has no part with an offer. */
  readonly method: "grid" | "evolve" | "none";
  /** The seed of a genetic search, or null. */
  readonly seed: number | null;
  /** The id of the run of strategy-search, or null for `none`. */
  readonly run: string | null;
  readonly objectives: readonly Objective[];
  readonly counts: SweepCounts;
  /** The baskets on the Pareto front, from the lowest price. Equal prices go in the order of the config id. */
  readonly front: readonly BuyChoice[];
  /** The constraints that the evaluated baskets break, in the order of their names. */
  readonly breaks: readonly BuyBreak[];
  /** The parts with no usable offer, in the order of the slots and of their parts. */
  readonly unpriced: readonly UnpricedPart[];
}

/** These options change the search of a plan. */
export interface PlanOptions {
  /** The largest count of evaluations. A space with no more baskets gets a grid of each basket. The default is `PLAN_EVALUATIONS`. */
  readonly evaluations?: number;
  /** The seed of a genetic search. The default is the id of the need. */
  readonly seed?: number | string;
  /** The count of the baskets of a generation of a genetic search. The default is the default of strategy-search. */
  readonly population?: number;
}

/** The offer to buy for one count of a part, or the reason that no offer is usable. */
type Priced = { readonly ok: true; readonly offerId: string; readonly cost: Quantity } | { readonly ok: false; readonly why: string };

/** The breaks, the values and the items of one basket. */
interface Assessed {
  readonly breaks: readonly { readonly name: string; readonly why: string }[];
  readonly values: Readonly<Record<string, number>>;
  readonly price: Quantity | null;
  readonly items: readonly BuyItem[];
}

/**
 * This function chooses the offer to buy for a count of a part: the in-stock offer with the lowest cost, with the
 * shipping. An offer with a cost that is not known is not usable. Equal costs keep the order of `bestOffer`.
 */
function priceOf(observations: readonly Observation[], count: number, need: BuyNeed): Priced {
  const choice = bestOffer(observations, { currency: need.currency, count, ...(need.conditions === undefined ? {} : { conditions: need.conditions }) });
  let pick: (OfferChoice & { readonly cost: Quantity }) | undefined;
  for (const offer of choice.offers) {
    const cost = offer.cost;
    if (offer.inStock && cost !== null && (pick === undefined || compare(cost, pick.cost) < 0)) pick = { ...offer, cost };
  }
  if (pick !== undefined) return { ok: true, offerId: pick.observation.offer.id, cost: pick.cost };
  if (choice.offers.length > 0) return { ok: false, why: `No offer of ${String(count)} units is in stock with a known cost.` };
  const first = choice.skipped[0];
  return { ok: false, why: first === undefined ? "No offer matches the part." : `No offer is usable. The first offer that the choice skipped: ${first.why}` };
}

/**
 * This function makes a buy plan from a need and the observations of the offers. Each slot is a stage of a strategy
 * space. Each part with a usable offer is an option of its stage, with a param `count`. The price of a basket is the sum
 * of the cost of each item.
 *
 * Each measure and each rule is a Vex program that evaluates at the key `need` of a record space. The key `need` has
 * the inputs. The key of each slot has the facts of its part, `slot`, `part`, `count` and `cost`. A slot with no part
 * has only `slot`, the count 0 and the cost 0. Thus the axis `others` gives the slots.
 *
 * A space with no more baskets than `evaluations` gets a grid of each basket, and a larger space gets a genetic search.
 *
 * @throws RangeError when the need or its currency is not valid, or when `evaluations` is not a whole number of 1 or more.
 * The function also throws a RangeError when strategy-search refuses the options.
 */
export function planBuys(need: BuyNeed, observations: readonly Observation[], options: PlanOptions = {}): BuyPlan {
  const shape = buyNeedSchema.safeParse(need);
  if (!shape.success) throw new RangeError(`The need is not valid: ${shape.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" ")}`);
  const problems = needProblems(need);
  if (problems.length > 0) throw new RangeError(`The need is not valid: ${problems.join(" ")}`);
  const evaluations = options.evaluations ?? PLAN_EVALUATIONS;
  if (!Number.isSafeInteger(evaluations) || evaluations < 1) throw new RangeError(`The count of evaluations ${String(evaluations)} is not a whole number of 1 or more.`);

  const measures = (need.measures ?? []).map((measure) => ({ measure, program: programOf(measure.program) }));
  const rules = (need.rules ?? []).map((rule) => ({ rule, program: programOf(rule.program) }));
  const objectives: Objective[] = [
    { name: "price", goal: "min", unit: need.currency },
    ...measures.flatMap(({ measure }) => (measure.goal === undefined ? [] : [measure.unit === undefined ? { name: measure.name, goal: measure.goal } : { name: measure.name, goal: measure.goal, unit: measure.unit }])),
  ];

  // The price of each count of each part, once. A part with no usable offer at any count is not an option.
  const prices = new Map<string, Map<number, Priced>>();
  const unpriced: UnpricedPart[] = [];
  const stages: StrategySpace["stages"][number][] = [];
  let blocked = false;
  for (const slot of need.slots) {
    const { min, max } = countOf(slot);
    const low = Math.max(1, min);
    const params: SpaceParam[] = max > low ? [{ name: "count", kind: "int", min: low, max, default: low }] : [];
    const usable: string[] = [];
    for (const part of slot.parts) {
      const offers = offersOfPart(observations, part.want);
      const byCount = new Map<number, Priced>();
      for (let count = low; count <= max; count++) byCount.set(count, priceOf(offers, count, need));
      prices.set(`${slot.name}\u0000${part.key}`, byCount);
      const first = byCount.get(low);
      if ([...byCount.values()].some((priced) => priced.ok)) usable.push(part.key);
      else unpriced.push({ slot: slot.name, part: part.key, why: first === undefined || first.ok ? "No offer is usable." : first.why });
    }
    if (usable.length > 0) stages.push({ name: slot.name, options: usable.map((id) => ({ id, params })), ...(min === 0 ? { optional: true } : {}) });
    else if (min > 0) blocked = true;
  }
  const none: BuyPlan = { format: PLAN_FORMAT, need: need.id, currency: need.currency, method: "none", seed: null, run: null, objectives, counts: { feasible: 0, breaks: 0, unread: 0, front: 0 }, front: [], breaks: [], unpriced };
  if (blocked || stages.length === 0) return none;

  const strategySpace: StrategySpace = { schema: STRATEGY_SPACE_SCHEMA, engine: "buy-plan", version: "1", stages };

  const assess = (config: StrategyConfig): Assessed => {
    const breaks: { name: string; why: string }[] = [];
    const items: BuyItem[] = [];
    const records: Record<string, Readonly<Record<string, Fact>>> = { [NEED_KEY]: need.inputs ?? {} };
    for (const slot of need.slots) {
      const choice = config.stages[slot.name] ?? null;
      if (choice === null) {
        records[slot.name] = { slot: slot.name, count: 0, cost: 0 };
        continue;
      }
      const part = slot.parts.find((each) => each.key === choice.option) as NeedPart;
      const count = Number(choice.params?.["count"] ?? Math.max(1, countOf(slot).min));
      const priced = prices.get(`${slot.name}\u0000${part.key}`)?.get(count) ?? { ok: false, why: `The count ${String(count)} is not a count of the slot.` };
      if (!priced.ok) {
        breaks.push({ name: `price:${slot.name}`, why: `The part ${part.key} of the slot ${slot.name}: ${priced.why}` });
        records[slot.name] = { ...part.facts, slot: slot.name, part: part.key, count, cost: 0 };
        continue;
      }
      items.push({ slot: slot.name, part: part.key, count, offerId: priced.offerId, cost: priced.cost });
      records[slot.name] = { ...part.facts, slot: slot.name, part: part.key, count, cost: valueIn(priced.cost, need.currency) };
    }
    const price = breaks.length > 0 ? null : sum(items.map((item) => item.cost), need.currency);
    const values: Record<string, number> = price === null ? {} : { price: valueIn(price, need.currency) };
    const basket = space.record(records);
    for (const { measure, program } of measures) {
      const result = program.run({ space: basket, origin: NEED_KEY });
      if (!result.ok) breaks.push({ name: `measure:${measure.name}`, why: result.error.message });
      else if (typeof result.value !== "number" || !Number.isFinite(result.value)) breaks.push({ name: `measure:${measure.name}`, why: `The value ${String(result.value)} is not a finite number.` });
      else {
        values[measure.name] = result.value;
        if (measure.min !== undefined && result.value < measure.min) breaks.push({ name: `limit:${measure.name}`, why: `The value ${String(result.value)} is below the minimum ${String(measure.min)}.` });
        if (measure.max !== undefined && result.value > measure.max) breaks.push({ name: `limit:${measure.name}`, why: `The value ${String(result.value)} is above the maximum ${String(measure.max)}.` });
      }
    }
    for (const { rule, program } of rules) {
      const result = program.run({ space: basket, origin: NEED_KEY });
      if (!result.ok) breaks.push({ name: `rule:${rule.name}`, why: result.error.message });
      else if (result.value !== true) breaks.push({ name: `rule:${rule.name}`, why: result.value === false ? "The basket breaks the rule." : `The value ${String(result.value)} is not a boolean.` });
    }
    return { breaks, values, price, items };
  };

  // The reason of the first basket that breaks each constraint.
  const firstWhy = new Map<string, string>();
  const evaluate = (config: StrategyConfig): Measure => {
    const assessed = assess(config);
    for (const { name, why } of assessed.breaks) if (!firstWhy.has(name)) firstWhy.set(name, why);
    return { breaks: [...new Set(assessed.breaks.map((each) => each.name))], values: assessed.values };
  };

  const levels = Math.max(1, ...need.slots.map((slot) => countOf(slot).max - Math.max(1, countOf(slot).min) + 1));
  const grid = spaceSize(strategySpace, { levels }).base <= BigInt(evaluations);
  const evaluator = `buy-need:${need.id}`;
  const run = grid
    ? sweep(strategySpace, { objectives, evaluate, enumerate: { mode: "grid", levels, limit: evaluations }, evaluator })
    : evolve(strategySpace, {
        objectives,
        evaluate,
        seed: options.seed ?? need.id,
        evaluations,
        ...(options.population === undefined ? {} : { population: options.population }),
        evaluator,
      });

  const front = frontOf(run)
    .map(({ row, config }): BuyChoice => {
      const assessed = assess(config);
      const values = Object.fromEntries(Object.entries(assessed.values).filter(([name]) => name !== "price"));
      return { config: row.config, price: assessed.price as Quantity, values, items: assessed.items };
    })
    .sort((a, b) => compare(a.price, b.price) || (a.config < b.config ? -1 : a.config > b.config ? 1 : 0));
  return {
    ...none,
    method: grid ? "grid" : "evolve",
    seed: run.seed,
    run: run.run,
    counts: run.counts,
    front,
    breaks: breaksOf(run.rows, firstWhy),
    unpriced,
  };
}

/** This function counts the rows that break each constraint, in the order of the names. */
function breaksOf(rows: readonly EvaluationRow[], firstWhy: ReadonlyMap<string, string>): BuyBreak[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const name of row.breaks) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, count]) => ({ name, count, why: firstWhy.get(name) ?? "" }));
}
