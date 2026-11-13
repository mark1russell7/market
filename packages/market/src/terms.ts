import { valueIn } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";
import { sourceSchema, textSchema } from "./records.ts";

/**
 * This schema accepts the storage rule of a source, from its terms. With `keep`, the terms set no limit on the
 * time. With `max-age`, a store keeps a reading for `age` at most. With `no-store`, a reading serves one request.
 */
export const retentionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("keep") }),
  z.strictObject({ kind: z.literal("max-age"), age: quantitySchema("time", { positive: true }) }),
  z.strictObject({ kind: z.literal("no-store") }),
]);

/**
 * This schema accepts the rules of the terms of one source. `deleteWhenEnded` deletes the readings of an offer
 * when the offer ends. `priceModel` permits a trend or a forecast of prices. `clause` names the text of the terms.
 */
export const sourceTermsSchema = z.strictObject({
  source: sourceSchema,
  retention: retentionSchema,
  deleteWhenEnded: z.boolean(),
  priceModel: z.boolean(),
  clause: textSchema,
});

/** The storage rule of a source. */
export type Retention = z.infer<typeof retentionSchema>;
/** The rules of the terms of one source. */
export type SourceTerms = z.infer<typeof sourceTermsSchema>;

/**
 * This function gives the last instant at which a store keeps a reading, or null when the terms set no
 * limit. For a source with `no-store`, the instant is the instant of the reading.
 */
export function keepUntil(terms: SourceTerms, reading: { readonly at: string }): string | null {
  const { retention } = terms;
  if (retention.kind === "keep") return null;
  const at = Date.parse(reading.at);
  if (Number.isNaN(at)) throw new RangeError(`The instant ${JSON.stringify(reading.at)} is not an instant.`);
  if (retention.kind === "no-store") return new Date(at).toISOString();
  return new Date(at + Math.floor(valueIn(retention.age, "ms"))).toISOString();
}

/**
 * This function tells if a store keeps a reading at the instant `now`. A store keeps no reading of a source with
 * `no-store`, and no reading of an ended offer when the terms delete them.
 */
export function isKept(terms: SourceTerms, reading: { readonly at: string }, now: string, ended = false): boolean {
  if (ended && terms.deleteWhenEnded) return false;
  if (terms.retention.kind === "no-store") return false;
  const until = keepUntil(terms, reading);
  if (until === null) return true;
  const instant = Date.parse(now);
  if (Number.isNaN(instant)) throw new RangeError(`The instant ${JSON.stringify(now)} is not an instant.`);
  return instant <= Date.parse(until);
}

/** This function tells if the terms permit a stored history of the readings of a source. */
export function permitsHistory(terms: SourceTerms): boolean {
  return terms.retention.kind === "keep" && !terms.deleteWhenEnded;
}

/** This function tells if the terms permit a trend of the prices of a source: a history and a model of prices. */
export function permitsTrend(terms: SourceTerms): boolean {
  return permitsHistory(terms) && terms.priceModel;
}
