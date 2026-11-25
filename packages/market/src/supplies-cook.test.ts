import { canonicalUnit, divide, quantity, valueIn } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { checkSupplies, cookWater, fuelEnergyPerMass, quickSoakWater, soakWater, type CitedRate, type CitedSpan, type QuickSoak, type SupplyCatalog, type SupplyProduct, type SupplyResource } from "./supplies.ts";
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
    const quick = cook?.quickSoak;
    if (quick !== undefined) out.push({ where: `${each.id} cook.quickSoak.boil`, fact: quick.boil.fact });
    if (quick?.stand !== undefined) out.push({ where: `${each.id} cook.quickSoak.stand`, fact: quick.stand.fact });
    const rate = each.stove?.rate;
    if (rate !== undefined) out.push({ where: `${each.id} stove.rate`, fact: rate.fact });
    const boil = each.stove?.boil;
    if (boil !== undefined) out.push({ where: `${each.id} stove.boil`, fact: boil.fact });
    if (boil?.start !== undefined) out.push({ where: `${each.id} stove.boil.start`, fact: boil.start.fact });
    if (boil?.end !== undefined) out.push({ where: `${each.id} stove.boil.end`, fact: boil.end.fact });
    const adverse = each.stove?.adverse;
    if (adverse !== undefined) out.push({ where: `${each.id} stove.adverse`, fact: adverse.fact });
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
    expect(cited.length).toBe(23);
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
    expect(product("food.beans-dry-1kg").cook).toEqual({
      water: { amount: 1.75, unit: "qt", per: { amount: 1, unit: "lb" }, fact: "usda.refried-beans-cook" },
      soak: { amount: 1.75, unit: "qt", per: { amount: 1, unit: "lb" }, fact: "usda.refried-beans-soak" },
      time: { low: 1, high: 1.5, unit: "h", fact: "usda.pinto-beans-cook" },
    });
    expect(product("food.pasta-dry-1kg").cook).toEqual({
      water: { amount: 3, unit: "gal", per: { amount: 25, unit: "oz" }, fact: "usda.spaghetti-meat-sauce-cook" },
      time: { low: 9, high: 11, unit: "min", fact: "ronzoni.spaghetti-cook" },
    });
  });

  it("has no cook field with no cited fact: the rice and the pasta have no soak, and the flour has no cook facts", () => {
    expect(product("food.rice-white-1kg").cook?.soak).toBeUndefined();
    expect(product("food.pasta-dry-1kg").cook?.soak).toBeUndefined();
    expect("cook" in product("food.flour-white-1kg")).toBe(false);
    for (const each of SUPPLY_CATALOG.products.filter((item) => item.kind !== "food")) expect("cook" in each, each.id).toBe(false);
  });

  it("gives the cook water in L/kg from the water for each volume and the bulk mass", () => {
    // 2 cup of water in 1 cup of rice, and 1 cup of rice is 185 g: 2 × 0.2365882365 L / 0.185 kg.
    expect(cookWater(rice)!.unit).toBe("L/kg");
    expect(cookWater(rice)!.value).toBeCloseTo((2 * 0.2365882365) / 0.185, 9);
    expect(cookWater(product("food.oats-1kg"))!.value).toBeCloseTo((2 * 0.2365882365) / 0.081, 9);
    // The USDA recipe gives 1 3/4 qt of water for each lb of dry beans, for the soak and again for the cook.
    const beans = product("food.beans-dry-1kg");
    expect(cookWater(beans)!.value).toBeCloseTo((1.75 * 0.946352946) / 0.45359237, 9);
    expect(soakWater(beans)!.value).toBeCloseTo((1.75 * 0.946352946) / 0.45359237, 9);
    expect(soakWater(rice)).toBeUndefined();
    // The quick soak of the same recipe boils the same 1 3/4 qt for each lb for 2 min, and the beans stand in it for 1 h.
    expect(quickSoakWater(beans)!.value).toBeCloseTo((1.75 * 0.946352946) / 0.45359237, 9);
    expect(beans.cook?.quickSoak?.boil).toEqual({ low: 2, high: 2, unit: "min", fact: "usda.refried-beans-quick-soak" });
    expect(beans.cook?.quickSoak?.stand).toEqual({ low: 1, high: 1, unit: "h", fact: "usda.refried-beans-quick-soak" });
    expect(beans.cook?.unsoakedTime).toBeUndefined();
    // A made-up quick soak of 10 cup of water for each lb, and of 2 cup for each cup of rice with its bulk mass.
    const time = rice.cook!.time!;
    const quick = { ...beans, cook: { ...beans.cook, quickSoak: { amount: 10, unit: "cup", per: { amount: 1, unit: "lb" }, fact: "usda.refried-beans-soak", boil: time } } };
    expect(quickSoakWater(quick)!.unit).toBe("L/kg");
    expect(quickSoakWater(quick)!.value).toBeCloseTo((10 * 0.2365882365) / 0.45359237, 9);
    expect(soakWater(quick)!.value).toBeCloseTo((1.75 * 0.946352946) / 0.45359237, 9);
    expect(quickSoakWater({ ...rice, cook: { ...rice.cook, quickSoak: { ...rice.cook!.water!, boil: time } } })!.value).toBeCloseTo((2 * 0.2365882365) / 0.185, 9);
    expect(quickSoakWater({ ...rice, cook: { quickSoak: { ...rice.cook!.water!, boil: time } } })).toBeUndefined();
    // The USDA recipe gives 3 gal of water for 1 lb 9 oz (25 oz) of dry spaghetti: about 16 L/kg.
    expect(cookWater(product("food.pasta-dry-1kg"))!.value).toBeCloseTo((3 * 3.785411784) / (25 * 0.028349523125), 9);
    expect(cookWater({ ...rice, cook: { water: { amount: 4, unit: "qt", per: { amount: 1, unit: "lb" }, fact: "usarice.long-grain-white" } } })!.value).toBeCloseTo((4 * 0.946352946) / 0.45359237, 9);
    expect(cookWater({ ...rice, cook: { water: rice.cook!.water } })).toBeUndefined();
  });
});

