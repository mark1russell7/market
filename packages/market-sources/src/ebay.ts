import {
  offerId,
  parseGtin,
  type Availability,
  type Condition,
  type Format,
  type PartNumber,
  type Seller,
  type Shipping,
  type SourceTerms,
  type Spec,
} from "@mark1russell7/market";
import type { Quantity } from "@mark1russell7/quantity";
import {
  checkAt,
  compact,
  decimal,
  done,
  field,
  httpsUrl,
  instant,
  isRecord,
  list,
  observe,
  path,
  readMoney,
  refused,
  text,
  wholeNumber,
  type Observation,
  type ParseResult,
  type Read,
} from "./parse.ts";

/** The name of the eBay Browse API as a source of offers. */
export const EBAY_SOURCE = "ebay";

/**
 * The terms of the eBay Browse API. A display shows no data older than 6 hours. An application deletes the data of
 * an ended listing, and nothing models the prices of eBay.
 */
export const EBAY_TERMS: SourceTerms = {
  source: EBAY_SOURCE,
  retention: { kind: "max-age", age: { value: 6, unit: "h" } },
  deleteWhenEnded: true,
  priceModel: false,
  clause: "eBay API License Agreement of 2025-09-03, sections 8.1(b)(1), 8.1(c) and 9.5",
};

const CONDITIONS_BY_ID: ReadonlyMap<string, Condition> = new Map<string, Condition>([
  ["1000", "new"],
  ["1500", "open-box"],
  ["1750", "new"],
  ["2000", "refurbished"],
  ["2010", "refurbished"],
  ["2020", "refurbished"],
  ["2030", "refurbished"],
  ["2500", "refurbished"],
  ["2750", "used"],
  ["2990", "used"],
  ["3000", "used"],
  ["3010", "used"],
  ["4000", "used"],
  ["5000", "used"],
  ["6000", "used"],
  ["7000", "for-parts"],
]);

/**
 * This function gives the condition of an eBay condition id, for example `3000` gives `used`. An id that the
 * table of eBay does not have gives `unknown`.
 */
export function ebayCondition(conditionId: unknown): Condition {
  const id = typeof conditionId === "number" ? String(conditionId) : text(conditionId);
  return (id === undefined ? undefined : CONDITIONS_BY_ID.get(id)) ?? "unknown";
}

const AVAILABILITY_BY_STATUS: ReadonlyMap<string, Availability> = new Map<string, Availability>([
  ["IN_STOCK", "in-stock"],
  ["LIMITED_STOCK", "low-stock"],
  ["OUT_OF_STOCK", "out-of-stock"],
]);

const PLACEHOLDERS = new Set(["does not apply", "n/a", "na"]);

function real(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate === undefined || PLACEHOLDERS.has(candidate.toLowerCase()) ? undefined : candidate;
}

function convertedAmount(value: unknown): Read<Quantity> | undefined {
  if (value === undefined || value === null) return undefined;
  return readMoney(field(value, "value"), field(value, "currency"));
}

function formatOf(options: readonly unknown[] | undefined): Format | undefined {
  if (options === undefined || options.includes("FIXED_PRICE")) return "fixed-price";
  return options.includes("AUCTION") ? "auction" : undefined;
}

function shippingOf(options: readonly unknown[] | undefined, currency: string): Shipping {
  let cheapest: Quantity | undefined;
  let calculated = false;
  for (const option of options ?? []) {
    const type = text(field(option, "shippingCostType"));
    if (type === "CALCULATED") calculated = true;
    if (type !== "FIXED") continue;
    const cost = convertedAmount(field(option, "shippingCost"));
    if (cost === undefined || !cost.ok || cost.value.unit !== currency) continue;
    if (cheapest === undefined || cost.value.value < cheapest.value) cheapest = cost.value;
  }
  if (cheapest !== undefined) return cheapest.value === 0 ? { kind: "free" } : { kind: "fixed", cost: cheapest };
  return calculated ? { kind: "calculated" } : { kind: "unknown" };
}

function sellerOf(value: unknown): Seller {
  const percent = decimal(field(value, "feedbackPercentage"));
  const count = wholeNumber(field(value, "feedbackScore"));
  const rating = percent !== undefined && percent <= 100 && count !== undefined ? { percent, count } : undefined;
  return compact({ id: text(field(value, "userId")), name: text(field(value, "username")), rating });
}

function specsOf(value: unknown): Spec[] {
  const specs: Spec[] = [];
  for (const aspect of list(value) ?? []) {
    const name = text(field(aspect, "name"));
    const content = text(field(aspect, "value"));
    if (name !== undefined && content !== undefined) specs.push({ name, value: content });
  }
  return specs;
}

