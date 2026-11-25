import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AZURE_PLACE_COUNTRIES, AZURE_REGION_TABLE, AZURE_REGIONS_SOURCE, azureRegion, azureRegionsDataText, parseAzureRegionsPage } from "./azure-regions.ts";

// The page of these tests is made up. It has the form of the list of the regions of the Azure documentation.
const HEAD = "<tr>\n<th>Region</th>\n<th>Availability zones</th>\n<th>Paired region</th>\n<th>Physical location</th>\n<th>Geography</th>\n<th>Programmatic name</th>\n</tr>";
const row = (...values: string[]) => `<tr>\n${values.map((value) => `<td>${value}</td>`).join("\n")}\n</tr>`;
const PAGE = [
  "<h2>Regions</h2>",
  "<table>\n<thead>",
  HEAD,
  "</thead>\n<tbody>",
  row("Example North", "3", '<img src="media/icon.svg" alt="An icon">\n Example South', "Kansas", "United States", "examplenorth"),
  row("Example West", "N/A", "N/A", "Netherlands", "Europe", "examplewest"),
  row("Example East", "3", "N/A", "Hong Kong", "Asia Pacific", "<code>exampleeast</code>"),
  row("Example Bad", "3", "N/A", "", "Germany", "examplebad"),
  row("Example Far", "3", "N/A", "Atlantis", "Atlantis", "examplefar"),
  row("Example Odd", "3", "N/A", "Kansas", "United States", "Example Odd"),
  "</tbody>\n</table>",
  "<table>",
  HEAD,
  row("Example North", "3", "N/A", "Kansas", "United States", "examplenorth"),
  row("Example West", "N/A", "N/A", "Ireland", "Europe", "examplewest"),
  "</table>",
  "<table>\n<tr><th>Icon</th><th>Meaning</th></tr>\n<tr><td>A</td><td>B</td></tr>\n</table>",
].join("\n");

describe("the list of the regions of the Azure documentation", () => {
  it("reads the country and the place of each region, and gives a note for each other row", () => {
    const read = parseAzureRegionsPage(PAGE);
    expect(read.regions).toEqual([
      { region: "examplenorth", country: "US", place: "Kansas" },
      { region: "examplewest", country: "NL", place: "Netherlands" },
      { region: "exampleeast", country: "HK", place: "Hong Kong" },
    ]);
    expect(read.notes).toEqual([
      "The row 4 of the table 1 is skipped: it has no programmatic name, physical location or geography.",
      'The row 5 of the table 1 is skipped: the region examplefar has no known country for "Atlantis" and "Atlantis".',
      "The row 6 of the table 1 is skipped: it has no programmatic name, physical location or geography.",
      "The region examplewest has two places. The first stays.",
    ]);
  });

  it("gives no region for a page with no table of the regions, and skips a cell with an entity", () => {
    expect(parseAzureRegionsPage("<p>No table</p>")).toEqual({ regions: [], notes: [] });
    const entity = parseAzureRegionsPage(`<table>${HEAD}${row("A", "3", "N/A", "Kansas", "United&nbsp;States", "examplea")}</table>`);
    expect(entity.regions).toEqual([]);
    expect(entity.notes).toHaveLength(1);
  });

  it("gives a country of two capital letters for each name of a place", () => {
    for (const country of Object.values(AZURE_PLACE_COUNTRIES)) expect(country).toMatch(/^[A-Z]{2}$/u);
  });
});

describe("the dataset of regions", () => {
  it("keeps its source, its terms and its attribution", () => {
    expect(AZURE_REGIONS_SOURCE.page).toMatch(/^https:\/\/learn\.microsoft\.com\//u);
    expect(AZURE_REGIONS_SOURCE.read).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(AZURE_REGIONS_SOURCE.attribution).toContain(AZURE_REGIONS_SOURCE.page);
  });

  it("has a country of two capital letters and a place for each region", () => {
    const entries = Object.entries(AZURE_REGION_TABLE);
    expect(entries.length).toBeGreaterThan(40);
    for (const [region, [country, place]] of entries) {
      expect(region).toMatch(/^[a-z][a-z0-9]*$/u);
      expect(Object.values(AZURE_PLACE_COUNTRIES)).toContain(country);
      expect(place.length).toBeGreaterThan(0);
    }
  });

  it("is the text that the generator writes", () => {
    const regions = Object.entries(AZURE_REGION_TABLE).map(([region, [country, place]]) => ({ region, country, place }));
    const file = readFileSync(new URL("./azure-regions-data.ts", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
    expect(azureRegionsDataText(AZURE_REGIONS_SOURCE, regions)).toBe(file);
  });

  it("finds a region by its programmatic name with any case, and no key of the prototype", () => {
    expect(azureRegion("WestEurope")).toEqual({ region: "westeurope", country: "NL", place: "Netherlands" });
    expect(azureRegion("eastus")?.country).toBe("US");
    expect(azureRegion("nowhere")).toBeUndefined();
    expect(azureRegion("constructor")).toBeUndefined();
    expect(azureRegion(undefined)).toBeUndefined();
  });
});