/** This function gives the fuel rate of a stove of the catalog in `kg/h`. */
function kgPerHour(id: string): number {
  const rate = product(id).stove!.rate!;
  return valueIn(divide(quantity(rate.amount, canonicalUnit(rate.unit)), quantity(rate.per.amount, canonicalUnit(rate.per.unit))), "kg/h");
}

describe("the stoves of the reference catalog", () => {
  const stoves = SUPPLY_CATALOG.products.filter((item) => item.stove !== undefined);

  it("has three stoves, each with a cited basis and a fuel rate in a mass for each time", () => {
    expect(stoves.map((item) => item.id)).toEqual(["heat.stove-canister-1-burner", "heat.stove-propane-2-burner", "heat.stove-butane-1-burner"]);
    for (const stove of stoves) {
      expect(stove.kind, stove.id).toBe("heat");
      expect(stove.basis, stove.id).toBe("ready.food-camp-stove");
      expect(stove.gives, stove.id).toEqual([]);
      // A rate in a mass needs no heating value, so no stove has the field heating.
      expect(stove.stove?.heating, stove.id).toBeUndefined();
      expect(resource(stove.stove!.fuel).kind, stove.id).toBe("heat");
    }
  });

  it("keeps each fuel rate as the cited numbers", () => {
    expect(product("heat.stove-canister-1-burner").stove).toEqual({
      fuel: "fuel.isobutane-mix",
      rate: { amount: 227, unit: "g", per: { amount: 60, unit: "min" }, fact: "msr.pocketrocket-2-rate" },
      boil: { amount: 16, unit: "L", per: { amount: 227, unit: "g" }, fact: "msr.pocketrocket-2-rate", start: { celsius: 21, fact: "msr.test-conditions" }, end: { celsius: 100, fact: "msr.test-conditions" }, bound: "most" },
      adverse: { factor: 4, typical: { low: 3, high: 4 }, fact: "msr.adverse-factor" },
    });
    expect(product("heat.stove-propane-2-burner").stove).toEqual({ fuel: "fuel.propane", rate: { amount: 16.4, unit: "oz", per: { amount: 1, unit: "h" }, fact: "coleman.propane-2-burner-rate", bound: "least" } });
    expect(product("heat.stove-butane-1-burner").stove).toEqual({ fuel: "fuel.butane", rate: { amount: 8.8, unit: "oz", per: { amount: 1.25, unit: "h" }, fact: "coleman.butane-1-burner-rate", bound: "least" } });
  });

  it("gives each fuel rate in kg/h: 0.227, 16.4 oz and 8.8 oz / 1.25 in kg", () => {
    expect(kgPerHour("heat.stove-canister-1-burner")).toBeCloseTo(0.227, 12);
    expect(kgPerHour("heat.stove-propane-2-burner")).toBeCloseTo(16.4 * 0.028349523125, 12);
    expect(kgPerHour("heat.stove-butane-1-burner")).toBeCloseTo((8.8 * 0.028349523125) / 1.25, 12);
  });

  it("cites the page of the maker for each rate, and the source has a license and a check date", () => {
    const sources = { "msr.pocketrocket-2-rate": "msr.pocketrocket-2", "coleman.propane-2-burner-rate": "coleman.propane-2-burner", "coleman.butane-1-burner-rate": "coleman.butane-1-burner" };
    for (const [fact, source] of Object.entries(sources)) {
      const unit = SUPPLY_CATALOG.facts.find((each) => each.id === fact);
      expect(unit?.source, fact).toBe(source);
      const record = SUPPLY_CATALOG.sources.find((each) => each.id === source);
      expect(record?.license, fact).toBe("all-rights-reserved");
      expect(record?.checked, fact).toBe("2026-11-24");
    }
    expect(SUPPLY_CATALOG.sources.find((each) => each.id === "ready.food")?.license).toBe("us-public-domain");
  });

  it("gives a fuel energy to propane and butane, and none to the canister mix, so its energy is a no read", () => {
    expect(fuelEnergyPerMass(resource("fuel.propane"))).toBeDefined();
    expect(fuelEnergyPerMass(resource("fuel.butane"))).toBeDefined();
    expect("fuelEnergy" in resource("fuel.isobutane-mix")).toBe(false);
    expect(fuelEnergyPerMass(resource("fuel.isobutane-mix"))).toBeUndefined();
  });
});

