/**
 * The generic parser of the plan lists of cloud providers. A plan list is an API that gives each plan of virtual
 * machines with its hourly price, its monthly cap and its regions. A `PlanProvider` record tells where the API keeps
 * each value. Thus a new provider is a record of data, and not new code.
 *
 * The parser gives one metered offer for each plan, region and price term. The meter `compute` counts the hours of
 * a month: the hourly price up to the monthly cap, then no price.
 */
import {
  offerId,
  priceTermSchema,
  sourceSchema,
  sourceTermsSchema,
  textSchema,
  type Meter,
  type MeteredObservation,
  type PriceTerm,
  type SourceTerms,
  type Spec,
} from "@mark1russell7/market";
import { canonicalUnit, rationals } from "@mark1russell7/quantity";
import { z } from "zod";
import {
  checkAt,
  decimal,
  field,
  isCurrency,
  isRecord,
  list,
  observeMetered,
  path,
  refused,
  show,
  text,
  wholeNumber,
  type MeteredParseResult,
  type Read,
} from "./parse.ts";

/** The name of the meter of each plan offer. It counts the hours of use in one month. */
export const PLAN_METER = "compute";

/** The name of the spec that the parser adds to each offer. Its value is the key of the price term. */
export const PLAN_PRICING_SPEC = "pricing";

/**
 * The paging of a list. With `page`, the query parameter `param` has the number of the page, and the field `pages`
 * of an answer has the count of pages. With `cursor`, the field `next` of an answer has the value of `param` for the
 * next page, and an empty value ends the list.
 */
export type PlanPaging =
  | { readonly kind: "none" }
  | { readonly kind: "page"; readonly param: string; readonly pages: string }
  | { readonly kind: "cursor"; readonly param: string; readonly next: string };

/** A list of an API: its path on the host, its query, the field of its items in an answer, and its paging. */
export interface PlanListRead {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly items: string;
  readonly paging: PlanPaging;
}

/**
 * The price of a plan on one term. Each field is a path of names with dots in a plan, for example `price.hourly`.
 * A plan has the term only when the field `when` is `true`. The fields `regionHourly` and `regionMonthly` are the
 * paths in a price of one region. Without them, the paths in the fields `hourly` and `monthly` of the term apply.
 */
export interface PlanTerm {
  readonly key: string;
  readonly term: PriceTerm;
  readonly when?: string | undefined;
  readonly hourly: string;
  readonly monthly?: string | undefined;
  readonly regionHourly?: string | undefined;
  readonly regionMonthly?: string | undefined;
}

/**
 * The regions of each plan. With `field`, a plan has a list of the ids of its regions. With `list`, a different
 * list of the API has one row for each plan and region. The field `available` of a row tells if the provider has
 * the plan in that region.
 */
export type PlanRegions =
  | { readonly kind: "field"; readonly path: string }
  | {
      readonly kind: "list";
      readonly read: PlanListRead;
      readonly plan: string;
      readonly region: string;
      readonly available: string;
    };

/**
 * The prices of a plan that change with the region. With `map`, an object of a plan has a price for each id of a
 * region. With `list`, a list of a plan has prices, each with the id of its region in the field `id`.
 */
export type PlanRegionPrices =
  | { readonly kind: "none" }
  | { readonly kind: "map"; readonly path: string }
  | { readonly kind: "list"; readonly path: string; readonly id: string };

/**
 * The list of the places of the regions of a provider. Each row has the id of a region at `id` and its country at
 * `country`, as a code of ISO 3166-1 alpha-2. The parser puts the country into the location of each offer.
 */
export interface PlanPlaces {
  readonly read: PlanListRead;
  readonly id: string;
  readonly country: string;
}

/** A spec of each offer: its name, the path of its value in a plan, and the unit that the parser adds to the value. */
export interface PlanSpec {
  readonly name: string;
  readonly path: string;
  readonly unit?: string | undefined;
}

/**
 * The record of a provider with a plan list. The parser and the client read the API with only this record. Each
 * path is a path of names with dots in an answer or in a plan.
 */
