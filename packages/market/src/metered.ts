import {
  atomAbove,
  canonicalUnit,
  convertExact,
  convertible,
  parseUnit,
  quantity,
  rationals,
  UnitError,
  type Quantity,
  type Rational,
} from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";
import { instantSchema, moneySchema, offerId, sourceSchema, specSchema, textSchema, type Spec } from "./records.ts";

/*
 * This module has the metered prices of a market. A provider meters an amount, for example the hours of a machine,
 * the stored data of each month, the data that goes out, or the requests. A metered price is a price for each unit
 * of that amount, in tiers, with a free amount for each billing period and a term.
 */

/**
 * The kinds of a metered amount: a time (the hours of a machine), data times time (stored data), data (a transfer)
 * and a count (requests).
 */
export const METERED_KINDS = ["time", "data-time", "data", "count"] as const;
/** The kind of a metered amount. */
export type MeteredKind = (typeof METERED_KINDS)[number];

/**
 * The scopes of a free amount. With `account`, all the usage of the account in all regions shares one free amount.
 * With `region`, each region has its own free amount. With `resource`, each resource has its own free amount.
 */
export const FREE_SCOPES = ["account", "region", "resource"] as const;
/** The scope of a free amount: the usage that shares it. */
export type FreeScope = (typeof FREE_SCOPES)[number];

/**
 * The location of a metered offer: the provider, and its region and zone, as the provider names them. The country
 * is the country of the region, when the source tells it.
 */
export interface Location {
  readonly provider: string;
  readonly region: string;
  readonly zone?: string | undefined;
  /** The country of the region, as a code of ISO 3166-1 alpha-2 with two capital letters, for example `NL`. */
  readonly country?: string | undefined;
}

/**
 * The term of a metered price. A `spot` price is also a preemptible price: the provider can end the use at any time,
 * after the `notice`. A `committed` price binds the buyer for its `length`.
 */
export type PriceTerm =
  | { readonly kind: "on-demand" }
  | { readonly kind: "spot"; readonly notice?: Quantity | undefined }
  | { readonly kind: "committed"; readonly length: Quantity };

/** A metered offer: one resource of a provider in one location, on one term, with the identifiers that the source gives. */
export interface MeteredOffer {
  readonly id: string;
  readonly source: string;
  readonly sourceId: string;
  readonly productId?: string | undefined;
  readonly title: string;
  readonly url?: string | undefined;
  readonly location: Location;
  readonly term: PriceTerm;
  readonly specs: readonly Spec[];
}

/** A tier of a meter: the price for each unit of the usage from `from` to the start of the next tier, in one period. */
export interface Tier {
  readonly from: Quantity;
  readonly unitPrice: Quantity;
}

/** A free amount of a meter for each period, and the scope that shares it. */
export interface FreeAmount {
  readonly amount: Quantity;
  readonly scope: FreeScope;
}

/** A meter of a metered reading: the tiers of the price of one metered amount, and its free amount. */
export interface Meter {
  readonly name: string;
  readonly tiers: readonly Tier[];
  readonly free?: FreeAmount | undefined;
}

/** A metered reading: the metered prices of one offer at one instant. */
export interface MeteredReading {
  readonly offerId: string;
  readonly at: string;
  readonly period: Quantity;
  readonly meters: readonly Meter[];
  readonly upfront?: Quantity | undefined;
}

/** One metered offer of a source, and its metered reading at one instant. */
export interface MeteredObservation {
  readonly offer: MeteredOffer;
  readonly reading: MeteredReading;
}

/** The usage of each meter in one period, by the name of the meter. */
export type MeteredUsage = Readonly<Record<string, Quantity>>;

/** These options change the cost of a metered offer. */
export interface MeteredCostOptions {
  /**
   * The part of the free amount of each meter that other usage in its scope used in the same period. The keys are
   * the names of the meters. The default is none.
   */
  readonly freeUsed?: MeteredUsage | undefined;
}

