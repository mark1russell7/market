import { offerId, type PartNumber, type PriceBreak, type Seller, type SourceTerms, type Spec } from "@mark1russell7/market";
import type { Quantity } from "@mark1russell7/quantity";
import {
  checkAt,
  done,
  field,
  httpsUrl,
  isCurrency,
  isRecord,
  list,
  observe,
  path,
  readMoney,
  refused,
  show,
  text,
  wholeNumber,
  type Observation,
  type ParseResult,
} from "./parse.ts";

/** The name of the Digi-Key Product Information API v4 as a source of offers. */
export const DIGIKEY_SOURCE = "digikey";

/** The name of the seller of an offer that Digi-Key ships itself. */
export const DIGIKEY_SELLER = "Digi-Key";

/**
 * The terms of the Digi-Key Product Information API: nothing makes or updates a database of its data. Thus a
 * reading serves one request, and no store keeps it.
 */
export const DIGIKEY_TERMS: SourceTerms = {
  source: DIGIKEY_SOURCE,
  retention: { kind: "no-store" },
  deleteWhenEnded: false,
  priceModel: false,
  clause: "Digi-Key API User Agreement, section 5.1(e): no database of the information",
};

interface Break {
  readonly quantity: number;
  readonly unitPrice: Quantity;
}

function breaksOf(value: unknown, currency: string): Break[] {
  const breaks: Break[] = [];
  for (const entry of list(value) ?? []) {
    const quantity = wholeNumber(field(entry, "BreakQuantity"));
    const unitPrice = readMoney(field(entry, "UnitPrice"), currency);
    if (quantity === undefined || quantity < 1 || !unitPrice.ok) continue;
    if (!breaks.some((each) => each.quantity === quantity)) breaks.push({ quantity, unitPrice: unitPrice.value });
  }
  return breaks.sort((a, b) => a.quantity - b.quantity);
}

function sellerOf(variation: unknown): Seller {
  if (field(variation, "MarketPlace") !== true) return { name: DIGIKEY_SELLER };
  const supplierId = wholeNumber(path(variation, "Supplier", "Id"));
  const name = text(path(variation, "Supplier", "Name"));
  return {
    ...(supplierId === undefined ? {} : { id: String(supplierId) }),
    ...(name === undefined ? {} : { name }),
  };
}

function specsOf(product: Readonly<Record<string, unknown>>): Spec[] {
  const specs: Spec[] = [];
  for (const parameter of list(product["Parameters"]) ?? []) {
    const name = text(field(parameter, "ParameterText"));
    const value = text(field(parameter, "ValueText"));
    if (name !== undefined && value !== undefined) specs.push({ name, value });
  }
  const status = text(path(product, "ProductStatus", "Status"));
  if (status !== undefined) specs.push({ name: "Product status", value: status });
  return specs;
}

