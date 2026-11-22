import type { FoodPlan } from "./food-plan.ts";

// The costs of the food plans of USDA. Each value is from the table of the report, read on 2026-11-22. The report
// rounds each weekly cost to 10 cents. Footnote 2 of the report gives the change for each size of household.

const week = (value: number): { readonly value: number; readonly unit: string } => ({ value, unit: "USD/wk" });

/** The costs of the food plans of USDA, one record for each plan and month. */
export const FOOD_PLANS: readonly FoodPlan[] = [
  {
    id: "usda.thrifty:2026-10",
    title: "Official USDA Thrifty Food Plan: U.S. Average, October 2026",
    area: "U.S. average",
    period: "2026-10",
    source: {
      id: "usda.food-plans",
      title: "USDA Food Plans: Monthly Cost of Food Reports",
      url: "https://www.fna.usda.gov/research/cnpp/usda-food-plans/cost-food-monthly-reports",
      license: "us-public-domain",
      checked: "2026-11-22",
      by: "USDA Food and Nutrition Administration",
    },
    locator: "CostofFoodOct2026Thrifty.pdf, the column Weekly Cost of the table of age-sex groups",
    weekly: {
      "child-1": week(26.4),
      "child-2-3": week(39.8),
      "child-4-5": week(43.5),
      "child-6-8": week(48.3),
      "child-9-11": week(55.8),
      "female-12-13": week(51.7),
      "female-14-19": week(60.1),
      "female-20-50": week(58.7),
      "female-51-70": week(54.6),
      "female-71-up": week(60.3),
      "male-12-13": week(59.7),
      "male-14-19": week(75.3),
      "male-20-50": week(73.7),
      "male-51-70": week(65),
      "male-71-up": week(62),
    },
    sizes: [
      { from: 1, to: 1, change: 0.2 },
      { from: 2, to: 2, change: 0.1 },
      { from: 3, to: 3, change: 0.05 },
      { from: 4, to: 4, change: 0 },
      { from: 5, to: 6, change: -0.05 },
      { from: 7, change: -0.1 },
    ],
  },
];
