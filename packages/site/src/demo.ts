import {
  bestOffer,
  gtinCheckDigit,
  isKept,
  keepUntil,
  matchKeys,
  offersOfPart,
  offersPart,
  parseGtin,
  permitsHistory,
  permitsTrend,
  unitPriceFor,
  type Availability,
  type Condition,
  type Observation,
  type OfferChoice,
  type PartWant,
  type SourceTerms,
} from "@mark1russell7/market";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { labelOf, SAMPLE_AT, SAMPLE_OFFERS, SAMPLE_OLDER, SAMPLE_TERMS, SAMPLE_WANT } from "./demo-data.ts";

/** The currency of the buyer of the demo. */
export const CURRENCY = "USD";

/** The largest count of an order in the demo. */
export const MAX_COUNT = 120;

/** The largest age of a reading in the demo, in hours. */
export const MAX_AGE = 48;

/** The conditions that a visitor can accept, in the order of the page. */
export const OFFERED_CONDITIONS: readonly Condition[] = ["new", "refurbished", "used"];

/** The state of the demo: each choice of the visitor. The address of the page keeps it. */
export interface DemoState {
  /** The count of units of the order, from 1 to `MAX_COUNT`. */
  readonly count: number;
  /** The conditions that the buyer accepts. */
  readonly conditions: readonly Condition[];
  /** The part number of the want. */
  readonly part: string;
  /** The text of the GTIN check. */
  readonly code: string;
  /** The age of a reading for the storage rules, in hours. */
  readonly age: number;
  /** True when the offer of the reading ended. */
  readonly ended: boolean;
}

/** The state of a first visit. */
export const DEFAULT_STATE: DemoState = {
  count: 1,
  conditions: ["new"],
  part: SAMPLE_WANT.partNumbers[0] ?? "",
  code: "0 12345 67890 5",
  age: 12,
  ended: false,
};

const clampInt = (text: string | null, min: number, max: number, fallback: number): number => {
  if (text === null || !/^\d+$/.test(text)) return fallback;
  return Math.min(max, Math.max(min, Number(text)));
};

/** This function reads the state from the hash of the address. A value that is not valid gets its default. */
export function stateOf(hash: string): DemoState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const conditions = params.get("cond");
  const chosen = conditions === null ? DEFAULT_STATE.conditions : OFFERED_CONDITIONS.filter((each) => conditions.split(",").includes(each));
  return {
    count: clampInt(params.get("count"), 1, MAX_COUNT, DEFAULT_STATE.count),
    conditions: chosen,
    part: params.get("part")?.slice(0, 40) ?? DEFAULT_STATE.part,
    code: params.get("code")?.slice(0, 40) ?? DEFAULT_STATE.code,
    age: clampInt(params.get("age"), 0, MAX_AGE, DEFAULT_STATE.age),
    ended: params.get("ended") === "1",
  };
}

/** This function gives the hash of the address for a state. It holds only the values that are not the defaults. */
export function hashOf(state: DemoState): string {
  const params = new URLSearchParams();
  if (state.count !== DEFAULT_STATE.count) params.set("count", String(state.count));
  if (state.conditions.join(",") !== DEFAULT_STATE.conditions.join(",")) params.set("cond", state.conditions.join(","));
  if (state.part !== DEFAULT_STATE.part) params.set("part", state.part);
  if (state.code !== DEFAULT_STATE.code) params.set("code", state.code);
  if (state.age !== DEFAULT_STATE.age) params.set("age", String(state.age));
  if (state.ended) params.set("ended", "1");
  const text = params.toString();
  return text === "" ? "" : `#${text}`;
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });

/** This function writes an amount of money of the buyer, for example `$1,180.00`. */
export function money(amount: Quantity): string {
  return MONEY.format(valueIn(amount, CURRENCY));
}

/** This function gives the slot of the color of an offer: its place in the sample list. */
export function slotOf(offerId: string): number {
  return SAMPLE_OFFERS.findIndex((each) => each.offer.id === offerId);
}

