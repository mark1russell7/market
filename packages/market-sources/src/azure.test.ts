import { meteredCost, meteredObservationSchema, type MeteredObservation } from "@mark1russell7/market";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AT, azurePage, meteredNotes, meteredObservations, mutated } from "../test/fixtures.ts";
import {
  AZURE_PRICES_URL,
  azureNextPage,
  azurePricesUrl,
  azureUnit,
  isAzurePricesUrl,
  parseAzureRetailPricePages,
  parseAzureRetailPrices,
} from "./azure.ts";
import type { MeteredParseResult } from "./parse.ts";

type Row = (typeof azurePage.Items)[number];

const NEXT = "https://prices.azure.com:443/api/retail/prices?api-version=2023-01-01-preview&$filter=x&$skip=1000";

/** The rows of the fixture whose meter has this name. */
function rowsOf(meterName: string): Row[] {
  return azurePage.Items.filter((row) => row.meterName === meterName);
}

/** The first E64 v4 row on demand, with its savings plans. */
const VM: Row = azurePage.Items.find((row) => row.skuId === "DZH318Z0D1L7/0058")!;

/** This function reads a page with these rows, and no link of a next page. */
function parseRows(rows: readonly unknown[]): MeteredParseResult {
  return parseAzureRetailPrices({ Items: rows, NextPageLink: null, Count: rows.length }, AT);
}

/** This function gives the observation of an offer id, and it throws when the result does not have it. */
function offer(result: MeteredParseResult, id: string): MeteredObservation {
  const found = meteredObservations(result).find((observation) => observation.offer.id === id);
  if (found === undefined) throw new Error(`The result has no offer ${id}.`);
  return found;
}

/** This function examines the invariants of a metered result: each record is valid, and each id is unique. */
function expectValid(result: MeteredParseResult): void {
  if (!result.ok) {
    expect(result.problems.length).toBeGreaterThan(0);
    return;
  }
  const ids = new Set<string>();
  for (const observation of result.observations) {
    expect(meteredObservationSchema.safeParse(observation).success).toBe(true);
    expect(observation.reading.offerId).toBe(observation.offer.id);
    expect(observation.reading.at).toBe(AT);
    expect(ids.has(observation.offer.id)).toBe(false);
    ids.add(observation.offer.id);
  }
}

describe("azurePricesUrl", () => {
  it("joins the fields in the order of the documentation, and asks for the version with savings plans", () => {
    expect(azurePricesUrl({ skuName: "E64 v4", armRegionName: "southcentralus" })).toBe(
      `${AZURE_PRICES_URL}?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20'southcentralus'%20and%20skuName%20eq%20'E64%20v4'`,
    );
  });

  it("doubles each quote of a value, and adds the currency before the filter", () => {
    expect(azurePricesUrl({ productName: "Ev4's Series" }, "USD")).toBe(
      `${AZURE_PRICES_URL}?api-version=2023-01-01-preview&currencyCode='USD'&$filter=productName%20eq%20'Ev4''s%20Series'`,
    );
  });

  it("refuses an empty filter, a field that the API does not filter and a bad value", () => {
    expect(() => azurePricesUrl({})).toThrow("large crawl");
    expect(() => azurePricesUrl({ tierMinimumUnits: "0" } as never)).toThrow('does not filter the field "tierMinimumUnits"');
    for (const value of ["", " westeurope", "westeurope ", "west\neurope", "x".repeat(201), 1 as never]) {
      expect(() => azurePricesUrl({ armRegionName: value })).toThrow(RangeError);
    }
    expect(azurePricesUrl({ armRegionName: "x".repeat(200) })).toContain("x".repeat(200));
  });

  it("refuses a currency that is not three capitals or not a money unit", () => {
    for (const currency of ["usd", "US", "USDX", "ZZZ", "U$D"]) {
      expect(() => azurePricesUrl({ armRegionName: "westeurope" }, currency)).toThrow(RangeError);
    }
  });
});