export interface PlanProvider {
  readonly source: string;
  readonly provider: string;
  readonly name: string;
  readonly host: string;
  readonly paceMs: number;
  readonly currency: string;
  readonly terms: SourceTerms;
  readonly plans: PlanListRead;
  readonly id: string;
  readonly label?: string | undefined;
  readonly regions: PlanRegions;
  readonly regionPrices: PlanRegionPrices;
  readonly places?: PlanPlaces | undefined;
  readonly prices: readonly PlanTerm[];
  readonly specs: readonly PlanSpec[];
}

/** The answers of one read of a provider: the pages of its plan list, of its list of regions and of its list of places. */
export interface PlanAnswers {
  readonly plans: readonly unknown[];
  readonly regions?: readonly unknown[] | undefined;
  readonly places?: readonly unknown[] | undefined;
}

const dottedSchema = z
  .string()
  .regex(/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/, "The path has names of letters, digits, _, $ and -, with a dot between two names.");

const paramSchema = z.string().regex(/^[A-Za-z0-9_.-]+$/, "The name of a query parameter has letters, digits, _, . and -.");

const pagingSchema: z.ZodType<PlanPaging> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("page"), param: paramSchema, pages: dottedSchema }),
  z.strictObject({ kind: z.literal("cursor"), param: paramSchema, next: dottedSchema }),
]);

const listReadSchema: z.ZodType<PlanListRead> = z.strictObject({
  path: z.string().regex(/^\/[A-Za-z0-9._~/-]*$/, "The path of a list starts with a slash, and it has no query."),
  query: z.record(paramSchema, z.string()),
  items: dottedSchema,
  paging: pagingSchema,
});

const termSchema: z.ZodType<PlanTerm> = z.strictObject({
  key: sourceSchema,
  term: priceTermSchema,
  when: dottedSchema.optional(),
  hourly: dottedSchema,
  monthly: dottedSchema.optional(),
  regionHourly: dottedSchema.optional(),
  regionMonthly: dottedSchema.optional(),
});

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * This schema accepts the record of a provider with a plan list. The terms are the terms of the source of the
 * record. Each price term has its own key, and each spec has its own name. The name `pricing` is for the parser.
 */
export const planProviderSchema: z.ZodType<PlanProvider> = z
  .strictObject({
    source: sourceSchema,
    provider: textSchema,
    name: textSchema,
    host: z.string().regex(HOST, "The host is a DNS name with small letters, digits, hyphens and dots."),
    paceMs: z.number().int().min(1),
    currency: z.string().refine(isCurrency, "The currency is not a money unit of @mark1russell7/quantity."),
    terms: sourceTermsSchema,
    plans: listReadSchema,
    id: dottedSchema,
    label: dottedSchema.optional(),
    regions: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("field"), path: dottedSchema }),
      z.strictObject({
        kind: z.literal("list"),
        read: listReadSchema,
        plan: dottedSchema,
        region: dottedSchema,
        available: dottedSchema,
      }),
    ]),
    regionPrices: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("none") }),
      z.strictObject({ kind: z.literal("map"), path: dottedSchema }),
      z.strictObject({ kind: z.literal("list"), path: dottedSchema, id: dottedSchema }),
    ]),
    places: z.strictObject({ read: listReadSchema, id: dottedSchema, country: dottedSchema }).optional(),
    prices: z.array(termSchema).min(1),
    specs: z.array(z.strictObject({ name: textSchema, path: dottedSchema, unit: textSchema.optional() })),
  })
  .superRefine((record, context) => {
    if (record.terms.source !== record.source) {
      context.addIssue({ code: "custom", message: `The terms are the terms of ${record.terms.source}, and not of ${record.source}.`, path: ["terms", "source"] });
    }
    const keys = record.prices.map((price) => price.key);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Two price terms have one key.", path: ["prices"] });
    const names = record.specs.map((spec) => spec.name);
    if (new Set(names).size !== names.length) context.addIssue({ code: "custom", message: "Two specs have one name.", path: ["specs"] });
    if (names.includes(PLAN_PRICING_SPEC)) {
      context.addIssue({ code: "custom", message: `The spec name ${PLAN_PRICING_SPEC} is for the parser.`, path: ["specs"] });
    }
  });