function mapItem(item: unknown, where: string, at: string, notes: string[]): Observation | undefined {
  if (!isRecord(item)) {
    notes.push(`The item ${where} is skipped: it is not an object.`);
    return undefined;
  }
  const sourceId = text(item["itemId"]);
  if (sourceId === undefined) {
    notes.push(`The item ${where} is skipped: it has no itemId.`);
    return undefined;
  }
  const id = offerId(EBAY_SOURCE, sourceId);
  const skip = (why: string): undefined => {
    notes.push(`The offer ${id} is skipped: ${why}.`);
    return undefined;
  };

  const title = text(item["title"]);
  if (title === undefined) return skip("it has no title");
  const options = list(item["buyingOptions"]);
  const format = formatOf(options);
  if (format === undefined) return skip(`its buying options ${(options ?? []).map(String).join(", ")} have no price to pay`);
  const endsAt = instant(item["itemEndDate"]);
  if (endsAt !== undefined && Date.parse(endsAt) <= Date.parse(at)) return skip(`the listing ended at ${endsAt}`);

  const price =
    format === "auction"
      ? (convertedAmount(item["currentBidPrice"]) ?? convertedAmount(item["price"]))
      : convertedAmount(item["price"]);
  if (price === undefined) return skip("it has no price");
  if (!price.ok) return skip(`its price is not valid: ${price.why}`);

  const original = format === "fixed-price" ? convertedAmount(path(item, "marketingPrice", "originalPrice")) : undefined;
  const listPrice =
    original?.ok === true && original.value.unit === price.value.unit && original.value.value > price.value.value
      ? original.value
      : undefined;

  const estimate = (list(item["estimatedAvailabilities"]) ?? []).find(isRecord);
  const availability = AVAILABILITY_BY_STATUS.get(text(field(estimate, "estimatedAvailabilityStatus")) ?? "") ?? "unknown";
  let available =
    text(field(estimate, "availabilityThresholdType")) === undefined
      ? wholeNumber(field(estimate, "estimatedAvailableQuantity"))
      : undefined;
  if (available !== undefined && availability !== "unknown" && (availability === "out-of-stock") !== (available === 0)) {
    notes.push(`The offer ${id} has no count: the count ${available} does not agree with ${availability}.`);
    available = undefined;
  }

  const gtinText = text(item["gtin"]);
  const gtin = gtinText === undefined ? null : parseGtin(gtinText);
  if (gtinText !== undefined && gtin === null && /\d/.test(gtinText)) {
    notes.push(`The offer ${id} has no GTIN: ${JSON.stringify(gtinText)} is not a valid GTIN.`);
  }
  const brand = real(item["brand"]);
  const mpn = real(item["mpn"]);
  const partNumbers: PartNumber[] = brand !== undefined && mpn !== undefined ? [{ brand, partNumber: mpn }] : [];

  return observe(
    {
      id,
      source: EBAY_SOURCE,
      sourceId,
      title,
      url: httpsUrl(item["itemWebUrl"]),
      seller: sellerOf(item["seller"]),
      condition: ebayCondition(item["conditionId"]),
      grade: text(item["condition"]),
      format,
      endsAt,
      gtins: gtin === null ? [] : [gtin],
      partNumbers,
      specs: specsOf(item["localizedAspects"]),
    },
    {
      offerId: id,
      at,
      price: price.value,
      listPrice,
      shipping: shippingOf(list(item["shippingOptions"]), price.value.unit),
      availability,
      available,
    },
    notes,
  );
}

/**
 * This function reads the answer of `getItem` of the eBay Browse API (`GET /buy/browse/v1/item/{item_id}`)
 * at the instant `at`. It gives one observation, or a note when the item does not map to an offer.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseEbayItem(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of getItem is not an object.");
  const notes: string[] = [];
  const observation = mapItem(answer, "of the answer", at, notes);
  return done(observation === undefined ? [] : [observation], notes);
}

/**
 * This function reads the answer of `search` of the eBay Browse API (`GET /buy/browse/v1/item_summary/search`)
 * at the instant `at`. An answer with no results has the `total` 0 and no `itemSummaries`, and it gives no
 * observations.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseEbaySearch(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of search is not an object.");
  const summaries = answer["itemSummaries"];
  if ((summaries === undefined || summaries === null) && answer["total"] === 0) return done([], []);
  if (!Array.isArray(summaries)) return refused("The field itemSummaries of the answer is not a list, and total is not 0.");
  const notes: string[] = [];
  const observations: Observation[] = [];
  summaries.forEach((summary: unknown, index) => {
    const observation = mapItem(summary, `itemSummaries[${index}]`, at, notes);
    if (observation !== undefined) observations.push(observation);
  });
  return done(observations, notes);
}
