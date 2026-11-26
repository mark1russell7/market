import { gtinCheckDigit, offerId, parseGtin, type Availability, type SourceTerms, type Spec } from "@mark1russell7/market";
import { tryParseUnit, type Quantity } from "@mark1russell7/quantity";
import {
  checkAt,
  done,
  field,
  httpsUrl,
  isRecord,
  list,
  observe,
  readMoney,
  refused,
  text,
  type Observation,
  type ParseResult,
  type Read,
} from "./parse.ts";

/** The name of the Kroger Products API as a source of offers. */
export const KROGER_SOURCE = "kroger";

/**
 * The terms of the Kroger APIs. Section 4(e) forbids a database or a permanent copy of the content, and a cache past
 * the cache header. Thus a reading serves one request, no store keeps it, and nothing models the prices.
 */
export const KROGER_TERMS: SourceTerms = {
  source: KROGER_SOURCE,
  retention: { kind: "no-store" },
  deleteWhenEnded: false,
  priceModel: false,
  clause:
    "Kroger Developer Terms of Service, last modified 2019-04-09, read on 2026-11-26, section 4(e): no database and no permanent copy of the content, and no cache past the cache header",
};

/** The site of the product pages. The field `productPageURI` of the API is a path on this site. */
const PRODUCT_SITE = "https://www.kroger.com";

/** A location id of the Kroger Locations API: 8 characters, for example `01400943`. */
const LOCATION_ID = /^[0-9A-Za-z]{8}$/;

/**
 * This function examines a location id.
 *
 * @throws RangeError when the location id is not 8 letters or digits.
 */
export function checkKrogerLocation(locationId: string): string {
  if (typeof locationId !== "string" || !LOCATION_ID.test(locationId)) {
    throw new RangeError(`The location id ${JSON.stringify(locationId)} is not 8 letters or digits.`);
  }
  return locationId;
}

const AVAILABILITY_BY_LEVEL: ReadonlyMap<string, Availability> = new Map<string, Availability>([
  ["HIGH", "in-stock"],
  ["LOW", "low-stock"],
  ["TEMPORARILY_OUT_OF_STOCK", "out-of-stock"],
]);

/** The fulfillment fields of an item, with their names in a spec, in a fixed order. */
const FULFILLMENT: readonly (readonly [string, string])[] = [
  ["instore", "in store"],
  ["curbside", "curbside"],
  ["delivery", "delivery"],
  ["shiptohome", "ship to home"],
];

/**
 * This function gives the GTIN-14 of a Kroger product id, or null. The id is the 13 digits of a barcode with no
 * check digit. An id with 7 zeros or more first is not a GTIN-8 or longer, for example a PLU code of produce. An id
 * with the GS1 prefix 02, 04 or 2 (restricted circulation) is a code of the store, for example an item by weight.
 */
export function krogerGtin(productId: unknown): string | null {
  const id = text(productId);
  if (id === undefined || !/^\d{13}$/.test(id)) return null;
  if (id.startsWith("0000000")) return null;
  const gtin13 = id.slice(1);
  if (/^(02|04|2)/.test(gtin13)) return null;
  return parseGtin(`${id}${gtinCheckDigit(id)}`);
}

function productUrl(value: unknown): string | undefined {
  const uri = text(value);
  if (uri === undefined || !uri.startsWith("/") || uri.startsWith("//")) return undefined;
  const query = uri.indexOf("?");
  return httpsUrl(`${PRODUCT_SITE}${query < 0 ? uri : uri.slice(0, query)}`);
}

function positiveUsd(value: unknown): Read<Quantity> | undefined {
  if (value === undefined || value === null || value === 0) return undefined;
  return readMoney(value, "USD");
}

/**
 * This function reads the average weight of one unit of a product, for example `8.62 [lb_av]`. The unit is a UCUM
 * code, and `@mark1russell7/quantity` reads it. The function gives undefined when the text is not a value above 0 and
 * a unit of mass.
 */
function averageWeight(product: Readonly<Record<string, unknown>>): Quantity | undefined {
  const weight = text(field(product["itemInformation"], "averageWeightPerUnit"));
  const match = weight === undefined ? null : /^(\d+(?:\.\d+)?) (\S+)$/.exec(weight);
  const parsed = match === null ? undefined : tryParseUnit(match[2] ?? "");
  const unit = parsed?.kind === "mass" ? parsed.symbol : undefined;
  const value = Number(match?.[1]);
  return unit === undefined || !(value > 0) ? undefined : { value, unit };
}

function specsOf(item: unknown): Spec[] {
  const specs: Spec[] = [];
  const size = text(field(item, "size"));
  if (size !== undefined) specs.push({ name: "size", value: size });
  const soldBy = text(field(item, "soldBy"));
  if (soldBy !== undefined) specs.push({ name: "sold by", value: soldBy.toLowerCase() });
  const fulfillment = field(item, "fulfillment");
  const ways = FULFILLMENT.filter(([key]) => field(fulfillment, key) === true).map(([, name]) => name);
  if (ways.length > 0) specs.push({ name: "fulfillment", value: ways.join(", ") });
  return specs;
}

