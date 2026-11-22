import { describe, expect, it } from "vitest";
import { averagePriceId, averagePriceSchema, latestAverages, monthSchema, unitPriceSchema, type AveragePrice } from "./average.ts";

const rice: AveragePrice = {
  id: averagePriceId("bls-ap", "APU0000701312", "2026-10"),
  source: "bls-ap",
  series: "APU0000701312",
  item: "Rice, white, long grain, uncooked, per lb. (453.6 gm)",
  area: "U.S. city average",
  period: "2026-10",
  price: { value: 1.101, unit: "USD/lb" },
  at: "2026-11-22T16:00:00Z",
};

describe("the average prices", () => {
  it("accepts an average price, and refuses an id that is not the id of its source, series and month", () => {
    expect(averagePriceSchema.safeParse(rice).success).toBe(true);
    expect(averagePriceSchema.safeParse({ ...rice, id: "bls-ap:APU0000701312:2026-09" }).success).toBe(false);
    expect(averagePriceSchema.safeParse({ ...rice, extra: 1 }).success).toBe(false);
  });

  it("accepts a price for each unit of an amount that is not money, and refuses the other units", () => {
    for (const unit of ["USD/lb", "USD/L", "USD/{each}", "USD/h"]) expect(unitPriceSchema.safeParse({ value: 1, unit }).success, unit).toBe(true);
    for (const unit of ["USD", "lb", "USD/USD", "lb/USD", "foo/lb"]) expect(unitPriceSchema.safeParse({ value: 1, unit }).success, unit).toBe(false);
    expect(unitPriceSchema.safeParse({ value: 0, unit: "USD/lb" }).success).toBe(false);
  });

  it("accepts a month from 0001-01 to 9999-12 only", () => {
    for (const month of ["2026-01", "2026-12", "0001-01"]) expect(monthSchema.safeParse(month).success, month).toBe(true);
    for (const month of ["2026-00", "2026-13", "0000-05", "2026-1", "2026-10-01", "M10"]) expect(monthSchema.safeParse(month).success, month).toBe(false);
  });

  it("gives the last month of each series, and the later read of one month", () => {
    const september = { ...rice, id: averagePriceId("bls-ap", rice.series, "2026-09"), period: "2026-09" };
    const revised = { ...rice, price: { value: 1.105, unit: "USD/lb" }, at: "2026-11-23T16:00:00Z" };
    const sugar = { ...rice, series: "APU0000715211", id: averagePriceId("bls-ap", "APU0000715211", "2026-10") };
    expect(latestAverages([revised, september, sugar, rice])).toEqual([revised, sugar]);
    expect(latestAverages([])).toEqual([]);
  });
});
