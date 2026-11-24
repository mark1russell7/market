import { describe, expect, it } from "vitest";
import { checkSupplies, cookWater, fuelEnergyPerMass, type CitedRate, type CitedSpan, type SupplyCatalog, type SupplyProduct, type SupplyResource } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const errors = (catalog: SupplyCatalog): string[] =>
  checkSupplies(catalog)
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.code);
const product = (id: string): SupplyProduct => SUPPLY_CATALOG.products.find((each) => each.id === id)!;
const resource = (code: string): SupplyResource => SUPPLY_CATALOG.resources.find((each) => each.code === code)!;
const rice = product("food.rice-white-1kg");
const withProduct = (next: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === next.id ? next : each)) });
const withResource = (next: SupplyResource): SupplyCatalog => ({ ...SUPPLY_CATALOG, resources: SUPPLY_CATALOG.resources.map((each) => (each.code === next.code ? next : each)) });
const radio = product("communication.noaa-radio");

/** This function gives the facts that the cook facts, the stoves and the fuel energy of a catalog cite. */
function citedFacts(catalog: SupplyCatalog): { readonly where: string; readonly fact: string }[] {
  const out: { where: string; fact: string }[] = [];
  for (const each of catalog.resources) if (each.fuelEnergy !== undefined) out.push({ where: `${each.code} fuelEnergy`, fact: each.fuelEnergy.fact });
  for (const each of catalog.products) {
    const cook = each.cook;
    if (cook !== undefined)
      for (const [name, value] of Object.entries(cook) as [string, CitedRate | CitedSpan | undefined][]) if (value !== undefined) out.push({ where: `${each.id} cook.${name}`, fact: value.fact });
    const rate = each.stove?.rate;
    if (rate !== undefined) out.push({ where: `${each.id} stove.rate`, fact: rate.fact });
  }
  return out;
}

describe("the cook facts and the fuel energy of the reference catalog", () => {
  it("passes the gate of the whole catalog with the checks of the date of the cook sources", () => {
    expect(errors(SUPPLY_CATALOG)).toEqual([]);
    expect(checkSupplies(SUPPLY_CATALOG, { at: "2026-11-24" }).filter((finding) => finding.level === "error")).toEqual([]);
  });

  it("gives each cook and fuel field a fact with a source and a license", () => {
    const cited = citedFacts(SUPPLY_CATALOG);
    expect(cited.length).toBe(10);
    for (const { where, fact } of cited) {
      const unit = SUPPLY_CATALOG.facts.find((each) => each.id === fact);
      expect(unit?.use, where).toBe("fact");
      const source = SUPPLY_CATALOG.sources.find((each) => each.id === unit?.source);
      expect(source?.license, where).toBeDefined();
      expect(source?.license, where).not.toBe("invented");
      expect(source?.url, where).toMatch(/^https:\/\//);
    }
  });

  it("fails the gate for a cook or fuel field whose fact is not in the catalog, or whose fact has no source", () => {
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, time: { low: 15, high: 18, unit: "min", fact: "no.such-fact" } } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, water: { amount: 2, unit: "cup", per: { amount: 1, unit: "cup" }, fact: "no.such-fact" } } }))).toEqual(["supplies-fact"]);
    const propane = resource("fuel.propane");
    expect(errors(withResource({ ...propane, fuelEnergy: { ...propane.fuelEnergy!, fact: "no.such-fact" } }))).toEqual(["supplies-fact"]);
    const facts = SUPPLY_CATALOG.facts.map((each) => (each.id === "nist.propane-combustion" ? { ...each, source: "no.such-source" } : each));
    expect(errors({ ...SUPPLY_CATALOG, facts })).toEqual(["missing-source"]);
  });

  it("keeps each fuel energy as the cited numbers, and gives them in kJ/kg", () => {
    expect(resource("fuel.propane").fuelEnergy).toEqual({ amount: 2219.2, unit: "kJ", per: { amount: 44.0956, unit: "g" }, fact: "nist.propane-combustion", heating: "higher" });
    expect(resource("fuel.butane").fuelEnergy).toEqual({ amount: 2877.5, unit: "kJ", per: { amount: 58.1222, unit: "g" }, fact: "nist.butane-combustion", heating: "higher" });
    expect(fuelEnergyPerMass(resource("fuel.propane"))!.unit).toBe("kJ/kg");
    expect(fuelEnergyPerMass(resource("fuel.propane"))!.value).toBeCloseTo(2219.2 / 0.0440956, 6);
    expect(fuelEnergyPerMass(resource("fuel.butane"))!.value).toBeCloseTo(2877.5 / 0.0581222, 6);
    expect(fuelEnergyPerMass(resource("water.stored"))).toBeUndefined();
  });

  it("keeps the cook facts as the cited numbers", () => {
    expect(rice.cook).toEqual({
      water: { amount: 2, unit: "cup", per: { amount: 1, unit: "cup" }, fact: "usarice.long-grain-white" },
      bulk: { amount: 185, unit: "g", per: { amount: 1, unit: "cup" }, fact: "fdc.rice-white-cup" },
      time: { low: 15, high: 18, unit: "min", fact: "usarice.long-grain-white" },
    });
    expect(product("food.oats-1kg").cook?.time).toEqual({ low: 5, high: 5, unit: "min", fact: "quaker.oats-stovetop" });
    expect(product("food.beans-dry-1kg").cook).toEqual({ time: { low: 1, high: 1.5, unit: "h", fact: "usda.pinto-beans-cook" } });
    expect(product("food.pasta-dry-1kg").cook).toEqual({ time: { low: 9, high: 11, unit: "min", fact: "ronzoni.spaghetti-cook" } });
  });

  it("has no cook field with no cited fact: the beans and the pasta have no water, and the flour has no cook facts", () => {
    expect(product("food.beans-dry-1kg").cook?.water).toBeUndefined();
    expect(product("food.pasta-dry-1kg").cook?.water).toBeUndefined();
    expect("cook" in product("food.flour-white-1kg")).toBe(false);
    for (const each of SUPPLY_CATALOG.products.filter((item) => item.kind !== "food")) expect("cook" in each, each.id).toBe(false);
    expect(SUPPLY_CATALOG.products.filter((item) => item.stove !== undefined)).toEqual([]);
  });

  it("gives the cook water in L/kg from the water for each volume and the bulk mass", () => {
    // 2 cup of water in 1 cup of rice, and 1 cup of rice is 185 g: 2 × 0.2365882365 L / 0.185 kg.
    expect(cookWater(rice)!.unit).toBe("L/kg");
    expect(cookWater(rice)!.value).toBeCloseTo((2 * 0.2365882365) / 0.185, 9);
    expect(cookWater(product("food.oats-1kg"))!.value).toBeCloseTo((2 * 0.2365882365) / 0.081, 9);
    expect(cookWater(product("food.beans-dry-1kg"))).toBeUndefined();
    expect(cookWater({ ...rice, cook: { water: { amount: 4, unit: "qt", per: { amount: 1, unit: "lb" }, fact: "usarice.long-grain-white" } } })!.value).toBeCloseTo((4 * 0.946352946) / 0.45359237, 9);
    expect(cookWater({ ...rice, cook: { water: rice.cook!.water } })).toBeUndefined();
  });
});