describe("isAzurePricesUrl and azureNextPage", () => {
  it("accepts only the API on https and its default port", () => {
    expect(isAzurePricesUrl(NEXT)).toBe(true);
    expect(isAzurePricesUrl(azurePricesUrl({ meterId: "x" }))).toBe(true);
    for (const link of [
      "http://prices.azure.com/api/retail/prices",
      "https://prices.azure.com:8443/api/retail/prices",
      "https://prices.azure.com.example.com/api/retail/prices",
      "https://example.com/api/retail/prices",
      "https://prices.azure.com/api/retail/prices/x",
      "https://user:secret@prices.azure.com/api/retail/prices",
      "not a link",
    ]) {
      expect(isAzurePricesUrl(link)).toBe(false);
    }
  });

  it("gives the link of the next page only when it goes to the API", () => {
    expect(azureNextPage({ NextPageLink: NEXT })).toBe(NEXT);
    expect(azureNextPage({ NextPageLink: "https://example.com/api/retail/prices" })).toBeNull();
    expect(azureNextPage({ NextPageLink: null })).toBeNull();
    expect(azureNextPage([])).toBeNull();
  });
});

describe("azureUnit", () => {
  it.each([
    ["1 Hour", 1, "h"],
    ["1/Hour", 1, "h"],
    ["1/Month", 1, "mo"],
    ["1 GB", 1, "GiB"],
    ["1 GiB", 1, "GiB"],
    ["1 MB", 1, "MiB"],
    ["1 TB", 1, "TiB"],
    ["1 GB/Month", 1, "GiB·mo"],
    ["1 GiB/Hour", 1, "GiB·h"],
    ["1", 1, "{count}"],
    ["100", 100, "{count}"],
    ["1K", 1000, "{count}"],
    ["10K", 10_000, "{count}"],
    ["100K", 100_000, "{count}"],
    ["1M", 1_000_000, "{count}"],
    ["10K/Month", 10_000, "{count}·mo"],
    ["100/Month", 100, "{count}·mo"],
  ])("reads %s as %d of %s", (unitOfMeasure, count, unit) => {
    expect(azureUnit(unitOfMeasure)).toEqual({ count, unit });
  });

  it.each(["", "Hour", "0 Hour", "1.5 Hour", "01 Hour", "1 PB", "1 Parsec", "1 GB/Week", "1 Hour/Month", " 1 Hour", "1  Hour"])(
    "does not know %j",
    (unitOfMeasure) => {
      expect(azureUnit(unitOfMeasure)).toBeUndefined();
    },
  );
});

