import { checkSources, checkUnits, type CitedUnit, type Finding, type FindingCode, type GateOptions, type Source } from "@mark1russell7/guidebook";
import { convertible, kindOf, quantity, rationals, valueIn, whyNotConvertible, type Quantity } from "@mark1russell7/quantity";
import { latestAverages, moneyOf, monthSchema, type AveragePrice } from "./average.ts";
import type { PartWant } from "./offers.ts";
import type { ProductWant } from "./order.ts";

/*
 * This module is the format and the gate of a catalog of supplies: the products that a household keeps for an
 * emergency, the resource and the amount that one unit gives, and its shelf life. Each value has a cited fact, the
 * definition of the product, or an explicit no read. The facts and their sources are the records of
 * `@mark1russell7/guidebook`, and its gate examines them. The module names no person and no place.
 */

/** The format of a catalog of supplies. */
export const SUPPLY_FORMAT = "supply-catalog/1";

/** The kinds of the supplies. */
export const SUPPLY_KINDS = ["water", "food", "power", "light", "heat", "first-aid", "communication"] as const;

/** A kind of a supply. */
export type SupplyKind = (typeof SUPPLY_KINDS)[number];

/** A value that no source gives yet. The reason tells what is missing. */
export interface NoRead {
  readonly read: false;
  readonly why: string;
}

/**
 * An amount with its reason. The reason is a cited fact: the `id` of a unit of the catalog with the use `fact`.
 * Or it is the definition of the product, for example the 1 gal of a jug of 1 gal.
 */
export type CitedAmount =
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly fact: string; readonly definition?: never }
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly definition: string; readonly fact?: never };

/** A resource that a supply gives, with its unit, for example `water.stored` in `L`. The codes are the resource codes of a store. */
export interface SupplyResource {
  readonly code: string;
  readonly unit: string;
  readonly title: string;
}

/** The gift of one unit of a product: an amount of one resource, or no read. */
export interface SupplyGift {
  readonly resource: string;
  readonly amount: CitedAmount | NoRead;
}

/**
 * The shelf life of a product: a cited amount of time, the `id` of a product of the FoodKeeper data of USDA FSIS, or no read.
 * The entry `/foodkeeper` of `@mark1russell7/stock` gives the due rule of a FoodKeeper product.
 */
export type ShelfLife = CitedAmount | { readonly read: true; readonly foodKeeper: number } | NoRead;

/**
 * The join of a product to a series of average prices. It names the source and the series. It also gives the amount
 * of the item of the series in one unit of the product. For example, 1 kg of dry rice is the amount of a series of
 * rice in USD/lb.
 */
export interface AverageJoin {
  readonly read: true;
  /** The source of the average prices, for example `bls-ap`. */
  readonly source: string;
  /** The id of the series in the source, for example `APU0000701312`. */
  readonly series: string;
  /** The amount of the item of the series in one unit of the product, with its reason. */
  readonly per: CitedAmount;
}

/** A product of the catalog. */
export interface SupplyProduct {
  readonly id: string;
  readonly title: string;
  readonly kind: SupplyKind;
  /** The part that the offers of a seller must match. A product with no part has no offer, so it has no price. */
  readonly want?: PartWant | undefined;
  /** The resources that one unit gives. A product that gives no stored resource, for example a radio, gives none. */
  readonly gives: readonly SupplyGift[];
  /** The `id` of a fact that tells why a kit has the product, for example the kit list of a public agency. */
  readonly basis?: string | undefined;
  /**
   * The count of units for each person of the household, in one bare count unit, for example 1 `{each}` of a sleeping
   * bag. A product with no field `perPerson` is one for the household. `kitMax` gives the count of units from it.
   */
  readonly perPerson?: CitedAmount | undefined;
  /** The food energy of one unit, in a unit of energy. A cooking converter gives it. */
  readonly energy?: CitedAmount | NoRead | undefined;
  /**
   * The amount of one unit as sold: a mass, a volume or a count, for example 1 kg, 530 g or 1 gal.
   * A product with no known size has no field `size`. A no read is for a product that has a size, when the source
   * of the size is not read yet, for example a label.
   */
  readonly size?: CitedAmount | NoRead | undefined;
  readonly shelf: ShelfLife;
  /**
   * The series of average prices that gives the price of one unit, or no read with the reason. A product with no join
   * and no part has no price.
   */
  readonly average?: AverageJoin | NoRead | undefined;
}

