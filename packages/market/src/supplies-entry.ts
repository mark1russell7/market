/**
 * The catalog of supplies: the format, the gate, the wants of its products and the gifts of their units, and the
 * reference catalog. It also gives the price of a product from an average price, and the cost of a food plan of USDA.
 * Each value has a cited fact, the definition of the product, or a no read.
 */
export {
  SUPPLY_CODES,
  SUPPLY_FORMAT,
  SUPPLY_KINDS,
  averageSupplyPrices,
  checkSupplies,
  giftsOf,
  supplyWants,
  type AverageJoin,
  type CitedAmount,
  type GiftOf,
  type NoRead,
  type ShelfLife,
  type SupplyCatalog,
  type SupplyCode,
  type SupplyFinding,
  type SupplyGift,
  type SupplyKind,
  type SupplyPrice,
  type SupplyProduct,
  type SupplyResource,
} from "./supplies.ts";
export { SUPPLY_CATALOG } from "./supplies-data.ts";
export {
  FOOD_PLAN_GROUPS,
  foodPlanCheck,
  foodPlanCost,
  type FoodPlan,
  type FoodPlanCheck,
  type FoodPlanGroup,
  type FoodPlanMember,
  type FoodPlanSize,
} from "./food-plan.ts";
export { FOOD_PLANS } from "./food-plan-data.ts";