function mapItem(
  product: Readonly<Record<string, unknown>>,
  item: unknown,
  where: string,
  locationId: string,
  at: string,
  notes: string[],
): Observation | undefined {
  const productId = text(product["productId"]);
  const itemId = text(field(item, "itemId")) ?? productId;
  if (!isRecord(item) || itemId === undefined) {
    notes.push(`The item ${where} is skipped: it is not an object with an itemId.`);
    return undefined;
  }
  const id = offerId(KROGER_SOURCE, `${itemId}@${locationId}`);
  const skip = (why: string): undefined => {
    notes.push(`The offer ${id} is skipped: ${why}.`);
    return undefined;
  };

  const title = text(product["description"]);
  if (title === undefined) return skip("it has no description");
  const byWeight = text(item["soldBy"])?.toLowerCase() === "weight";
  const price = field(item, "price");
  const regular = positiveUsd(field(price, byWeight ? "regularPerUnitEstimate" : "regular"));
  if (regular === undefined) {
    return skip(byWeight ? "it is sold by weight, and it has no estimated price of one unit" : "it has no price at the location");
  }
  if (!regular.ok) return skip(`its ${byWeight ? "estimated" : "regular"} price is not valid: ${regular.why}`);
  const promo = positiveUsd(field(price, byWeight ? "promoPerUnitEstimate" : "promo"));
  const sale = promo?.ok === true && promo.value.value < regular.value.value ? promo.value : undefined;
  const paid = sale ?? regular.value;
  const weight = byWeight ? averageWeight(product) : undefined;
  if (byWeight && weight === undefined) notes.push(`The offer ${id} has no average weight, thus it has no price for each unit of mass.`);
  const amountPrice = weight === undefined ? undefined : { value: paid.value / weight.value, unit: `${paid.unit}/${weight.unit}` };

  const stock = text(field(field(item, "inventory"), "stockLevel"));
  const availability = AVAILABILITY_BY_LEVEL.get(stock ?? "") ?? "unknown";
  const gtin = krogerGtin(product["upc"] ?? productId);

  return observe(
    {
      id,
      source: KROGER_SOURCE,
      sourceId: `${itemId}@${locationId}`,
      title,
      url: productUrl(product["productPageURI"]),
      seller: { id: locationId },
      condition: "new",
      format: "fixed-price",
      gtins: gtin === null ? [] : [gtin],
      partNumbers: [],
      specs: specsOf(item),
    },
    {
      offerId: id,
      at,
      price: paid,
      listPrice: sale === undefined ? undefined : regular.value,
      shipping: { kind: "unknown" },
      availability,
      ...(byWeight ? { estimate: true as const } : {}),
      ...(amountPrice === undefined ? {} : { amountPrice }),
    },
    notes,
  );
}

function mapProduct(product: unknown, where: string, locationId: string, at: string, notes: string[]): Observation[] {
  if (!isRecord(product)) {
    notes.push(`The product ${where} is skipped: it is not an object.`);
    return [];
  }
  const items = list(product["items"]);
  if (items === undefined || items.length === 0) {
    notes.push(`The product ${where} is skipped: it has no items.`);
    return [];
  }
  const observations: Observation[] = [];
  items.forEach((item: unknown, index) => {
    const observation = mapItem(product, item, `${where}.items[${index}]`, locationId, at, notes);
    if (observation !== undefined) observations.push(observation);
  });
  return observations;
}

/**
 * This function reads the answer of Product details of the Kroger Products API (`GET /v1/products/{id}`) at the
 * instant `at`. The request had the location id `locationId`, because the API gives a price only for a location.
 * Each item of the product is one offer at that location.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form, or the location id is not valid.
 */
export function parseKrogerProduct(answer: unknown, at: string, locationId: string): ParseResult {
  checkAt(at);
  checkKrogerLocation(locationId);
  if (!isRecord(answer)) return refused("The answer of Product details is not an object.");
  if (!isRecord(answer["data"])) return refused("The field data of the answer is not an object.");
  const notes: string[] = [];
  return done(mapProduct(answer["data"], "data", locationId, at, notes), notes);
}

/**
 * This function reads the answer of Product search of the Kroger Products API (`GET /v1/products`) at the instant
 * `at`. The request had the location id `locationId`. An answer with no results has an empty `data`.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form, or the location id is not valid.
 */
export function parseKrogerProducts(answer: unknown, at: string, locationId: string): ParseResult {
  checkAt(at);
  checkKrogerLocation(locationId);
  if (!isRecord(answer)) return refused("The answer of Product search is not an object.");
  const data = answer["data"];
  if (!Array.isArray(data)) return refused("The field data of the answer is not a list.");
  const notes: string[] = [];
  const observations: Observation[] = [];
  data.forEach((product: unknown, index) => {
    observations.push(...mapProduct(product, `data[${index}]`, locationId, at, notes));
  });
  return done(observations, notes);
}
