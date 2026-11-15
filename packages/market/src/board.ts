import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";
import { latestObservations, type Observation } from "./offers.ts";
import { instantSchema, offerSchema, priceReadingSchema, sourceSchema, textSchema } from "./records.ts";
import { isKept, keepUntil, type SourceTerms } from "./terms.ts";

/*
 * This module calculates a board of current prices. A board has the latest observation of each offer that the
 * terms of its source permit a store to keep. A watch reads its sources on a schedule, so the board has a current
 * price of each offer. Each function of this module is a calculation with no effect. A host does the reads and
 * writes the board.
 */

/** The format name of a board record. */
export const BOARD_FORMAT = "price-board/1";

/** This schema accepts an observation: an offer, and a reading of that offer. */
export const observationSchema: z.ZodType<Observation> = z
  .strictObject({ offer: offerSchema, reading: priceReadingSchema })
  .refine((each) => each.reading.offerId === each.offer.id, { message: "The reading is not a reading of the offer." });

/** This record is a board: the instant of its last change, and the latest kept observation of each offer. */
export interface Board {
  readonly format: typeof BOARD_FORMAT;
  readonly at: string;
  readonly observations: readonly Observation[];
}

/** This schema accepts a board. Each offer has one observation at most. */
export const boardSchema: z.ZodType<Board> = z
  .strictObject({ format: z.literal(BOARD_FORMAT), at: instantSchema, observations: z.array(observationSchema) })
  .refine((board) => new Set(board.observations.map((each) => each.offer.id)).size === board.observations.length, {
    message: "The board has two observations of one offer.",
  });

/** This record is an offer that the store does not keep, with the reason. */
export interface Dropped {
  readonly offerId: string;
  readonly why: string;
}

/** These options give the rules of a store: the terms of each source, the instant, and the offers that ended. */
export interface KeepOptions {
  /** The terms of the sources. A store keeps no reading of a source without terms. */
  readonly terms: readonly SourceTerms[];
  /** The instant of the decision. */
  readonly now: string;
  /** The ids of the offers that ended, as their sources tell. An offer with `endsAt` at or before `now` also ended. */
  readonly ended?: readonly string[] | undefined;
}

/** This record is the decision of a store: the observations that it keeps, and each offer that it drops. */
export interface Kept {
  /** The latest observation of each kept offer, in the order of the offer ids. */
  readonly kept: readonly Observation[];
  /** Each dropped offer, in the order of the offer ids. */
  readonly dropped: readonly Dropped[];
}

/** This function gives the terms of each source by its name. Two terms of one source are a problem of the input. */
function termsBySource(terms: readonly SourceTerms[]): ReadonlyMap<string, SourceTerms> {
  const map = new Map<string, SourceTerms>();
  for (const each of terms) {
    if (map.has(each.source)) throw new RangeError(`The terms of the source ${each.source} are in the list two times.`);
    map.set(each.source, each);
  }
  return map;
}

/** This function gives the text of an amount of time, for example `6 h`. */
const timeText = (age: Quantity): string => `${age.value} ${age.unit}`;

/**
 * This function decides which observations a store keeps. It takes the latest observation of each offer. It keeps
 * an observation while the terms of its source permit it, and while its offer has not ended. A current price is
 * a price that a buyer can pay, so the store drops an ended offer for each source.
 *
 * Give the board and the new observations together. To read the board at an instant, give the board alone. A
 * reading can pass its limit after the last change of the board.
 *
 * @throws RangeError when `now` is not an instant, or when the terms have two entries for one source.
 */
export function keepObservations(observations: readonly Observation[], options: KeepOptions): Kept {
  const terms = termsBySource(options.terms);
  const now = Date.parse(options.now);
  if (Number.isNaN(now)) throw new RangeError(`The instant ${JSON.stringify(options.now)} is not an instant.`);
  const ended = new Set(options.ended ?? []);
  const kept: Observation[] = [];
  const dropped: Dropped[] = [];
  for (const observation of latestObservations(observations)) {
    const { offer, reading } = observation;
    const rules = terms.get(offer.source);
    const endsAt = offer.endsAt === undefined ? Number.NaN : Date.parse(offer.endsAt);
    const over = ended.has(offer.id) || endsAt <= now;
    if (rules === undefined) dropped.push({ offerId: offer.id, why: `The terms of the source ${offer.source} are not known, so a store keeps no reading of it.` });
    else if (rules.retention.kind === "no-store") dropped.push({ offerId: offer.id, why: `The terms of ${offer.source} permit no store: a reading serves one request.` });
    else if (over) {
      const rule = rules.deleteWhenEnded ? `, and the terms of ${offer.source} delete its readings` : "";
      dropped.push({ offerId: offer.id, why: `The offer ended${rule}.` });
    } else if (!isKept(rules, reading, options.now)) {
      const age = rules.retention.kind === "max-age" ? timeText(rules.retention.age) : "";
      dropped.push({ offerId: offer.id, why: `The reading of ${reading.at} passed the limit of ${age} of the terms of ${offer.source} at ${keepUntil(rules, reading)}.` });
    } else kept.push(observation);
  }
  return { kept, dropped };
}

