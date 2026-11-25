/**
 * The places of the regions of Azure: the country and the physical location of each region. The Azure Retail Prices
 * API gives the name of a region, but not its country. The list of the regions of the Azure documentation gives them.
 * The dataset `AZURE_REGION_TABLE` keeps only these two facts for each region.
 */
import { AZURE_REGION_TABLE, AZURE_REGIONS_SOURCE } from "./azure-regions-data.ts";

export { AZURE_REGION_TABLE, AZURE_REGIONS_SOURCE };

/** The source of a dataset of regions: the page, the date of the read, the terms and the attribution. */
export interface AzureRegionsSource {
  /** The address of the page of the list of the regions. */
  readonly page: string;
  /** The date of the read, as `YYYY-MM-DD`. */
  readonly read: string;
  /** The terms of the data. The page states no license. Thus the table keeps only facts, and no text of the page. */
  readonly terms: string;
  /** The attribution that each copy of the data keeps. */
  readonly attribution: string;
}

/** One region of Azure: its programmatic name, the code of its country, and its physical location. */
export interface AzureRegion {
  /** The programmatic name of the region, for example `westeurope`. The Azure Retail Prices API names it `armRegionName`. */
  readonly region: string;
  /** The code of ISO 3166-1 alpha-2 of the country of the region. */
  readonly country: string;
  /** The physical location of the region, as the list names it: a city, a state or a country. */
  readonly place: string;
}

/** The result of a read of the page of the list of the regions: the regions in the order of the page, and the notes. */
export interface AzureRegionsResult {
  readonly regions: readonly AzureRegion[];
  readonly notes: readonly string[];
}

/**
 * The code of the country of each name of a geography or a physical location of the list of the regions. A geography of
 * more than one country, for example `Europe`, gets its country from the physical location of the region.
 */
export const AZURE_PLACE_COUNTRIES: Readonly<Record<string, string>> = {
  "Abu Dhabi": "AE",
  Australia: "AU",
  Austria: "AT",
  Belgium: "BE",
  Brazil: "BR",
  Canada: "CA",
  Chile: "CL",
  Denmark: "DK",
  Dubai: "AE",
  Finland: "FI",
  France: "FR",
  Germany: "DE",
  Greece: "GR",
  "Hong Kong": "HK",
  India: "IN",
  Indonesia: "ID",
  Ireland: "IE",
  Israel: "IL",
  Italy: "IT",
  Japan: "JP",
  Korea: "KR",
  Malaysia: "MY",
  Mexico: "MX",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Norway: "NO",
  Poland: "PL",
  Qatar: "QA",
  "Saudi Arabia": "SA",
  Singapore: "SG",
  "South Africa": "ZA",
  Spain: "ES",
  Sweden: "SE",
  Switzerland: "CH",
  Taiwan: "TW",
  UAE: "AE",
  "United Kingdom": "GB",
  "United States": "US",
};

// The value of a key of a record, only when the record has the key itself, thus not a key of the prototype.
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const NAME = /^[a-z][a-z0-9]*$/u;
const HEADS = { place: "Physical location", geography: "Geography", region: "Programmatic name" } as const;

// The content of each element of a tag, in order. The scan reads the text from left to right with no regular
// expression, thus a page of the web cannot make it slow. An element with no end tag ends the scan.
function elements(html: string, tag: string): string[] {
  const out: string[] = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let at = 0;
  for (;;) {
    const start = html.indexOf(open, at);
    if (start < 0) return out;
    const next = html.charAt(start + open.length);
    if (next !== ">" && next !== " " && next !== "\n" && next !== "\t" && next !== "\r") {
      at = start + open.length;
      continue;
    }
    const body = html.indexOf(">", start);
    const end = body < 0 ? -1 : html.indexOf(close, body + 1);
    if (end < 0) return out;
    out.push(html.slice(body + 1, end));
    at = end + close.length;
  }
}

