import {
  meteredKindOf,
  offerId,
  type Meter,
  type MeteredObservation,
  type PriceTerm,
  type SourceTerms,
  type Spec,
} from "@mark1russell7/market";
import { canonicalUnit, rationals } from "@mark1russell7/quantity";
import {
  checkAt,
  decimal,
  field,
  isCurrency,
  isRecord,
  list,
  observeMetered,
  refused,
  show,
  text,
  type MeteredParseResult,
} from "./parse.ts";
import { azureRegion } from "./azure-regions.ts";
import { azureVmSize } from "./azure-sizes.ts";

/** The name of the Azure Retail Prices API as a source of metered offers. */
export const AZURE_SOURCE = "azure";

// The location of an offer in a region. A region of `AZURE_REGION_TABLE` also gives its country.
function locationOf(region: string): { provider: string; region: string; country?: string } {
  const country = azureRegion(region)?.country;
  return country === undefined ? { provider: AZURE_PROVIDER, region } : { provider: AZURE_PROVIDER, region, country };
}

/** The provider of the location of each offer of the Azure Retail Prices API. */
export const AZURE_PROVIDER = "azure";

/**
 * The terms of the Azure Retail Prices API. The API needs no key, and its documentation names tools for internal
 * analysis and price comparison. The Microsoft APIs Terms of Use permit copies only for the use of the
 * application, and they forbid redistribution and resale of the data.
 */
export const AZURE_TERMS: SourceTerms = {
  source: AZURE_SOURCE,
  retention: { kind: "keep" },
  deleteWhenEnded: false,
  priceModel: true,
  clause:
    "Azure Retail Prices REST API overview, read on 2026-11-18, and Microsoft APIs Terms of Use of October 2025, sections 3(b)(4) and 3(b)(14): copies only as the application needs them, and no redistribution or resale",
};

/** The address of the Azure Retail Prices API. */
export const AZURE_PRICES_URL = "https://prices.azure.com/api/retail/prices";

/** The version of the API that the request builder asks for. Only this version gives the prices of savings plans. */
export const AZURE_API_VERSION = "2023-01-01-preview";

/** The fields of a filter of the Azure Retail Prices API, from its documentation. */
export const AZURE_FILTER_FIELDS = [
  "armRegionName",
  "location",
  "meterId",
  "meterName",
  "productId",
  "skuId",
  "productName",
  "skuName",
  "serviceName",
  "serviceId",
  "serviceFamily",
  "priceType",
  "armSkuName",
] as const;

/** A field of a filter of the Azure Retail Prices API. */
export type AzureFilterField = (typeof AZURE_FILTER_FIELDS)[number];

/** A filter of the Azure Retail Prices API: the value of each field. The API compares each value with its case. */
export type AzureFilter = { readonly [Field in AzureFilterField]?: string };

/** A unit of measure of the API: the count of units that one price buys, and the unit of `@mark1russell7/quantity`. */
export interface AzureUnit {
  readonly count: number;
  readonly unit: string;
}

/** The longest value of a field of a filter, in code units. */
const FILTER_VALUE_LIMIT = 200;

/**
 * This function gives the URL of a read of the Azure Retail Prices API with a filter. Each field of the filter
 * gives the term `field eq 'value'`, and the terms join with `and`. Without a currency, the API gives US dollars.
 *
 * @throws RangeError when the filter has no field, or a field that the API does not filter. It also throws when a
 * value is empty, has a space at an end, has a control character or has more than 200 characters. A currency that
 * `@mark1russell7/quantity` does not have also gives a `RangeError`.
 */
export function azurePricesUrl(filter: AzureFilter, currency?: string): string {
  const fields: readonly string[] = AZURE_FILTER_FIELDS;
  const other = Object.keys(filter).find((name) => !fields.includes(name));
  if (other !== undefined) throw new RangeError(`The API does not filter the field ${show(other)}.`);
  const terms: string[] = [];
  for (const name of AZURE_FILTER_FIELDS) {
    const value: unknown = filter[name];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      value === "" ||
      value !== value.trim() ||
      value.length > FILTER_VALUE_LIMIT ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new RangeError(
        `The value of the field ${name} is not a text of 1 to ${FILTER_VALUE_LIMIT} characters with no control character and no space at an end.`,
      );
    }
    terms.push(`${name} eq '${value.replaceAll("'", "''")}'`);
  }
  if (terms.length === 0) throw new RangeError("The filter has no field. A read of each price of Azure is a large crawl.");
  const query = [`api-version=${AZURE_API_VERSION}`];
  if (currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(currency) || !isCurrency(currency)) {
      throw new RangeError(`The currency ${show(currency)} is not a money unit of @mark1russell7/quantity.`);
    }
    query.push(`currencyCode=${encodeURIComponent(`'${currency}'`)}`);
  }
  query.push(`$filter=${encodeURIComponent(terms.join(" and "))}`);
  return `${AZURE_PRICES_URL}?${query.join("&")}`;
}

