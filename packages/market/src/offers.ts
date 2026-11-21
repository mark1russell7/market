import { compare, convert, convertible, kindOf, scale, UnitError, type Quantity } from "@mark1russell7/quantity";
import { foldCode } from "./identifiers.ts";
import { costOf, unitPriceFor } from "./price.ts";
import type { Condition, Offer, PriceReading } from "./records.ts";

/** One offer of a source, and its price reading at one instant. */
export interface Observation {
  readonly offer: Offer;
  readonly reading: PriceReading;
}

/**
 * This record names a part that a buyer wants: the names of its maker, and its part numbers. A seller can write
 * the brand of one maker in more than one form, so the want has a list of names.
 */
export interface PartWant {
  /** The names of the maker, as the sellers write the brand. */
  readonly brands: readonly string[];
  /** The part numbers of the maker. A part number of an offer matches when it starts with one of them, after the fold. */
  readonly partNumbers: readonly string[];
}

/**
 * This function tells if an offer is an offer of the part. One part number of the offer must have a brand of the
 * want and start with a part number of the want. `foldCode` folds each text before the comparison. A part number
 * of another maker does not match: many makers use short numbers like `A1383`.
 */
export function offersPart(offer: Pick<Offer, "partNumbers">, want: PartWant): boolean {
  const brands = new Set(want.brands.map(foldCode).filter((brand) => brand !== ""));
  const parts = want.partNumbers.map(foldCode).filter((part) => part !== "");
  return offer.partNumbers.some(({ brand, partNumber }) => {
    const folded = foldCode(partNumber);
    return brands.has(foldCode(brand)) && parts.some((part) => folded.startsWith(part));
  });
}

/**
 * This function gives the latest observation of each offer, in the order of the offer ids. When two readings of
 * one offer have the same instant, the later one in the list applies.
 */
export function latestObservations(observations: readonly Observation[]): Observation[] {
  const latest = new Map<string, Observation>();
  for (const each of observations) {
    const seen = latest.get(each.offer.id);
    if (seen === undefined || Date.parse(seen.reading.at) <= Date.parse(each.reading.at)) latest.set(each.offer.id, each);
  }
  return [...latest.values()].sort((a, b) => order(a.offer.id, b.offer.id));
}

/** This function gives the latest observation of each offer of the part, in the order of the offer ids. */
export function offersOfPart(observations: readonly Observation[], want: PartWant): Observation[] {
  return latestObservations(observations.filter((each) => offersPart(each.offer, want)));
}

/** This record is one offer that a buyer can choose, with the price of an order in the currency of the buyer. */
export interface OfferChoice {
  readonly observation: Observation;
  /** The unit price for the count, times the count. */
  readonly goods: Quantity;
  /** The goods and the shipping, or null when the shipping cost is not known. */
  readonly cost: Quantity | null;
  /** True when the availability is `in-stock` or `low-stock`. */
  readonly inStock: boolean;
}

/** These options change the choice of an offer. */
export interface BestOfferOptions {
  /** The currency of the prices, a unit of money of `@mark1russell7/quantity`, for example `USD`. An offer with a price in another currency is skipped. */
  readonly currency: string;
  /** The count of units of the order. The default is 1. */
  readonly count?: number;
  /** The conditions that the buyer accepts. The default is `new` only. */
  readonly conditions?: readonly Condition[];
}

/** This record is the choice of an offer: the best offer, each offer in the order of the price, and each skipped offer. */
export interface BestOffer {
  /** The offer with the lowest price that is in stock, or else the offer with the lowest price, or null with no offer. */
  readonly best: OfferChoice | null;
  /** The offers, from the lowest price of the goods. Equal prices go in the order of the cost, then of the offer id. */
  readonly offers: readonly OfferChoice[];
  /** The offers that the choice skipped, each with the reason. */
  readonly skipped: readonly { readonly offerId: string; readonly why: string }[];
}

/**
 * This function chooses the offer to buy from the latest observation of each offer. It skips an offer with a
 * condition that the buyer does not accept, a price in another currency, or a minimum above the count.
 *
 * @throws RangeError when the count is not a whole number of 1 or more, or when the currency is not a unit of money.
 */
export function bestOffer(observations: readonly Observation[], options: BestOfferOptions): BestOffer {
  const { currency, count = 1, conditions = ["new"] } = options;
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`The count ${count} is not a whole number of 1 or more.`);
  if (!isMoney(currency)) throw new RangeError(`The currency ${currency} is not a unit of money of @mark1russell7/quantity.`);
  const accepted = new Set<Condition>(conditions);
  const offers: OfferChoice[] = [];
  const skipped: { offerId: string; why: string }[] = [];
  for (const observation of latestObservations(observations)) {
    const { offer, reading } = observation;
    const minimum = reading.minimumQuantity ?? 1;
    if (!accepted.has(offer.condition)) skipped.push({ offerId: offer.id, why: `The condition ${offer.condition} is not a condition that the buyer accepts.` });
    else if (!converts(reading.price.unit, currency)) skipped.push({ offerId: offer.id, why: `The price is in ${reading.price.unit}, not in ${currency}.` });
    else if (count < minimum) skipped.push({ offerId: offer.id, why: `The minimum order is ${minimum} units, more than the count ${count}.` });
    else {
      const goods = convert(scale(unitPriceFor(reading, count), count), currency);
      // A shipping cost in another currency is not known in the currency of the buyer.
      const shipping = reading.shipping.kind !== "fixed" || converts(reading.shipping.cost.unit, currency);
      const total = shipping ? costOf(reading, count) : null;
      const cost = total === null ? null : convert(total, currency);
      const inStock = reading.availability === "in-stock" || reading.availability === "low-stock";
      offers.push({ observation, goods, cost, inStock });
    }
  }
  offers.sort((a, b) => compare(a.goods, b.goods) || byCost(a.cost, b.cost) || order(a.observation.offer.id, b.observation.offer.id));
  const best = offers.find((choice) => choice.inStock) ?? offers[0] ?? null;
  return { best, offers, skipped };
}

/** This function tells if a unit is a unit of money that the quantity package knows. */
function isMoney(unit: string): boolean {
  try {
    return kindOf(unit) === "money";
  } catch (error) {
    if (error instanceof UnitError) return false;
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

/** This function orders two costs. A known cost comes before a cost that is not known. */
function byCost(a: Quantity | null, b: Quantity | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compare(a, b);
}

/** This function orders two texts by their code units, so the order does not depend on the locale. */
function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The offer to buy for one count of a part, or the reason that no offer is usable. */
export type Priced = { readonly ok: true; readonly offerId: string; readonly cost: Quantity } | { readonly ok: false; readonly why: string };

/**
 * This function chooses the offer to buy for a count of a part: the in-stock offer with the lowest cost, with the
 * shipping. An offer with a cost that is not known is not usable. Equal costs keep the order of `bestOffer`.
 */
export function priceOf(observations: readonly Observation[], count: number, need: { readonly currency: string; readonly conditions?: readonly Condition[] | undefined }): Priced {
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
