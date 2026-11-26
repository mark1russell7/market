import { quotaGate, withQuota, type Quota, type QuotaGate } from "polite-crawler/api";
import {
  checkName,
  checkSecret,
  formBody,
  instantOf,
  readAnswer,
  readGrant,
  readJson,
  redact,
  send,
  sendWithToken,
  tokenStore,
  type Answer,
  type Pace,
  type Send,
  type Signal,
  type Transport,
} from "./client.ts";
import { checkKrogerLocation, parseKrogerProduct, parseKrogerProducts } from "./kroger.ts";
import { parseKrogerLocation, parseKrogerLocations, type KrogerLocationsResult } from "./kroger-locations.ts";
import type { ParseResult } from "./parse.ts";

/** The host of the Kroger APIs. */
export const KROGER_HOST = "api.kroger.com";

/** The host of the certification environment of the Kroger APIs. */
export const KROGER_SANDBOX_HOST = "api-ce.kroger.com";

/** The scope of a client token for the Products API: read access to general product information. */
export const KROGER_SCOPE = "product.compact";

/**
 * The client sends one request each second at most: the API interval of the policy of `polite-crawler`. The
 * documentation of the Products API gives a count of calls each day, but no pace.
 */
export const KROGER_PACE_MS = 1000;

/**
 * The quota of the Products API: 10,000 calls each day. The section "Rate Limit" of the Products API 1.3.0 gives
 * 10,000 calls each day, counted over all the operations of `/products`
 * (https://developer.kroger.com/api-products/api/product-api-public). The gate keeps 1,000 in reserve for calls that
 * it does not see. The documentation does not tell when the day of the count starts, thus the window is a rolling 24
 * hours. A request of a token goes to another endpoint, thus it does not count.
 */
export const KROGER_QUOTA: Quota = {
  name: "Kroger Products API calls",
  limit: 10_000,
  reserve: 1_000,
  window: { kind: "rolling", ms: 86_400_000 },
};

/**
 * The name of the key of `KROGER_QUOTA`. The API counts the calls of each client. The name has no client id, because
 * a store keeps the name as text.
 */
export const KROGER_QUOTA_KEY = "kroger:products";

/** The most products of one page of Product search. */
export const KROGER_SEARCH_LIMIT = 50;

/** The most products that Product search skips with `start`. */
export const KROGER_START_LIMIT = 250;

/** The options of a Kroger client. */
export interface KrogerClientOptions<S extends Signal> {
  /** The client id of the application. */
  readonly clientId: string;
  /** The client secret of the application. */
  readonly clientSecret: string;
  /** This function encodes a text in UTF-8, and gives its Base64 form. The host gives it, for example with `Buffer`. */
  readonly base64: (text: string) => string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /**
   * The location id of the store, from the Kroger Locations API, for example `01400943`. The Products API gives a
   * price, the stock and the fulfillment only for a location.
   */
  readonly locationId: string;
  /** With true, the client uses the certification environment. */
  readonly sandbox?: boolean | undefined;
  /**
   * The gate of `KROGER_QUOTA`. The default is one gate in memory for each pace, with the clock of the pace. Thus each
   * client of one pace counts in one gate, as the pace keeps one interval for each host. A gate with a shared store
   * counts each process of one application in one record. An example store is `SqliteHostStateStore` of `polite-crawler`.
   */
  readonly quota?: QuotaGate | undefined;
}

/**
 * A client of the Kroger Products API at one location. Each method gives the result of a parser of this package. Each
 * method throws `QuotaError` of `polite-crawler/api` when the quota refuses the call. Its `resetAt` tells when the
 * gate gives a call again. The client sent nothing.
 */
export interface KrogerClient<S extends Signal> {
  /** This method reads Product details of a product id: the 13 digits of a barcode with no check digit. */
  product(productId: string, signal?: S): Promise<ParseResult>;
  /**
   * This method reads one page of Product search of the term: 3 characters or more, and 8 words at most. The page has
   * `limit` products at most (1 to 50, the default 10), after `start` products (0 to 250, the default 0).
   */
  search(term: string, limit?: number, start?: number, signal?: S): Promise<ParseResult>;
}

const SOURCE = "Kroger";

/** The default gates of each pace, one map for each quota. A pace is the pace of the clients of one process. */
const PRODUCT_GATES = new WeakMap<object, QuotaGate>();
const LOCATION_GATES = new WeakMap<object, QuotaGate>();

function paceGate<S extends Signal>(pace: Pace<S>, gates: WeakMap<object, QuotaGate>, quota: Quota, key: string): QuotaGate {
  const found = gates.get(pace);
  if (found !== undefined) return found;
  const gate = quotaGate(quota, { key, now: pace.now });
  gates.set(pace, gate);
  return gate;
}

/** The options of a Kroger client that a session reads. */
interface SessionOptions<S extends Signal> {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly base64: (text: string) => string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  readonly sandbox?: boolean | undefined;
}

/**
 * This function makes the token store and the counted send of a Kroger client. The token has the scope `scope`, or
 * no scope when it is undefined.
 */