describe("parseAzureRetailPrices", () => {
  const result = parseAzureRetailPrices(azurePage, AT);

  it("reads the real page with no note: one offer for each SKU in a region on a term", () => {
    expect(meteredNotes(result)).toEqual([]);
    expect(result.ok && result.next).toBeNull();
    expect(meteredObservations(result).map(({ offer }) => offer.id)).toEqual([
      "azure:westeurope/DZH318Z0BNVX/003F/consumption",
      "azure:westeurope/DZH318Z0BNZJ/008R/consumption",
      "azure:southcentralus/DZH318Z0D1L7/0058/consumption",
      "azure:southcentralus/DZH318Z0D1L7/0058/savings-plan-3y",
      "azure:southcentralus/DZH318Z0D1L7/0058/savings-plan-1y",
      "azure:southcentralus/DZH318Z0D1L7/018J/reservation-1y",
      "azure:southcentralus/DZH318Z0D1L7/018F/reservation-3y",
      "azure:southcentralus/DZH318Z0D1L3/006C/consumption",
      "azure:southcentralus/DZH318Z0D1L3/006C/dev-test",
    ]);
    expectValid(result);
  });

  it("maps the tiers of the egress meter, with the first 100 GiB at zero", () => {
    const tiers = (from: number, value: number) => ({ from: { value: from, unit: "GiB" }, unitPrice: { value, unit: "USD/GiB" } });
    expect(offer(result, "azure:westeurope/DZH318Z0BNVX/003F/consumption")).toEqual({
      offer: {
        id: "azure:westeurope/DZH318Z0BNVX/003F/consumption",
        source: "azure",
        sourceId: "westeurope/DZH318Z0BNVX/003F/consumption",
        title: "Rtn Preference: MGN, Standard",
        location: { provider: "azure", region: "westeurope", country: "NL" },
        term: { kind: "on-demand" },
        specs: [
          { name: "serviceName", value: "Bandwidth" },
          { name: "serviceFamily", value: "Networking" },
          { name: "productName", value: "Rtn Preference: MGN" },
          { name: "skuName", value: "Standard" },
          { name: "location", value: "EU West" },
          { name: "pricing", value: "consumption" },
        ],
      },
      reading: {
        offerId: "azure:westeurope/DZH318Z0BNVX/003F/consumption",
        at: AT,
        period: { value: 1, unit: "mo" },
        meters: [
          {
            name: "Standard Data Transfer Out",
            tiers: [tiers(0, 0), tiers(100, 0.087), tiers(10335, 0.083), tiers(51295, 0.07), tiers(153695, 0.05), tiers(512095, 0.05)],
          },
          { name: "Standard Inter-Region Data Transfer", tiers: [tiers(0, 0.02)] },
        ],
      },
    });
  });

  it("gives the price of one unit of a count, and a month of data", () => {
    const meters = offer(result, "azure:westeurope/DZH318Z0BNZJ/008R/consumption").reading.meters;
    expect(meters.map((meter) => [meter.name, meter.tiers.map((tier) => [tier.from.value, tier.from.unit, tier.unitPrice.value, tier.unitPrice.unit])])).toEqual([
      [
        "Hot LRS Data Stored",
        [
          [0, "GiB·mo", 0.0196, "USD/(GiB·mo)"],
          [51200, "GiB·mo", 0.018816, "USD/(GiB·mo)"],
          [512000, "GiB·mo", 0.018032, "USD/(GiB·mo)"],
        ],
      ],
      ["Hot LRS Write Operations", [[0, "{count}", 0.0000054, "USD/{count}"]]],
      ["Hot Read Operations", [[0, "{count}", 0.00000043, "USD/{count}"]]],
      ["Index Tags", [[0, "{count}·mo", 0.0000039, "USD/({count}·mo)"]]],
    ]);
  });

  it("maps a reservation to a committed term with its total as upfront money, and a savings plan to its rate", () => {
    const reservation = offer(result, "azure:southcentralus/DZH318Z0D1L7/018J/reservation-1y");
    expect(reservation.offer.title).toBe("Virtual Machines Ev4 Series, E64 v4, 1-year reservation");
    expect(reservation.offer.term).toEqual({ kind: "committed", length: { value: 1, unit: "yr" } });
    expect(reservation.offer.specs).toContainEqual({ name: "os", value: "linux" });
    expect(reservation.reading.upfront).toEqual({ value: 25007, unit: "USD" });
    expect(reservation.reading.meters).toEqual([
      { name: "E64 v4", tiers: [{ from: { value: 0, unit: "h" }, unitPrice: { value: 0, unit: "USD/h" } }] },
    ]);
    const plan = offer(result, "azure:southcentralus/DZH318Z0D1L7/0058/savings-plan-3y");
    expect(plan.offer.term).toEqual({ kind: "committed", length: { value: 3, unit: "yr" } });
    expect(plan.reading.upfront).toBeUndefined();
    expect(plan.reading.meters[0]?.tiers[0]?.unitPrice).toEqual({ value: 2.2917606, unit: "USD/h" });
  });

  it("maps a spot SKU to the spot term, and keeps its Dev/Test price as another offer", () => {
    const spot = offer(result, "azure:southcentralus/DZH318Z0D1L3/006C/consumption");
    const devTest = offer(result, "azure:southcentralus/DZH318Z0D1L3/006C/dev-test");
    expect(spot.offer.term).toEqual({ kind: "spot" });
    expect(devTest.offer.term).toEqual({ kind: "spot" });
    expect(devTest.offer.title).toBe("Virtual Machines Ev4 Series Windows, E64 v4 Spot, Dev/Test");
    expect(devTest.offer.specs.at(-1)).toEqual({ name: "pricing", value: "dev-test" });
    expect(devTest.offer.specs).toContainEqual({ name: "os", value: "windows" });
    expect(devTest.reading.meters[0]?.tiers[0]?.unitPrice.value).toBe(0.894062);
  });

  it("gives exact costs with meteredCost: the free tier, a tier edge, a data month and an upfront share", () => {
    const egress = offer(result, "azure:westeurope/DZH318Z0BNVX/003F/consumption");
    const out = (value: number) => meteredCost(egress, { "Standard Data Transfer Out": { value, unit: "GiB" } }).total;
    expect(out(100)).toEqual({ value: 0, unit: "USD" });
    expect(out(10335)).toEqual({ value: 890.445, unit: "USD" });
    expect(out(10336)).toEqual({ value: 890.528, unit: "USD" });
    const blob = offer(result, "azure:westeurope/DZH318Z0BNZJ/008R/consumption");
    const stored = meteredCost(blob, {
      "Hot LRS Data Stored": { value: 60, unit: "TiB·mo" },
      "Hot LRS Write Operations": { value: 1_000_000, unit: "{count}" },
    });
    expect(stored.meters.map((meter) => meter.cost.value)).toEqual([1196.19584, 5.4, 0, 0]);
    const vm = offer(result, "azure:southcentralus/DZH318Z0D1L7/0058/consumption");
    expect(meteredCost(vm, { "E64 v4": { value: 730, unit: "h" } }).total).toEqual({ value: 3531.74, unit: "USD" });
    const reservation = offer(result, "azure:southcentralus/DZH318Z0D1L7/018J/reservation-1y");
    expect(meteredCost(reservation, { "E64 v4": { value: 730, unit: "h" } })).toEqual({
      meters: [{ name: "E64 v4", cost: { value: 0, unit: "USD" } }],
      upfront: { value: 25007 / 12, unit: "USD" },
      total: { value: 25007 / 12, unit: "USD" },
    });
  });

  it("refuses an answer that is not an object or has no list of items, and a read with no page", () => {
    expect(parseAzureRetailPrices([], AT)).toEqual({ ok: false, problems: ["The answer is not an object."] });
    expect(parseAzureRetailPrices({ Items: {} }, AT)).toEqual({ ok: false, problems: ["The field Items of the answer is not a list."] });
    expect(parseAzureRetailPricePages([azurePage, null], AT)).toEqual({ ok: false, problems: ["The page 2 is not an object."] });
    expect(parseAzureRetailPricePages([], AT)).toEqual({ ok: false, problems: ["The read has no page."] });
  });

  it("throws a RangeError for an instant that is not in UTC", () => {
    expect(() => parseAzureRetailPrices(azurePage, "2026-11-12 18:00")).toThrow(RangeError);
  });
});