describe("the dry beans of the reference catalog", () => {
  const beans = product("food.beans-dry-1kg");

  it("cites the energy and the cook time of the same bean: pinto", () => {
    const energy = beans.energy;
    expect(energy?.read === true && energy.scaled?.rate.fact).toBe("fdc.beans-pinto");
    expect(energy).toMatchObject({ read: true, amount: 3470, unit: "kcal" });
    const fact = SUPPLY_CATALOG.facts.find((each) => each.id === "fdc.beans-pinto");
    expect(fact?.text).toContain("175199 (pinto beans, mature seeds, raw) gives 347 kcal in 100 g");
    expect(beans.cook?.time?.fact).toBe("usda.pinto-beans-cook");
    expect(SUPPLY_CATALOG.facts.some((each) => each.id === "fdc.beans-black")).toBe(false);
  });

  it("gives the USDA sheet at its fns.usda.gov address, not at a CDN host", () => {
    expect(SUPPLY_CATALOG.sources.find((each) => each.id === "usda.pinto-beans")?.url).toBe("https://www.fns.usda.gov/sites/default/files/resource-files/PintoBeansDry.pdf");
    for (const source of SUPPLY_CATALOG.sources) expect(source.url, source.id).not.toMatch(/azureedge/);
  });

  it("cites the soak water and the cook water of the USDA recipe for schools, a work of the US government", () => {
    for (const fact of ["usda.refried-beans-soak", "usda.refried-beans-cook"]) expect(SUPPLY_CATALOG.facts.find((each) => each.id === fact)?.source, fact).toBe("usda.refried-beans");
    expect(SUPPLY_CATALOG.sources.find((each) => each.id === "usda.refried-beans")?.license).toBe("us-public-domain");
  });
});