/** The cost of the usage of one meter in one period. */
export interface MeterCost {
  readonly name: string;
  readonly cost: Quantity;
}

/** The cost of a metered offer for one period. */
export interface MeteredCost {
  /** The cost of each meter, in the order of the meters of the reading. */
  readonly meters: readonly MeterCost[];
  /** The part of the upfront money of a committed term for one period, or zero. */
  readonly upfront: Quantity;
  /** The sum of the cost of each meter and the part of the upfront money. */
  readonly total: Quantity;
}

/** The parts of the unit of a metered price: its unit of money, and the kind of its metered amount. */
interface PriceParts {
  readonly money: string;
  readonly kind: MeteredKind;
}

/** This function gives the kind of a metered amount from the exponents of its data and its time, or undefined. */
function kindOfExponents(data: number, time: number): MeteredKind | undefined {
  if (data === 0 && time === 0) return "count";
  if (data === 0 && time === 1) return "time";
  if (data === 1 && time === 0) return "data";
  if (data === 1 && time === 1) return "data-time";
  return undefined;
}

/** This function reads the unit of a metered price. It gives the parts of the unit, or the problem as a text. */
function readPriceUnit(unit: string): PriceParts | string {
  const refused = `The unit ${unit} is not a price for each unit of a metered amount, for example USD/h.`;
  let parsed: ReturnType<typeof parseUnit>;
  try {
    parsed = parseUnit(unit);
  } catch (error) {
    if (error instanceof UnitError) return refused;
    throw error;
  }
  const money = atomAbove(parsed, "money");
  const below = parsed.components.some((component) => component.exponent < 0);
  if (money === undefined || !below) return refused;
  const { money: units = 0, data = 0, time = 0, ...others } = parsed.vector;
  const kind = Object.values(others).every((exponent) => exponent === 0) && units === 1 ? kindOfExponents(-data, -time) : undefined;
  return kind === undefined ? refused : { money, kind };
}

/** This function gives the unit of a price for each unit of an amount, for example `USD/(GiB·mo)` for `GiB·mo`. */
function priceUnitFor(money: string, amountUnit: string): string | undefined {
  try {
    return canonicalUnit(`${money}/${amountUnit}`);
  } catch (error) {
    if (error instanceof UnitError) return undefined;
    throw error;
  }
}

/** This function tells if an amount in one unit converts to another unit. A unit that the quantity package does not know does not convert. */
function converts(from: string, to: string): boolean {
  try {
    return convertible(from, to);
  } catch (error) {
    if (error instanceof UnitError) return false;
    throw error;
  }
}

/** This function gives the start of each tier in one unit, or undefined when a start does not convert to it. */
function startsOf(tiers: readonly Tier[], unit: string): Rational[] | undefined {
  try {
    return tiers.map((tier) => convertExact(rationals.fromNumber(tier.from.value), tier.from.unit, unit));
  } catch (error) {
    if (error instanceof UnitError || error instanceof RangeError) return undefined;
    throw error;
  }
}

/** This function tells if a unit of an amount measures the metered amount of a unit of price. */
function measures(amountUnit: string, priceUnit: string, money: string): boolean {
  const unit = priceUnitFor(money, amountUnit);
  return unit !== undefined && converts(unit, priceUnit);
}

/**
 * This function gives the kind of the metered amount of the unit of a metered price, for example `time` for `USD/h`
 * and `data-time` for `USD/(GiB·mo)`.
 *
 * @throws RangeError when the unit is not a price for each unit of a metered amount.
 */
export function meteredKindOf(unit: string): MeteredKind {
  const parts = readPriceUnit(unit);
  if (typeof parts === "string") throw new RangeError(parts);
  return parts.kind;
}

/**
 * This schema accepts the location of a metered offer. The name of the provider has small letters, digits and
 * hyphens, as the name of a source. The region and the zone are the ids of the provider. The country has two
 * capital letters.
 */
