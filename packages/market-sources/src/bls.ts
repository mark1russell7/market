import { averagePriceId, averagePriceSchema, type AveragePrice, type SourceTerms } from "@mark1russell7/market";
import { checkAt, compact, decimal, field, list, refused, show, text, type Refused } from "./parse.ts";

/*
 * This module reads the average prices of the U.S. Bureau of Labor Statistics (BLS). The CPI program publishes the
 * average price of some foods, fuels and other items each month: the series of the survey AP. The parser reads an
 * answer of version 1 of the BLS Public Data API, which needs no key. The answer gives no title of a series, so the
 * parser takes the item, the area and the unit of each series from a list of known series.
 */

/** The name of the source. */
export const BLS_SOURCE = "bls-ap";

/** The statement that the terms of the API make necessary for each user of the data. The layer that shows the prices shows it. */
export const BLS_STATEMENT =
  "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.";

/** The terms of the BLS Public Data API. They set no limit on the time or the use of the data. */
export const BLS_TERMS: SourceTerms = {
  source: BLS_SOURCE,
  retention: { kind: "keep" },
  deleteWhenEnded: false,
  priceModel: true,
  clause:
    "BLS Public Data API Terms of Service, last modified 2023-08-30, read on 2026-11-22: no control over the end use, cite the date of the retrieval, give BLS_STATEMENT, and do not change the content",
};

/** The address of version 1 of the BLS Public Data API, for one or more series. */
export const BLS_API_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/";

/** The most series of one query of version 1. */
export const BLS_SERIES_LIMIT = 25;

/** The most years of one query of version 1. */
export const BLS_YEAR_LIMIT = 10;

/** A known series of average prices: its id, its item and its area as BLS names them, and the unit of the item. */
export interface BlsSeries {
  readonly series: string;
  readonly item: string;
  readonly area: string;
  /** The unit of the amount of the item, a unit of `@mark1russell7/quantity`, for example `lb`. */
  readonly unit: string;
}

const US = "U.S. city average";

/**
 * The average prices of some dry staples, in the U.S. city average. The titles are from the BLS data viewer of each
 * series, read on 2026-11-22. The series of the Northeast for these items exist, but they have no value since 2023.
 */
export const BLS_STAPLES: readonly BlsSeries[] = [
  { series: "APU0000701312", item: "Rice, white, long grain, uncooked, per lb. (453.6 gm)", area: US, unit: "lb" },
  { series: "APU0000701111", item: "Flour, white, all purpose, per lb. (453.6 gm)", area: US, unit: "lb" },
  { series: "APU0000714233", item: "Beans, dried, any type, all sizes, per lb. (453.6 gm)", area: US, unit: "lb" },
  { series: "APU0000715211", item: "Sugar, white, all sizes, per lb. (453.6 gm)", area: US, unit: "lb" },
  { series: "APU0000701322", item: "Spaghetti and macaroni, per lb. (453.6 gm)", area: US, unit: "lb" },
];

/**
 * The result of the parser of average prices. With `ok`, each price is valid under `averagePriceSchema`, and each
 * note tells why the parser skipped a value. Without `ok`, the answer does not have the documented shape.
 */
export type AverageParseResult =
  | { readonly ok: true; readonly prices: readonly AveragePrice[]; readonly notes: readonly string[] }
  | (Refused & { readonly threshold?: true | undefined });

/** A message of BLS that tells that the daily threshold of the user is reached. */
const THRESHOLD = /threshold/i;

const SERIES_ID = /^[A-Z0-9]{1,30}$/;

/**
 * This function gives the request of version 1 of the API for some series, from a first year to a last year. The
 * API gives the last three years when the request has no years.
 *
 * @throws RangeError when the count of series is not from 1 to `BLS_SERIES_LIMIT`, or when an id is not an id of BLS.
 * It also throws when the years are not whole numbers in order, or when they are more than `BLS_YEAR_LIMIT` years.
 */