/** The result of a check of a provider record. */
export type PlanProviderRead = { readonly ok: true; readonly provider: PlanProvider } | { readonly ok: false; readonly problems: readonly string[] };

/** This function examines a provider record, for example a record from a JSON file. */
export function parsePlanProvider(value: unknown): PlanProviderRead {
  const checked = planProviderSchema.safeParse(value);
  if (checked.success) return { ok: true, provider: checked.data };
  return { ok: false, problems: checked.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`) };
}

/** This function gives the value at a path of names with dots, or undefined. */
function dig(value: unknown, dotted: string): unknown {
  return path(value, ...dotted.split("."));
}

/**
 * This function gives the address of one page of a list of a provider. `after` is the value of the paging parameter
 * of the page. Without it, the address is the address of the first page.
 */
export function planListUrl(provider: PlanProvider, read: PlanListRead, after?: string): string {
  const { paging } = read;
  const pairs = Object.entries(read.query).filter(([name]) => paging.kind === "none" || after === undefined || name !== paging.param);
  if (after !== undefined && paging.kind !== "none") pairs.push([paging.param, after]);
  const search = pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  return `https://${provider.host}${read.path}${search === "" ? "" : `?${search}`}`;
}

/**
 * The page after an answer. The kind `next` has the value of the paging parameter of the next page. The kind `end`
 * tells that the answer is the last page. The kind `fault` tells that the answer has no valid paging field.
 */
export type PlanNextPage =
  | { readonly kind: "next"; readonly after: string }
  | { readonly kind: "end" }
  | { readonly kind: "fault"; readonly why: string };

/**
 * This function gives the page after an answer. `page` is the number of the page of the answer, from 1. A paging
 * field that is missing or of a wrong type gives a fault, not the end. A part of a list gives wrong offers. A cursor
 * of empty text or null is the end.
 */
export function planNextPage(read: PlanListRead, answer: unknown, page: number): PlanNextPage {
  const { paging } = read;
  if (paging.kind === "none") return { kind: "end" };
  if (paging.kind === "page") {
    const raw = dig(answer, paging.pages);
    const pages = wholeNumber(raw);
    if (pages === undefined) return { kind: "fault", why: `The count of pages ${show(raw)} at ${show(paging.pages)} is not a whole number.` };
    return page < pages ? { kind: "next", after: String(page + 1) } : { kind: "end" };
  }
  const raw = dig(answer, paging.next);
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) return { kind: "end" };
  if (typeof raw !== "string") return { kind: "fault", why: `The cursor ${show(raw)} at ${show(paging.next)} is not text or null.` };
  // The cursor is opaque, so it goes back with no change.
  return { kind: "next", after: raw };
}

function itemsOf(pages: readonly unknown[], read: PlanListRead, what: string): Read<readonly unknown[]> {
  const items: unknown[] = [];
  for (const [index, page] of pages.entries()) {
    const found = list(dig(page, read.items));
    if (found === undefined) return { ok: false, why: `The page ${index + 1} of the ${what} has no list at ${show(read.items)}.` };
    items.push(...found);
  }
  return { ok: true, value: items };
}

/** This function gives the available regions of each plan id from the rows of a list of regions. */
function availability(
  rows: readonly unknown[],
  regions: Extract<PlanRegions, { kind: "list" }>,
  notes: string[],
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  let bad = 0;
  let off = 0;
  for (const row of rows) {
    const plan = text(dig(row, regions.plan));
    const region = text(dig(row, regions.region));
    const available = dig(row, regions.available);
    if (plan === undefined || region === undefined || typeof available !== "boolean") {
      bad += 1;
      continue;
    }
    if (!available) {
      off += 1;
      continue;
    }
    const found = map.get(plan);
    if (found === undefined) map.set(plan, [region]);
    else if (!found.includes(region)) found.push(region);
  }
  if (bad > 0) notes.push(`${bad} rows of the list of regions are skipped: each has no plan, no region or no ${show(regions.available)} of true or false.`);
  if (off > 0) notes.push(`${off} pairs of a plan and a region are not available.`);
  return map;
}

const COUNTRY = /^[A-Z]{2}$/;