export const locationSchema: z.ZodType<Location> = z.strictObject({
  provider: sourceSchema,
  region: textSchema,
  zone: textSchema.optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "The country is a code of ISO 3166-1 alpha-2 with two capital letters.")
    .optional(),
});

/**
 * This schema accepts the term of a metered price. A `spot` term can have the notice before the provider ends the
 * use. A `committed` term has its length.
 */
export const priceTermSchema: z.ZodType<PriceTerm> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("on-demand") }),
  z.strictObject({ kind: z.literal("spot"), notice: quantitySchema("time", { nonnegative: true }).optional() }),
  z.strictObject({ kind: z.literal("committed"), length: quantitySchema("time", { positive: true }) }),
]);

/**
 * This schema accepts a metered offer: one resource of a provider in one location, on one term. The id is the
 * source and the source id, with a colon between them.
 */
export const meteredOfferSchema: z.ZodType<MeteredOffer> = z
  .strictObject({
    id: textSchema,
    source: sourceSchema,
    sourceId: textSchema,
    productId: textSchema.optional(),
    title: textSchema,
    url: z.url({ protocol: /^https$/ }).optional(),
    location: locationSchema,
    term: priceTermSchema,
    specs: z.array(specSchema),
  })
  .refine((offer) => offer.id === offerId(offer.source, offer.sourceId), {
    message: "The id of an offer is its source and its source id, with a colon between them.",
    path: ["id"],
  });

/**
 * This schema accepts a metered price of zero or more: an amount of money for each unit of a metered amount, for
 * example `{ "value": 0.0116, "unit": "USD/h" }`.
 */
export const meteredPriceSchema: z.ZodType<Quantity, Quantity> = quantitySchema(undefined, { nonnegative: true }).superRefine(
  (price, context) => {
    const parts = readPriceUnit(price.unit);
    if (typeof parts === "string") context.addIssue({ code: "custom", message: parts });
  },
);

/** This schema accepts a tier: the start of its usage, and its price for each unit. The start measures the metered amount of the price. */
export const tierSchema: z.ZodType<Tier> = z
  .strictObject({ from: quantitySchema(undefined, { nonnegative: true }), unitPrice: meteredPriceSchema })
  .superRefine((tier, context) => {
    const parts = readPriceUnit(tier.unitPrice.unit);
    if (typeof parts === "string" || measures(tier.from.unit, tier.unitPrice.unit, parts.money)) return;
    context.addIssue({
      code: "custom",
      message: `The start ${tier.from.unit} does not measure the metered amount of the price ${tier.unitPrice.unit}.`,
      path: ["from"],
    });
  });

/** This schema accepts a free amount of more than zero for each period, and its scope. */
export const freeAmountSchema: z.ZodType<FreeAmount> = z.strictObject({
  amount: quantitySchema(undefined, { positive: true }),
  scope: z.enum(FREE_SCOPES),
});

/**
 * This schema accepts a meter. The first tier starts at zero, and the starts increase. The prices of the tiers and
 * the free amount measure one metered amount.
 */