/** This record is one offer that the buyer can choose, as a row of the table. */
export interface OfferRow {
  readonly id: string;
  readonly label: string;
  readonly seller: string;
  readonly title: string;
  readonly condition: Condition;
  readonly availability: Availability;
  readonly inStock: boolean;
  readonly unitPrice: string;
  readonly goods: string;
  readonly shipping: string;
  readonly cost: string;
  readonly best: boolean;
  readonly slot: number;
}

/** This record is an offer that the choice skipped, with the reason from `bestOffer`. */
export interface SkippedRow {
  readonly id: string;
  readonly label: string;
  readonly seller: string;
  readonly why: string;
}

/** This record is an offer of another part: its brand and its part number do not match the want. */
export interface OtherRow {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly brand: string;
  readonly partNumber: string;
}

/** This record is the choice of the demo for one state. */
export interface ChoiceView {
  readonly want: PartWant;
  /** The count of the offers of the part. */
  readonly matched: number;
  readonly rows: readonly OfferRow[];
  readonly skipped: readonly SkippedRow[];
  readonly other: readonly OtherRow[];
  /** The sentence of the choice. */
  readonly verdict: string;
  /** The sentence that tells why the best offer is not the lowest price, or an empty text. */
  readonly why: string;
  readonly best: OfferRow | null;
}

/** This function gives the want of a state: the brands of the sample, and the part number of the visitor. */
export function wantOf(state: DemoState): PartWant {
  return { brands: SAMPLE_WANT.brands, partNumbers: [state.part] };
}

const sellerOf = (observation: Observation): string => observation.offer.seller.name ?? observation.offer.source;

const shippingText = (observation: Observation): string => {
  const { shipping } = observation.reading;
  switch (shipping.kind) {
    case "free":
      return "Free";
    case "fixed":
      return money(shipping.cost);
    case "calculated":
      return "At checkout";
    default:
      return "Not known";
  }
};

const rowOf = (choice: OfferChoice, count: number, best: OfferChoice | null): OfferRow => {
  const { observation } = choice;
  return {
    id: observation.offer.id,
    label: labelOf(observation.offer.id),
    seller: sellerOf(observation),
    title: observation.offer.title,
    condition: observation.offer.condition,
    availability: observation.reading.availability,
    inStock: choice.inStock,
    unitPrice: money(unitPriceFor(observation.reading, count)),
    goods: money(choice.goods),
    shipping: shippingText(observation),
    cost: choice.cost === null ? "Not known" : money(choice.cost),
    best: choice === best,
    slot: slotOf(observation.offer.id),
  };
};

/** This function chooses the offer of a state with `offersOfPart` and `bestOffer`, and gives the rows of the page. */
export function choiceOf(state: DemoState): ChoiceView {
  const want = wantOf(state);
  const all = [...SAMPLE_OFFERS, ...SAMPLE_OLDER];
  const ofPart = offersOfPart(all, want);
  const chosen = bestOffer(ofPart, { currency: CURRENCY, count: state.count, conditions: state.conditions });
  const rows = chosen.offers.map((choice) => rowOf(choice, state.count, chosen.best));
  const best = rows.find((row) => row.best) ?? null;
  const byId = new Map(SAMPLE_OFFERS.map((each) => [each.offer.id, each]));
  const skipped = chosen.skipped.map(({ offerId, why }) => {
    const observation = byId.get(offerId);
    return { id: offerId, label: labelOf(offerId), seller: observation === undefined ? offerId : sellerOf(observation), why };
  });
  const other = SAMPLE_OFFERS.filter((each) => !offersPart(each.offer, want)).map(({ offer }) => ({
    id: offer.id,
    label: labelOf(offer.id),
    title: offer.title,
    brand: offer.partNumbers[0]?.brand ?? "",
    partNumber: offer.partNumbers[0]?.partNumber ?? "",
  }));
  const units = state.count === 1 ? "1 unit" : `${state.count} units`;
  let verdict: string;
  if (ofPart.length === 0) verdict = "No offer has this part number of the maker.";
  else if (best === null) verdict = `No offer of the part can take an order of ${units}.`;
  else if (!best.inStock) verdict = `No offer is in stock. The lowest price for ${units} is ${best.goods} from ${best.seller}.`;
  else verdict = `Buy ${units} from ${best.seller}: ${best.goods} for the goods, ${best.cost === "Not known" ? "and the shipping cost is not known" : `${best.cost} with the shipping`}.`;
  const lower = best === null || !best.inStock ? [] : rows.slice(0, rows.indexOf(best)).filter((row) => !row.inStock);
  const [first] = lower;
  const why =
    first === undefined
      ? ""
      : lower.length === 1
        ? `The offer "${first.title}" of ${first.seller} has a lower price, but it is not in stock.`
        : `${lower.length} offers have a lower price, but they are not in stock.`;
  return { want, matched: ofPart.length, rows, skipped, other, verdict, why, best };
}