/**
 * The pattern of a link to the Azure Retail Prices API: `https`, the host `prices.azure.com`, no port or the port 443,
 * the path `/api/retail/prices` and an optional query. The pattern refuses a user name, a password and a fragment.
 */
const AZURE_PRICES_LINK = /^https:\/\/prices\.azure\.com(?::443)?\/api\/retail\/prices(?:\?[^#\s]*)?$/;

/** This function tells if a link goes to the Azure Retail Prices API (`AZURE_PRICES_LINK`). */
export function isAzurePricesUrl(link: string): boolean {
  return AZURE_PRICES_LINK.test(link);
}

/** This function gives the link of the next page of an answer, or null. A link to another address gives null. */
export function azureNextPage(answer: unknown): string | null {
  const link = text(field(answer, "NextPageLink"));
  return link !== undefined && isAzurePricesUrl(link) ? link : null;
}

/** The words of an amount in a unit of measure, and their units. A GB of Azure is 2^30 bytes, thus a GiB. */
const AMOUNT_WORDS: Readonly<Record<string, string>> = {
  Second: "s",
  Seconds: "s",
  Minute: "min",
  Minutes: "min",
  Hour: "h",
  Hours: "h",
  Day: "d",
  Days: "d",
  Month: "mo",
  Months: "mo",
  Year: "yr",
  Years: "yr",
  KB: "KiB",
  KiB: "KiB",
  MB: "MiB",
  MiB: "MiB",
  GB: "GiB",
  GiB: "GiB",
  TB: "TiB",
  TiB: "TiB",
};

/** The words of a time after the slash of a unit of measure, and their units. */
const PER_WORDS: Readonly<Record<string, string>> = { Second: "s", Minute: "min", Hour: "h", Day: "d", Month: "mo", Year: "yr" };

/** A unit of measure: a count with `K` or `M`, a word of an amount, and `/` and a time. Only the count is necessary. */
const UNIT_OF_MEASURE = /^([1-9][0-9]{0,8})([KM]?)(?: ([A-Za-z]+))?(?:\/([A-Za-z]+))?$/;

/**
 * This function gives the unit of a unit of measure of the API, or undefined when the parser does not know it. A
 * count with no word gives `{count}`, for example `10K` gives 10,000 of `{count}`. A word of data or time gives
 * its unit, and `/Month` multiplies it by a month. Only `1/Hour` and `1/Month` give a time alone.
 */
export function azureUnit(unitOfMeasure: string): AzureUnit | undefined {
  const match = UNIT_OF_MEASURE.exec(unitOfMeasure);
  if (match === null) return undefined;
  const [, digits = "", multiplier = "", word, per] = match;
  const count = Number(digits) * (multiplier === "K" ? 1000 : multiplier === "M" ? 1_000_000 : 1);
  const amount = word === undefined ? undefined : AMOUNT_WORDS[word];
  const time = per === undefined ? undefined : PER_WORDS[per];
  if ((word !== undefined && amount === undefined) || (per !== undefined && time === undefined)) return undefined;
  let unit: string;
  if (amount !== undefined) unit = time === undefined ? amount : `${amount}·${time}`;
  else if (time !== undefined && count === 1) unit = time;
  else unit = time === undefined ? "{count}" : `{count}·${time}`;
  try {
    meteredKindOf(priceUnit("USD", unit));
  } catch {
    return undefined;
  }
  return { count, unit };
}

function priceUnit(currency: string, unit: string): string {
  return canonicalUnit(unit.includes("·") ? `${currency}/(${unit})` : `${currency}/${unit}`);
}

/** This function gives the exact price of one unit, from the price of `count` units, as the nearest number. */
function perUnit(price: number, count: number): number {
  return rationals.toNumber(rationals.div(rationals.fromNumber(price), rationals.fromNumber(count)));
}

/** A row of an answer that the parser read. */
interface Row {
  readonly where: string;
  readonly region: string;
  readonly skuId: string;
  readonly meterId: string;
  readonly meterName: string;
  readonly unitOfMeasure: string;
  readonly unit: AzureUnit;
  readonly currency: string;
  readonly start: number;
  readonly price: number;
  readonly type: string;
  readonly title: string;
  readonly spot: boolean;
  readonly specs: readonly Spec[];
  readonly item: Readonly<Record<string, unknown>>;
}

/** One offer that a row gives: its term, the price of its tier, and the upfront money of a reservation. */
interface Variant {
  readonly key: string;
  readonly term: PriceTerm;
  readonly title: string;
  readonly price: number;
  readonly upfront?: number;
}

interface MeterDraft {
  readonly meterId: string;
  readonly meterName: string;
  readonly unit: AzureUnit;
  readonly tiers: Map<number, number>;
  problem?: string;
}

interface OfferDraft {
  readonly sourceId: string;
  readonly region: string;
  readonly title: string;
  readonly term: PriceTerm;
  readonly specs: readonly Spec[];
  readonly currency: string;
  readonly upfront: number | undefined;
  readonly meters: Map<string, MeterDraft>;
}

/** The text of a spot term at the end of a SKU name: `Spot`, or `Low Priority` of the older VMs that Azure can end. */
const SPOT = /(?:^|\s)(?:Spot|Low Priority)$/;

/** A term of a reservation or of a savings plan: `1 Year`, `3 Years` or `10 Years`. */
const YEARS = /^([1-9][0-9]?) Years?$/;

function yearsOf(value: unknown): number | undefined {
  const match = YEARS.exec(text(value) ?? "");
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * The fields of a row that each offer keeps as specs. The spec `pricing` adds the key of the term of the offer. A row of
 * the service `Virtual Machines` also gets the specs `vcpu` and `memory` from `AZURE_VM_SIZE_TABLE` by its `armSkuName`, and
 * the spec `os` from `azureVmOs`.
 */
const SPEC_FIELDS = ["serviceName", "serviceFamily", "productName", "skuName", "armSkuName", "location"] as const;

/**
 * This function gives the operating system of a row of the service `Virtual Machines` from its product name: `windows`
 * or `linux`. The price of a machine with a Windows license is in a product with the word `Windows` in its name. The
 * price of each other product of the service has no license of an operating system, thus the machine runs Linux.
 */
export function azureVmOs(productName: string): "windows" | "linux" {
  return /\bWindows\b/u.test(productName) ? "windows" : "linux";
}

function readRow(item: unknown, where: string, notes: string[]): Row | undefined {
  if (!isRecord(item)) {
    notes.push(`The row ${where} is skipped: it is not an object.`);
    return undefined;
  }
  const skuId = text(item["skuId"]);
  const meterId = text(item["meterId"]);
  const meterName = text(item["meterName"]);
  const region = text(item["armRegionName"]) ?? text(item["location"]);
  const product = text(item["productName"]);
  const sku = text(item["skuName"]);
  const type = text(item["type"]);
  if (
    skuId === undefined ||
    meterId === undefined ||
    meterName === undefined ||
    region === undefined ||
    product === undefined ||
    sku === undefined ||
    type === undefined
  ) {
    const fields = { skuId, meterId, meterName, armRegionName: region, productName: product, skuName: sku, type };
    const missing = Object.entries(fields).filter(([, value]) => value === undefined);
    notes.push(`The row ${where} is skipped: it has no ${missing.map(([name]) => name).join(", ")}.`);
    return undefined;
  }
  const unitOfMeasure = text(item["unitOfMeasure"]) ?? "";
  const unit = azureUnit(unitOfMeasure);
  if (unit === undefined) {
    notes.push(`The row ${where} is skipped: the parser does not know the unit of measure ${show(unitOfMeasure)}.`);
    return undefined;
  }
  const currency = text(item["currencyCode"]);
  if (currency === undefined || !isCurrency(currency)) {
    notes.push(`The row ${where} is skipped: the currency ${show(item["currencyCode"])} is not a money unit of @mark1russell7/quantity.`);
    return undefined;
  }
  const start = decimal(item["tierMinimumUnits"]);
  const price = decimal(item["retailPrice"]);
  if (start === undefined || price === undefined) {
    const name = start === undefined ? "tierMinimumUnits" : "retailPrice";
    notes.push(`The row ${where} is skipped: its ${name} ${show(item[name])} is not a decimal of zero or more.`);
    return undefined;
  }
  const specs: Spec[] = [];
  for (const name of SPEC_FIELDS) {
    const value = text(item[name]);
    if (value !== undefined) specs.push({ name, value });
  }
  const size = text(item["serviceName"]) === "Virtual Machines" ? azureVmSize(text(item["armSkuName"])) : undefined;
  if (size !== undefined) specs.push({ name: "vcpu", value: String(size.vcpu) }, { name: "memory", value: `${size.memoryGiB} GiB` });
  if (text(item["serviceName"]) === "Virtual Machines") specs.push({ name: "os", value: azureVmOs(product) });
  const spot = SPOT.test(sku);
  return { where, region, skuId, meterId, meterName, unitOfMeasure, unit, currency, start, price, type, title: `${product}, ${sku}`, spot, specs, item };
}

function variantsOf(row: Row, notes: string[]): Variant[] {
  const base: PriceTerm = row.spot ? { kind: "spot" } : { kind: "on-demand" };
  if (row.type === "DevTestConsumption") return [{ key: "dev-test", term: base, title: `${row.title}, Dev/Test`, price: row.price }];
  if (row.type === "Reservation") {
    const years = yearsOf(row.item["reservationTerm"]);
    if (years === undefined) {
      notes.push(`The row ${row.where} is skipped: its reservationTerm ${show(row.item["reservationTerm"])} is not a count of years.`);
      return [];
    }
    const term: PriceTerm = { kind: "committed", length: { value: years, unit: "yr" } };
    return [{ key: `reservation-${years}y`, term, title: `${row.title}, ${years}-year reservation`, price: 0, upfront: row.price }];
  }
  if (row.type !== "Consumption") {
    notes.push(`The row ${row.where} is skipped: its type ${show(row.type)} is not a type of the documentation.`);
    return [];
  }
  const variants: Variant[] = [{ key: "consumption", term: base, title: row.title, price: row.price }];
  const plans = row.item["savingsPlan"];
  (list(plans) ?? []).forEach((plan, index) => {
    const years = yearsOf(field(plan, "term"));
    const price = decimal(field(plan, "retailPrice"));
    if (years === undefined || price === undefined) {
      notes.push(`The savings plan ${row.where}.savingsPlan[${index}] is skipped: it has no term in years or no retailPrice.`);
      return;
    }
    const term: PriceTerm = { kind: "committed", length: { value: years, unit: "yr" } };
    variants.push({ key: `savings-plan-${years}y`, term, title: `${row.title}, ${years}-year savings plan`, price });
  });
  if (plans !== undefined && plans !== null && list(plans) === undefined) {
    notes.push(`The field savingsPlan of the row ${row.where} is not a list, and the parser does not read it.`);
  }
  return variants;
}

function addRow(row: Row, drafts: Map<string, OfferDraft>, notes: string[]): void {
  for (const variant of variantsOf(row, notes)) {
    const sourceId = `${row.region}/${row.skuId}/${variant.key}`;
    let draft = drafts.get(sourceId);
    if (draft === undefined) {
      draft = {
        sourceId,
        region: row.region,
        title: variant.title,
        term: variant.term,
        specs: [...row.specs, { name: "pricing", value: variant.key }],
        currency: row.currency,
        upfront: variant.upfront,
        meters: new Map(),
      };
      drafts.set(sourceId, draft);
    } else if (draft.currency !== row.currency) {
      notes.push(`The row ${row.where} is skipped: its currency ${row.currency} is not the currency of the offer ${offerId(AZURE_SOURCE, sourceId)}.`);
      continue;
    } else if (variant.upfront !== undefined) {
      notes.push(`The row ${row.where} is skipped: it repeats the reservation ${offerId(AZURE_SOURCE, sourceId)}.`);
      continue;
    }
    const key = `${row.meterId}\u0000${row.meterName}\u0000${row.unitOfMeasure}`;
    let meter = draft.meters.get(key);
    if (meter === undefined) {
      meter = { meterId: row.meterId, meterName: row.meterName, unit: row.unit, tiers: new Map() };
      draft.meters.set(key, meter);
    }
    if (row.start !== 0 && row.unit.count !== 1) {
      meter.problem = `a tier starts at ${row.start} of the unit of measure ${row.unitOfMeasure}, and the documentation does not tell the unit of the start`;
    }
    const known = meter.tiers.get(row.start);
    if (known !== undefined && known !== variant.price) {
      meter.problem = `two rows give the tier at ${row.start} the prices ${known} and ${variant.price}`;
    }
    meter.tiers.set(row.start, variant.price);
  }
}

function meterOf(draft: OfferDraft, meter: MeterDraft, name: string, id: string, notes: string[]): Meter | undefined {
  if (meter.problem !== undefined) {
    notes.push(`The meter ${show(meter.meterName)} of the offer ${id} is skipped: ${meter.problem}.`);
    return undefined;
  }
  const starts = [...meter.tiers.keys()].sort((a, b) => a - b);
  if (starts[0] !== 0) {
    notes.push(`The meter ${show(meter.meterName)} of the offer ${id} is skipped: it has no tier that starts at 0.`);
    return undefined;
  }
  const unitPrice = priceUnit(draft.currency, meter.unit.unit);
  return {
    name,
    tiers: starts.map((start) => ({
      from: { value: start, unit: meter.unit.unit },
      unitPrice: { value: perUnit(meter.tiers.get(start) ?? 0, meter.unit.count), unit: unitPrice },
    })),
  };
}

function observationOf(draft: OfferDraft, at: string, notes: string[]): MeteredObservation | undefined {
  const id = offerId(AZURE_SOURCE, draft.sourceId);
  const names = new Map<string, number>();
  for (const meter of draft.meters.values()) names.set(meter.meterName, (names.get(meter.meterName) ?? 0) + 1);
  const meters: Meter[] = [];
  for (const meter of draft.meters.values()) {
    const name = (names.get(meter.meterName) ?? 0) > 1 ? `${meter.meterName} (${meter.meterId})` : meter.meterName;
    const read = meterOf(draft, meter, name, id, notes);
    if (read !== undefined) meters.push(read);
  }
  if (meters.length === 0) {
    notes.push(`The offer ${id} is skipped: it has no meter with a valid price.`);
    return undefined;
  }
  return observeMetered(
    {
      id,
      source: AZURE_SOURCE,
      sourceId: draft.sourceId,
      title: draft.title,
      location: locationOf(draft.region),
      term: draft.term,
      specs: [...draft.specs],
    },
    {
      offerId: id,
      at,
      period: { value: 1, unit: "mo" },
      meters,
      upfront: draft.upfront === undefined ? undefined : { value: draft.upfront, unit: draft.currency },
    },
    notes,
  );
}

/**
 * This function reads one page of the Azure Retail Prices API (`GET /api/retail/prices`) at the instant `at`.
 * The prices of one SKU can continue on the next page: `parseAzureRetailPricePages` reads all the pages together.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseAzureRetailPrices(answer: unknown, at: string): MeteredParseResult {
  return parseAzureRetailPricePages([answer], at);
}

/**
 * This function reads the pages of one read of the Azure Retail Prices API at the instant `at`. Each SKU in a
 * region on a term gives one offer, with a meter for each meter of the SKU. The `next` of the result is the link
 * of the last page.
 *
 * @throws RangeError when `at` is not an instant in UTC in the ISO 8601 form.
 */
export function parseAzureRetailPricePages(answers: readonly unknown[], at: string): MeteredParseResult {
  checkAt(at);
  if (answers.length === 0) return refused("The read has no page.");
  const notes: string[] = [];
  const drafts = new Map<string, OfferDraft>();
  const rows: Row[] = [];
  for (const [index, answer] of answers.entries()) {
    const label = answers.length === 1 ? "The answer" : `The page ${index + 1}`;
    if (!isRecord(answer)) return refused(`${label} is not an object.`);
    const items = list(answer["Items"]);
    if (items === undefined) return refused(`The field Items of ${label.toLowerCase()} is not a list.`);
    const prefix = answers.length === 1 ? "" : `page ${index + 1}, `;
    items.forEach((item, row) => {
      const read = readRow(item, `${prefix}Items[${row}]`, notes);
      if (read !== undefined) rows.push(read);
    });
  }
  for (const row of rows) addRow(row, drafts, notes);
  const observations: MeteredObservation[] = [];
  for (const draft of drafts.values()) {
    const observation = observationOf(draft, at, notes);
    if (observation !== undefined) observations.push(observation);
  }
  const last = answers[answers.length - 1];
  const next = azureNextPage(last);
  const link = field(last, "NextPageLink");
  if (next === null && text(link) !== undefined) {
    notes.push(`The link of the next page ${show(link)} does not go to the Azure Retail Prices API, and the result has no link.`);
  }
  return { ok: true, observations, notes, next };
}
