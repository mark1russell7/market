import {
  instantSchema,
  moneySchema,
  offerSchema,
  priceReadingSchema,
  type Offer,
  type PriceReading,
} from "@mark1russell7/market";
import type { Quantity } from "@mark1russell7/quantity";
import { z } from "zod";

/** One offer of a source, and its price reading at the instant of the answer. */
export interface Observation {
  readonly offer: Offer;
  readonly reading: PriceReading;
}

/**
 * The result of a parser. With `ok`, the answer has the documented shape. Each observation is valid under the
 * schemas of `@mark1russell7/market`, and each note tells why the parser skipped a record or a field. Without
 * `ok`, the answer does not have the documented shape, and `problems` tells why.
 */
export type ParseResult =
  | { readonly ok: true; readonly observations: readonly Observation[]; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** A value that a reader found, or the reason that it found none. */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

/** This function tells if a JSON value is an object that is not a list. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** This function gives the value at `key` of a JSON object, or undefined when the value is not an object. */
export function field(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** This function gives the value at a path of keys in a JSON value, or undefined when a step is missing. */
export function path(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) current = field(current, key);
  return current;
}

/** This function gives a list, or undefined for each other value. A source writes an absent list as null or as no key. */
export function list(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** This function gives a text without spaces at its ends, or undefined for an empty text, null and each other value. */
export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** This function gives a whole number of zero or more, or undefined for each other value. */
export function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * This function gives the number of a decimal of zero or more. The decimal is a finite JSON number, or a text with
 * digits, and a point and digits as an option. It refuses an exponent, a sign, a space and a hexadecimal text.
 */
export function decimal(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string" || !DECIMAL.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** This function gives a short JSON text of a value for a note. */
export function show(value: unknown): string {
  let shown: string | undefined;
  try {
    shown = JSON.stringify(value);
  } catch {
    shown = undefined;
  }
  if (shown === undefined) return String(typeof value);
  return shown.length > 40 ? `${shown.slice(0, 37)}...` : shown;
}

/** This function gives an amount of money from an amount and a currency code, or the reason that it is not one. */
export function readMoney(amount: unknown, currency: unknown): Read<Quantity> {
  const notDecimal: Read<Quantity> = { ok: false, why: `the amount ${show(amount)} is not a decimal of zero or more` };
  const value = decimal(amount);
  if (value === undefined) return notDecimal;
  const unit = text(currency);
  if (unit === undefined) return { ok: false, why: `the amount ${show(amount)} has no currency` };
  if (!isCurrency(unit)) return { ok: false, why: `the currency ${show(unit)} is not a money unit of @mark1russell7/quantity` };
  const parsed = moneySchema.safeParse({ value, unit });
  return parsed.success ? { ok: true, value: parsed.data } : notDecimal;
}

/** This function tells if a currency code is a money unit of `@mark1russell7/quantity`. */
export function isCurrency(unit: string): boolean {
  return moneySchema.safeParse({ value: 0, unit }).success;
}

const httpsSchema = z.url({ protocol: /^https$/ });

/** This function gives an `https` URL, or undefined for each other value. */
export function httpsUrl(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate !== undefined && httpsSchema.safeParse(candidate).success ? candidate : undefined;
}

/** This function gives an instant in UTC in the ISO 8601 form, or undefined for each other value. */
export function instant(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate !== undefined && instantSchema.safeParse(candidate).success ? candidate : undefined;
}

/**
 * This function examines the instant of an answer.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function checkAt(at: string): void {
  if (!instantSchema.safeParse(at).success) {
    throw new RangeError(`The instant ${show(at)} of the answer is not an ISO 8601 instant in UTC.`);
  }
}

/** This function gives a copy of an object without its keys that have the value undefined. */
export function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join(", ");
}

/**
 * This function examines an offer and its reading with the schemas of `@mark1russell7/market`. It gives the
 * observation, or it adds a note and gives undefined.
 */
export function observe(offer: Offer, reading: PriceReading, notes: string[]): Observation | undefined {
  const checkedOffer = offerSchema.safeParse(compact(offer));
  if (!checkedOffer.success) {
    notes.push(`The offer ${offer.id} is skipped: the schema refuses it (${issues(checkedOffer.error)}).`);
    return undefined;
  }
  const checkedReading = priceReadingSchema.safeParse(compact(reading));
  if (!checkedReading.success) {
    notes.push(`The offer ${offer.id} is skipped: the schema refuses its reading (${issues(checkedReading.error)}).`);
    return undefined;
  }
  return { offer: checkedOffer.data, reading: checkedReading.data };
}

/** This function gives a result with the observations. An offer that the answer repeats counts once. */
export function done(observations: readonly Observation[], notes: readonly string[]): ParseResult {
  const seen = new Set<string>();
  const unique = observations.filter((each) => {
    if (seen.has(each.offer.id)) return false;
    seen.add(each.offer.id);
    return true;
  });
  return { ok: true, observations: unique, notes };
}

/** This function gives a result for an answer that does not have the documented shape. */
export function refused(...problems: readonly string[]): ParseResult {
  return { ok: false, problems };
}