/** This record is one step of the line of an offer: its unit price for each count from `from` to `to`. */
export interface Step {
  readonly from: number;
  readonly to: number;
  readonly price: number;
}

/** This record is the line of one offer in the chart of the unit price. */
export interface Series {
  readonly id: string;
  readonly label: string;
  readonly seller: string;
  readonly title: string;
  readonly slot: number;
  readonly inStock: boolean;
  readonly steps: readonly Step[];
}

/** This record is one run of counts with one best offer, or with no offer. */
export interface BandRun {
  readonly from: number;
  readonly to: number;
  readonly id: string | null;
}

/** This record is the chart of the unit price for each count of an order. */
export interface Curve {
  readonly series: readonly Series[];
  readonly band: readonly BandRun[];
  readonly low: number;
  readonly high: number;
}

/**
 * This function gives the unit price of each offer for each count from 1 to `MAX_COUNT`, and the best offer for
 * each count. It calls `bestOffer` one time for each count, so the chart shows the choice of the package.
 */
export function curveOf(state: DemoState): Curve {
  const ofPart = offersOfPart([...SAMPLE_OFFERS, ...SAMPLE_OLDER], wantOf(state));
  const lines = new Map<string, { observation: Observation; inStock: boolean; steps: Step[] }>();
  const band: BandRun[] = [];
  for (let count = 1; count <= MAX_COUNT; count += 1) {
    const chosen = bestOffer(ofPart, { currency: CURRENCY, count, conditions: state.conditions });
    for (const choice of chosen.offers) {
      const { observation } = choice;
      const price = valueIn(unitPriceFor(observation.reading, count), CURRENCY);
      let line = lines.get(observation.offer.id);
      if (line === undefined) {
        line = { observation, inStock: choice.inStock, steps: [] };
        lines.set(observation.offer.id, line);
      }
      const last = line.steps.at(-1);
      if (last !== undefined && last.price === price && last.to === count - 1) line.steps[line.steps.length - 1] = { ...last, to: count };
      else line.steps.push({ from: count, to: count, price });
    }
    const id = chosen.best?.observation.offer.id ?? null;
    const run = band.at(-1);
    if (run !== undefined && run.id === id) band[band.length - 1] = { ...run, to: count };
    else band.push({ from: count, to: count, id });
  }
  const series = [...lines.values()]
    .map(({ observation, inStock, steps }) => ({
      id: observation.offer.id,
      label: labelOf(observation.offer.id),
      seller: sellerOf(observation),
      title: observation.offer.title,
      slot: slotOf(observation.offer.id),
      inStock,
      steps,
    }))
    .sort((a, b) => a.slot - b.slot);
  const prices = series.flatMap((line) => line.steps.map((step) => step.price));
  return { series, band, low: prices.length === 0 ? 0 : Math.min(...prices), high: prices.length === 0 ? 1 : Math.max(...prices) };
}

/** This record is one digit of a GTIN in the sum of the check digit. */
export interface GtinStep {
  readonly digit: number;
  readonly weight: 1 | 3;
}

/** This record is the GTIN check of a text. */
export interface GtinView {
  /** The digits after the removal of the spaces and the hyphens. */
  readonly digits: string;
  /** True when `parseGtin` accepts the text. */
  readonly valid: boolean;
  /** The GTIN-14 form, or null. */
  readonly gtin14: string | null;
  /** The match key of the GTIN, or null. */
  readonly key: string | null;
  /** The digits of the sum with their weights, from the left, or null when the text cannot have a check digit. */
  readonly steps: readonly GtinStep[] | null;
  readonly sum: number | null;
  /** The check digit that the sum gives. */
  readonly expected: number | null;
  /** The last digit of the text. */
  readonly given: number | null;
  /** The sentence of the check. */
  readonly why: string;
}