describe("the gate of the cook facts, the stoves and the fuel energy", () => {
  it("refuses a cook water for each volume with no bulk mass", () => {
    expect(errors(withProduct({ ...rice, cook: { water: rice.cook!.water } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { water: { ...rice.cook!.water!, per: { amount: 1, unit: "kg" } } } }))).toEqual([]);
  });

  it("refuses amounts that are not more than 0, units that do not fit, and a time with low more than high", () => {
    const water = rice.cook!.water!;
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, water: { ...water, amount: 0 } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, water: { ...water, unit: "kg" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, water: { ...water, per: { amount: 1, unit: "h" } } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, bulk: { ...rice.cook!.bulk!, unit: "L" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, time: { low: 18, high: 15, unit: "min", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, time: { low: 15, high: 18, unit: "kg", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, time: { low: 15, high: 18, unit: "foo", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, time: { low: -1, high: 18, unit: "min", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-amount"]);
  });

  it("refuses cook facts on a product that is not food", () => {
    expect(errors(withProduct({ ...radio, cook: { time: rice.cook!.time } }))).toEqual(["supplies-kind"]);
  });

  it("refuses a fuel energy that is not an energy for each mass, or that has no known heating value", () => {
    const propane = resource("fuel.propane");
    const energy = propane.fuelEnergy!;
    expect(errors(withResource({ ...propane, fuelEnergy: { ...energy, unit: "kg" } }))).toEqual(["supplies-unit"]);
    expect(errors(withResource({ ...propane, fuelEnergy: { ...energy, per: { amount: 1, unit: "L" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withResource({ ...propane, fuelEnergy: { ...energy, per: { amount: 0, unit: "g" } } }))).toEqual(["supplies-amount"]);
    expect(errors(withResource({ ...propane, fuelEnergy: { ...energy, heating: "gross" as never } }))).toEqual(["supplies-amount"]);
    expect(errors(withResource({ ...propane, fuelEnergy: null as never }))).toEqual(["supplies-amount"]);
  });

  it("examines a stove: its fuel is a heat resource of the catalog, and its fuel rate is an energy or a mass in a time", () => {
    const stove = (rate: SupplyProduct["stove"]): SupplyCatalog => withProduct({ ...radio, stove: rate });
    const fact = "ready.kit-radio";
    expect(errors(stove({ fuel: "fuel.butane" }))).toEqual([]);
    const hour = { amount: 1, unit: "h" };
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kWh", per: hour, fact }, heating: "higher" }))).toEqual([]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 227, unit: "g", per: { amount: 90, unit: "min" }, fact } }))).toEqual([]);
    expect(errors(stove({ fuel: "fuel.wood" }))).toEqual(["supplies-resource"]);
    // A stove burns a fuel: a resource of the kind heat.
    expect(errors(stove({ fuel: "water.stored" }))).toEqual(["supplies-kind"]);
    // A rate in an energy needs its heating value. A rate in a mass needs none.
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kWh", per: hour, fact } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kWh", per: hour, fact }, heating: "gross" as never }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kW", per: hour, fact }, heating: "higher" }))).toEqual(["supplies-unit"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kWh", per: { amount: 1, unit: "kg" }, fact }, heating: "higher" }))).toEqual(["supplies-unit"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 3.5, unit: "kWh", per: hour, fact: "no.such-fact" }, heating: "higher" }))).toEqual(["supplies-fact"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 0, unit: "kWh", per: hour, fact }, heating: "higher" }))).toEqual(["supplies-amount"]);
  });

  it("gives a finding, and does not throw, for cook facts or a stove that are not a record, or a rate with no per", () => {
    const raw = (fields: Record<string, unknown>): SupplyCatalog => withProduct({ ...rice, ...fields } as unknown as SupplyProduct);
    expect(errors(raw({ cook: null }))).toEqual(["supplies-amount"]);
    expect(checkSupplies(raw({ stove: "a stove" })).find((finding) => finding.code === "supplies-amount")?.message).toContain("It must be a record of facts");
    expect(errors(raw({ cook: { ...rice.cook, water: { amount: 2, unit: "cup", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-amount"]);
    expect(errors(raw({ cook: { ...rice.cook, time: 15 } }))).toEqual(["supplies-amount"]);
  });
});