export const meterSchema: z.ZodType<Meter> = z
  .strictObject({ name: textSchema, tiers: z.array(tierSchema).min(1), free: freeAmountSchema.optional() })
  .superRefine((meter, context) => {
    const [first] = meter.tiers;
    if (first === undefined) return;
    const parts = readPriceUnit(first.unitPrice.unit);
    if (typeof parts === "string") return;
    let units = true;
    for (const [index, tier] of meter.tiers.entries()) {
      if (converts(tier.unitPrice.unit, first.unitPrice.unit) && measures(tier.from.unit, first.unitPrice.unit, parts.money)) continue;
      units = false;
      context.addIssue({
        code: "custom",
        message: `The tier ${index} does not measure the metered amount of the price ${first.unitPrice.unit}.`,
        path: ["tiers", index],
      });
    }
    if (meter.free !== undefined && !measures(meter.free.amount.unit, first.unitPrice.unit, parts.money)) {
      context.addIssue({
        code: "custom",
        message: `The free amount ${meter.free.amount.unit} does not measure the metered amount of the price ${first.unitPrice.unit}.`,
        path: ["free", "amount"],
      });
    }
    if (!units) return;
    const starts = startsOf(meter.tiers, first.from.unit);
    if (starts === undefined) return;
    if (rationals.sign(starts[0] ?? rationals.ZERO) !== 0) {
      context.addIssue({ code: "custom", message: "The first tier does not start at zero.", path: ["tiers", 0, "from"] });
    }
    for (let index = 1; index < starts.length; index += 1) {
      if (rationals.cmp(starts[index] ?? rationals.ZERO, starts[index - 1] ?? rationals.ZERO) > 0) continue;
      context.addIssue({
        code: "custom",
        message: `The tier ${index} does not start after the tier ${index - 1}.`,
        path: ["tiers", index, "from"],
      });
    }
  });

/**
 * This schema accepts a metered reading: the metered prices of one offer at one instant. The tiers and the free
 * amounts count the usage of one `period`. Each meter has its own name.
 */
export const meteredReadingSchema: z.ZodType<MeteredReading> = z
  .strictObject({
    offerId: textSchema,
    at: instantSchema,
    period: quantitySchema("time", { positive: true }),
    meters: z.array(meterSchema).min(1),
    upfront: moneySchema.optional(),
  })
  .refine((reading) => new Set(reading.meters.map((meter) => meter.name)).size === reading.meters.length, {
    message: "The reading has two meters with one name.",
    path: ["meters"],
  });

/** This schema accepts a metered observation: an offer, and a reading of that offer. Only a committed term has upfront money. */
export const meteredObservationSchema: z.ZodType<MeteredObservation> = z
  .strictObject({ offer: meteredOfferSchema, reading: meteredReadingSchema })
  .superRefine((each, context) => {
    if (each.reading.offerId !== each.offer.id) {
      context.addIssue({ code: "custom", message: "The reading is not a reading of the offer.", path: ["reading", "offerId"] });
    }
    if (each.reading.upfront !== undefined && each.offer.term.kind !== "committed") {
      context.addIssue({
        code: "custom",
        message: `The term ${each.offer.term.kind} has no upfront money.`,
        path: ["reading", "upfront"],
      });
    }
  });

/** This function gives the value of an amount in a unit, as an exact rational. */
function exactIn(amount: Quantity, unit: string): Rational {
  return convertExact(rationals.fromNumber(amount.value), amount.unit, unit);
}

/** This function gives the larger of two rationals. */
function larger(a: Rational, b: Rational): Rational {
  return rationals.cmp(a, b) >= 0 ? a : b;
}

/** This function gives the smaller of two rationals. */
function smaller(a: Rational, b: Rational): Rational {
  return rationals.cmp(a, b) <= 0 ? a : b;
}

/** This function examines an amount of usage of a meter, and gives its value in its own unit. */
function usageValue(meter: Meter, amount: Quantity, priceUnit: string, money: string, what: string): Rational {
  if (!Number.isFinite(amount.value) || amount.value < 0) {
    throw new RangeError(`The ${what} of the meter ${meter.name} is ${amount.value}, not an amount of zero or more.`);
  }
  if (!measures(amount.unit, priceUnit, money)) {
    throw new RangeError(`The ${what} of the meter ${meter.name} is in ${amount.unit}, which does not measure the price ${priceUnit}.`);
  }
  return rationals.fromNumber(amount.value);
}

/**
 * This function gives the exact cost of the usage of one meter, in the unit of money of its first tier. The free
 * amount comes off the usage first. The tiers then count the rest of the usage from zero.
 */