/** A catalog of supplies: the sources, the cited facts, the resources and the products. */
export interface SupplyCatalog {
  readonly format: typeof SUPPLY_FORMAT;
  readonly sources: readonly Source[];
  readonly facts: readonly CitedUnit[];
  readonly resources: readonly SupplyResource[];
  readonly products: readonly SupplyProduct[];
}

/** The codes of the findings of the catalog gate. */
export const SUPPLY_CODES = [
  "supplies-format",
  "supplies-twice",
  "supplies-kind",
  "supplies-resource",
  "supplies-fact",
  "supplies-basis",
  "supplies-amount",
  "supplies-unit",
  "supplies-shelf",
  "supplies-unused",
  "supplies-no-read",
  "supplies-no-reason",
] as const;

/** A code of a finding of the catalog gate. */
export type SupplyCode = (typeof SUPPLY_CODES)[number];

/** A finding of the catalog gate, or of the gate of the facts and their sources. */
export type SupplyFinding = Finding<SupplyCode | FindingCode, "source" | "unit" | "resource" | "product">;

/**
 * The options of the catalog gate: the options of the gate of the sources, and the known FoodKeeper ids.
 */
export interface SupplyGateOptions extends GateOptions {
  /**
   * The ids of the products of the FoodKeeper data, for example the ids of `FOODKEEPER_PRODUCTS` of the entry
   * `/foodkeeper` of `@mark1russell7/stock`. With this option, a shelf life with an id that is not in the set is an
   * error. With no option, the gate does not examine the ids against the data.
   */
  readonly foodKeeper?: ReadonlySet<number> | readonly number[] | undefined;
}

/** This function tells if a text is a unit of `@mark1russell7/quantity`. `convertible` throws for an unknown unit. */
function known(unit: unknown): boolean {
  if (typeof unit !== "string") return false;
  try {
    return convertible(unit, unit);
  } catch {
    return false;
  }
}

/** The unit that each food energy converts to. */
const ENERGY_UNIT = "kcal";
/** The unit that each shelf life converts to. */
const SHELF_UNIT = "d";
/**
 * This function gives true for the unit of a size. That is a mass or a volume that converts to `kg` or `L`, or one
 * bare count, for example `{each}`. The kind of a unit is not sufficient. For example, `g/{each}` has the kind
 * mass, and it does not convert to `kg`.
 */
function sizeUnit(unit: string): boolean {
  return convertible(unit, "kg") || convertible(unit, "L") || countUnit(unit);
}

/** This function gives true for one bare count unit, for example `{each}`. */
function countUnit(unit: string): boolean {
  return /^{[^{}/]+}$/.test(unit) && kindOf(unit) === "count";
}

/**
 * This function examines a catalog. It gives the findings of the sources and the facts (the gate of
 * `@mark1russell7/guidebook`), and the findings of the products:
 *
 * - An error for a product or a resource two times, a kind that is not a supply kind, and a gift of an unknown resource.
 * - An error for a product that gives no resource and has no basis.
 * - An error for a field `energy` on a product that is not food. The field is the food energy of one unit.
 * - An error for a fact that is not a fact of the catalog, and for an amount that is not more than 0. The basis of a
 *   product is also a fact.
 * - An error for an amount with no reason, with two reasons, or with a blank definition. A catalog from JSON can have them.
 * - An error for a unit that is not a unit of `@mark1russell7/quantity`.
 * - An error for a unit that does not convert to the unit of its resource.
 * - An error for a size in a unit that is not a mass, a volume or a count, for example `h` or `kcal`.
 * - An error for a count for each person in a unit that is not one bare count, for example `kg` or `{each}/{person}`.
 * - The amount of the item of an average price has the same checks as each other amount.
 * - With the option `foodKeeper`, an error for a FoodKeeper id of a shelf life that is not in the known ids.
 * - A warning for each value with no read, and for a no read with a blank reason.
 * - A warning for each fact and each source that no product uses.
 *
 * The function takes a decoded catalog: each record has the fields of its type. Decode a catalog from JSON first, for
 * example with the entry `/read` of `@mark1russell7/optional`. The gate then finds the values that the type does not hold.
 *
 * @param catalog - The catalog
 * @param options - The options of the gate of the sources, for example the date of the gate, and the known FoodKeeper ids
 */
