import { checkSources, checkUnits, type CitedUnit, type Finding, type FindingCode, type GateOptions, type Source } from "@mark1russell7/guidebook";
import { canonicalUnit, convertible, divide, kindOf, multiply, quantity, rationals, UnitError, valueIn, whyNotConvertible, type Quantity } from "@mark1russell7/quantity";
import { isRecord } from "@mark1russell7/optional/read";
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
 * An amount with its reason. The reason is one of four:
 *
 * - A cited fact: the `id` of a unit of the catalog with the use `fact`.
 * - The definition of the product, for example the 1 gal of a jug of 1 gal.
 * - A rate of a cited fact times an amount of the product, in the field `scaled`. An example is 365 kcal in 100 g times 1 kg.
 * - The size of the product, with `size: true`. The size has its own reason, and the gate compares the two amounts. An
 *   example is the gift of 1 kg of a package of 1 kg of rice.
 */
export type CitedAmount =
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly fact: string; readonly definition?: never; readonly scaled?: never; readonly size?: never }
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly definition: string; readonly fact?: never; readonly scaled?: never; readonly size?: never }
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly scaled: ScaledReason; readonly fact?: never; readonly definition?: never; readonly size?: never }
  | { readonly read: true; readonly amount: number; readonly unit: string; readonly size: true; readonly fact?: never; readonly definition?: never; readonly scaled?: never };

/**
 * The reason of an amount that is a rate times an amount, for example the food energy of a package. The rate is a
 * cited fact. The amount that the rate applies to has its own reason: a fact, a definition of the product or its size.
 * The gate calculates the product, and the amount must be equal to it.
 */
export interface ScaledReason {
  /** The rate: `amount` of `unit` in `per`, for example 365 kcal in 100 g. `fact` is the `id` of the fact that gives it. */
  readonly rate: { readonly amount: number; readonly unit: string; readonly per: { readonly amount: number; readonly unit: string }; readonly fact: string };
  /** The amount that the rate applies to, for example 1 kg, with a fact, a definition or the size of the product. */
  readonly of:
    | { readonly amount: number; readonly unit: string; readonly fact: string; readonly definition?: never; readonly size?: never }
    | { readonly amount: number; readonly unit: string; readonly definition: string; readonly fact?: never; readonly size?: never }
    | { readonly amount: number; readonly unit: string; readonly size: true; readonly fact?: never; readonly definition?: never };
}

/**
 * A resource that a supply gives, with its unit and its kind, for example `water.stored` in `L` of the kind `water`. The
 * codes are the resource codes of a store. The kind tells which gifts in a unit of energy are food energy. A gift of
 * `food.no-cook` in kcal is food energy, and a gift of `energy.battery` in Wh is not.
 */
export interface SupplyResource {
  readonly code: string;
  readonly unit: string;
  readonly title: string;
  readonly kind: SupplyKind;
  /**
   * The energy that the combustion of a fuel gives, for example the heat of combustion of `fuel.propane`. A resource
   * with no cited value has no field `fuelEnergy`. `fuelEnergyPerMass` gives the value in `kJ/kg`.
   */
  readonly fuelEnergy?: FuelEnergy | undefined;
}

/**
 * A rate with its fact: `amount` of `unit` in `per`, for example 2 cup of water in 1 cup of dry rice. The two amounts
 * are the values that the source gives, so the record keeps them as they are.
 */
export interface CitedRate {
  readonly amount: number;
  readonly unit: string;
  readonly per: { readonly amount: number; readonly unit: string };
  /** The `id` of the fact that gives the rate. */
  readonly fact: string;
}

/** A time from `low` to `high` with its fact, for example 15 to 18 min. A source with one value gives the same value two times. */
export interface CitedSpan {
  readonly low: number;
  readonly high: number;
  readonly unit: string;
  /** The `id` of the fact that gives the time. */
  readonly fact: string;
}

/** The two values of the heat of combustion. The higher value includes the heat of the water vapor that condenses. */
export const HEATING_VALUES = ["higher", "lower"] as const;

/** A value of the heat of combustion: `higher` or `lower`. */
export type HeatingValue = (typeof HEATING_VALUES)[number];

/**
 * The energy of a fuel: an energy in a mass, for example 2219.2 kJ in 44.0956 g of propane (1 mol). The field `heating`
 * tells if the value is the higher or the lower heat of combustion.
 */
export interface FuelEnergy extends CitedRate {
  readonly heating: HeatingValue;
}

/**
 * The cited facts to cook a dry food. Each field is optional. A product with no cited fact for a field has no such field.
 *
 * - `water`: the water to cook the food, in a volume, for each volume or mass of the dry food.
 * - `bulk`: the mass of a volume of the dry food. It converts a water rate for each volume to a rate for each mass.
 * - `time`: the time on the heat after the water boils. The heat to boil the water is not in this time.
 *
 * `cookWater` gives the water in `L/kg` of dry food.
 */
export interface CookFacts {
  readonly water?: CitedRate | undefined;
  readonly bulk?: CitedRate | undefined;
  readonly time?: CitedSpan | undefined;
}

/**
 * The bounds of a cited stove rate. `least`: the true rate is this value or more. `most`: the true rate is this value
 * or less.
 */
export const RATE_BOUNDS = ["least", "most"] as const;

/** A bound of a cited stove rate. */
export type RateBound = (typeof RATE_BOUNDS)[number];