describe("the gate of the cook facts, the stoves and the fuel energy", () => {
  it("refuses a cook water for each volume with no bulk mass", () => {
    expect(errors(withProduct({ ...rice, cook: { water: rice.cook!.water } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { water: { ...rice.cook!.water!, per: { amount: 1, unit: "kg" } } } }))).toEqual([]);
  });

  it("examines a soak water as a cook water: a volume for each volume with a bulk mass, or for each mass, with its fact and no bound", () => {
    const soak = rice.cook!.water!;
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, soak } }))).toEqual([]);
    expect(errors(withProduct({ ...rice, cook: { soak } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { soak: { ...soak, per: { amount: 1, unit: "kg" } } } }))).toEqual([]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, soak: { ...soak, unit: "kg" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, soak: { ...soak, amount: 0 } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, soak: { ...soak, fact: "no.such-fact" } } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, soak: { ...soak, bound: "least" } as never } }))).toEqual(["supplies-amount"]);
  });

  it("examines a quick soak water as a soak water, with a boil time, an optional stand time and no bound", () => {
    // A made-up quick soak on the rice: its water rate is the cook water of the rice, and its times cite the cook time.
    const water = rice.cook!.water!;
    const time = rice.cook!.time!;
    const quickSoak: QuickSoak = { ...water, boil: { ...time, low: 2, high: 2 }, stand: { ...time, low: 60, high: 60 } };
    const cook = (fields: Record<string, unknown>): SupplyCatalog => withProduct({ ...rice, cook: { ...rice.cook, ...fields } } as unknown as SupplyProduct);
    expect(errors(cook({ quickSoak }))).toEqual([]);
    expect(errors(cook({ quickSoak: { ...quickSoak, stand: undefined } }))).toEqual([]);
    expect(errors(withProduct({ ...rice, cook: { quickSoak } }))).toEqual(["supplies-fact"]);
    expect(checkSupplies(withProduct({ ...rice, cook: { quickSoak } })).find((finding) => finding.code === "supplies-fact")?.message).toContain("The quick soak water of the product");
    expect(errors(withProduct({ ...rice, cook: { quickSoak: { ...quickSoak, per: { amount: 1, unit: "kg" } } } }))).toEqual([]);
    expect(errors(cook({ quickSoak: { ...quickSoak, unit: "kg" } }))).toEqual(["supplies-unit"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, amount: 0 } }))).toEqual(["supplies-amount"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, fact: "no.such-fact" } }))).toEqual(["supplies-fact"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, bound: "least" } }))).toEqual(["supplies-amount"]);
    expect(errors(cook({ quickSoak: "a quick soak" }))).toEqual(["supplies-amount"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, boil: undefined } }))).toEqual(["supplies-amount"]);
    expect(checkSupplies(cook({ quickSoak: { ...quickSoak, boil: undefined } })).find((finding) => finding.code === "supplies-amount")?.message).toContain("has no boil time");
    expect(errors(cook({ quickSoak: { ...quickSoak, boil: 2 } }))).toEqual(["supplies-amount"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, boil: { ...quickSoak.boil, unit: "kg" } } }))).toEqual(["supplies-unit"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, boil: { ...quickSoak.boil, fact: "no.such-fact" } } }))).toEqual(["supplies-fact"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, stand: { ...time, low: 60, high: 30 } } }))).toEqual(["supplies-amount"]);
    expect(errors(cook({ quickSoak: { ...quickSoak, stand: { ...time, unit: "foo" } } }))).toEqual(["supplies-unit"]);
  });

  it("examines an unsoaked cook time as a cook time", () => {
    const time = rice.cook!.time!;
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, unsoakedTime: { ...time, low: 90, high: 120 } } }))).toEqual([]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, unsoakedTime: { ...time, low: 120, high: 90 } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, unsoakedTime: { ...time, unit: "kg" } } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, unsoakedTime: { ...time, fact: "no.such-fact" } } }))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, unsoakedTime: 90 } } as unknown as SupplyProduct))).toEqual(["supplies-amount"]);
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
    // A stove rate has a known bound or no bound.
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 227, unit: "g", per: hour, fact, bound: "least" } }))).toEqual([]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 227, unit: "g", per: hour, fact, bound: "Least" as never } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ fuel: "fuel.butane", rate: { amount: 227, unit: "g", per: hour, fact, bound: "most" } }))).toEqual([]);
  });

  it("examines a boil yield: a volume of water for a mass of fuel, a cited start below 100 °C or no start, and a known bound or no bound", () => {
    const stove = (boil: unknown): SupplyCatalog => withProduct({ ...radio, stove: { fuel: "fuel.butane", boil: boil as never } });
    const fact = "ready.kit-radio";
    const start = { celsius: 21, fact };
    const boil = { amount: 16, unit: "L", per: { amount: 227, unit: "g" }, fact, start };
    expect(errors(stove(boil))).toEqual([]);
    expect(errors(stove({ ...boil, bound: "most" }))).toEqual([]);
    expect(errors(stove({ ...boil, bound: "least" }))).toEqual([]);
    expect(errors(stove({ ...boil, bound: "Most" }))).toEqual(["supplies-amount"]);
    // The water is a volume, and the fuel is a mass.
    expect(errors(stove({ ...boil, unit: "kg" }))).toEqual(["supplies-unit"]);
    expect(errors(stove({ ...boil, per: { amount: 1, unit: "h" } }))).toEqual(["supplies-unit"]);
    expect(errors(stove({ ...boil, fact: "no.such-fact" }))).toEqual(["supplies-fact"]);
    // A yield with no start is valid, and it gives no read. A start has its fact, and the water starts below the boil.
    expect(errors(stove({ ...boil, start: undefined }))).toEqual([]);
    expect(errors(stove({ ...boil, start: 21 }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, start: { ...start, celsius: 100 } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, start: { ...start, celsius: 0 } }))).toEqual([]);
    expect(errors(stove({ ...boil, start: { ...start, celsius: -1 } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, start: { ...start, celsius: Number.NaN } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, start: { ...start, fact: "no.such-fact" } }))).toEqual(["supplies-fact"]);
  });

  it("examines the end of a boil yield: a cited boil point from more than 0 °C to 102 °C, and more than the start", () => {
    const stove = (boil: unknown): SupplyCatalog => withProduct({ ...radio, stove: { fuel: "fuel.butane", boil: boil as never } });
    const fact = "ready.kit-radio";
    const boil = { amount: 16, unit: "L", per: { amount: 227, unit: "g" }, fact, start: { celsius: 21, fact } };
    expect(errors(stove({ ...boil, end: { celsius: 100, fact } }))).toEqual([]);
    expect(errors(stove({ ...boil, end: { celsius: 93.4, fact } }))).toEqual([]);
    expect(errors(stove({ ...boil, end: { celsius: 101.4, fact } }))).toEqual([]);
    // A yield with no end is valid. A reader gives no read for it.
    expect(errors(stove({ ...boil, end: undefined }))).toEqual([]);
    expect(errors(stove({ ...boil, start: undefined, end: { celsius: 100, fact } }))).toEqual([]);
    expect(errors(stove({ ...boil, end: 100 }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, end: { celsius: 103, fact } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, end: { celsius: 0, fact } }))).toEqual(["supplies-amount", "supplies-amount"]);
    expect(errors(stove({ ...boil, end: { celsius: Number.NaN, fact } }))).toEqual(["supplies-amount", "supplies-amount"]);
    expect(errors(stove({ ...boil, end: { celsius: 21, fact } }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ ...boil, end: { celsius: 100, fact: "no.such-fact" } }))).toEqual(["supplies-fact"]);
  });

  it("examines an adverse factor: a finite number of 1 or more, a known fact, a known bound or no bound, and a typical range that holds the factor", () => {
    const stove = (adverse: unknown): SupplyCatalog => withProduct({ ...radio, stove: { fuel: "fuel.butane", adverse: adverse as never } });
    const fact = "ready.kit-radio";
    expect(errors(stove({ factor: 4, fact, bound: "most" }))).toEqual([]);
    expect(errors(stove({ factor: 4, fact, bound: "least" }))).toEqual([]);
    expect(errors(stove({ factor: 1, fact }))).toEqual([]);
    expect(errors(stove({ factor: 4, fact, bound: "Most" }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 0.5, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: Number.POSITIVE_INFINITY, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: Number.NaN, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: "4", fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 4, fact: "no.such-fact" }))).toEqual(["supplies-fact"]);
    expect(errors(stove(3)).sort()).toEqual(["supplies-amount", "supplies-fact"]);
    expect(errors(stove({ factor: 4, typical: { low: 3, high: 4 }, fact }))).toEqual([]);
    expect(errors(stove({ factor: 3.5, typical: { low: 3, high: 4 }, fact }))).toEqual([]);
    expect(errors(stove({ factor: 3, typical: { low: 3, high: 3 }, fact }))).toEqual([]);
    expect(errors(stove({ factor: 4, typical: { low: 3, high: 4 }, fact, bound: "most" }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 5, typical: { low: 3, high: 4 }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 2, typical: { low: 3, high: 4 }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 4, typical: { low: 4, high: 3 }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 1, typical: { low: 0.5, high: 2 }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 4, typical: { low: 3, high: Number.POSITIVE_INFINITY }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 4, typical: { low: 3 }, fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: 4, typical: [3, 4], fact }))).toEqual(["supplies-amount"]);
    expect(errors(stove({ factor: Number.NaN, typical: { low: 3, high: 4 }, fact }))).toEqual(["supplies-amount"]);
  });

  it("keeps the adverse factor of the canister stove as the high end of the typical range of the maker article, with no bound", () => {
    const adverse = product("heat.stove-canister-1-burner").stove?.adverse;
    expect(adverse).toEqual({ factor: 4, typical: { low: 3, high: 4 }, fact: "msr.adverse-factor" });
    expect(adverse?.factor).toBe(adverse?.typical?.high);
    expect(SUPPLY_CATALOG.facts.find((each) => each.id === adverse?.fact)?.source).toBe("msr.fuel-to-carry");
  });

  it("keeps the boil yield of the canister stove as the most yield of the maker test, from 21 °C", () => {
    const boil = product("heat.stove-canister-1-burner").stove?.boil;
    expect(boil?.bound).toBe("most");
    expect(SUPPLY_CATALOG.facts.find((each) => each.id === boil?.start?.fact)?.source).toBe("msr.stove-performance");
    // The same fact gives the end: the test is at sea level, and it ends at 212F (100C).
    expect(boil?.end).toEqual({ celsius: 100, fact: "msr.test-conditions" });
    expect(SUPPLY_CATALOG.sources.find((each) => each.id === "msr.stove-performance")?.license).toBe("all-rights-reserved");
  });

  it("refuses a bound on a rate that is not the fuel rate of a stove", () => {
    const propane = resource("fuel.propane");
    const bound = { bound: "least" } as never;
    expect(errors(withResource({ ...propane, fuelEnergy: { ...propane.fuelEnergy!, ...(bound as object) } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, water: { ...rice.cook!.water!, ...(bound as object) } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, cook: { ...rice.cook, bulk: { ...rice.cook!.bulk!, ...(bound as object) } } }))).toEqual(["supplies-amount"]);
  });

  it("gives a finding, and does not throw, for cook facts or a stove that are not a record, or a rate with no per", () => {
    const raw = (fields: Record<string, unknown>): SupplyCatalog => withProduct({ ...rice, ...fields } as unknown as SupplyProduct);
    expect(errors(raw({ cook: null }))).toEqual(["supplies-amount"]);
    expect(checkSupplies(raw({ stove: "a stove" })).find((finding) => finding.code === "supplies-amount")?.message).toContain("It must be a record of facts");
    expect(errors(raw({ cook: { ...rice.cook, water: { amount: 2, unit: "cup", fact: "usarice.long-grain-white" } } }))).toEqual(["supplies-amount"]);
    expect(errors(raw({ cook: { ...rice.cook, time: 15 } }))).toEqual(["supplies-amount"]);
  });
});