function mapProduct(product: unknown, where: string, currency: string, at: string, notes: string[]): Observation[] {
  if (!isRecord(product)) {
    notes.push(`The product ${where} is skipped: it is not an object.`);
    return [];
  }
  const title =
    text(path(product, "Description", "ProductDescription")) ??
    text(path(product, "Description", "DetailedDescription")) ??
    text(product["ManufacturerProductNumber"]);
  if (title === undefined) {
    notes.push(`The product ${where} is skipped: it has no description and no part number.`);
    return [];
  }
  const variations = list(product["ProductVariations"]) ?? [];
  if (variations.length === 0) notes.push(`The product ${where} has no ProductVariations, so it gives no offer.`);
  const brand = text(path(product, "Manufacturer", "Name"));
  const partNumber = text(product["ManufacturerProductNumber"]);
  const partNumbers: PartNumber[] = brand !== undefined && partNumber !== undefined ? [{ brand, partNumber }] : [];
  const specs = specsOf(product);
  const url = httpsUrl(product["ProductUrl"]);

  const observations: Observation[] = [];
  variations.forEach((variation: unknown, index) => {
    const sourceId = text(field(variation, "DigiKeyProductNumber"));
    if (sourceId === undefined) {
      notes.push(`The variation ${where}.ProductVariations[${index}] is skipped: it has no DigiKeyProductNumber.`);
      return;
    }
    const id = offerId(DIGIKEY_SOURCE, sourceId);
    const breaks = breaksOf(field(variation, "StandardPricing"), currency);
    const lowest = breaks[0];
    if (lowest === undefined) {
      notes.push(`The offer ${id} is skipped: it has no valid StandardPricing.`);
      return;
    }
    const minimum = Math.max(wholeNumber(field(variation, "MinimumOrderQuantity")) ?? 1, lowest.quantity, 1);
    const price = breaks.filter((each) => each.quantity <= minimum).at(-1) ?? lowest;
    const priceBreaks: PriceBreak[] = breaks.filter((each) => each.quantity > minimum);
    const available = wholeNumber(field(variation, "QuantityAvailableforPackageType"));
    const packageType = text(path(variation, "PackageType", "Name"));

    const observation = observe(
      {
        id,
        source: DIGIKEY_SOURCE,
        sourceId,
        title,
        url,
        seller: sellerOf(variation),
        condition: "new",
        format: "fixed-price",
        gtins: [],
        partNumbers,
        specs: packageType === undefined ? specs : [...specs, { name: "Package type", value: packageType }],
      },
      {
        offerId: id,
        at,
        price: price.unitPrice,
        shipping: { kind: "unknown" },
        availability: available === undefined ? "unknown" : available > 0 ? "in-stock" : "out-of-stock",
        available,
        minimumQuantity: minimum > 1 ? minimum : undefined,
        priceBreaks: priceBreaks.length > 0 ? priceBreaks : undefined,
      },
      notes,
    );
    if (observation !== undefined) observations.push(observation);
  });
  return observations;
}

function currencyOf(answer: Readonly<Record<string, unknown>>): string | ParseResult {
  const currency = text(path(answer, "SearchLocaleUsed", "Currency"));
  if (currency === undefined) return refused("The answer names no currency in SearchLocaleUsed.Currency.");
  if (!isCurrency(currency)) {
    return refused(`The currency ${show(currency)} of the answer is not a money unit of @mark1russell7/quantity.`);
  }
  return currency;
}

/**
 * This function reads the answer of `ProductDetails` of the Digi-Key Product Information API v4
 * (`GET /products/v4/search/{productNumber}/productdetails`) at the instant `at`. Each variation of the
 * product (a package type) gives one observation. The currency comes from `SearchLocaleUsed.Currency`.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseDigiKeyProductDetails(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of ProductDetails is not an object.");
  const currency = currencyOf(answer);
  if (typeof currency !== "string") return currency;
  if (!isRecord(answer["Product"])) return refused("The field Product of the answer is not an object.");
  const notes: string[] = [];
  return done(mapProduct(answer["Product"], "Product", currency, at, notes), notes);
}

/**
 * This function reads the answer of `KeywordSearch` of the Digi-Key Product Information API v4
 * (`POST /products/v4/search/keyword`) at the instant `at`. It reads the lists `Products` and `ExactMatches`,
 * and an offer in both lists counts once.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseDigiKeyKeywordSearch(answer: unknown, at: string): ParseResult {
  checkAt(at);
  if (!isRecord(answer)) return refused("The answer of KeywordSearch is not an object.");
  const currency = currencyOf(answer);
  if (typeof currency !== "string") return currency;
  const products = list(answer["Products"]);
  const exact = list(answer["ExactMatches"]);
  if (products === undefined && exact === undefined) return refused("The answer has no list Products and no list ExactMatches.");
  const notes: string[] = [];
  const observations = [
    ...(exact ?? []).flatMap((product, index) => mapProduct(product, `ExactMatches[${index}]`, currency, at, notes)),
    ...(products ?? []).flatMap((product, index) => mapProduct(product, `Products[${index}]`, currency, at, notes)),
  ];
  return done(observations, notes);
}