/**
 * This function gives the country of each region id from the rows of a list of places. It changes a code to capital
 * letters. A row with no id or with no code of two letters is skipped. When two rows give two countries for one
 * region, the region gets no country.
 */
function countriesOf(rows: readonly unknown[], places: PlanPlaces, notes: string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const clash = new Set<string>();
  let bad = 0;
  for (const row of rows) {
    const region = text(dig(row, places.id));
    const country = text(dig(row, places.country))?.toUpperCase();
    if (region === undefined || country === undefined || !COUNTRY.test(country)) {
      bad += 1;
      continue;
    }
    const found = map.get(region);
    if (found !== undefined && found !== country) clash.add(region);
    else map.set(region, country);
  }
  for (const region of clash) map.delete(region);
  if (bad > 0) notes.push(`${bad} rows of the list of places are skipped: each has no region or no country of two letters.`);
  if (clash.size > 0) notes.push(`The regions ${[...clash].sort().join(", ")} have no country: the list of places gives two countries for each.`);
  return map;
}

function regionsOfItem(item: unknown, at: string): readonly string[] {
  const ids = (list(dig(item, at)) ?? []).map(text).filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

/** This function gives the price object of one region of a plan, or undefined when the plan has no price for that region. */
function regionPrice(item: unknown, prices: PlanRegionPrices, region: string): unknown {
  if (prices.kind === "none") return undefined;
  const found = dig(item, prices.path);
  if (prices.kind === "map") return isRecord(found) ? field(found, region) : undefined;
  return (list(found) ?? []).find((row) => text(dig(row, prices.id)) === region);
}

/** This function reads a price: the value at the path of the price of the region, else the value at the path of the plan. */
function priceOf(item: unknown, region: unknown, itemPath: string | undefined, regionPath: string | undefined): unknown {
  if (itemPath === undefined) return undefined;
  const fromRegion = region === undefined ? undefined : dig(region, regionPath ?? itemPath);
  return fromRegion ?? dig(item, itemPath);
}

/** This function gives the meter of an hourly price with a monthly cap. Above the cap, an hour has no price. */
function computeMeter(currency: string, hourly: number, monthly: number | undefined): Meter {
  const unit = canonicalUnit(`${currency}/h`);
  const tiers = [{ from: { value: 0, unit: "h" }, unitPrice: { value: hourly, unit } }];
  if (monthly !== undefined && monthly > 0 && hourly > 0) {
    const cap = rationals.toNumber(rationals.div(rationals.fromNumber(monthly), rationals.fromNumber(hourly)));
    tiers.push({ from: { value: cap, unit: "h" }, unitPrice: { value: 0, unit } });
  }
  return { name: PLAN_METER, tiers };
}

function specsOf(item: unknown, provider: PlanProvider, key: string): Spec[] {
  const specs: Spec[] = [];
  for (const spec of provider.specs) {
    const value = dig(item, spec.path);
    const shown = typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);
    if (shown === undefined) continue;
    specs.push({ name: spec.name, value: spec.unit === undefined ? shown : `${shown} ${spec.unit}` });
  }
  specs.push({ name: PLAN_PRICING_SPEC, value: key });
  return specs;
}

