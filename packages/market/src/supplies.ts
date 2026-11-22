import { checkSources, checkUnits, type CitedUnit, type Finding, type FindingCode, type GateOptions, type Source } from "@mark1russell7/guidebook";
import { convertible, quantity, valueIn } from "@mark1russell7/quantity";
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

/** A product of the catalog. */
export interface SupplyProduct {
  readonly id: string;
  readonly title: string;
  readonly kind: SupplyKind;
  /** The part that the offers of a seller must match. A product with no part has no offer, so it has no price. */
  readonly want?: PartWant | undefined;
  /** The resources that one unit gives. */
  readonly gives: readonly SupplyGift[];
  /** The food energy of one unit, in a unit of energy. A cooking converter gives it. */
  readonly energy?: CitedAmount | NoRead | undefined;
  readonly shelf: ShelfLife;
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
  "supplies-amount",
  "supplies-unit",
  "supplies-shelf",
  "supplies-unused",
  "supplies-no-read",
] as const;

/** A code of a finding of the catalog gate. */
export type SupplyCode = (typeof SUPPLY_CODES)[number];

/** A finding of the catalog gate, or of the gate of the facts and their sources. */
export type SupplyFinding = Finding<SupplyCode | FindingCode, "source" | "unit" | "resource" | "product">;

/** The unit that each food energy converts to. */
const ENERGY_UNIT = "kcal";
/** The unit that each shelf life converts to. */
const SHELF_UNIT = "d";

/**
 * This function examines a catalog. It gives the findings of the sources and the facts (the gate of
 * `@mark1russell7/guidebook`), and the findings of the products:
 *
 * - An error for a product or a resource two times, a kind that is not a supply kind, and a gift of an unknown resource.
 * - An error for a fact that is not a fact of the catalog, and for an amount that is not more than 0.
 * - An error for a unit that does not convert to the unit of its resource.
 * - A warning for each value with no read, and for each fact and each source that no product uses.
 *
 * @param catalog - The catalog
 * @param options - The options of the gate of the sources, for example the date of the gate
 */
export function checkSupplies(catalog: SupplyCatalog, options: GateOptions = {}): SupplyFinding[] {
  const out: SupplyFinding[] = [...checkSources(catalog.sources, options), ...checkUnits(catalog.facts, catalog.sources, options)];
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
    resources.set(resource.code, resource);
  }
  const facts = new Map(catalog.facts.map((fact) => [fact.id, fact]));
  const used = new Set<string>();

  /** This function examines one cited amount, and gives the unit check to `units`. */
  const amount = (product: string, what: string, value: CitedAmount | NoRead, unit: string): void => {
    if (!value.read) {
      warning("supplies-no-read", "product", product, `The ${what} of the product ${product} is no read: ${value.why}`);
      return;
    }
    if (value.fact !== undefined) {
      const fact = facts.get(value.fact);
      if (fact === undefined || fact.use !== "fact") error("supplies-fact", "product", product, `The ${what} of the product ${product} cites ${value.fact}, and the catalog has no fact with that id.`);
      used.add(value.fact);
    }
    if (!(Number.isFinite(value.amount) && value.amount > 0)) error("supplies-amount", "product", product, `The ${what} of the product ${product} is ${String(value.amount)}. It must be a finite number more than 0.`);
    if (!convertible(value.unit, unit)) error("supplies-unit", "product", product, `The ${what} of the product ${product} is in ${value.unit}, and ${value.unit} does not convert to ${unit}.`);
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
    if (product.energy !== undefined) amount(product.id, "food energy", product.energy, ENERGY_UNIT);
    if ("foodKeeper" in product.shelf) {
      if (!(Number.isSafeInteger(product.shelf.foodKeeper) && product.shelf.foodKeeper > 0)) error("supplies-shelf", "product", product.id, `The FoodKeeper id of the product ${product.id} is ${String(product.shelf.foodKeeper)}. It must be a whole number more than 0.`);
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

/** The gift of a count of units: an amount in the unit of its resource, or no read. */
export type GiftOf = { readonly resource: string; readonly read: true; readonly amount: number; readonly unit: string } | { readonly resource: string; readonly read: false; readonly why: string };

/**
 * This function gives the resources of a count of units of a product, each in the unit of its resource.
 * A gift with no read stays no read: it is not 0.
 *
 * @param catalog - The catalog
 * @param id - The `id` of the product
 * @param units - The count of units
 * @throws RangeError when the catalog has no such product, or a gift of an unknown resource
 */
export function giftsOf(catalog: SupplyCatalog, id: string, units: number): GiftOf[] {
  const product = catalog.products.find((each) => each.id === id);
  if (product === undefined) throw new RangeError(`The catalog has no product ${id}.`);
  return product.gives.map((gift): GiftOf => {
    const resource = catalog.resources.find((each) => each.code === gift.resource);
    if (resource === undefined) throw new RangeError(`The product ${id} gives the resource ${gift.resource}, and the catalog has no such resource.`);
    if (!gift.amount.read) return { resource: gift.resource, read: false, why: gift.amount.why };
    return { resource: gift.resource, read: true, amount: units * valueIn(quantity(gift.amount.amount, gift.amount.unit), resource.unit), unit: resource.unit };
  });
}
