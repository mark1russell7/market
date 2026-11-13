import {
  offerId,
  parseGtin,
  type Availability,
  type Condition,
  type PartNumber,
  type Shipping,
  type SourceTerms,
  type Spec,
} from "@mark1russell7/market";
import type { Quantity } from "@mark1russell7/quantity";
import {
  checkAt,
  decimal,
  done,
  field,
  httpsUrl,
  isRecord,
  list,
  observe,
  path,
  readMoney,
  refused,
  text,
  type Observation,
  type ParseResult,
} from "./parse.ts";

/** The name of the Best Buy Products API and Open Box API as a source of offers. */
export const BEST_BUY_SOURCE = "bestbuy";

/**
 * The terms of the Best Buy APIs: a cache keeps the content for 72 hours at most, and nothing analyzes the prices
 * of Best Buy for a third party.
 */
export const BEST_BUY_TERMS: SourceTerms = {
  source: BEST_BUY_SOURCE,
  retention: { kind: "max-age", age: { value: 72, unit: "h" } },
  deleteWhenEnded: false,
  priceModel: false,
  clause: "Best Buy API terms of 2021-02-23: no store or cache over 72 hours, and no price analysis for a third party",
};

/** The US APIs of Best Buy give each price in US dollars, and the answer names no currency. */
const CURRENCY = "USD";

/**
 * This function gives the condition of a product of the Best Buy Products API. The text `New` gives `new`, a
 * text with `refurbished` gives `refurbished`, and a pre-owned product gives `used`.
 */
export function bestBuyCondition(condition: unknown, preowned: unknown): Condition {
  const lower = text(condition)?.toLowerCase();
  if (lower !== undefined && lower.includes("refurb")) return "refurbished";
  if (preowned === true || (lower !== undefined && /pre-?owned|used/.test(lower))) return "used";
  if (lower === "new") return "new";
  return "unknown";
}

function skuOf(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  const candidate = text(value);
  return candidate !== undefined && /^\d+$/.test(candidate) ? candidate : undefined;
}

function listPriceOf(regular: unknown, price: Quantity): Quantity | undefined {
  const read = readMoney(regular, CURRENCY);
  return read.ok && read.value.value > price.value ? read.value : undefined;
}

function shippingOf(product: Readonly<Record<string, unknown>>): Shipping {
  if (product["freeShipping"] === true) return { kind: "free" };
  const cost = decimal(product["shippingCost"]);
  if (cost === undefined || cost === 0) return { kind: "unknown" };
  const money = readMoney(cost, CURRENCY);
  return money.ok ? { kind: "fixed", cost: money.value } : { kind: "unknown" };
}

function availabilityOf(product: Readonly<Record<string, unknown>>): Availability {
  if (product["active"] === false || product["onlineAvailability"] === false) return "out-of-stock";
  const orderable = text(product["orderable"]);
  if (orderable === "Available") return "in-stock";
  return orderable === undefined && product["onlineAvailability"] === true ? "in-stock" : "unknown";
}

function specsOf(value: unknown): Spec[] {
  const specs: Spec[] = [];
  for (const detail of list(value) ?? []) {
    const name = text(field(detail, "name"));
    const content = text(field(detail, "value"));
    if (name !== undefined && content !== undefined) specs.push({ name, value: content });
  }
  return specs;
}

function mapProduct(product: unknown, where: string, at: string, notes: string[]): Observation | undefined {
  if (!isRecord(product)) {
    notes.push(`The product ${where} is skipped: it is not an object.`);
    return undefined;
  }
  const sourceId = skuOf(product["sku"]);
  if (sourceId === undefined) {
    notes.push(`The product ${where} is skipped: it has no sku.`);
    return undefined;
  }
  const id = offerId(BEST_BUY_SOURCE, sourceId);
  const title = text(product["name"]);
  if (title === undefined) {
    notes.push(`The offer ${id} is skipped: it has no name.`);
    return undefined;
  }
  const price = readMoney(product["salePrice"], CURRENCY);
  if (!price.ok) {
    notes.push(`The offer ${id} is skipped: its salePrice is not valid: ${price.why}.`);
    return undefined;
  }

  const upc = text(product["upc"]);
  const gtin = upc === undefined ? null : parseGtin(upc);
  if (upc !== undefined && gtin === null) notes.push(`The offer ${id} has no GTIN: ${JSON.stringify(upc)} is not a valid UPC.`);
  const brand = text(product["manufacturer"]);
  const model = text(product["modelNumber"]);
  const partNumbers: PartNumber[] = brand !== undefined && model !== undefined ? [{ brand, partNumber: model }] : [];

  return observe(
    {
      id,
      source: BEST_BUY_SOURCE,
      sourceId,
      title,
      url: httpsUrl(product["url"]),
      seller: {},
      condition: bestBuyCondition(product["condition"], product["preowned"]),
      grade: text(product["condition"]),
      format: "fixed-price",
      gtins: gtin === null ? [] : [gtin],
      partNumbers,
      specs: specsOf(product["details"]),
    },
    {
      offerId: id,
      at,
      price: price.value,
      listPrice: listPriceOf(product["regularPrice"], price.value),
      shipping: shippingOf(product),
      availability: availabilityOf(product),
    },
    notes,
  );
}