function krogerSession<S extends Signal>(options: SessionOptions<S>, scope: string | undefined, gate: QuotaGate) {
  checkSecret("clientId", options.clientId);
  checkSecret("clientSecret", options.clientSecret);
  const { clientId, clientSecret, pace, transport } = options;
  const host = options.sandbox === true ? KROGER_SANDBOX_HOST : KROGER_HOST;
  const base = `https://${host}`;
  const basic = options.base64(`${clientId}:${clientSecret}`);
  const secrets = [clientId, clientSecret, basic];
  const context = { source: SOURCE, host, minIntervalMs: KROGER_PACE_MS, secrets, redact };

  const tokens = tokenStore<S>(async (signal) => {
    const issuedAt = pace.now();
    const grant: Record<string, string> = { grant_type: "client_credentials" };
    if (scope !== undefined) grant["scope"] = scope;
    const exchange = {
      method: "POST" as const,
      url: `${base}/v1/connect/oauth2/token`,
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(grant),
    };
    const { reply } = await send(pace, transport, { ...context, what: "the token", exchange }, signal);
    return readGrant(reply, SOURCE, issuedAt, secrets, redact);
  }, pace.now);

  const headers = (token: string): Readonly<Record<string, string>> => ({ authorization: `Bearer ${token}` });
  const counted = withQuota(
    gate,
    async (input: Send, signal: S | undefined): Promise<Answer> => await sendWithToken(pace, transport, tokens, input, headers, signal),
    { read: (answer) => (answer.reply.status === 429 ? { remaining: 0 } : undefined) },
  );
  const get = async (what: string, url: string, signal?: S) => {
    const exchange = { method: "GET" as const, url, headers: { accept: "application/json" }, body: null };
    const input = { ...context, what, exchange };
    return { input, answer: await counted(input, signal) };
  };
  return { base, get };
}

const PRODUCT_ID = /^\d{13}$/;

/**
 * This function makes a client of the Kroger Products API. The client gets a client token with the client
 * credentials grant, with Basic, the form of RFC 6749 section 2.3.1. It keeps the token until 1 minute before its
 * end. Each request sends the token and the location id.
 *
 * - The gate counts each request of a product before the client sends it, and it refuses a request over the quota.
 * - The documentation gives no status for a client over its limit. A 429 (Too Many Requests) sets the count to the
 *   limit. Then the gate refuses each request until the requests of the window go out of it, 24 hours at most.
 *
 * @throws RangeError when the client id or the client secret is not a key, or the location id is not valid. The
 * message does not show a secret.
 */
export function createKrogerClient<S extends Signal>(options: KrogerClientOptions<S>): KrogerClient<S> {
  const { pace } = options;
  const { base, get } = krogerSession(options, KROGER_SCOPE, options.quota ?? paceGate(pace, PRODUCT_GATES, KROGER_QUOTA, KROGER_QUOTA_KEY));
  const locationId = checkKrogerLocation(options.locationId);

  const read = async (what: string, url: string, parse: (json: unknown, at: string, locationId: string) => ParseResult, signal?: S) => {
    const { input, answer } = await get(what, url, signal);
    return readAnswer(answer, input, (json, at) => parse(json, at, locationId), instantOf(pace.now()));
  };

  return {
    async product(productId, signal) {
      const id = checkName("productId", productId);
      if (!PRODUCT_ID.test(id)) throw new RangeError(`The product id ${JSON.stringify(id)} is not 13 digits.`);
      const query = formBody({ "filter.locationId": locationId });
      return read(`Product details of ${id}`, `${base}/v1/products/${id}?${query}`, parseKrogerProduct, signal);
    },
    async search(term, limit = 10, start = 0, signal) {
      const words = checkName("term", term).split(/\s+/);
      const text = words.join(" ");
      if (text.length < 3 || words.length > 8) throw new RangeError("The term is not 3 characters or more in 8 words at most.");
      if (!Number.isInteger(limit) || limit < 1 || limit > KROGER_SEARCH_LIMIT) {
        throw new RangeError(`The limit is not a whole number from 1 to ${KROGER_SEARCH_LIMIT}.`);
      }
      if (!Number.isInteger(start) || start < 0 || start > KROGER_START_LIMIT) {
        throw new RangeError(`The start is not a whole number from 0 to ${KROGER_START_LIMIT}.`);
      }
      const fields: Record<string, string> = { "filter.term": text, "filter.locationId": locationId, "filter.limit": String(limit) };
      if (start > 0) fields["filter.start"] = String(start);
      return read(`Product search of ${JSON.stringify(text)}`, `${base}/v1/products?${formBody(fields)}`, parseKrogerProducts, signal);
    },
  };
}

/**
 * The quota of the Locations API: 1,600 calls each day for each endpoint. The section "Rate Limit" of the Locations
 * API 1.2.3 gives this limit (https://developer.kroger.com/api-products/api/location-api-public). The endpoint
 * `/locations` has Location search and Location details, thus they count in one gate. The gate keeps 160 in reserve.
 */