export function checkSupplies(catalog: SupplyCatalog, options: SupplyGateOptions = {}): SupplyFinding[] {
  const { foodKeeper: knownFoodKeeper, ...gate } = options;
  const foodKeeper = knownFoodKeeper === undefined ? undefined : new Set<number>(knownFoodKeeper);
  const out: SupplyFinding[] = [...checkSources(catalog.sources, gate), ...checkUnits(catalog.facts, catalog.sources, gate)];
  const error = (code: SupplyCode, record: "resource" | "product", id: string, message: string): void => {
    out.push({ level: "error", code, record, id, message });
  };
  const warning = (code: SupplyCode, record: "source" | "unit" | "product", id: string, message: string): void => {
    out.push({ level: "warning", code, record, id, message });
  };
  if (catalog.format !== SUPPLY_FORMAT) error("supplies-format", "product", "", `The format is ${String(catalog.format)}. It must be ${SUPPLY_FORMAT}.`);

  const resources = new Map<string, SupplyResource>();
  for (const resource of catalog.resources) {
    if (resources.has(resource.code)) error("supplies-twice", "resource", resource.code, `The resource ${resource.code} is two times in the catalog.`);
    if (!known(resource.unit)) error("supplies-unit", "resource", resource.code, `The unit ${String(resource.unit)} of the resource ${resource.code} is not a known unit.`);
    resources.set(resource.code, resource);
  }
  const facts = new Map(catalog.facts.map((fact) => [fact.id, fact]));
  const used = new Set<string>();

  /** This function examines one cited amount, and gives the unit check to `units`. */
  const amount = (product: string, what: string, value: CitedAmount | NoRead, unit: string): void => {
    if (!value.read) {
      warning("supplies-no-read", "product", product, `The ${what} of the product ${product} is no read: ${String(value.why)}`);
      if (typeof value.why !== "string" || value.why.trim() === "") warning("supplies-no-reason", "product", product, `The no read of the ${what} of the product ${product} has no reason.`);
      return;
    }
    // The type permits one reason only. A catalog from JSON can have no reason, two reasons or a blank definition.
    const reasons = (value.fact === undefined ? 0 : 1) + (value.definition === undefined ? 0 : 1);
    if (reasons !== 1) error("supplies-fact", "product", product, `The ${what} of the product ${product} has ${String(reasons)} reasons. It must have a fact or a definition, not the two.`);
    else if (value.definition !== undefined && (typeof value.definition !== "string" || value.definition.trim() === "")) error("supplies-fact", "product", product, `The definition of the ${what} of the product ${product} is blank.`);
    if (value.fact !== undefined) {
      const fact = facts.get(value.fact);
      if (fact === undefined || fact.use !== "fact") error("supplies-fact", "product", product, `The ${what} of the product ${product} cites ${value.fact}, and the catalog has no fact with that id.`);
      used.add(value.fact);
    }
    if (!(Number.isFinite(value.amount) && value.amount > 0)) error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${String(value.amount)}. It must be a finite number more than 0.`);
    if (!known(value.unit)) error("supplies-unit", "product", product, `The unit ${String(value.unit)} of the ${what} of the product ${product} is not a known unit.`);
    else if (known(unit) && !convertible(value.unit, unit)) error("supplies-unit", "product", product, `The ${what} of the product ${product} is in ${value.unit}, and ${value.unit} does not convert to ${unit}.`);
  };

  const products = new Set<string>();
  for (const product of catalog.products) {
    if (products.has(product.id)) error("supplies-twice", "product", product.id, `The product ${product.id} is two times in the catalog.`);
    products.add(product.id);
    if (!(SUPPLY_KINDS as readonly string[]).includes(product.kind)) error("supplies-kind", "product", product.id, `The kind ${String(product.kind)} of the product ${product.id} is not a supply kind.`);
    const gifts = new Set<string>();
    for (const gift of product.gives) {
      if (gifts.has(gift.resource)) error("supplies-twice", "product", product.id, `The product ${product.id} gives the resource ${gift.resource} two times.`);
      gifts.add(gift.resource);
      const resource = resources.get(gift.resource);
      if (resource === undefined) error("supplies-resource", "product", product.id, `The product ${product.id} gives the resource ${gift.resource}, and the catalog has no such resource.`);
      else amount(product.id, `gift of ${gift.resource}`, gift.amount, resource.unit);
    }
    if (product.gives.length === 0 && product.basis === undefined) error("supplies-basis", "product", product.id, `The product ${product.id} gives no resource and has no basis. A product that gives no resource cites a fact in its basis.`);
    if (product.basis !== undefined) {
      const fact = facts.get(product.basis);
      if (fact === undefined || fact.use !== "fact") error("supplies-fact", "product", product.id, `The basis of the product ${product.id} cites ${String(product.basis)}, and the catalog has no fact with that id.`);
      used.add(product.basis);
    }
    // An unknown kind has its own error above, so this rule examines only a known kind that is not food.
    if (product.energy !== undefined && product.kind !== "food" && (SUPPLY_KINDS as readonly string[]).includes(product.kind)) error("supplies-kind", "product", product.id, `The product ${product.id} has a food energy, and its kind is ${String(product.kind)}. Only a product of the kind food has a food energy.`);
    if (product.energy !== undefined) amount(product.id, "food energy", product.energy, ENERGY_UNIT);
    if (product.size !== undefined) {
      // The size has no single unit to convert to. Its unit must be a mass, a volume or one bare count. An unknown unit
      // has its own error.
      amount(product.id, "size", product.size, "");
      if (product.size.read && known(product.size.unit) && !sizeUnit(product.size.unit))
        error("supplies-unit", "product", product.id, `The size of the product ${product.id} is in ${product.size.unit}. It must be a mass, a volume or a count.`);
    }
    if (product.perPerson !== undefined) {
      // The count has no single unit to convert to. Its unit must be one bare count. An unknown unit has its own error.
      // A count that is not read gives no count of units, so the gate refuses it. A catalog from JSON can have one.
      if (product.perPerson.read !== true) error("supplies-amount", "product", product.id, `The count for each person of the product ${product.id} is not read. A product with no known count has no field perPerson.`);
      else amount(product.id, "count for each person", product.perPerson, "");
      if (product.perPerson.read === true && known(product.perPerson.unit) && !countUnit(product.perPerson.unit))
        error("supplies-unit", "product", product.id, `The count for each person of the product ${product.id} is in ${product.perPerson.unit}. It must be one bare count, for example {each}.`);
    }
    if (product.average !== undefined) amount(product.id, "average price", product.average.read ? product.average.per : product.average, product.average.read ? product.average.per.unit : "");
    if ("foodKeeper" in product.shelf) {
      if (!(Number.isSafeInteger(product.shelf.foodKeeper) && product.shelf.foodKeeper > 0)) error("supplies-shelf", "product", product.id, `The FoodKeeper id of the product ${product.id} is ${String(product.shelf.foodKeeper)}. It must be a whole number more than 0.`);
      else if (foodKeeper !== undefined && !foodKeeper.has(product.shelf.foodKeeper))
        error("supplies-shelf", "product", product.id, `The FoodKeeper id ${String(product.shelf.foodKeeper)} of the product ${product.id} is not in the known FoodKeeper ids.`);
    } else amount(product.id, "shelf life", product.shelf, SHELF_UNIT);
  }

  for (const fact of catalog.facts) if (!used.has(fact.id)) warning("supplies-unused", "unit", fact.id, `No product uses the fact ${fact.id}.`);
  const cited = new Set(catalog.facts.map((fact) => fact.source));
  for (const source of catalog.sources) if (!cited.has(source.id)) warning("supplies-unused", "source", source.id, `No fact cites the source ${source.id}.`);
  return out;
}

/**
 * This function gives the wants of the products with a part, in the order of the catalog, for `buyCandidates`.
 * A product with no part has no offer, so it is not in the result.
 *
 * @param catalog - The catalog
 * @param max - The largest count of units of a product. The default is 1 for each product
 */
export function supplyWants(catalog: SupplyCatalog, max: (product: SupplyProduct) => number = () => 1): ProductWant[] {
  return catalog.products.flatMap((product) => (product.want === undefined ? [] : [{ product: product.id, want: product.want, max: max(product) }]));
}

/**
 * This function gives the largest count of units of each product for a household, for `supplyWants`. A product with a
 * count for each person has that count times the persons, up to the next whole unit. Each other product has 1. The
 * product is exact: the count is the decimal of its number, so 1.1 for each person of 50 persons gives 55, not 56.
 *
 * @param people - The count of persons of the household. The persons are input data of the user.
 * @returns The function `max` of `supplyWants`
 * @throws RangeError when the count of persons is not a whole number of 0 or more
 */
export function kitMax(people: number): (product: SupplyProduct) => number {
  if (!(Number.isSafeInteger(people) && people >= 0)) throw new RangeError(`The count of persons is ${String(people)}. It must be a whole number of 0 or more.`);
  const persons = rationals.fromNumber(people);
  return (product) => (product.perPerson === undefined ? 1 : rationals.toNumber(rationals.ceil(rationals.mul(rationals.fromNumber(product.perPerson.amount), persons))));
}

/** The gift of a count of units: an amount in the unit of its resource, or no read. */
export type GiftOf = { readonly resource: string; readonly read: true; readonly amount: number; readonly unit: string } | { readonly resource: string; readonly read: false; readonly why: string };

/**
 * This function gives the resources of a count of units of a product, each in the unit of its resource.
 * A gift with no read stays no read: it is not 0.
 *
 * @param catalog - The catalog
 * @param id - The `id` of the product
 * @param units - The count of units
 * @throws RangeError when the count of units is not a finite number of 0 or more
 * @throws RangeError when the catalog has no such product, or a gift of an unknown resource
 * @throws The error of `valueIn` of `@mark1russell7/quantity` when the unit of a gift does not convert to the unit of its resource
 */
export function giftsOf(catalog: SupplyCatalog, id: string, units: number): GiftOf[] {
  if (!(Number.isFinite(units) && units >= 0)) throw new RangeError(`The count of units is ${String(units)}. It must be a finite number of 0 or more.`);
  const product = catalog.products.find((each) => each.id === id);
  if (product === undefined) throw new RangeError(`The catalog has no product ${id}.`);
  return product.gives.map((gift): GiftOf => {
    const resource = catalog.resources.find((each) => each.code === gift.resource);
    if (resource === undefined) throw new RangeError(`The product ${id} gives the resource ${gift.resource}, and the catalog has no such resource.`);
    if (!gift.amount.read) return { resource: gift.resource, read: false, why: gift.amount.why };
    return { resource: gift.resource, read: true, amount: units * valueIn(quantity(gift.amount.amount, gift.amount.unit), resource.unit), unit: resource.unit };
  });
}

/** The price of one unit of a product from an average price, or no read with the reason. */
export type SupplyPrice =
  | { readonly product: string; readonly read: true; readonly price: Quantity; readonly average: string; readonly period: string }
  | { readonly product: string; readonly read: false; readonly why: string };

/**
 * This function gives the price of one unit of each product with a join to a series, in the order of the catalog.
 * It takes the last month of each series (`latestAverages`). The price is in the money of the average price.
 *
 * - A product with no join is not in the result.
 * - A join with no read, a series with no price, and a unit that does not fit give no read. A no read is not 0.
 * - The unit of the series must convert to the unit of the product, for example USD/lb to 1 kg.
 * - With the option `since`, a last price before that month gives no read. A series that stops then gives no old price.
 *
 * @param catalog - The catalog
 * @param prices - The average prices, from one or more reads
 * @param options - The option `since`: the first month of a price that the result can use, in the form `YYYY-MM`
 * @returns The price of one unit of each product with a join, or no read with the reason
 * @throws RangeError when `since` is not a month in the form `YYYY-MM`
 */
export function averageSupplyPrices(catalog: SupplyCatalog, prices: readonly AveragePrice[], options: { readonly since?: string | undefined } = {}): SupplyPrice[] {
  const { since } = options;
  if (since !== undefined && !monthSchema.safeParse(since).success) throw new RangeError(`The month ${String(since)} is not in the form YYYY-MM.`);
  const last = new Map(latestAverages(prices).map((price) => [`${price.source}:${price.series}`, price]));
  return catalog.products.flatMap((product): SupplyPrice[] => {
    const join = product.average;
    if (join === undefined) return [];
    const none = (why: string): SupplyPrice[] => [{ product: product.id, read: false, why }];
    if (!join.read) return none(join.why);
    const average = last.get(`${join.source}:${join.series}`);
    if (average === undefined) return none(`The prices have no average price of the series ${join.series} of ${join.source}.`);
    if (since !== undefined && average.period < since) return none(`The last average price of the series ${join.series} of ${join.source} is for ${average.period}, before ${since}.`);
    const money = moneyOf(average.price.unit);
    if (money === undefined) return none(`The unit ${average.price.unit} of ${average.id} is not a price for each unit of an amount.`);
    if (!known(join.per.unit)) return none(`The unit ${String(join.per.unit)} of the product ${product.id} is not a known unit.`);
    const unit = `${money}/${join.per.unit}`;
    const why = whyNotConvertible(average.price.unit, unit);
    if (why !== undefined) return none(`The average price ${average.id} is in ${average.price.unit}, and it does not convert to ${unit}: ${why}.`);
    const price = quantity(valueIn(average.price, unit) * join.per.amount, money);
    return [{ product: product.id, read: true, price, average: average.id, period: average.period }];
  });
}
