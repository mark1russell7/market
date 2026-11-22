/**
 * The catalog of supplies: the format, the gate, the wants of its products and the gifts of their units, and the
 * reference catalog. Each value has a cited fact, the definition of the product, or a no read.
 */
export {
  SUPPLY_CODES,
  SUPPLY_FORMAT,
  SUPPLY_KINDS,
  checkSupplies,
  giftsOf,
  supplyWants,
  type CitedAmount,
  type GiftOf,
  type NoRead,
  type ShelfLife,
  type SupplyCatalog,
  type SupplyCode,
  type SupplyFinding,
  type SupplyGift,
  type SupplyKind,
  type SupplyProduct,
  type SupplyResource,
} from "./supplies.ts";
export { SUPPLY_CATALOG } from "./supplies-data.ts";
