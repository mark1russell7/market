import { checkKrogerLocation } from "./kroger.ts";
import { field, isRecord, refused, text, type Refused } from "./parse.ts";

/** The postal address of a Kroger location. */
export interface KrogerAddress {
  /** The first line of the street address. */
  readonly line1: string;
  /** The second line of the street address, when the API gives one that is not empty. */
  readonly line2: string | undefined;
  readonly city: string;
  /** The code of the state, for example `OH`. */
  readonly state: string;
  readonly zipCode: string;
}

/**
 * A store of the Kroger Locations API. The field `point` has the shape of `LatLon` of `@mark1russell7/geo`: the
 * latitude and the longitude in degrees on WGS84.
 */
export interface KrogerLocation {
  /** The location id: the 3-digit division number, then the 5-digit store number. */
  readonly locationId: string;
  /** The name of the chain, for example `KROGER`. */
  readonly chain: string | undefined;
  /** The name of the location. */
  readonly name: string;
  /** The address. It is undefined when the answer has no full address. */
  readonly address: KrogerAddress | undefined;
  /** The point of the store. It is undefined when the answer has no valid latitude and longitude. */
  readonly point: { readonly lat: number; readonly lon: number } | undefined;
  /** The phone number of the location, as the API gives it. */
  readonly phone: string | undefined;
}

/**
 * The result of a parser of the Locations API. With `ok`, each location has a valid location id and a name, and
 * each note tells why the parser skipped a record or a field. Without `ok`, the answer does not have the documented
 * shape, and `problems` tells why.
 */
export type KrogerLocationsResult =
  | { readonly ok: true; readonly locations: readonly KrogerLocation[]; readonly notes: readonly string[] }
  | Refused;

function validId(value: unknown): string | undefined {
  const id = text(value);
  if (id === undefined) return undefined;
  try {
    return checkKrogerLocation(id);
  } catch {
    return undefined;
  }
}

function addressOf(value: unknown): KrogerAddress | undefined {
  const line1 = text(field(value, "addressLine1"));
  const city = text(field(value, "city"));
  const state = text(field(value, "state"));
  const zipCode = text(field(value, "zipCode"));
  if (line1 === undefined || city === undefined || state === undefined || zipCode === undefined) return undefined;
  return { line1, line2: text(field(value, "addressLine2")), city, state, zipCode };
}

function pointOf(value: unknown): KrogerLocation["point"] {
  const lat = field(value, "latitude");
  const lon = field(value, "longitude");
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

function mapLocation(value: unknown, where: string, notes: string[]): KrogerLocation | undefined {
  if (!isRecord(value)) {
    notes.push(`The location ${where} is skipped: it is not an object.`);
    return undefined;
  }
  const locationId = validId(value["locationId"]);
  if (locationId === undefined) {
    notes.push(`The location ${where} is skipped: its locationId is not 8 letters or digits.`);
    return undefined;
  }
  const chain = text(value["chain"]);
  const name = text(value["name"]) ?? chain;
  if (name === undefined) {
    notes.push(`The location ${locationId} is skipped: it has no name and no chain.`);
    return undefined;
  }
  const address = addressOf(value["address"]);
  if (address === undefined) notes.push(`The location ${locationId} has no full address.`);
  const point = pointOf(value["geolocation"]);
  if (point === undefined) notes.push(`The location ${locationId} has no valid latitude and longitude.`);
  return { locationId, chain, name, address, point, phone: text(value["phone"]) };
}

/**
 * This function reads the answer of Location details of the Kroger Locations API (`GET /v1/locations/{id}`). It
 * gives one location, or none with a note.
 */
export function parseKrogerLocation(answer: unknown): KrogerLocationsResult {
  if (!isRecord(answer)) return refused("The answer of Location details is not an object.");
  if (!isRecord(answer["data"])) return refused("The field data of the answer is not an object.");
  const notes: string[] = [];
  const location = mapLocation(answer["data"], "data", notes);
  return { ok: true, locations: location === undefined ? [] : [location], notes };
}

/**
 * This function reads the answer of Location search of the Kroger Locations API (`GET /v1/locations`). The order of
 * the locations is the order of the answer. The API has no pages: one answer has all the results.
 */
export function parseKrogerLocations(answer: unknown): KrogerLocationsResult {
  if (!isRecord(answer)) return refused("The answer of Location search is not an object.");
  const data = answer["data"];
  if (!Array.isArray(data)) return refused("The field data of the answer is not a list.");
  const notes: string[] = [];
  const locations: KrogerLocation[] = [];
  data.forEach((value: unknown, index) => {
    const location = mapLocation(value, `data[${index}]`, notes);
    if (location !== undefined) locations.push(location);
  });
  return { ok: true, locations, notes };
}