/**
 * The fuel rate of a stove, with its bound. For example, a page that gives a burn time of "up to 1 h" gives the least
 * fuel rate, so the rate has `bound: "least"`. A rate with no field `bound` is the cited value with no bound.
 * A reader that takes the rate as the value must take only a rate with no bound.
 */
export interface StoveRate extends CitedRate {
  readonly bound?: RateBound | undefined;
}

/**
 * The boil yield of a stove: the volume of water that a mass of fuel boils, for example 16 L for each 227 g canister.
 * `start` is the temperature of the water at the start, with its fact. The yield ends at 100 °C, when the water boils.
 * A maker test is in calm air from a warm start, so it gives the most yield, and the yield has `bound: "most"`.
 * A colder start of the test gives less fuel, so a yield with no cited start gives no read.
 */
export interface StoveYield extends StoveRate {
  readonly start?: { readonly celsius: number; readonly fact: string } | undefined;
}

/**
 * The cited facts of a product that spoils after its container is opened, for example ready-to-feed infant formula.
 *
 * - `container`: the amount of one sealed container. Its unit converts to the unit of the size. A unit of the product
 *   holds a whole count of containers.
 * - `noCold`: the `id` of the fact that tells the use of an opened container with no cold storage. The content of an
 *   opened container serves one use, and the rest is waste.
 */
export interface OpenedFacts {
  readonly container: CitedAmount | NoRead;
  readonly noCold: string;
}

/**
 * The cited facts of a stove. `fuel` is the code of the resource that the stove burns, for example `fuel.butane`.
 *
 * - `rate`: the fuel that the stove burns in a time at its full heat. It is an energy in a time, for example 15000 BTU
 *   in 1 h. It can also be a mass in a time, for example 227 g in 90 min for one canister. A stove with no cited rate has no field `rate`.
 *   A burn time of "up to" a time gives the least rate, so the rate has `bound: "least"`. A burn time of "approximately" a time has no bound.
 * - `boil`: the water that a mass of fuel boils, from a cited start temperature. A boil test of a maker gives the most
 *   yield, so the yield has `bound: "most"`. A stove with no cited yield has no field `boil`.
 * - `heating`: the heating value of a rate in an energy. Ratings in BTU/h usually give the higher value. A rate in a mass
 *   has no heating value.
 */
