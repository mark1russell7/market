/**
 * The catalog of supplies: the format, the gate, the wants of its products and the gifts of their units, and the
 * reference catalog. It also gives the price of a product from an average price, and the cost of a food plan of USDA.
 * It gives the energy need of a household from the Dietary Guidelines for Americans, and the energy check of a buy list.
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
export {
  ACTIVITY_LEVELS,
  CALORIE_AGES,
  CALORIE_GROUPS,
  CALORIE_SEXES,
  calorieNeed,
  foodEnergyCheck,
  type ActivityLevel,
  type CalorieAge,
  type CalorieGroup,
  type CalorieMember,
  type CalorieNeed,
  type CalorieSex,
  type CalorieTable,
  type FoodEnergyCheck,
  type FoodEnergyLine,
} from "./food-energy.ts";
export { CALORIE_TABLES } from "./food-energy-data.ts";