/** This record is one entry of a watch: a read of one source that repeats. */
export interface WatchEntry {
  /** The name of the entry. Each entry of a watch has its own name. */
  readonly name: string;
  /** The source of the read. */
  readonly source: string;
  /** The time from one read of the entry to the next, a time of `@mark1russell7/quantity`. */
  readonly every: Quantity;
}

/** This schema accepts an entry of a watch. */
export const watchEntrySchema: z.ZodType<WatchEntry> = z.strictObject({
  name: textSchema,
  source: sourceSchema,
  every: quantitySchema("time", { positive: true }),
});

/** These options give the rules of a schedule: the terms of each source, and the slack of the loop. */
export interface ScheduleOptions {
  /** The terms of the sources. */
  readonly terms: readonly SourceTerms[];
  /**
   * The longest time from the instant of a due read to the instant that its reading is on the board. It is the
   * time between two passes of the loop, plus the longest pass.
   */
  readonly slack: Quantity;
}

/** This record is the interval of an entry, in milliseconds, or the reason that the entry has no interval. */
export type ReadInterval = { readonly ok: true; readonly ms: number } | { readonly ok: false; readonly why: string };

/**
 * This function gives the time from one read of an entry to the next, in milliseconds. A reading of a source with
 * the limit `L` stays on the board until `L` after the read. The next reading arrives `slack` after the next read
 * is due, at most. Thus the interval is the shorter of `every` and `L - slack`. Then the board has a current
 * reading of the entry at each instant after its first read.
 */
export function readInterval(entry: WatchEntry, options: ScheduleOptions): ReadInterval {
  const terms = termsBySource(options.terms).get(entry.source);
  const every = valueIn(entry.every, "ms");
  if (!(every > 0)) return { ok: false, why: `The time every of the entry ${entry.name} is not more than 0.` };
  if (terms === undefined) return { ok: false, why: `The terms of the source ${entry.source} of the entry ${entry.name} are not known.` };
  const { retention } = terms;
  if (retention.kind === "no-store") return { ok: false, why: `The terms of ${entry.source} permit no store, so a watch cannot keep the prices of the entry ${entry.name}. Read the source for each request.` };
  if (retention.kind === "keep") return { ok: true, ms: every };
  const room = valueIn(retention.age, "ms") - valueIn(options.slack, "ms");
  if (!(room > 0)) return { ok: false, why: `The slack ${timeText(options.slack)} is not less than the limit ${timeText(retention.age)} of the terms of ${entry.source}, so the board has gaps in the prices of the entry ${entry.name}.` };
  return { ok: true, ms: Math.min(every, room) };
}

/** This function gives the problems of a watch: an entry with no interval, and two entries with one name. */
export function watchProblems(entries: readonly WatchEntry[], options: ScheduleOptions): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) problems.push(`Two entries have the name ${entry.name}.`);
    names.add(entry.name);
    const interval = readInterval(entry, options);
    if (!interval.ok) problems.push(interval.why);
  }
  return problems;
}

/** This record is the plan of one pass of a watch: the due entries, and the instant of the next due read. */
export interface ReadPlan {
  /** The names of the due entries, in the order of the entries. An entry with no read is due. */
  readonly due: readonly string[];
  /** The first instant after `now` that an entry is due, or null when no entry has an interval. */
  readonly next: string | null;
}

/**
 * This function plans one pass of a watch. An entry is due when it has no last read, or when its interval has
 * passed since its last read. An entry with no interval is not due at any time. `watchProblems` gives its reason.
 *
 * @param last - The instant of the last read of each entry, by name
 * @throws RangeError when `now` or a last read is not an instant.
 */
export function planReads(entries: readonly WatchEntry[], last: Readonly<Record<string, string>>, now: string, options: ScheduleOptions): ReadPlan {
  const at = Date.parse(now);
  if (Number.isNaN(at)) throw new RangeError(`The instant ${JSON.stringify(now)} is not an instant.`);
  const due: string[] = [];
  let next = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const interval = readInterval(entry, options);
    if (!interval.ok) continue;
    const before = Object.hasOwn(last, entry.name) ? last[entry.name] : undefined;
    const read = before === undefined ? Number.NaN : Date.parse(before);
    if (before !== undefined && Number.isNaN(read)) throw new RangeError(`The last read ${JSON.stringify(before)} of the entry ${entry.name} is not an instant.`);
    const isDue = Number.isNaN(read) || read + interval.ms <= at;
    if (isDue) due.push(entry.name);
    // A planned read happens at `now`, so the next read of a due entry is one interval after `now`.
    next = Math.min(next, (isDue ? at : read) + interval.ms);
  }
  return { due, next: Number.isFinite(next) ? new Date(next).toISOString() : null };
}