/** This function checks a GTIN with `parseGtin`, and gives the steps of its check digit. */
export function gtinOf(text: string): GtinView {
  const digits = text.replace(/[\s-]/g, "");
  const gtin14 = parseGtin(text);
  const key = matchKeys({ gtins: [text], partNumbers: [] })[0] ?? null;
  const none = { digits, valid: gtin14 !== null, gtin14, key, steps: null, sum: null, expected: null, given: null };
  if (digits === "") return { ...none, why: "Type the digits of a GTIN: a UPC-A, an EAN-13, a GTIN-8 or a GTIN-14." };
  if (!/^\d+$/.test(digits)) return { ...none, why: "The code has a character that is not a digit, a space or a hyphen." };
  const body = digits.slice(0, -1);
  const steps = [...body].map((char, i): GtinStep => ({ digit: Number(char), weight: (body.length - 1 - i) % 2 === 0 ? 3 : 1 }));
  const sum = steps.reduce((total, step) => total + step.digit * step.weight, 0);
  const expected = body === "" ? null : gtinCheckDigit(body);
  const given = Number(digits.slice(-1));
  const shown = { ...none, steps, sum, expected, given };
  if (![8, 12, 13, 14].includes(digits.length)) return { ...shown, why: `The code has ${digits.length} digits. A GTIN has 8, 12, 13 or 14 digits.` };
  if (/^0+$/.test(digits)) return { ...shown, why: "A GTIN of zeros only is not a GTIN." };
  if (gtin14 === null) return { ...shown, why: `The sum gives the check digit ${String(expected)}, but the last digit is ${given}. A digit of the code is wrong.` };
  return { ...shown, why: `The sum gives the check digit ${String(expected)}, and the last digit is ${given}. The GTIN is valid.` };
}

/** This record is the storage rule of one source for the reading of the demo. */
export interface TermsRow {
  readonly source: string;
  /** The name of the source on the page. */
  readonly name: string;
  /** The hours that a store keeps the reading, null with no limit, or 0 when it keeps no reading. */
  readonly keptFor: number | null;
  readonly rule: string;
  readonly kept: boolean;
  readonly until: string;
  readonly history: boolean;
  readonly trend: boolean;
  readonly why: string;
}

const ruleText = (terms: SourceTerms): string => {
  const { retention } = terms;
  if (retention.kind === "keep") return "Keep";
  if (retention.kind === "no-store") return "No store";
  return `Keep ${valueIn(retention.age, "h")} h`;
};

/** This function applies the storage rule of each sample source to a reading of the age of the state. */
export function termsOf(state: DemoState): TermsRow[] {
  const reading = { at: SAMPLE_AT };
  const now = new Date(Date.parse(SAMPLE_AT) + state.age * 3_600_000).toISOString();
  return SAMPLE_TERMS.map((terms) => {
    const kept = isKept(terms, reading, now, state.ended);
    const limit = keepUntil(terms, reading);
    const hours = limit === null ? null : (Date.parse(limit) - Date.parse(SAMPLE_AT)) / 3_600_000;
    const until = hours === null ? "No limit" : hours === 0 ? "At the reading" : `${hours} h after the reading`;
    let why: string;
    if (state.ended && terms.deleteWhenEnded) why = "The offer ended, and the terms delete the readings of an ended offer.";
    else if (terms.retention.kind === "no-store") why = "The terms permit no store. A reading serves one request.";
    else if (hours === null) why = "The terms set no limit on the time.";
    else if (kept) why = `The reading is ${state.age} h old, and the limit is ${hours} h.`;
    else why = `The reading is ${state.age} h old, more than the limit of ${hours} h.`;
    const name = SAMPLE_OFFERS.find((each) => each.offer.source === terms.source)?.offer.seller.name ?? terms.source;
    const deleted = state.ended && terms.deleteWhenEnded;
    const keptFor = deleted || terms.retention.kind === "no-store" ? 0 : hours;
    return { source: terms.source, name, keptFor, rule: ruleText(terms), kept, until, history: permitsHistory(terms), trend: permitsTrend(terms), why };
  });
}