/**
 * This function reads the answer of one product of the Best Buy Products API (`GET /v1/products/{sku}.json`) at
 * the instant `at`.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseBestBuyProduct(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of the product is not an object.");
  const notes: string[] = [];
  const observation = mapProduct(answer, "of the answer", at, notes);
  return done(observation === undefined ? [] : [observation], notes);
}

/**
 * This function reads the answer of a search of the Best Buy Products API (`GET /v1/products(...)?format=json`)
 * at the instant `at`. The answer has its products in the list `products`, in the page form and in the cursor form.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseBestBuyProducts(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of the search is not an object.");
  const products = list(answer["products"]);
  if (products === undefined) return refused("The field products of the answer is not a list.");
  const notes: string[] = [];
  const observations: Observation[] = [];
  products.forEach((product, index) => {
    const observation = mapProduct(product, `products[${index}]`, at, notes);
    if (observation !== undefined) observations.push(observation);
  });
  return done(observations, notes);
}

function availabilityOfOpenBox(offer: unknown): Availability {
  const online = field(offer, "onlineAvailability");
  if (online === true) return "in-stock";
  return online === false ? "out-of-stock" : "unknown";
}

function mapOpenBox(result: unknown, where: string, at: string, notes: string[]): Observation[] {
  if (!isRecord(result)) {
    notes.push(`The result ${where} is skipped: it is not an object.`);
    return [];
  }
  const sku = skuOf(result["sku"]);
  if (sku === undefined) {
    notes.push(`The result ${where} is skipped: it has no sku.`);
    return [];
  }
  const title = text(path(result, "names", "title"));
  if (title === undefined) {
    notes.push(`The result ${where} is skipped: it has no names.title.`);
    return [];
  }
  const url = httpsUrl(path(result, "links", "web"));
  const observations: Observation[] = [];
  (list(result["offers"]) ?? []).forEach((offer: unknown, index) => {
    const grade = text(field(offer, "condition"));
    const listing = text(field(offer, "listingId")) ?? grade;
    if (listing === undefined) {
      notes.push(`The offer ${where}.offers[${index}] is skipped: it has no listingId and no condition.`);
      return;
    }
    const sourceId = `${sku}/open-box/${listing}`;
    const id = offerId(BEST_BUY_SOURCE, sourceId);
    const price = readMoney(path(offer, "prices", "current"), CURRENCY);
    if (!price.ok) {
      notes.push(`The offer ${id} is skipped: its prices.current is not valid: ${price.why}.`);
      return;
    }
    const sellerId = text(field(offer, "sellerId"));
    const observation = observe(
      {
        id,
        source: BEST_BUY_SOURCE,
        sourceId,
        title,
        url,
        seller: sellerId === undefined ? {} : { id: sellerId },
        condition: "open-box",
        grade,
        format: "fixed-price",
        gtins: [],
        partNumbers: [],
        specs: [],
      },
      {
        offerId: id,
        at,
        price: price.value,
        listPrice: listPriceOf(path(offer, "prices", "regular"), price.value),
        shipping: { kind: "unknown" },
        availability: availabilityOfOpenBox(offer),
      },
      notes,
    );
    if (observation !== undefined) observations.push(observation);
  });
  return observations;
}

/**
 * This function reads the answer of the Best Buy Open Box API (`GET /beta/products/{sku}/openBox`, or a search of
 * `/beta/products/openBox(...)`) at the instant `at`. Each open-box offer of a SKU gives one observation, with the
 * source id `{sku}/open-box/{listingId}`.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseBestBuyOpenBox(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of the Open Box API is not an object.");
  const results = list(answer["results"]);
  if (results === undefined) {
    const empty = path(answer, "metadata", "resultSet", "count") === 0 && (answer["results"] ?? null) === null;
    return empty ? done([], []) : refused("The field results of the answer is not a list.");
  }
  const notes: string[] = [];
  const observations = results.flatMap((result, index) => mapOpenBox(result, `results[${index}]`, at, notes));
  return done(observations, notes);
}