describe("parseAzureRetailPricePages", () => {
  it("joins the tiers of a meter whose rows continue on the next page, and gives the link of the last page", () => {
    const egress = rowsOf("Standard Data Transfer Out");
    const pages = [
      { Items: egress.slice(0, 2), NextPageLink: NEXT },
      { Items: egress.slice(2), NextPageLink: NEXT },
    ];
    const joined = parseAzureRetailPricePages(pages, AT);
    expect(meteredNotes(joined)).toEqual([]);
    expect(joined.ok && joined.next).toBe(NEXT);
    expect(meteredObservations(joined)).toEqual(meteredObservations(parseRows(egress)));
  });

  it("gives a note and no link when the link of the next page goes to another address", () => {
    const read = parseAzureRetailPrices({ ...azurePage, NextPageLink: "https://example.com/next" }, AT);
    expect(read.ok && read.next).toBeNull();
    expect(meteredNotes(read)).toEqual([
      'The link of the next page "https://example.com/next" does not go to the Azure Retail Prices API, and the result has no link.',
    ]);
  });

  it("names each page in the note of a row", () => {
    const read = parseAzureRetailPricePages([{ Items: [VM] }, { Items: [7] }], AT);
    expect(meteredNotes(read)).toEqual(["The row page 2, Items[0] is skipped: it is not an object."]);
  });
});