/** This function reads one price term of one plan in one region. */
function observationOf(
  provider: PlanProvider,
  item: unknown,
  plan: { readonly id: string; readonly title: string },
  term: PlanTerm,
  region: string,
  country: string | undefined,
  at: string,
  notes: string[],
): MeteredObservation | undefined {
  const sourceId = `${plan.id}/${region}/${term.key}`;
  const id = offerId(provider.source, sourceId);
  const price = regionPrice(item, provider.regionPrices, region);
  const rawHourly = priceOf(item, price, term.hourly, term.regionHourly);
  const hourly = decimal(rawHourly);
  if (hourly === undefined) {
    notes.push(`The offer ${id} is skipped: its hourly price ${show(rawHourly)} is not a number of 0 or more.`);
    return undefined;
  }
  const rawMonthly = priceOf(item, price, term.monthly, term.regionMonthly);
  const monthly = rawMonthly === undefined || rawMonthly === null ? undefined : decimal(rawMonthly);
  if (rawMonthly !== undefined && rawMonthly !== null && monthly === undefined) {
    notes.push(`The offer ${id} is skipped: its monthly price ${show(rawMonthly)} is not a number of 0 or more.`);
    return undefined;
  }
  // An hourly meter of price 0 cannot give a monthly price, and the offer would look free.
  if (hourly === 0 && monthly !== undefined && monthly > 0) {
    notes.push(`The offer ${id} is skipped: its hourly price is 0 and its monthly price is ${String(monthly)}.`);
    return undefined;
  }
  // A monthly price of 0 cannot be a cap above an hourly price, so the meter has no cap. The note shows the fault of the data.
  if (hourly > 0 && monthly === 0) notes.push(`The offer ${id} has no monthly cap: its monthly price is 0 and its hourly price is ${String(hourly)}.`);
  return observeMetered(
    {
      id,
      source: provider.source,
      sourceId,
      title: plan.title,
      location: { provider: provider.provider, region, ...(country === undefined ? {} : { country }) },
      term: term.term,
      specs: specsOf(item, provider, term.key),
    },
    { offerId: id, at, period: { value: 1, unit: "mo" }, meters: [computeMeter(provider.currency, hourly, monthly)] },
    notes,
  );
}

/**
 * This function reads the answers of a plan list at the instant `at`. It gives one metered offer for each plan,
 * available region and price term. A provider with regions of the kind `list` needs the pages of that list. A
 * provider with a list of places needs the pages of that list, and each offer gets the country of its region. The
 * result has no link of a next page: the client reads each page of a list before the parse.
 */
export function parsePlanLists(provider: PlanProvider, answers: PlanAnswers, at: string): MeteredParseResult {
  checkAt(at);
  const notes: string[] = [];
  const items = itemsOf(answers.plans, provider.plans, "plan list");
  if (!items.ok) return refused(items.why);
  const { regions } = provider;
  let available: ReadonlyMap<string, readonly string[]> | undefined;
  if (regions.kind === "list") {
    if (answers.regions === undefined || answers.regions.length === 0) {
      return refused(`The provider ${provider.source} reads its regions from a list, and the answers have no page of that list.`);
    }
    const rows = itemsOf(answers.regions, regions.read, "list of regions");
    if (!rows.ok) return refused(rows.why);
    available = availability(rows.value, regions, notes);
  }
  let countries: ReadonlyMap<string, string> | undefined;
  if (provider.places !== undefined) {
    if (answers.places === undefined || answers.places.length === 0) {
      return refused(`The provider ${provider.source} reads the countries of its regions from a list, and the answers have no page of that list.`);
    }
    const rows = itemsOf(answers.places, provider.places.read, "list of places");
    if (!rows.ok) return refused(rows.why);
    countries = countriesOf(rows.value, provider.places, notes);
  }
  const unplaced = new Set<string>();
  const observations: MeteredObservation[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.value.entries()) {
    const planId = text(dig(item, provider.id));
    if (planId === undefined) {
      notes.push(`The plan ${index + 1} is skipped: it has no text at ${show(provider.id)}.`);
      continue;
    }
    const label = provider.label === undefined ? undefined : text(dig(item, provider.label));
    const plan = { id: planId, title: `${provider.name} ${label ?? planId}` };
    const places = regions.kind === "field" ? regionsOfItem(item, regions.path) : (available?.get(planId) ?? []);
    if (places.length === 0) {
      notes.push(`The plan ${planId} has no offer: it has no available region.`);
      continue;
    }
    for (const term of provider.prices) {
      if (term.when !== undefined && dig(item, term.when) !== true) continue;
      for (const region of places) {
        const country = countries?.get(region);
        if (countries !== undefined && country === undefined) unplaced.add(region);
        const observation = observationOf(provider, item, plan, term, region, country, at, notes);
        if (observation === undefined || seen.has(observation.offer.id)) continue;
        seen.add(observation.offer.id);
        observations.push(observation);
      }
    }
  }
  if (unplaced.size > 0) notes.push(`The offers of the regions ${[...unplaced].sort().join(", ")} have no country.`);
  return { ok: true, observations, notes, next: null };
}