export const KROGER_LOCATIONS_QUOTA: Quota = {
  name: "Kroger Locations API calls",
  limit: 1_600,
  reserve: 160,
  window: { kind: "rolling", ms: 86_400_000 },
};

/** The name of the key of `KROGER_LOCATIONS_QUOTA`. */
export const KROGER_LOCATIONS_QUOTA_KEY = "kroger:locations";

/** The most locations of one answer of Location search. The API has no pages. */
export const KROGER_LOCATION_LIMIT = 200;

/** The largest radius of Location search, in miles. */
export const KROGER_RADIUS_LIMIT = 100;

/**
 * The start point of Location search: a ZIP code of 5 digits, or a point in degrees on WGS84. The point has the shape
 * of `LatLon` of `@mark1russell7/geo`.
 */
export type KrogerPlace = { readonly zipCode: string } | { readonly point: { readonly lat: number; readonly lon: number } };

/** The options of Location search. */
export interface KrogerNearOptions {
  /** The radius in miles, a whole number from 1 to 100. The API default is 10. */
  readonly radiusMiles?: number | undefined;
  /** The most locations of the answer, a whole number from 1 to 200. The default is 10. */
  readonly limit?: number | undefined;
  /** The name of a chain. With it, the answer has only the stores of that chain. */
  readonly chain?: string | undefined;
}

/** The options of a client of the Kroger Locations API. */
export interface KrogerLocationClientOptions<S extends Signal> {
  /** The client id of the application. */
  readonly clientId: string;
  /** The client secret of the application. */
  readonly clientSecret: string;
  /** This function encodes a text in UTF-8, and gives its Base64 form. */
  readonly base64: (text: string) => string;
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /** With true, the client uses the certification environment. */
  readonly sandbox?: boolean | undefined;
  /** The gate of `KROGER_LOCATIONS_QUOTA`. The default is one gate in memory for each pace. */
  readonly quota?: QuotaGate | undefined;
}

/**
 * A client of the Kroger Locations API. It finds the location id that the product client needs. Each method throws
 * `QuotaError` of `polite-crawler/api` when the quota refuses the call.
 */
export interface KrogerLocationClient<S extends Signal> {
  /** This method reads Location search: the stores near a place. */
  near(place: KrogerPlace, options?: KrogerNearOptions, signal?: S): Promise<KrogerLocationsResult>;
  /** This method reads Location details of a location id. */
  location(locationId: string, signal?: S): Promise<KrogerLocationsResult>;
}

const ZIP_CODE = /^\d{5}$/;

function wholeIn(name: string, value: number, low: number, high: number): string {
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new RangeError(`The ${name} is not a whole number from ${low} to ${high}.`);
  }
  return String(value);
}

function placeField(place: KrogerPlace): readonly [string, string] {
  if ("zipCode" in place) {
    if (typeof place.zipCode !== "string" || !ZIP_CODE.test(place.zipCode)) throw new RangeError("The ZIP code is not 5 digits.");
    return ["filter.zipCode.near", place.zipCode];
  }
  const { lat, lon } = place.point;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError("The point is not a latitude from -90 to 90 and a longitude from -180 to 180.");
  }
  return ["filter.latLong.near", `${lat},${lon}`];
}

/**
 * This function makes a client of the Kroger Locations API. The client gets a client token with no scope, because
 * the Locations API needs none. It uses the same token rules and pace as `createKrogerClient`.
 *
 * @throws RangeError when the client id or the client secret is not a key. The message does not show a secret.
 */
export function createKrogerLocationClient<S extends Signal>(options: KrogerLocationClientOptions<S>): KrogerLocationClient<S> {
  const gate = options.quota ?? paceGate(options.pace, LOCATION_GATES, KROGER_LOCATIONS_QUOTA, KROGER_LOCATIONS_QUOTA_KEY);
  const { base, get } = krogerSession(options, undefined, gate);

  const read = async (what: string, url: string, parse: (json: unknown) => KrogerLocationsResult, signal?: S) => {
    const { input, answer } = await get(what, url, signal);
    const json = readJson(answer, input);
    return json.ok ? parse(json.json) : json;
  };

  return {
    async near(place, near = {}, signal) {
      const [name, value] = placeField(place);
      const fields: Record<string, string> = { [name]: value };
      if (near.radiusMiles !== undefined) fields["filter.radiusInMiles"] = wholeIn("radius", near.radiusMiles, 1, KROGER_RADIUS_LIMIT);
      fields["filter.limit"] = wholeIn("limit", near.limit ?? 10, 1, KROGER_LOCATION_LIMIT);
      if (near.chain !== undefined) fields["filter.chain"] = checkName("chain", near.chain);
      return read("Location search", `${base}/v1/locations?${formBody(fields)}`, parseKrogerLocations, signal);
    },
    async location(locationId, signal) {
      const id = checkKrogerLocation(checkName("locationId", locationId));
      return read(`Location details of ${id}`, `${base}/v1/locations/${id}`, parseKrogerLocation, signal);
    },
  };
}