function costOfMeter(meter: Meter, used: Quantity | undefined, freeUsed: Quantity | undefined): { money: string; cost: Rational } {
  const [first] = meter.tiers;
  if (first === undefined) throw new RangeError(`The meter ${meter.name} has no tier.`);
  const parts = readPriceUnit(first.unitPrice.unit);
  if (typeof parts === "string") throw new RangeError(parts);
  const { money } = parts;
  if (used === undefined) return { money, cost: rationals.ZERO };
  const amount = usageValue(meter, used, first.unitPrice.unit, money, "usage");
  const unit = used.unit;
  const perUnit = priceUnitFor(money, unit);
  if (perUnit === undefined) throw new RangeError(`The usage of the meter ${meter.name} is in ${unit}, which has no price unit.`);
  let free: Rational = rationals.ZERO;
  if (meter.free !== undefined) free = exactIn(meter.free.amount, unit);
  if (freeUsed !== undefined) {
    usageValue(meter, freeUsed, first.unitPrice.unit, money, "used free amount");
    free = larger(rationals.ZERO, rationals.sub(free, exactIn(freeUsed, unit)));
  }
  const billed = larger(rationals.ZERO, rationals.sub(amount, free));
  let cost: Rational = rationals.ZERO;
  for (const [index, tier] of meter.tiers.entries()) {
    const start = exactIn(tier.from, unit);
    const next = meter.tiers[index + 1];
    const end = next === undefined ? billed : smaller(billed, exactIn(next.from, unit));
    if (rationals.cmp(end, start) <= 0) continue;
    cost = rationals.add(cost, rationals.mul(rationals.sub(end, start), exactIn(tier.unitPrice, perUnit)));
  }
  return { money, cost };
}

/**
 * This function gives the cost of a metered offer for one period, from the usage of each meter in that period. A
 * meter with no usage costs zero. The free amount of a meter comes off its usage first, less `freeUsed`. The tiers
 * then count the rest of the usage from zero. A committed term adds its upfront money times the period over the length.
 *
 * The arithmetic is exact, and the function does not round the cost to the cent. Each value is the nearest number to
 * the exact cost. The function converts the units with the exact factors of `@mark1russell7/quantity`.
 *
 * @throws RangeError when the usage names a meter that the reading does not have. It also throws when an amount
 * of usage is negative, or does not measure the metered amount of its meter.
 */
export function meteredCost(observation: MeteredObservation, usage: MeteredUsage, options: MeteredCostOptions = {}): MeteredCost {
  const { offer, reading } = observation;
  const { freeUsed = {} } = options;
  const names = new Set(reading.meters.map((meter) => meter.name));
  for (const name of [...Object.keys(usage), ...Object.keys(freeUsed)]) {
    if (!names.has(name)) throw new RangeError(`The reading of ${reading.offerId} has no meter ${name}.`);
  }
  const at = (record: MeteredUsage, name: string): Quantity | undefined => (Object.hasOwn(record, name) ? record[name] : undefined);
  const costs = reading.meters.map((meter) => ({ name: meter.name, ...costOfMeter(meter, at(usage, meter.name), at(freeUsed, meter.name)) }));
  const unit = costs[0]?.money;
  if (unit === undefined) throw new RangeError(`The reading of ${reading.offerId} has no meter.`);
  let total: Rational = rationals.ZERO;
  for (const each of costs) total = rationals.add(total, convertExact(each.cost, each.money, unit));
  const meters = costs.map((each): MeterCost => ({ name: each.name, cost: quantity(rationals.toNumber(each.cost), each.money) }));
  let upfront: Rational = rationals.ZERO;
  if (offer.term.kind === "committed" && reading.upfront !== undefined) {
    const { length } = offer.term;
    const share = rationals.div(exactIn(reading.period, length.unit), rationals.fromNumber(length.value));
    upfront = rationals.mul(exactIn(reading.upfront, unit), share);
  }
  total = rationals.add(total, upfront);
  return { meters, upfront: quantity(rationals.toNumber(upfront), unit), total: quantity(rationals.toNumber(total), unit) };
}
