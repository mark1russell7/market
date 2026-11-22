import { parseUnit, UnitError, type Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";
import { instantSchema, sourceSchema, textSchema } from "./records.ts";

/*
 * This module has the average prices of a market. An average price is not an offer of a seller. It is the mean price
 * of one item in one area and one month, from an official statistic, for example the average prices of the Consumer
 * Price Index. A buyer uses it as the price of a product that has no offer, and as a check of the price of an offer.
 */

/** The average price of one item in one area and one month, from one series of a source. */
export interface AveragePrice {
  /** The id `source:series:period`. `averagePriceId` gives it. */
  readonly id: string;
  readonly source: string;
  /** The id of the series in the source, for example `APU0000701312`. */
  readonly series: string;
  /** The item of the series, as the source names it. */
  readonly item: string;
  /** The area of the series, as the source names it, for example `U.S. city average`. */
  readonly area: string;
  /** The month of the price, in the form `YYYY-MM`. */
  readonly period: string;
  /** The price for each unit of the item, for example `{ "value": 1.101, "unit": "USD/lb" }`. */
  readonly price: Quantity;
  /** The instant of the read of the source. */
  readonly at: string;
  /** The footnotes of the source for this price, for example a preliminary value. */
  readonly footnotes?: readonly string[] | undefined;
}

/** This function gives the id of an average price: the source, the series and the month, with colons. */
export function averagePriceId(source: string, series: string, period: string): string {
  return `${source}:${series}:${period}`;
}

/**
 * This function reads the unit of a price for each unit of an amount of an item. The unit has one unit of money
 * above. Below, it has a unit of an amount that is not money and not a pure time, for example `USD/lb`, `USD/L` or `USD/kWh`.
 * A count below must have an annotation, for example `USD/{each}`. Thus `USD/%` and `USD/h` are not prices of an item.
 */
function unitPriceProblem(unit: string): string | undefined {
  const refused = `The unit ${unit} is not a price for each unit of an amount, for example USD/lb.`;
  let parsed: ReturnType<typeof parseUnit>;
  try {
    parsed = parseUnit(unit);
  } catch (error) {
    if (error instanceof UnitError) return refused;
    throw error;
  }
  const above = parsed.components.filter((component) => component.exponent > 0);
  const [money] = above;
  const vector = money?.atom?.vector;
  const isMoney = vector !== undefined && Object.keys(vector).length === 1 && vector.money === 1;
  if (above.length !== 1 || money?.exponent !== 1 || money.annotation !== undefined || !isMoney) return refused;
  const below = parsed.components.filter((component) => component.exponent < 0);
  const amountOf = (component: (typeof below)[number]): boolean => {
    const dimensions = component.atom?.vector;
    if (dimensions === undefined) return component.annotation !== undefined;
    const names = Object.keys(dimensions);
    const pureTime = names.length === 1 && names[0] === "time";
    return names.length > 0 && !names.includes("money") && !pureTime;
  };
  if (below.length === 0 || !below.every(amountOf)) return refused;
  return undefined;
}

/** This schema accepts a price of more than 0 for each unit of an amount, for example `{ "value": 1.101, "unit": "USD/lb" }`. */
export const unitPriceSchema: z.ZodType<Quantity, Quantity> = quantitySchema(undefined, { positive: true }).superRefine((price, context) => {
  const problem = unitPriceProblem(price.unit);
  if (problem !== undefined) context.addIssue({ code: "custom", message: problem });
});

/** This schema accepts a month in the form `YYYY-MM`, from `0001-01` to `9999-12`. */
export const monthSchema: z.ZodType<string> = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, "The month is not in the form YYYY-MM.");

/** This schema accepts an average price. Its id must be the id of its source, its series and its month. */
export const averagePriceSchema: z.ZodType<AveragePrice> = z
  .strictObject({
    id: textSchema,
    source: sourceSchema,
    series: textSchema,
    item: textSchema,
    area: textSchema,
    period: monthSchema,
    price: unitPriceSchema,
    at: instantSchema,
    footnotes: z.array(textSchema).optional(),
  })
  .refine((record) => record.id === averagePriceId(record.source, record.series, record.period), {
    message: "The id is not the id of the source, the series and the month.",
    path: ["id"],
  });

/**
 * This function gives the last average price of each series, by its month. A later read of the same month replaces
 * an earlier one, because a source can revise a value.
 *
 * @param prices - The average prices, from one or more reads
 * @returns One price for each series, in the order of the series ids
 */
export function latestAverages(prices: readonly AveragePrice[]): readonly AveragePrice[] {
  const last = new Map<string, AveragePrice>();
  for (const price of prices) {
    const key = `${price.source}:${price.series}`;
    const held = last.get(key);
    if (held === undefined || price.period > held.period || (price.period === held.period && price.at > held.at)) last.set(key, price);
  }
  return [...last.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, price]) => price);
}