describe("the notes of parseAzureRetailPrices", () => {
  it("skips a row with no id, an unknown unit, a bad currency, a bad price or an unknown type", () => {
    const read = parseRows([
      { ...VM, meterId: undefined, skuName: " " },
      { ...VM, unitOfMeasure: "1 PB" },
      { ...VM, currencyCode: "XXX1" },
      { ...VM, retailPrice: -1 },
      { ...VM, tierMinimumUnits: "abc" },
      { ...VM, type: "Credit" },
      { ...VM, type: "Reservation", reservationTerm: "5 Weeks" },
    ]);
    expect(meteredObservations(read)).toEqual([]);
    expect(meteredNotes(read)).toEqual([
      "The row Items[0] is skipped: it has no meterId, skuName.",
      'The row Items[1] is skipped: the parser does not know the unit of measure "1 PB".',
      'The row Items[2] is skipped: the currency "XXX1" is not a money unit of @mark1russell7/quantity.',
      "The row Items[3] is skipped: its retailPrice -1 is not a decimal of zero or more.",
      'The row Items[4] is skipped: its tierMinimumUnits "abc" is not a decimal of zero or more.',
      'The row Items[5] is skipped: its type "Credit" is not a type of the documentation.',
      'The row Items[6] is skipped: its reservationTerm "5 Weeks" is not a count of years.',
    ]);
  });

  it("skips a savings plan with no term in years, and a list of savings plans that is not a list", () => {
    const read = parseRows([{ ...VM, savingsPlan: [{ retailPrice: 1, term: "Forever" }, { term: "1 Year" }] }]);
    expect(meteredObservations(read).map(({ offer }) => offer.id)).toEqual(["azure:southcentralus/DZH318Z0D1L7/0058/consumption"]);
    expect(meteredNotes(read)).toEqual([
      "The savings plan Items[0].savingsPlan[0] is skipped: it has no term in years or no retailPrice.",
      "The savings plan Items[0].savingsPlan[1] is skipped: it has no term in years or no retailPrice.",
    ]);
    expect(meteredNotes(parseRows([{ ...VM, savingsPlan: "yes" }]))).toEqual([
      "The field savingsPlan of the row Items[0] is not a list, and the parser does not read it.",
    ]);
  });

  it("skips a meter whose tiers start above zero in a unit of more than one count, or have two prices", () => {
    const write = rowsOf("Hot LRS Write Operations")[0]!;
    const read = parseRows([write, { ...write, tierMinimumUnits: 100, retailPrice: 0.05 }, VM, { ...VM, retailPrice: 5 }]);
    expect(meteredObservations(read).map(({ offer }) => offer.id)).toEqual([
      "azure:southcentralus/DZH318Z0D1L7/0058/savings-plan-3y",
      "azure:southcentralus/DZH318Z0D1L7/0058/savings-plan-1y",
    ]);
    expect(meteredNotes(read)).toEqual([
      'The meter "Hot LRS Write Operations" of the offer azure:westeurope/DZH318Z0BNZJ/008R/consumption is skipped: a tier starts at 100 of the unit of measure 10K, and the documentation does not tell the unit of the start.',
      "The offer azure:westeurope/DZH318Z0BNZJ/008R/consumption is skipped: it has no meter with a valid price.",
      'The meter "E64 v4" of the offer azure:southcentralus/DZH318Z0D1L7/0058/consumption is skipped: two rows give the tier at 0 the prices 4.838 and 5.',
      "The offer azure:southcentralus/DZH318Z0D1L7/0058/consumption is skipped: it has no meter with a valid price.",
    ]);
  });

  it("skips a meter with no tier at zero, a row in a currency that quantity does not have and a repeated reservation", () => {
    const egress = rowsOf("Standard Data Transfer Out");
    const reservation = azurePage.Items.find((row) => row.type === "Reservation")!;
    const read = parseRows([...egress.slice(1), rowsOf("Standard Inter-Region Data Transfer")[0]!, { ...VM, currencyCode: "ZZZ" }, VM, reservation, reservation]);
    expect(meteredNotes(read)).toEqual([
      'The row Items[6] is skipped: the currency "ZZZ" is not a money unit of @mark1russell7/quantity.',
      "The row Items[9] is skipped: it repeats the reservation azure:southcentralus/DZH318Z0D1L7/018J/reservation-1y.",
      'The meter "Standard Data Transfer Out" of the offer azure:westeurope/DZH318Z0BNVX/003F/consumption is skipped: it has no tier that starts at 0.',
    ]);
    expect(offer(read, "azure:westeurope/DZH318Z0BNVX/003F/consumption").reading.meters.map((meter) => meter.name)).toEqual([
      "Standard Inter-Region Data Transfer",
    ]);
    expect(offer(read, "azure:southcentralus/DZH318Z0D1L7/0058/consumption").reading.meters[0]?.tiers[0]?.unitPrice.unit).toBe("USD/h");
  });

  it("names two meters of one name by their ids", () => {
    const read = parseRows([VM, { ...VM, meterId: "00000000-0000-0000-0000-000000000001", savingsPlan: undefined }]);
    expect(meteredNotes(read)).toEqual([]);
    expect(offer(read, "azure:southcentralus/DZH318Z0D1L7/0058/consumption").reading.meters.map((meter) => meter.name)).toEqual([
      "E64 v4 (0016083a-928f-56fd-8eeb-39287dcf676d)",
      "E64 v4 (00000000-0000-0000-0000-000000000001)",
    ]);
  });
});

describe("the properties of parseAzureRetailPrices", () => {
  it("never throws on a mutated page, and gives only valid metered records", () => {
    fc.assert(
      fc.property(mutated(azurePage), (answer) => {
        expectValid(parseAzureRetailPrices(answer, AT));
      }),
      { numRuns: 300 },
    );
  });

  it("never throws on any JSON value", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (answer) => {
        expectValid(parseAzureRetailPrices(answer, AT));
        expectValid(parseAzureRetailPrices({ Items: [answer] }, AT));
      }),
      { numRuns: 300 },
    );
  });
});
