import { describe, expect, it } from "vitest";
import { buyListEnergy } from "./buy-list-energy.ts";
import type { SupplyCatalog, SupplyProduct } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

/** The reference catalog with more products, for the cases that it does not have. */
function withProducts(...products: SupplyProduct[]): SupplyCatalog {
  return { ...SUPPLY_CATALOG, products: [...SUPPLY_CATALOG.products, ...products] };
}

const noLabel = { read: false, why: "No label." } as const;

describe("the food energy of a buy list", () => {
  it("gives the energy of each line with its resources, and their sum", () => {
    const energy = buyListEnergy(SUPPLY_CATALOG, { "food.rice-white-1kg": 14, "food.peanut-butter-1kg": 2, "food.soup-can": 4, "water.jug-1gal": 20 });
    expect(energy.lines).toEqual([
      { product: "food.rice-white-1kg", units: 14, resources: ["food.grain-dry"], read: true, energy: { value: 51100, unit: "kcal" } },
      { product: "food.peanut-butter-1kg", units: 2, resources: ["food.no-cook"], read: true, energy: { value: 11960, unit: "kcal" } },
      { product: "food.soup-can", units: 4, resources: ["food.no-cook"], read: true, energy: { value: expect.closeTo(869.2, 6) as number, unit: "kcal" } },
    ]);
    expect(energy.read).toBe(true);
    expect(energy.energy.unit).toBe("kcal");
    expect(energy.energy.value).toBeCloseTo(51100 + 11960 + 869.2, 6);
  });

  it("lets a caller split the energy of the food with no water and no fuel from the dry food", () => {
    const energy = buyListEnergy(SUPPLY_CATALOG, { "food.rice-white-1kg": 2, "food.peanut-butter-1kg": 1 });
    const noCook = energy.lines.filter((line) => line.read && line.resources.includes("food.no-cook")).reduce((sum, line) => sum + (line.read ? line.energy.value : 0), 0);
    expect(noCook).toBe(5980);
  });

  it("keeps a no read of energy as a line with no read, not as 0, and the sum is then a lower limit", () => {
    const catalog = withProducts(
      { id: "food.mystery", title: "A food with no label", kind: "food", gives: [], basis: "ready.kit-first-aid", energy: { read: false, why: "The label is lost." }, shelf: noLabel },
      { id: "food.unlisted", title: "A food with no energy field", kind: "food", gives: [], basis: "ready.kit-first-aid", shelf: noLabel },
    );
    const energy = buyListEnergy(catalog, { "food.oats-1kg": 2, "food.mystery": 3, "food.unlisted": 1 });
    expect(energy.read).toBe(false);
    expect(energy.lines.map((line) => [line.product, line.read])).toEqual([
      ["food.oats-1kg", true],
      ["food.mystery", false],
      ["food.unlisted", false],
    ]);
    expect(energy.lines[1]).toEqual({ product: "food.mystery", units: 3, resources: [], read: false, why: "The label is lost." });
    expect(energy.energy).toEqual({ value: 7580, unit: "kcal" });
  });

  it("gives no line for a product with 0 units or a product that is not food, and converts an energy in kJ", () => {
    const catalog = withProducts({ id: "food.bar", title: "A ration bar", kind: "food", gives: [], basis: "ready.kit-first-aid", energy: { read: true, amount: 4184, unit: "kJ", definition: "A test value." }, shelf: noLabel });
    const energy = buyListEnergy(catalog, { "food.bar": 2, "food.oats-1kg": 0, "water.jug-1gal": 3 });
    expect(energy.lines.map((line) => line.product)).toEqual(["food.bar"]);
    expect(energy.energy.value).toBeCloseTo(2000, 6);
    expect(buyListEnergy(SUPPLY_CATALOG, {})).toEqual({ lines: [], read: true, energy: { value: 0, unit: "kcal" } });
  });

  it("refuses an unknown product and a bad count of units", () => {
    expect(() => buyListEnergy(SUPPLY_CATALOG, { "food.unknown": 1 })).toThrow(RangeError);
    for (const units of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => buyListEnergy(SUPPLY_CATALOG, { "food.oats-1kg": units }), String(units)).toThrow(RangeError);
  });
});