export interface StoveFacts {
  readonly fuel: string;
  readonly rate?: StoveRate | undefined;
  readonly boil?: StoveYield | undefined;
  readonly heating?: HeatingValue | undefined;
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
  /**
   * The count of persons that the count `perPerson` is for, a whole number of 1 or more. The default is 1. Example: 1
   * tent for each 3 persons is `perPerson` 1 `{each}` and `forPersons` 3. A decimal cannot hold 1/3, and this field can.
   * The fact of `perPerson` gives this count too.
   */
  readonly forPersons?: number | undefined;
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
  /** The cited facts to cook a dry food: the water, the bulk mass and the time. Only a product of the kind food has them. */
  readonly cook?: CookFacts | undefined;
  /** The cited facts of a stove: its fuel and its fuel rate. */
  readonly stove?: StoveFacts | undefined;
  /** The cited facts of an opened container: the amount of one container and its use with no cold storage. */
  readonly opened?: OpenedFacts | undefined;
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
  "supplies-energy",
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

/** This function gives an amount in a unit in any known form. `quantity` takes the canonical form only. */
function amountIn(value: number, unit: string): Quantity {
  return quantity(value, canonicalUnit(unit));
}

/** A product after the check of its fields: a shelf life that is not a record is not there. */
type CheckedProduct = Omit<SupplyProduct, "shelf"> & { readonly shelf: SupplyProduct["shelf"] | undefined };

/** This function gives a short text of a value from JSON that is not a record, for a message. */
function shown(value: unknown): string {
  if (value === undefined) return "not there";
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a record";
  return `a value of the type ${typeof value}`;
}

/** This function tells if a value from JSON is a finite number. `quantity` throws for another value. */
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** This function tells if a value from JSON is a finite number more than 0, the rule of each amount. */
function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

/** This function tells if two amounts are equal, to a relative error of 1e-9 for the rounding of a conversion. A value that is not finite, for example a conversion that overflows, is not equal to a value. */
function same(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
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
/** The unit that the energy of a fuel converts to. */
const FUEL_ENERGY_UNIT = "kJ";
/** The unit of a mass, for the mass of a fuel and of a dry food. */
const MASS_UNIT = "kg";
/** The unit of a volume, for the cook water and the bulk of a dry food. */
const VOLUME_UNIT = "L";
/** The unit that a cook time converts to. */
const COOK_TIME_UNIT = "min";
/** The unit of the time of the fuel rate of a stove. */
const STOVE_TIME_UNIT = "h";
/** The unit of the cook water of a dry food. */
const COOK_WATER_UNIT = "L/kg";
/** The unit of the energy of a fuel for each mass. */
const FUEL_ENERGY_RATE_UNIT = "kJ/kg";
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
 * - An error for a field of a product that is null or not a record, for example `size: null` from JSON. The gate then
 *   examines the product with no such field, and does not throw.
 * - An error for a scaled amount that is not the rate times the amount of its reason, or that has a bad factor.
 * - An error for an amount that cites the size and is not equal to the size, and for a size that cites itself.
 * - An error for a food energy that is not equal to the sum of the food gifts of the product in a unit of energy. A
 *   food gift in another unit, for example a mass, makes the sum a lower limit. Then the error is for a sum that is more
 *   than the food energy. A gift with no read or a bad value makes the sum unknown, and the gate does not compare it.
 * - An error for a resource with a kind that is not a supply kind.
 * - An error for a unit that is not a unit of `@mark1russell7/quantity`.
 * - An error for a unit that does not convert to the unit of its resource.
 * - An error for a size in a unit that is not a mass, a volume or a count, for example `h` or `kcal`.
 * - An error for a count for each person in a unit that is not one bare count, for example `kg` or `{each}/{person}`.
 * - The amount of the item of an average price has the same checks as each other amount.
 * - With the option `foodKeeper`, an error for a FoodKeeper id of a shelf life that is not in the known ids.
 * - An error for a cited rate or time with no fact of the catalog, or with an amount that is not more than 0.
 * - An error for a cited rate or time with a unit that does not fit. The cook water is a volume for each volume or
 *   mass. The bulk is a mass for each volume. The cook time converts to `min`. The fuel energy of a resource is an
 *   energy for each mass, with a heating value.
 * - An error for cook facts on a product that is not food, and for a cook water for each volume with no bulk mass.
 * - An error for a stove that burns a resource that is not in the catalog, or a resource that is not of the kind heat.
 * - An error for a fuel rate of a stove that is not an energy or a mass in a time. A rate in an energy with no
 *   heating value is also an error.
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

  const facts = new Map(catalog.facts.map((fact) => [fact.id, fact]));
  const used = new Set<string>();

  /**
   * This function examines a cited rate: its fact, its two amounts and their units. The amount converts to one of the
   * units `to`, and the amount of the rate converts to one of the units `per`. It gives true for a good rate.
   */
  // Only a stove rate and a boil yield have a bound. A bound on another rate is an error, because its reader gives a bare value.
  const noBound = (record: "resource" | "product", id: string, what: string, value: unknown): void => {
    if (isRecord(value) && value["bound"] !== undefined)
      error("supplies-amount", record, id, `The ${what} of the ${record} ${id} has the bound ${shown(value["bound"])}. Only the fuel rate and the boil yield of a stove have a bound.`);
  };
  const rate = (record: "resource" | "product", id: string, what: string, value: unknown, to: readonly string[], per: readonly string[]): boolean => {
    if (!isRecord(value)) {
      error("supplies-amount", record, id, `The ${what} of the ${record} ${id} is ${shown(value)}. It must be a rate with its fact.`);
      return false;
    }
    const fact = value["fact"];
    const found = typeof fact === "string" ? facts.get(fact) : undefined;
    if (found === undefined || found.use !== "fact") error("supplies-fact", record, id, `The ${what} of the ${record} ${id} cites ${String(fact)}, and the catalog has no fact with that id.`);
    if (typeof fact === "string") used.add(fact);
    let good = found !== undefined && found.use === "fact";
    const parts: [string, unknown, unknown, readonly string[]][] = [[what, value["amount"], value["unit"], to]];
    const of = value["per"];
    if (isRecord(of)) parts.push([`amount of the ${what}`, of["amount"], of["unit"], per]);
    else {
      error("supplies-amount", record, id, `The ${what} of the ${record} ${id} has no amount that the rate is for (\`per\`).`);
      good = false;
    }
    for (const [name, amount, unit, targets] of parts) {
      if (!positive(amount)) {
        error("supplies-amount", record, id, `The ${name} of the ${record} ${id} is ${String(amount)}. It must be a finite number more than 0.`);
        good = false;
      }
      if (!known(unit)) {
        error("supplies-unit", record, id, `The unit ${String(unit)} of the ${name} of the ${record} ${id} is not a known unit.`);
        good = false;
      } else if (!targets.some((target) => convertible(unit as string, target))) {
        error("supplies-unit", record, id, `The ${name} of the ${record} ${id} is in ${String(unit)}. It must convert to ${targets.join(" or ")}.`);
        good = false;
      }
    }
    return good;
  };

  /** This function examines a cited time from low to high: its fact, its two values and its unit. */
  const span = (id: string, what: string, value: unknown, to: string): void => {
    if (!isRecord(value)) {
      error("supplies-amount", "product", id, `The ${what} of the product ${id} is ${shown(value)}. It must be a time from low to high with its fact.`);
      return;
    }
    const fact = value["fact"];
    const found = typeof fact === "string" ? facts.get(fact) : undefined;
    if (found === undefined || found.use !== "fact") error("supplies-fact", "product", id, `The ${what} of the product ${id} cites ${String(fact)}, and the catalog has no fact with that id.`);
    if (typeof fact === "string") used.add(fact);
    const { low, high, unit } = value;
    for (const [name, amount] of [
      ["low", low],
      ["high", high],
    ] as const)
      if (!positive(amount)) error("supplies-amount", "product", id, `The ${name} value of the ${what} of the product ${id} is ${String(amount)}. It must be a finite number more than 0.`);
    if (positive(low) && positive(high) && low > high) error("supplies-amount", "product", id, `The ${what} of the product ${id} is from ${String(low)} to ${String(high)}. The low value must not be more than the high value.`);
    if (!known(unit)) error("supplies-unit", "product", id, `The unit ${String(unit)} of the ${what} of the product ${id} is not a known unit.`);
    else if (!convertible(unit as string, to)) error("supplies-unit", "product", id, `The ${what} of the product ${id} is in ${String(unit)}, and ${String(unit)} does not convert to ${to}.`);
  };

  const resources = new Map<string, SupplyResource>();
  for (const resource of catalog.resources) {
    if (resources.has(resource.code)) error("supplies-twice", "resource", resource.code, `The resource ${resource.code} is two times in the catalog.`);
    if (!known(resource.unit)) error("supplies-unit", "resource", resource.code, `The unit ${String(resource.unit)} of the resource ${resource.code} is not a known unit.`);
    if (!(SUPPLY_KINDS as readonly string[]).includes(resource.kind)) error("supplies-kind", "resource", resource.code, `The kind ${String(resource.kind)} of the resource ${resource.code} is not a supply kind.`);
    if (resource.fuelEnergy !== undefined) {
      rate("resource", resource.code, "fuel energy", resource.fuelEnergy, [FUEL_ENERGY_UNIT], [MASS_UNIT]);
      noBound("resource", resource.code, "fuel energy", resource.fuelEnergy);
      const heating: unknown = isRecord(resource.fuelEnergy) ? resource.fuelEnergy.heating : undefined;
      if (isRecord(resource.fuelEnergy) && !(HEATING_VALUES as readonly unknown[]).includes(heating))
        error("supplies-amount", "resource", resource.code, `The fuel energy of the resource ${resource.code} has the heating value ${String(heating)}. It must be ${HEATING_VALUES.join(" or ")}.`);
    }
    resources.set(resource.code, resource);
  }

  /** This function examines the id of a fact that a reason cites. */
  const cite = (product: string, what: string, id: unknown): void => {
    const fact = typeof id === "string" ? facts.get(id) : undefined;
    if (fact === undefined || fact.use !== "fact") error("supplies-fact", "product", product, `${what} of the product ${product} cites ${String(id)}, and the catalog has no fact with that id.`);
    if (typeof id === "string") used.add(id);
  };
  /** This function examines the text of a definition. */
  const definition = (product: string, what: string, text: unknown): void => {
    if (typeof text !== "string" || text.trim() === "") error("supplies-fact", "product", product, `The definition of the ${what} of the product ${product} is blank.`);
  };
  /** This function examines an amount whose reason is the size of the product. The two amounts must be equal. */
  const sized = (record: CheckedProduct, what: string, value: { readonly amount: unknown; readonly unit: unknown; readonly size?: unknown }): void => {
    const product = record.id;
    if (value.size !== true) {
      error("supplies-fact", "product", product, `The field size of the ${what} of the product ${product} is ${String(value.size)}. A reason that cites the size has size: true.`);
      return;
    }
    const size = record.size;
    // A size cites itself with the reason size, or with a scaled reason whose amount cites the size. JSON can give
    // any value in each field of a scaled reason, so the read is safe.
    const sizeScaled = (size as { readonly scaled?: unknown } | undefined)?.scaled;
    const scaledOf: unknown = typeof sizeScaled === "object" && sizeScaled !== null ? (sizeScaled as { readonly of?: unknown }).of : undefined;
    const ofCitesSize = typeof scaledOf === "object" && scaledOf !== null && (scaledOf as { size?: unknown }).size !== undefined;
    if (size === undefined || size.read !== true || size.size !== undefined || ofCitesSize) {
      error("supplies-fact", "product", product, `The ${what} of the product ${product} cites the size, and the product has no read size with its own reason.`);
      return;
    }
    // The other checks give the error of a value that is not more than 0 or a unit that is not known, so this check
    // does not give a second error for them.
    if (!positive(value.amount) || !positive(size.amount) || !known(value.unit) || !known(size.unit)) return;
    const unit = value.unit as string;
    try {
      const why = whyNotConvertible(size.unit, unit);
      if (why !== undefined) {
        error("supplies-unit", "product", product, `The ${what} of the product ${product} is in ${unit}, and the size that it cites is in ${size.unit}: ${why}.`);
        return;
      }
      const expected = valueIn(amountIn(size.amount, size.unit), canonicalUnit(unit));
      if (!same(expected, value.amount)) error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${String(value.amount)} ${unit}, and the size that it cites is ${String(expected)} ${unit}.`);
    } catch (cause) {
      const code = cause instanceof UnitError ? "supplies-unit" : "supplies-amount";
      error(code, "product", product, `The size that the ${what} of the product ${product} cites has no value in ${unit}: ${cause instanceof Error ? cause.message : String(cause)}.`);
    }
  };
  /** This function examines a scaled reason: its factors, and the amount against the rate times the amount of the reason. */
  const scaled = (record: CheckedProduct, what: string, reason: ScaledReason, value: number, unit: string): void => {
    const product = record.id;
    // A catalog from JSON can have a scaled reason with no rate, no amount of the rate or no amount.
    const { rate, of } = (typeof reason === "object" && reason !== null ? reason : {}) as Partial<ScaledReason>;
    if (typeof rate !== "object" || rate === null || typeof rate.per !== "object" || rate.per === null || typeof of !== "object" || of === null) {
      error("supplies-fact", "product", product, `The scaled ${what} of the product ${product} must have a rate with its amount (\`per\`), and the amount that the rate applies to (\`of\`).`);
      return;
    }
    cite(product, `The rate of the ${what}`, rate.fact);
    const ofReasons = (of.fact === undefined ? 0 : 1) + (of.definition === undefined ? 0 : 1) + (of.size === undefined ? 0 : 1);
    if (ofReasons !== 1) error("supplies-fact", "product", product, `The amount of the scaled ${what} of the product ${product} has ${String(ofReasons)} reasons. It must have one: a fact, a definition or the size.`);
    else if (of.fact !== undefined) cite(product, `The amount of the scaled ${what}`, of.fact);
    else if (of.size !== undefined) sized(record, `amount of the scaled ${what}`, of);
    else definition(product, `amount of the scaled ${what}`, of.definition);
    const factors: [string, number, unknown][] = [
      ["rate", rate.amount, rate.unit],
      ["amount of the rate", rate.per.amount, rate.per.unit],
      ["amount", of.amount, of.unit],
    ];
    let good = Number.isFinite(value) && value > 0 && known(unit);
    for (const [name, factor, factorUnit] of factors) {
      if (!known(factorUnit)) {
        error("supplies-unit", "product", product, `The unit ${String(factorUnit)} of the ${name} of the scaled ${what} of the product ${product} is not a known unit.`);
        good = false;
      }
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
        error("supplies-amount", "product", product, `The ${name} of the scaled ${what} of the product ${product} is ${String(factor)}. It must be a finite number more than 0.`);
        good = false;
      }
    }
    if (!good) return;
    // The units and the values are known, but quantity can still refuse the product: a level unit, for example dB,
    // or a value that overflows. Each refusal is a finding, and the gate does not throw.
    try {
      const total = multiply(divide(amountIn(rate.amount, rate.unit), amountIn(rate.per.amount, rate.per.unit)), amountIn(of.amount, of.unit));
      const why = whyNotConvertible(total.unit, unit);
      if (why !== undefined) {
        error("supplies-unit", "product", product, `The rate times the amount of the scaled ${what} of the product ${product} is in ${total.unit}, and it does not convert to ${unit}: ${why}.`);
        return;
      }
      const expected = valueIn(total, canonicalUnit(unit));
      if (!same(expected, value)) error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${String(value)} ${unit}, and its rate times its amount gives ${String(expected)} ${unit}.`);
    } catch (cause) {
      const code = cause instanceof UnitError ? "supplies-unit" : "supplies-amount";
      error(code, "product", product, `The rate times the amount of the scaled ${what} of the product ${product} has no value: ${cause instanceof Error ? cause.message : String(cause)}.`);
    }
  };

  /** This function examines one cited amount, and gives the unit check to `units`. */
  const amount = (record: CheckedProduct, what: string, value: CitedAmount | NoRead, unit: string): void => {
    const product = record.id;
    // A catalog from JSON can give null in place of an amount, for example the amount of the item of an average price.
    const raw: unknown = value;
    if (!isRecord(raw)) {
      error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${shown(value)}. It must be an amount with its reason, or a no read.`);
      return;
    }
    if (!value.read) {
      warning("supplies-no-read", "product", product, `The ${what} of the product ${product} is no read: ${String(value.why)}`);
      if (typeof value.why !== "string" || value.why.trim() === "") warning("supplies-no-reason", "product", product, `The no read of the ${what} of the product ${product} has no reason.`);
      return;
    }
    // The type permits one reason only. A catalog from JSON can have no reason, two reasons or a blank definition.
    const reasons = (value.fact === undefined ? 0 : 1) + (value.definition === undefined ? 0 : 1) + (value.scaled === undefined ? 0 : 1) + (value.size === undefined ? 0 : 1);
    if (reasons !== 1) error("supplies-fact", "product", product, `The ${what} of the product ${product} has ${String(reasons)} reasons. It must have one: a fact, a definition, a scaled reason or the size.`);
    else if (value.definition !== undefined) definition(product, what, value.definition);
    if (value.fact !== undefined) cite(product, `The ${what}`, value.fact);
    if (value.scaled !== undefined && reasons === 1) scaled(record, what, value.scaled, value.amount, value.unit);
    if (value.size !== undefined && reasons === 1) sized(record, what, value);
    if (!(Number.isFinite(value.amount) && value.amount > 0)) error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${String(value.amount)}. It must be a finite number more than 0.`);
    if (!known(value.unit)) error("supplies-unit", "product", product, `The unit ${String(value.unit)} of the ${what} of the product ${product} is not a known unit.`);
    else if (known(unit) && !convertible(value.unit, unit)) error("supplies-unit", "product", product, `The ${what} of the product ${product} is in ${value.unit}, and ${value.unit} does not convert to ${unit}.`);
  };

  /**
   * This function examines the fields of a product that are records or lists. A catalog from JSON can give null or
   * another value in place of each. The function gives one finding for each such field, and gives the product with
   * no such field. `dropped` is true when it removed a gift, so the rule of a product with no gift does not apply.
   */
  const fieldsOf = (raw: SupplyProduct): { readonly product: CheckedProduct; readonly dropped: boolean } => {
    const id = raw.id;
    const fields: Record<string, unknown> = { ...raw };
    for (const field of ["size", "energy", "perPerson", "average", "cook", "stove", "opened"] as const) {
      const value: unknown = raw[field];
      if (value === undefined || isRecord(value)) continue;
      const must = field === "cook" || field === "stove" || field === "opened" ? "a record of facts" : "an amount with its reason or a no read";
      error("supplies-amount", "product", id, `The field ${field} of the product ${id} is ${shown(value)}. It must be ${must}, or the product has no field ${field}.`);
      fields[field] = undefined;
    }
    const shelf: unknown = raw.shelf;
    if (!isRecord(shelf)) {
      error("supplies-shelf", "product", id, `The shelf life of the product ${id} is ${shown(shelf)}. It must be an amount with its reason, a FoodKeeper id or a no read.`);
      fields["shelf"] = undefined;
    }
    const gives: unknown = raw.gives;
    let dropped = false;
    if (!Array.isArray(gives)) {
      error("supplies-resource", "product", id, `The field gives of the product ${id} is ${shown(gives)}. It must be a list of gifts.`);
      fields["gives"] = [];
      dropped = true;
    } else {
      fields["gives"] = gives.filter((gift: unknown) => {
        if (isRecord(gift) && isRecord(gift["amount"])) return true;
        const resource = isRecord(gift) && typeof gift["resource"] === "string" ? gift["resource"] : "an unknown resource";
        error("supplies-amount", "product", id, `A gift of ${resource} of the product ${id} is ${isRecord(gift) ? `a gift with the amount ${shown(gift["amount"])}` : shown(gift)}. Each gift has a resource and an amount with its reason or a no read.`);
        dropped = true;
        return false;
      });
    }
    return { product: fields as unknown as CheckedProduct, dropped };
  };

  const products = new Set<string>();
  for (const raw of catalog.products) {
    const { product, dropped } = fieldsOf(raw);
    if (products.has(product.id)) error("supplies-twice", "product", product.id, `The product ${product.id} is two times in the catalog.`);
    products.add(product.id);
    if (!(SUPPLY_KINDS as readonly string[]).includes(product.kind)) error("supplies-kind", "product", product.id, `The kind ${String(product.kind)} of the product ${product.id} is not a supply kind.`);
    const gifts = new Set<string>();
    for (const gift of product.gives) {
      if (gifts.has(gift.resource)) error("supplies-twice", "product", product.id, `The product ${product.id} gives the resource ${gift.resource} two times.`);
      gifts.add(gift.resource);
      const resource = resources.get(gift.resource);
      if (resource === undefined) error("supplies-resource", "product", product.id, `The product ${product.id} gives the resource ${gift.resource}, and the catalog has no such resource.`);
      else amount(product, `gift of ${gift.resource}`, gift.amount, resource.unit);
    }
    if (product.gives.length === 0 && !dropped && product.basis === undefined) error("supplies-basis", "product", product.id, `The product ${product.id} gives no resource and has no basis. A product that gives no resource cites a fact in its basis.`);
    if (product.basis !== undefined) {
      const fact = facts.get(product.basis);
      if (fact === undefined || fact.use !== "fact") error("supplies-fact", "product", product.id, `The basis of the product ${product.id} cites ${String(product.basis)}, and the catalog has no fact with that id.`);
      used.add(product.basis);
    }
    // An unknown kind has its own error above, so this rule examines only a known kind that is not food.
    if (product.energy !== undefined && product.kind !== "food" && (SUPPLY_KINDS as readonly string[]).includes(product.kind)) error("supplies-kind", "product", product.id, `The product ${product.id} has a food energy, and its kind is ${String(product.kind)}. Only a product of the kind food has a food energy.`);
    if (product.energy !== undefined) amount(product, "food energy", product.energy, ENERGY_UNIT);
    // `amount` gave the error of an amount that is not a finite number more than 0, so this check skips it.
    if (product.energy?.read === true && positive(product.energy.amount) && known(product.energy.unit) && convertible(product.energy.unit, ENERGY_UNIT)) {
      // The food gifts in a unit of energy share the food energy of the product. A gift of another kind, for example
      // the energy of a battery, is not food energy.
      const energy = valueIn(amountIn(product.energy.amount, product.energy.unit), ENERGY_UNIT);
      const food = product.gives.filter((gift) => resources.get(gift.resource)?.kind === "food");
      const inEnergy = food.filter((gift) => {
        const unit = resources.get(gift.resource)?.unit;
        return known(unit) && convertible(unit as string, ENERGY_UNIT);
      });
      // A food gift in another unit, for example the mass of dry rice, also has food energy. Then the sum is a lower limit.
      const lower = inEnergy.length < food.length;
      // A gift that the field check removed, a gift of a resource that is not in the catalog, a gift with no read, or a
      // value that the gift check refuses makes the sum unknown. The other checks give the finding.
      const unknownSum =
        dropped ||
        product.gives.some((gift) => !resources.has(gift.resource)) ||
        !inEnergy.every((gift) => gift.amount.read && positive(gift.amount.amount) && known(gift.amount.unit) && convertible(gift.amount.unit, ENERGY_UNIT));
      if (inEnergy.length > 0 && !unknownSum) {
        const sum = inEnergy.reduce((total, gift) => (gift.amount.read ? total + valueIn(amountIn(gift.amount.amount, gift.amount.unit), ENERGY_UNIT) : total), 0);
        const names = inEnergy.map((gift) => gift.resource).join(", ");
        const given = Number.isFinite(sum) ? `${String(sum)} kcal` : "more kcal than the largest finite number";
        if (lower && !same(sum, energy) && !(sum < energy))
          error("supplies-energy", "product", product.id, `The product ${product.id} gives ${given} of food energy in its gifts (${names}), and its food energy is ${String(energy)} kcal. Its other food gifts also have food energy, so the sum must not be more than the food energy.`);
        else if (!lower && !same(sum, energy))
          error("supplies-energy", "product", product.id, `The product ${product.id} gives ${given} of food energy in its gifts (${names}), and its food energy is ${String(energy)} kcal. The two must be equal.`);
      }
    }
    if (product.cook !== undefined) {
      // An unknown kind has its own error above, so this rule examines only a known kind that is not food.
      if (product.kind !== "food" && (SUPPLY_KINDS as readonly string[]).includes(product.kind)) error("supplies-kind", "product", product.id, `The product ${product.id} has cook facts, and its kind is ${String(product.kind)}. Only a product of the kind food has cook facts.`);
      const { water, bulk, time } = product.cook;
      const goodWater = water !== undefined && rate("product", product.id, "cook water", water, [VOLUME_UNIT], [VOLUME_UNIT, MASS_UNIT]);
      if (bulk !== undefined) rate("product", product.id, "bulk mass", bulk, [MASS_UNIT], [VOLUME_UNIT]);
      noBound("product", product.id, "cook water", water);
      noBound("product", product.id, "bulk mass", bulk);
      if (time !== undefined) span(product.id, "cook time", time, COOK_TIME_UNIT);
      // A water rate for each volume of dry food needs the mass of that volume.
      if (goodWater && convertible(water.per.unit, VOLUME_UNIT) && bulk === undefined)
        error("supplies-fact", "product", product.id, `The cook water of the product ${product.id} is for a volume of dry food, and the product has no bulk mass. The bulk mass converts the volume to a mass.`);
    }
    if (product.stove !== undefined) {
      const { fuel, rate: fuelRate, boil, heating } = product.stove;
      const burned = typeof fuel === "string" ? resources.get(fuel) : undefined;
      if (burned === undefined) error("supplies-resource", "product", product.id, `The stove ${product.id} burns the resource ${String(fuel)}, and the catalog has no such resource.`);
      else if (burned.kind !== "heat") error("supplies-kind", "product", product.id, `The stove ${product.id} burns the resource ${burned.code}, and its kind is ${String(burned.kind)}. A fuel has the kind heat.`);
      const goodRate = fuelRate !== undefined && rate("product", product.id, "fuel rate of the stove", fuelRate, [FUEL_ENERGY_UNIT, MASS_UNIT], [STOVE_TIME_UNIT]);
      const bound: unknown = isRecord(fuelRate) ? fuelRate["bound"] : undefined;
      if (bound !== undefined && !(RATE_BOUNDS as readonly unknown[]).includes(bound))
        error("supplies-amount", "product", product.id, `The fuel rate of the stove ${product.id} has the bound ${shown(bound)}. It must be ${RATE_BOUNDS.join(" or ")}, or the rate has no bound.`);
      if (heating !== undefined && !(HEATING_VALUES as readonly unknown[]).includes(heating))
        error("supplies-amount", "product", product.id, `The fuel rate of the stove ${product.id} has the heating value ${String(heating)}. It must be ${HEATING_VALUES.join(" or ")}.`);
      if (boil !== undefined) {
        rate("product", product.id, "boil yield of the stove", boil, [VOLUME_UNIT], [MASS_UNIT]);
        const boilBound: unknown = isRecord(boil) ? boil["bound"] : undefined;
        if (boilBound !== undefined && !(RATE_BOUNDS as readonly unknown[]).includes(boilBound))
          error("supplies-amount", "product", product.id, `The boil yield of the stove ${product.id} has the bound ${shown(boilBound)}. It must be ${RATE_BOUNDS.join(" or ")}, or the yield has no bound.`);
        // The yield is for liquid water: it starts at 0 °C or more, and below the boil at 100 °C. A yield with no start is valid, and it gives no read.
        const start: unknown = isRecord(boil) ? boil["start"] : undefined;
        if (start !== undefined && !isRecord(start)) error("supplies-amount", "product", product.id, `The start temperature of the boil yield of the stove ${product.id} is ${shown(start)}. It must be a temperature with its fact.`);
        else if (isRecord(start)) {
          const celsius = start["celsius"];
          if (typeof celsius !== "number" || !Number.isFinite(celsius) || celsius < 0 || !(celsius < 100))
            error("supplies-amount", "product", product.id, `The start temperature of the boil yield of the stove ${product.id} is ${shown(celsius)}. It must be a number from 0 °C to less than 100 °C.`);
          cite(product.id, "The start temperature of the boil yield", start["fact"]);
        }
      }
      // A rate in an energy needs its heating value: the higher and the lower value of a fuel differ by 5% to 10%.
      if (goodRate && convertible(fuelRate.unit, FUEL_ENERGY_UNIT) && heating === undefined)
        error("supplies-amount", "product", product.id, `The fuel rate of the stove ${product.id} is an energy, and it has no heating value. Give ${HEATING_VALUES.join(" or ")}.`);
    }
    if (product.opened !== undefined) {
      const { container, noCold } = product.opened;
      cite(product.id, "The use with no cold storage", noCold);
      amount(product, "container", container, "");
      const size = product.size;
      if (size === undefined) error("supplies-amount", "product", product.id, `The product ${product.id} has a container, and it has no size. The size gives the count of containers in a unit.`);
      else if (isRecord(container) && container.read && size.read && known(container.unit) && known(size.unit)) {
        if (!convertible(container.unit, size.unit)) error("supplies-unit", "product", product.id, `The container of the product ${product.id} is in ${container.unit}, and ${container.unit} does not convert to ${size.unit}, the unit of its size.`);
        else {
          const count = valueIn(amountIn(size.amount, size.unit), canonicalUnit(container.unit)) / valueIn(amountIn(container.amount, container.unit), canonicalUnit(container.unit));
          if (!same(count, Math.round(count)) || Math.round(count) < 1) error("supplies-amount", "product", product.id, `The size of the product ${product.id} holds ${String(count)} containers. It must hold a whole count of 1 or more.`);
        }
      }
    }
    if (product.size !== undefined) {
      // The size has no single unit to convert to. Its unit must be a mass, a volume or one bare count. An unknown unit
      // has its own error.
      amount(product, "size", product.size, "");
      if (product.size.read && known(product.size.unit) && !sizeUnit(product.size.unit))
        error("supplies-unit", "product", product.id, `The size of the product ${product.id} is in ${product.size.unit}. It must be a mass, a volume or a count.`);
    }
    if (product.perPerson !== undefined) {
      // The count has no single unit to convert to. Its unit must be one bare count. An unknown unit has its own error.
      // A count that is not read gives no count of units, so the gate refuses it. A catalog from JSON can have one.
      if (product.perPerson.read !== true) error("supplies-amount", "product", product.id, `The count for each person of the product ${product.id} is not read. A product with no known count has no field perPerson.`);
      else amount(product, "count for each person", product.perPerson, "");
      if (product.perPerson.read === true && known(product.perPerson.unit) && !countUnit(product.perPerson.unit))
        error("supplies-unit", "product", product.id, `The count for each person of the product ${product.id} is in ${product.perPerson.unit}. It must be one bare count, for example {each}.`);
    }
    if (product.forPersons !== undefined) {
      // The count of persons divides the count for each person, so it has no meaning without it.
      if (product.perPerson === undefined) error("supplies-amount", "product", product.id, `The product ${product.id} has a count of persons (forPersons) and no count perPerson. The count of persons is for the count perPerson.`);
      if (!(Number.isSafeInteger(product.forPersons) && product.forPersons >= 1))
        error("supplies-amount", "product", product.id, `The count of persons (forPersons) of the product ${product.id} is ${shown(product.forPersons)}. It must be a whole number of 1 or more.`);
    }
    if (product.average !== undefined) amount(product, "average price", product.average.read ? product.average.per : product.average, product.average.read && isRecord(product.average.per) ? product.average.per.unit : "");
    if (product.shelf === undefined) continue;
    if ("foodKeeper" in product.shelf) {
      if (!(Number.isSafeInteger(product.shelf.foodKeeper) && product.shelf.foodKeeper > 0)) error("supplies-shelf", "product", product.id, `The FoodKeeper id of the product ${product.id} is ${String(product.shelf.foodKeeper)}. It must be a whole number more than 0.`);
      else if (foodKeeper !== undefined && !foodKeeper.has(product.shelf.foodKeeper))
        error("supplies-shelf", "product", product.id, `The FoodKeeper id ${String(product.shelf.foodKeeper)} of the product ${product.id} is not in the known FoodKeeper ids.`);
    } else amount(product, "shelf life", product.shelf, SHELF_UNIT);
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
 * count for each person has that count times the persons, divided by its count of persons (`forPersons`). The result
 * goes up to the next whole unit. Each other product has 1. The calculation is exact: the count is the decimal of its number, so 1.1
 * for each person of 50 persons gives 55, not 56. 1 for each 3 persons of 7 persons gives 3.
 *
 * @param people - The count of persons of the household. The persons are input data of the user.
 * @returns The function `max` of `supplyWants`
 * @throws RangeError when the count of persons is not a whole number of 0 or more
 */
export function kitMax(people: number): (product: SupplyProduct) => number {
  if (!(Number.isSafeInteger(people) && people >= 0)) throw new RangeError(`The count of persons is ${String(people)}. It must be a whole number of 0 or more.`);
  const persons = rationals.fromNumber(people);
  return (product) =>
    product.perPerson === undefined
      ? 1
      : rationals.toNumber(rationals.ceil(rationals.div(rationals.mul(rationals.fromNumber(product.perPerson.amount), persons), rationals.fromNumber(product.forPersons ?? 1))));
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

/**
 * This function gives the cook water of a dry food in `L/kg`, from its cited facts. A water rate for each mass converts
 * directly. A water rate for each volume divides by the bulk mass of the food. A product with no water rate, or with a
 * water rate for each volume and no bulk mass, gives `undefined`. It is not 0.
 *
 * @param product - The product
 * @returns The litres of water for each kilogram of the dry food, or `undefined`
 * @throws The error of `@mark1russell7/quantity` when a unit is not known or does not convert
 */
export function cookWater(product: SupplyProduct): Quantity | undefined {
  const water = product.cook?.water;
  if (water === undefined) return undefined;
  const ratio = divide(amountIn(water.amount, water.unit), amountIn(water.per.amount, water.per.unit));
  if (convertible(water.per.unit, MASS_UNIT)) return quantity(valueIn(ratio, COOK_WATER_UNIT), COOK_WATER_UNIT);
  const bulk = product.cook?.bulk;
  if (bulk === undefined) return undefined;
  const density = divide(amountIn(bulk.amount, bulk.unit), amountIn(bulk.per.amount, bulk.per.unit));
  return quantity(valueIn(divide(ratio, density), COOK_WATER_UNIT), COOK_WATER_UNIT);
}

/**
 * This function gives the energy of a fuel in `kJ/kg`, from its cited rate. For example, 2219.2 kJ in 44.0956 g gives
 * 50327 kJ/kg. A resource with no field `fuelEnergy` gives `undefined`. The field `heating` of the rate tells which
 * value it is.
 *
 * @param resource - The resource of the fuel
 * @returns The energy for each kilogram of the fuel, or `undefined`
 * @throws The error of `@mark1russell7/quantity` when a unit is not known or does not convert
 */
export function fuelEnergyPerMass(resource: SupplyResource): Quantity | undefined {
  const energy = resource.fuelEnergy;
  if (energy === undefined) return undefined;
  const value = divide(amountIn(energy.amount, energy.unit), amountIn(energy.per.amount, energy.per.unit));
  return quantity(valueIn(value, FUEL_ENERGY_RATE_UNIT), FUEL_ENERGY_RATE_UNIT);
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
