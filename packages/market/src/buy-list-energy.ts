import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { giftsOf, type SupplyCatalog } from "./supplies.ts";

/*
 * This module has the food energy of a buy list, from the catalog of supplies. It gives the energy of each line and
 * their sum. The energy need of the members, the days of food and the shortfall are not in this package. The days
 * depend on the water and the fuel that a case leaves, so the model of the endurance of the stores gives them.
 */

/** The unit of each food energy. */
const ENERGY_UNIT = "kcal";

/**
 * The food energy of the units of one product of a buy list, or no read with the reason. A no read is not 0.
 * The resources are the codes of the gifts of the product, for example `food.no-cook` or `food.grain-dry`.
 */
export type BuyListEnergyLine =
  | { readonly product: string; readonly units: number; readonly resources: readonly string[]; readonly read: true; readonly energy: Quantity }
  | { readonly product: string; readonly units: number; readonly resources: readonly string[]; readonly read: false; readonly why: string };

/** The food energy of a buy list. */
export interface BuyListEnergy {
  /** The food energy of each product of the list, in the order of the list. */
  readonly lines: readonly BuyListEnergyLine[];
  /** True when each line has a read. When it is false, `energy` is a lower limit. */
  readonly read: boolean;
  /** The sum of the food energy of the lines with a read, in `kcal`. */
  readonly energy: Quantity;
}

/**
 * This function gives the food energy of a buy list, from the catalog. The energy of each product is its field
 * `energy` times its count of units. Each line has the resources of the product. Thus a caller can split the energy
 * of `food.no-cook` from the energy of the dry food.
 *
 * - A product with a no read for its energy gives a line with no read. A no read is not 0.
 * - A food product with no field `energy` also gives a line with no read.
 * - A product of another kind is not food, for example water or a battery. It gives no line, also when it has a
 *   field `energy`. The gate of the catalog refuses that field on a product that is not food.
 * - A product with 0 units gives no line.
 *
 * The list can be the `units` of a buy order.
 *
 * @param catalog - The catalog of supplies
 * @param units - The count of units of each product of the list, by the `id` of the product
 * @throws RangeError when a count of units is not a finite number of 0 or more, or when the catalog has no such product
 * @throws RangeError when a product gives a resource that the catalog does not have, as for `giftsOf`
 * @throws The error of `valueIn` of `@mark1russell7/quantity` when the unit of an energy does not convert to `kcal`
 */
export function buyListEnergy(catalog: SupplyCatalog, units: Readonly<Record<string, number>>): BuyListEnergy {
  const lines: BuyListEnergyLine[] = [];
  for (const [id, count] of Object.entries(units)) {
    // `giftsOf` refuses a bad count of units and an unknown product.
    const resources = giftsOf(catalog, id, count).map((gift) => gift.resource);
    const product = catalog.products.find((each) => each.id === id);
    if (product === undefined || count === 0 || product.kind !== "food") continue;
    const energy = product.energy;
    if (energy === undefined) {
      lines.push({ product: id, units: count, resources, read: false, why: `The catalog has no food energy for the product ${id}.` });
      continue;
    }
    if (!energy.read) lines.push({ product: id, units: count, resources, read: false, why: energy.why });
    else lines.push({ product: id, units: count, resources, read: true, energy: quantity(count * valueIn(quantity(energy.amount, energy.unit), ENERGY_UNIT), ENERGY_UNIT) });
  }
  const total = lines.reduce((sum, line) => sum + (line.read ? line.energy.value : 0), 0);
  return { lines, read: lines.every((line) => line.read), energy: quantity(total, ENERGY_UNIT) };
}