// The text of a cell: no tags, no line breaks and one space between words. A cell with an entity gives undefined.
function cellText(html: string): string | undefined {
  let text = "";
  let at = 0;
  for (;;) {
    const open = html.indexOf("<", at);
    if (open < 0) {
      text += html.slice(at);
      break;
    }
    text += `${html.slice(at, open)} `;
    const close = html.indexOf(">", open);
    if (close < 0) break;
    at = close + 1;
  }
  const joined = text
    .split(/\s/u)
    .filter((word) => word !== "")
    .join(" ");
  return joined.includes("&") ? undefined : joined;
}

function cells(row: string, tag: "td" | "th"): (string | undefined)[] {
  return elements(row, tag).map(cellText);
}

/**
 * This function reads the tables of the page of the list of the regions of Azure, as HTML. A table that has the heads
 * `Physical location`, `Geography` and `Programmatic name` gives one region for each row. The country comes from the
 * geography, or from the physical location for a geography of more than one country. A region in two tables gives one
 * region. A row with no valid name or no known country gives a note, and a region with two places gives a note.
 */
export function parseAzureRegionsPage(html: string): AzureRegionsResult {
  const regions = new Map<string, AzureRegion>();
  const notes: string[] = [];
  for (const [index, table] of elements(html, "table").entries()) {
    const rows = elements(table, "tr");
    const heads = cells(rows[0] ?? "", "th");
    const column = { place: heads.indexOf(HEADS.place), geography: heads.indexOf(HEADS.geography), region: heads.indexOf(HEADS.region) };
    if (column.place < 0 || column.geography < 0 || column.region < 0) continue;
    for (const [at, row] of rows.slice(1).entries()) {
      const values = cells(row, "td");
      const region = values[column.region];
      const place = values[column.place];
      const geography = values[column.geography];
      const where = `The row ${at + 1} of the table ${index + 1}`;
      if (region === undefined || !NAME.test(region) || place === undefined || place === "" || geography === undefined) {
        notes.push(`${where} is skipped: it has no programmatic name, physical location or geography.`);
        continue;
      }
      const country = own(AZURE_PLACE_COUNTRIES, geography) ?? own(AZURE_PLACE_COUNTRIES, place);
      if (country === undefined) {
        notes.push(`${where} is skipped: the region ${region} has no known country for ${JSON.stringify(geography)} and ${JSON.stringify(place)}.`);
        continue;
      }
      const known = regions.get(region);
      if (known !== undefined && (known.country !== country || known.place !== place)) {
        notes.push(`The region ${region} has two places. The first stays.`);
        continue;
      }
      if (known === undefined) regions.set(region, { region, country, place });
    }
  }
  return { regions: [...regions.values()], notes };
}

/** This function gives the text of the data file `src/azure-regions-data.ts` from the regions and their source. */
export function azureRegionsDataText(source: AzureRegionsSource, regions: readonly AzureRegion[]): string {
  const rows = [...regions].sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : 0));
  return [
    "// This file is generated by `scripts/azure-regions.ts`. Do not edit it.",
    `// ${source.attribution}`,
    'import type { AzureRegionsSource } from "./azure-regions.ts";',
    "",
    "/** The source of `AZURE_REGION_TABLE`, with its terms and its attribution. */",
    `export const AZURE_REGIONS_SOURCE: AzureRegionsSource = ${JSON.stringify(source, null, 2)};`,
    "",
    "/** The code of the country and the physical location of each region, by its programmatic name. */",
    "export const AZURE_REGION_TABLE: Readonly<Record<string, readonly [country: string, place: string]>> = {",
    ...rows.map((entry) => `  ${JSON.stringify(entry.region)}: [${JSON.stringify(entry.country)}, ${JSON.stringify(entry.place)}],`),
    "};",
    "",
  ].join("\n");
}

/**
 * This function gives the region of Azure with a programmatic name, for example `westeurope`. It gives `undefined`
 * when the dataset does not have the name. The match ignores the case.
 */
export function azureRegion(name: string | undefined): AzureRegion | undefined {
  if (name === undefined) return undefined;
  const region = name.toLowerCase();
  const entry = own(AZURE_REGION_TABLE, region);
  return entry === undefined ? undefined : { region, country: entry[0], place: entry[1] };
}
