import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KROGER_LOCATION, krogerLocationDetails, krogerLocationRecord, krogerLocationSearch, mutated } from "../test/fixtures.ts";
import { checkKrogerLocation } from "./kroger.ts";
import { parseKrogerLocation, parseKrogerLocations, type KrogerLocationsResult } from "./kroger-locations.ts";

function withRecord(changes: Record<string, unknown>) {
  return { data: { ...krogerLocationRecord, ...changes } };
}

describe("parseKrogerLocation", () => {
  it("maps the documented location", () => {
    expect(parseKrogerLocation(krogerLocationDetails)).toEqual({
      ok: true,
      locations: [
        {
          locationId: KROGER_LOCATION,
          chain: "KROGER",
          name: "Kroger Example Riverside",
          address: { line1: "100 Example Avenue", line2: undefined, city: "Exampleton", state: "OH", zipCode: "45000" },
          point: { lat: 39.1, lon: -84.5 },
          phone: "5550100000",
        },
      ],
      notes: [],
    });
  });

  it("keeps a location with no full address or no valid point, with a note", () => {
    const result = parseKrogerLocation(withRecord({ address: { city: "Exampleton" }, geolocation: { latitude: 91, longitude: 0 } }));
    expect(result).toMatchObject({ ok: true, locations: [{ locationId: KROGER_LOCATION, address: undefined, point: undefined }] });
    expect(result.ok && result.notes).toEqual([
      `The location ${KROGER_LOCATION} has no full address.`,
      `The location ${KROGER_LOCATION} has no valid latitude and longitude.`,
    ]);
  });

  it("uses the chain as the name when the name is absent", () => {
    expect(parseKrogerLocation(withRecord({ name: " " }))).toMatchObject({ ok: true, locations: [{ name: "KROGER" }] });
  });

  it("skips a location with a bad id, or with no name and no chain", () => {
    expect(parseKrogerLocation(withRecord({ locationId: "0123" }))).toEqual({
      ok: true,
      locations: [],
      notes: ["The location data is skipped: its locationId is not 8 letters or digits."],
    });
    expect(parseKrogerLocation(withRecord({ name: undefined, chain: undefined }))).toEqual({
      ok: true,
      locations: [],
      notes: [`The location ${KROGER_LOCATION} is skipped: it has no name and no chain.`],
    });
  });

  it("refuses an answer that is not the documented shape", () => {
    expect(parseKrogerLocation([])).toEqual({ ok: false, problems: ["The answer of Location details is not an object."] });
    expect(parseKrogerLocation({ data: [] })).toEqual({ ok: false, problems: ["The field data of the answer is not an object."] });
  });
});

describe("parseKrogerLocations", () => {
  it("maps each location in the order of the answer", () => {
    const result = parseKrogerLocations(krogerLocationSearch);
    expect(result.ok && result.notes).toEqual([]);
    expect(result.ok && result.locations.map(({ locationId, chain }) => [locationId, chain])).toEqual([
      [KROGER_LOCATION, "KROGER"],
      ["07654321", "EXAMPLEMART"],
    ]);
    expect(result.ok && result.locations[1]?.address?.line2).toBe("Suite 2");
  });

  it("skips an item that is not an object, and refuses an answer with no list", () => {
    expect(parseKrogerLocations({ data: [7] })).toEqual({ ok: true, locations: [], notes: ["The location data[0] is skipped: it is not an object."] });
    expect(parseKrogerLocations({ data: {} })).toEqual({ ok: false, problems: ["The field data of the answer is not a list."] });
    expect(parseKrogerLocations("x")).toEqual({ ok: false, problems: ["The answer of Location search is not an object."] });
  });
});

/** This function examines the invariants of a result: each location has a valid id, a name and a valid point. */
function expectValid(result: KrogerLocationsResult): void {
  if (!result.ok) {
    expect(result.problems.length).toBeGreaterThan(0);
    return;
  }
  for (const location of result.locations) {
    expect(checkKrogerLocation(location.locationId)).toBe(location.locationId);
    expect(location.name.trim()).not.toBe("");
    if (location.point !== undefined) {
      expect(Math.abs(location.point.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(location.point.lon)).toBeLessThanOrEqual(180);
    }
  }
}

describe.each([
  { name: "parseKrogerLocation", parse: parseKrogerLocation, fixture: krogerLocationDetails },
  { name: "parseKrogerLocations", parse: parseKrogerLocations, fixture: krogerLocationSearch },
])("$name", ({ parse, fixture }) => {
  it("never throws on a mutated answer, and gives only valid records", () => {
    fc.assert(fc.property(mutated(fixture), (answer) => expectValid(parse(answer))), { numRuns: 300 });
  });

  it("never throws on a random JSON value, and gives only valid records", () => {
    fc.assert(fc.property(fc.jsonValue(), (answer) => expectValid(parse(answer))), { numRuns: 200 });
  });
});