export function blsRequest(
  series: readonly string[],
  years?: { readonly start: number; readonly end: number },
): { readonly method: "POST"; readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string } {
  if (series.length < 1 || series.length > BLS_SERIES_LIMIT) throw new RangeError(`The count of series is not from 1 to ${BLS_SERIES_LIMIT}.`);
  for (const id of series) if (typeof id !== "string" || !SERIES_ID.test(id)) throw new RangeError(`The series ${show(id)} is not an id of BLS.`);
  if (new Set(series).size !== series.length) throw new RangeError("A series is two times in the request.");
  let body: { readonly seriesid: readonly string[]; readonly startyear?: string; readonly endyear?: string } = { seriesid: series };
  if (years !== undefined) {
    const { start, end } = years;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end - start + 1 > BLS_YEAR_LIMIT) {
      throw new RangeError(`The years are not whole numbers in order, with ${BLS_YEAR_LIMIT} years at most.`);
    }
    body = { seriesid: series, startyear: String(start), endyear: String(end) };
  }
  return { method: "POST", url: BLS_API_URL, headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) };
}

const MONTH = /^M(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/** This function gives the texts of the footnotes of a value. A footnote with no text is not a footnote. */
function footnotesOf(value: unknown): string[] {
  return (list(value) ?? []).map((note) => text(field(note, "text"))).filter((note): note is string => note !== undefined);
}

/**
 * This function reads an answer of version 1 of the BLS Public Data API for series of average prices.
 *
 * - Each value of a month of a known series becomes an average price, in US dollars for each unit of its item.
 * - A series that is not in `known` gives a note, and no price.
 * - A value that is not a decimal, for example `-` for no data, gives a note. So does a period that is not a month.
 * - Each message of the answer gives a note, for example "No Data Available" for a year.
 * - An answer that did not succeed gives problems. When a message names the daily threshold, the result also has
 *   `threshold: true`. Then a loop waits for the next day. The documentation does not give the shape of this answer.
 *
 * @param json - The JSON of the answer
 * @param at - The instant of the answer
 * @param known - The known series. The default is `BLS_STAPLES`.
 * @throws RangeError when `at` is not an ISO 8601 instant in UTC
 */
export function parseBlsSeries(json: unknown, at: string, known: readonly BlsSeries[] = BLS_STAPLES): AverageParseResult {
  checkAt(at);
  const status = field(json, "status");
  const messages = (list(field(json, "message")) ?? []).map((message) => text(message)).filter((message): message is string => message !== undefined);
  if (status !== "REQUEST_SUCCEEDED") {
    const problems = refused(`The status of the answer is ${show(status)}, not "REQUEST_SUCCEEDED".`, ...messages.map((message) => `BLS: ${message}`));
    return messages.some((message) => THRESHOLD.test(message)) ? { ...problems, threshold: true } : problems;
  }
  const series = list(field(field(json, "Results"), "series"));
  if (series === undefined) return refused("The answer has no list Results.series.");
  const byId = new Map(known.map((each) => [each.series, each]));
  const notes: string[] = messages.map((message) => `BLS: ${message}`);
  const prices: AveragePrice[] = [];
  const seen = new Set<string>();
  for (const entry of series) {
    const id = text(field(entry, "seriesID"));
    const meta = id === undefined ? undefined : byId.get(id);
    if (meta === undefined) {
      notes.push(`The series ${show(id)} is skipped: it is not a known series.`);
      continue;
    }
    for (const point of list(field(entry, "data")) ?? []) {
      const year = text(field(point, "year"));
      const period = text(field(point, "period"));
      if (year === undefined || period === undefined || !YEAR.test(year) || !MONTH.test(period)) {
        notes.push(`A value of the series ${meta.series} is skipped: the period ${show(year)} ${show(period)} is not a month.`);
        continue;
      }
      const month = `${year}-${period.slice(1)}`;
      const value = decimal(field(point, "value"));
      if (value === undefined) {
        notes.push(`The value of the series ${meta.series} for ${month} is skipped: ${show(field(point, "value"))} is not a decimal.`);
        continue;
      }
      const footnotes = footnotesOf(field(point, "footnotes"));
      const record = compact({
        id: averagePriceId(BLS_SOURCE, meta.series, month),
        source: BLS_SOURCE,
        series: meta.series,
        item: meta.item,
        area: meta.area,
        period: month,
        price: { value, unit: `USD/${meta.unit}` },
        at,
        footnotes: footnotes.length === 0 ? undefined : footnotes,
      });
      const checked = averagePriceSchema.safeParse(record);
      if (!checked.success) {
        notes.push(`The value of the series ${meta.series} for ${month} is skipped: the schema refuses it.`);
        continue;
      }
      if (seen.has(checked.data.id)) continue;
      seen.add(checked.data.id);
      prices.push(checked.data);
    }
  }
  return { ok: true, prices, notes };
}
