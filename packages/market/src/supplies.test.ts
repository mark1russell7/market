import { quantity, valueIn } from "@mark1russell7/quantity";
import { FOODKEEPER_PRODUCTS } from "@mark1russell7/stock/foodkeeper";
import { describe, expect, it } from "vitest";
import { buyCandidates } from "./order.ts";
import type { AveragePrice } from "./average.ts";
import { averageSupplyPrices, checkSupplies, giftsOf, kitMax, SUPPLY_KINDS, supplyWants, type SupplyCatalog, type SupplyProduct } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const codes = (catalog: SupplyCatalog): string[] => checkSupplies(catalog).map((finding) => finding.code);
const errors = (catalog: SupplyCatalog): string[] =>
  checkSupplies(catalog)
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.code);

const rice = SUPPLY_CATALOG.products.find((product) => product.id === "food.rice-white-1kg")!;
/** This function gives the reference catalog with one product in place of the rice. */
const withProduct = (product: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === rice.id ? product : each)) });

describe("the reference catalog of supplies", () => {
  it("passes the gate: each fact cites a source with a license, and each unit converts to the unit of its resource", () => {
    expect(errors(SUPPLY_CATALOG)).toEqual([]);
    expect(checkSupplies(SUPPLY_CATALOG, { at: "2026-11-22" }).filter((finding) => finding.level === "error")).toEqual([]);
  });

  it("gives one warning for each value with no read, and no other warning", () => {
    const warnings = checkSupplies(SUPPLY_CATALOG).filter((finding) => finding.level === "warning");
    expect(warnings.map((finding) => `${finding.code} ${finding.id}`)).toEqual([
      "supplies-no-read water.jug-1gal",
      "supplies-no-read food.oats-1kg",
      "supplies-no-read food.peanut-butter-1kg",
      "supplies-no-read food.soup-can",
      "supplies-no-read light.flashlight",
      "supplies-no-read heat.sleeping-bag",
      "supplies-no-read first-aid.kit",
      "supplies-no-read communication.noaa-radio",
      "supplies-no-read power.anker-737",
      "supplies-no-read power.anker-737",
    ]);
  });

  it("has a product of each supply kind, and a cited basis for each product that gives no stored resource", () => {
    expect(new Set(SUPPLY_CATALOG.products.map((product) => product.kind))).toEqual(new Set(SUPPLY_KINDS));
    for (const product of SUPPLY_CATALOG.products.filter((each) => each.gives.length === 0)) expect(product.basis, product.id).toBeDefined();
  });

  it("refuses a basis that is not a fact of the catalog, and counts a basis as a use of its fact", () => {
    const radio = SUPPLY_CATALOG.products.find((product) => product.id === "communication.noaa-radio")!;
    const products = (basis: string | undefined): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === radio.id ? { ...radio, basis } : each)) });
    expect(errors(products("unknown"))).toEqual(["supplies-fact"]);
    expect(errors(products(undefined))).toEqual(["supplies-basis"]);
    expect(errors({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === radio.id ? { ...radio, basis: undefined, gives: rice.gives } : each)) })).toEqual([]);
    const unused = checkSupplies(products(undefined)).filter((finding) => finding.code === "supplies-unused");
    expect(unused.map((finding) => finding.id)).toEqual(["ready.kit-radio"]);
  });

  it("gives the food energy of peanut butter in kcal, because it goes to the food need with no converter", () => {
    expect(giftsOf(SUPPLY_CATALOG, "food.peanut-butter-1kg", 2)).toEqual([{ resource: "food.no-cook", read: true, amount: 11960, unit: "kcal" }]);
  });

  it("gives the water of a jug of 1 gal in litres, exactly as the definition of the gallon", () => {
    expect(giftsOf(SUPPLY_CATALOG, "water.jug-1gal", 4)).toEqual([{ resource: "water.stored", read: true, amount: 4 * 3.785411784, unit: "L" }]);
  });

  it("keeps a gift with no read as no read, not as 0", () => {
    const [gift] = giftsOf(SUPPLY_CATALOG, "power.anker-737", 2);
    expect(gift?.read).toBe(false);
    expect(gift).not.toHaveProperty("amount");
  });

  it("gives a want only for a product with a part, and the product with no offer is unpriced", () => {
    const wants = supplyWants(SUPPLY_CATALOG, () => 3);
    expect(wants).toEqual([{ product: "power.anker-737", want: { brands: ["Anker"], partNumbers: ["A1289"] }, max: 3 }]);
    expect(buyCandidates(wants, [], { currency: "USD" }).unpriced.map((each) => each.product)).toEqual(["power.anker-737"]);
  });

  it("gives a size to each product with a known size, and each size converts to kg, L or a count", () => {
    const sized = SUPPLY_CATALOG.products.filter((product) => product.size !== undefined);
    expect(SUPPLY_CATALOG.products.filter((product) => product.size === undefined).map((product) => product.id)).toEqual([
      "water.container-1gal",
      "light.flashlight",
      "heat.sleeping-bag",
      "first-aid.kit",
      "communication.noaa-radio",
      "power.anker-737",
    ]);
    for (const product of sized) {
      const size = product.size!;
      expect(size.read, product.id).toBe(true);
      if (!size.read) continue;
      const to = ["kg", "L", "{each}"].find((unit) => {
        try {
          return valueIn(quantity(size.amount, size.unit), unit) > 0;
        } catch {
          return false;
        }
      });
      expect(to, product.id).toBeDefined();
    }
    const soup = SUPPLY_CATALOG.products.find((product) => product.id === "food.soup-can")!;
    expect(soup.size).toEqual({ read: true, amount: 530, unit: "g", fact: "fdc.soup-chicken-noodle" });
  });

  it("gives the size of peanut butter in lb for a page that counts an inventory in lb", () => {
    const size = SUPPLY_CATALOG.products.find((product) => product.id === "food.peanut-butter-1kg")!.size;
    expect(size?.read).toBe(true);
    if (size?.read !== true) return;
    expect(valueIn(quantity(size.amount, size.unit), "lb")).toBeCloseTo(2.2046, 4);
  });

  it("refuses an unknown product id, and a count of units that is not a finite number of 0 or more", () => {
    expect(() => giftsOf(SUPPLY_CATALOG, "unknown", 1)).toThrow(RangeError);
    for (const units of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(() => giftsOf(SUPPLY_CATALOG, "water.jug-1gal", units), String(units)).toThrow(RangeError);
    expect(giftsOf(SUPPLY_CATALOG, "water.jug-1gal", 0)).toEqual([{ resource: "water.stored", read: true, amount: 0, unit: "L" }]);
  });
});

describe("the gate of the catalog", () => {
  it("refuses a product two times, a resource two times and a gift of a resource two times", () => {
    expect(errors({ ...SUPPLY_CATALOG, products: [...SUPPLY_CATALOG.products, rice] })).toEqual(["supplies-twice"]);
    expect(errors({ ...SUPPLY_CATALOG, resources: [...SUPPLY_CATALOG.resources, SUPPLY_CATALOG.resources[0]!] })).toEqual(["supplies-twice"]);
    expect(errors(withProduct({ ...rice, gives: [rice.gives[0]!, rice.gives[0]!] }))).toEqual(["supplies-twice"]);
  });

  it("refuses a wrong format, an unknown kind and an unknown resource", () => {
    expect(errors({ ...SUPPLY_CATALOG, format: "other" as never })).toEqual(["supplies-format"]);
    expect(errors(withProduct({ ...rice, kind: "tools" as never }))).toEqual(["supplies-kind"]);
    expect(errors(withProduct({ ...rice, gives: [{ ...rice.gives[0]!, resource: "food.unknown" }] }))).toEqual(["supplies-resource"]);
  });

  it("refuses a food energy on a product that is not food, also in a unit that converts to kcal", () => {
    const battery = { ...rice, kind: "power" as const, energy: { read: true as const, amount: 100, unit: "W*h", definition: "A test battery." } };
    expect(errors(withProduct(battery))).toEqual(["supplies-kind"]);
  });

  it("refuses a cited amount with an unknown fact, an amount of 0 and a unit that does not convert", () => {
    const unknownFact = codes(withProduct({ ...rice, energy: { read: true, amount: 3650, unit: "kcal", fact: "unknown" } }));
    expect(unknownFact.filter((code) => code !== "supplies-no-read")).toEqual(["supplies-fact", "supplies-unused"]);
    expect(errors(withProduct({ ...rice, energy: { read: true, amount: 0, unit: "kcal", fact: "fdc.rice-white" } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, energy: { read: true, amount: 3650, unit: "kg", fact: "fdc.rice-white" } }))).toEqual(["supplies-unit"]);
    expect(errors(withProduct({ ...rice, gives: [{ resource: "food.grain-dry", amount: { read: true, amount: 1, unit: "L", definition: "A litre." } }] }))).toEqual(["supplies-unit"]);
  });

  it("refuses an amount from JSON with no reason, with two reasons or with a blank definition, and warns of a blank no read", () => {
    const energy = (value: unknown): SupplyCatalog => withProduct({ ...rice, energy: value as SupplyProduct["energy"] });
    expect(errors(energy({ read: true, amount: 3650, unit: "kcal" }))).toEqual(["supplies-fact"]);
    expect(errors(energy({ read: true, amount: 3650, unit: "kcal", fact: "fdc.rice-white", definition: "Also a definition." }))).toEqual(["supplies-fact"]);
    expect(errors(energy({ read: true, amount: 3650, unit: "kcal", definition: "  " }))).toEqual(["supplies-fact"]);
    expect(codes(energy({ read: false, why: "" })).filter((code) => code === "supplies-no-reason")).toEqual(["supplies-no-reason"]);
    expect(codes(SUPPLY_CATALOG)).not.toContain("supplies-no-reason");
  });

  it("accepts a scaled amount that is the rate times the amount, and refuses another amount", () => {
    const energy = rice.energy as Extract<SupplyProduct["energy"], { scaled: unknown }>;
    const scaled = (change: Partial<typeof energy>): SupplyCatalog => withProduct({ ...rice, energy: { ...energy, ...change } as SupplyProduct["energy"] });
    // 365 kcal in 100 g times 1 kg is 3650 kcal, also in another unit of energy.
    expect(errors(scaled({}))).toEqual([]);
    expect(errors(scaled({ amount: 3650 * 4.184, unit: "kJ" }))).toEqual([]);
    expect(errors(scaled({ amount: 3600 }))).toEqual(["supplies-amount"]);
    expect(checkSupplies(scaled({ amount: 3600 })).find((finding) => finding.code === "supplies-amount")?.message).toContain("gives 3650 kcal");
    // The amount of the reason has a fact: 41 kcal in 100 g times the 530 g of a can.
    const soup = SUPPLY_CATALOG.products.find((product) => product.id === "food.soup-can")!;
    expect(soup.energy).toMatchObject({ amount: 217.3, scaled: { of: { amount: 530, unit: "g", fact: "fdc.soup-chicken-noodle" } } });
  });

  it("refuses a scaled reason with an unknown fact, a bad factor or a unit that does not convert, and does not throw", () => {
    const energy = rice.energy as Extract<SupplyProduct["energy"], { scaled: unknown }>;
    const reason = (change: unknown): SupplyCatalog => withProduct({ ...rice, energy: { ...energy, scaled: change } as SupplyProduct["energy"] });
    const { rate, of } = energy.scaled;
    expect(errors(reason({ rate: { ...rate, fact: "unknown" }, of }))).toContain("supplies-fact");
    expect(errors(reason({ rate, of: { amount: 1, unit: "kg", fact: "unknown" } }))).toContain("supplies-fact");
    expect(errors(reason({ rate, of: { amount: 1, unit: "kg", fact: "fdc.rice-white", definition: "Also a definition." } }))).toEqual(["supplies-fact"]);
    expect(errors(reason({ rate, of: { amount: 1, unit: "kg", definition: " " } }))).toEqual(["supplies-fact"]);
    expect(errors(reason({ rate: { ...rate, per: { amount: 0, unit: "g" } }, of }))).toEqual(["supplies-amount"]);
    expect(errors(reason({ rate, of: { ...of, unit: "foo" } }))).toEqual(["supplies-unit"]);
    expect(errors(reason({ rate, of: { ...of, amount: "1" } }))).toEqual(["supplies-amount"]);
    // kcal in 100 g times 1 L is not an energy.
    expect(errors(reason({ rate, of: { ...of, unit: "L" } }))).toEqual(["supplies-unit"]);
    expect(errors(reason({ rate }))).toEqual(["supplies-fact"]);
    expect(errors(reason(undefined))).toEqual(["supplies-fact"]);
    expect(errors(withProduct({ ...rice, energy: { ...energy, fact: "fdc.rice-white" } as unknown as SupplyProduct["energy"] }))).toEqual(["supplies-fact"]);
  });

  it("gives a finding and does not throw for an amount that quantity refuses", () => {
    const energy = rice.energy as Extract<SupplyProduct["energy"], { scaled: unknown }>;
    const butter = SUPPLY_CATALOG.products.find((product) => product.id === "food.peanut-butter-1kg")!;
    const withButter = (product: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === butter.id ? product : each)) });
    const cited = (amount: unknown): SupplyCatalog => withProduct({ ...rice, energy: { read: true, amount, unit: "kcal", fact: "fdc.rice-white" } as SupplyProduct["energy"] });
    // A food energy that is not a finite number, also with a scaled reason.
    for (const amount of [Number.NaN, "3650", undefined, Number.POSITIVE_INFINITY]) expect(errors(cited(amount))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, energy: { ...energy, amount: Number.NaN } }))).toEqual(["supplies-amount"]);
    // A gift in kcal that is not a finite number.
    const gift = butter.gives[0]!;
    expect(errors(withButter({ ...butter, gives: [{ ...gift, amount: { ...gift.amount, amount: Number.NaN } as typeof gift.amount }] }))).toContain("supplies-amount");
    // A factor in a level unit, and factors whose product overflows.
    const { rate, of } = energy.scaled;
    expect(errors(withProduct({ ...rice, energy: { ...energy, scaled: { rate, of: { ...of, amount: 1, unit: "dB" } } } }))).toEqual(["supplies-unit"]);
    const overflow = { ...energy, scaled: { rate: { ...rate, amount: 1e300, per: { amount: 1e-300, unit: "g" } }, of } };
    expect(errors(withProduct({ ...rice, energy: overflow }))).toEqual(["supplies-amount"]);
  });

  it("refuses a food energy that is not equal to a gift of the product in a unit of energy", () => {
    const butter = SUPPLY_CATALOG.products.find((product) => product.id === "food.peanut-butter-1kg")!;
    const withButter = (product: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === butter.id ? product : each)) });
    expect(errors(withButter(butter))).toEqual([]);
    expect(errors(withButter({ ...butter, energy: { read: true, amount: 5000, unit: "kcal", definition: "A test." } }))).toEqual(["supplies-energy"]);
    expect(errors(withButter({ ...butter, energy: { read: true, amount: 5980 * 4.184, unit: "kJ", definition: "A test." } }))).toEqual([]);
    // A gift in another resource, for example the mass of a food, is not compared.
    expect(errors(withProduct({ ...rice, energy: { read: true, amount: 100, unit: "kcal", definition: "A test." } }))).toEqual([]);
  });

  it("refuses a unit from JSON that is not a known unit, in an amount and in a resource, and does not throw", () => {
    const foo = withProduct({ ...rice, energy: { read: true, amount: 3650, unit: "foo", fact: "fdc.rice-white" } });
    expect(errors(foo)).toEqual(["supplies-unit"]);
    expect(checkSupplies(foo).find((finding) => finding.code === "supplies-unit")?.message).toContain("not a known unit");
    expect(errors(withProduct({ ...rice, energy: { read: true, amount: 3650, unit: 5 as unknown as string, fact: "fdc.rice-white" } }))).toEqual(["supplies-unit"]);
    const resources = SUPPLY_CATALOG.resources.map((each) => (each.code === "food.grain-dry" ? { ...each, unit: "foo" } : each));
    expect(errors({ ...SUPPLY_CATALOG, resources })).toEqual(["supplies-unit"]);
  });

  it("refuses a size of 0, a size with an unknown fact, and a size that is not a mass, a volume or a count, and does not throw", () => {
    const size = (value: unknown): SupplyCatalog => withProduct({ ...rice, size: value as SupplyProduct["size"] });
    expect(errors(size({ read: true, amount: 0, unit: "kg", definition: "A test." }))).toEqual(["supplies-amount"]);
    expect(errors(size({ read: true, amount: 1, unit: "kg", fact: "unknown" }))).toEqual(["supplies-fact"]);
    for (const unit of ["h", "kcal", "USD", "g/{each}", "L/{each}", "{each}/{can}"]) {
      expect(() => checkSupplies(size({ read: true, amount: 1, unit, definition: "A test." })), unit).not.toThrow();
      expect(errors(size({ read: true, amount: 1, unit, definition: "A test." })), unit).toEqual(["supplies-unit"]);
    }
    expect(errors(size({ read: true, amount: 1, unit: "foo", definition: "A test." }))).toEqual(["supplies-unit"]);
    for (const unit of ["g", "lb", "L", "gal", "{each}", "{can}"]) expect(errors(size({ read: true, amount: 1, unit, definition: "A test." })), unit).toEqual([]);
    const noRead = checkSupplies(size({ read: false, why: "The label is not read." })).filter((finding) => finding.id === rice.id);
    expect(noRead.map((finding) => `${finding.level} ${finding.code}`)).toEqual(["warning supplies-no-read"]);
  });

  it("refuses a count for each person of 0, not read, with an unknown fact, or in a unit that is not one bare count", () => {
    const perPerson = (value: unknown): SupplyCatalog => withProduct({ ...rice, perPerson: value as SupplyProduct["perPerson"] });
    expect(errors(perPerson({ read: true, amount: 0, unit: "{each}", definition: "A test." }))).toEqual(["supplies-amount"]);
    expect(errors(perPerson({ read: true, amount: 1, unit: "{each}", fact: "unknown" }))).toEqual(["supplies-fact"]);
    for (const value of [{ read: false, why: "The list is not read." }, { amount: 1, unit: "{each}", definition: "A test." }]) expect(errors(perPerson(value))).toEqual(["supplies-amount"]);
    for (const unit of ["kg", "L", "h", "{each}/{person}", "foo"]) {
      expect(() => checkSupplies(perPerson({ read: true, amount: 1, unit, definition: "A test." })), unit).not.toThrow();
      expect(errors(perPerson({ read: true, amount: 1, unit, definition: "A test." })), unit).toEqual(["supplies-unit"]);
    }
    for (const unit of ["{each}", "{bag}"]) expect(errors(perPerson({ read: true, amount: 1, unit, definition: "A test." })), unit).toEqual([]);
  });

  it("gives the sleeping bag a count for each person from its cited fact, and no other product has one", () => {
    const counted = SUPPLY_CATALOG.products.filter((product) => product.perPerson !== undefined);
    expect(counted.map((product) => [product.id, product.perPerson])).toEqual([["heat.sleeping-bag", { read: true, amount: 1, unit: "{each}", fact: "ready.kit-sleeping-bag" }]]);
    expect(SUPPLY_CATALOG.facts.find((fact) => fact.id === "ready.kit-sleeping-bag")?.text).toContain("for each person");
  });

  it("gives the count of units of a product for each person times the persons, and 1 to each other product", () => {
    const bag = SUPPLY_CATALOG.products.find((product) => product.id === "heat.sleeping-bag")!;
    const radio = SUPPLY_CATALOG.products.find((product) => product.id === "communication.noaa-radio")!;
    for (const people of [0, 1, 4]) {
      expect(kitMax(people)(bag), String(people)).toBe(people);
      expect(kitMax(people)(radio), String(people)).toBe(1);
    }
    const each = (amount: number): SupplyProduct => ({ ...bag, perPerson: { read: true, amount, unit: "{each}", definition: "A test." } });
    expect(kitMax(3)(each(0.5))).toBe(2);
    // A product of two doubles goes past a whole count: 1.1 * 50 is 55.00000000000001 and 0.14 * 50 is 7.000000000000001.
    expect(kitMax(50)(each(1.1))).toBe(55);
    expect(kitMax(50)(each(0.14))).toBe(7);
    expect(kitMax(50)(each(0.141))).toBe(8);
    expect(supplyWants({ ...SUPPLY_CATALOG, products: [{ ...bag, want: { brands: ["Test"], partNumbers: ["T-1"] } }] }, kitMax(4))).toEqual([{ product: bag.id, want: { brands: ["Test"], partNumbers: ["T-1"] }, max: 4 }]);
    for (const people of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => kitMax(people), String(people)).toThrow(RangeError);
  });

  it("refuses a FoodKeeper id that is not a whole number more than 0, and a shelf life in a unit that is not a time", () => {
    expect(errors(withProduct({ ...rice, shelf: { read: true, foodKeeper: 0 } }))).toEqual(["supplies-shelf"]);
    expect(errors(withProduct({ ...rice, shelf: { read: true, amount: 2, unit: "kg", definition: "A wrong unit." } }))).toEqual(["supplies-unit"]);
  });

  it("finds each FoodKeeper id of the reference catalog in the FoodKeeper data of @mark1russell7/stock", () => {
    const foodKeeper = new Set(FOODKEEPER_PRODUCTS.map((product) => product.id));
    expect(checkSupplies(SUPPLY_CATALOG, { foodKeeper }).filter((finding) => finding.level === "error")).toEqual([]);
    expect(checkSupplies(SUPPLY_CATALOG, { foodKeeper: [...foodKeeper], at: "2026-11-22" }).filter((finding) => finding.level === "error")).toEqual([]);
  });

  it("refuses a FoodKeeper id that is not in the known ids, and examines no id with no option", () => {
    const foodKeeper = new Set(FOODKEEPER_PRODUCTS.map((product) => product.id));
    const missing = Math.max(...foodKeeper) + 1;
    const catalog = withProduct({ ...rice, shelf: { read: true, foodKeeper: missing } });
    const found = checkSupplies(catalog, { foodKeeper }).filter((finding) => finding.level === "error");
    expect(found.map((finding) => `${finding.code} ${finding.id}`)).toEqual([`supplies-shelf ${rice.id}`]);
    expect(found[0]?.message).toContain(`The FoodKeeper id ${String(missing)} of the product ${rice.id} is not in the known FoodKeeper ids.`);
    expect(checkSupplies(catalog, { foodKeeper: [] }).map((finding) => finding.code)).toContain("supplies-shelf");
    // With no option, the gate gives the same findings as before: it does not examine the id against the data.
    expect(errors(catalog)).toEqual([]);
    expect(checkSupplies(catalog)).toEqual(checkSupplies(SUPPLY_CATALOG));
    expect(checkSupplies(SUPPLY_CATALOG, { foodKeeper })).toEqual(checkSupplies(SUPPLY_CATALOG));
  });

  it("gives one error for a FoodKeeper id that is not a whole number, also with the known ids", () => {
    const foodKeeper = new Set(FOODKEEPER_PRODUCTS.map((product) => product.id));
    expect(checkSupplies(withProduct({ ...rice, shelf: { read: true, foodKeeper: 1.5 } }), { foodKeeper }).filter((finding) => finding.level === "error").map((finding) => finding.code)).toEqual(["supplies-shelf"]);
  });

  it("gives the findings of the sources and the facts from the gate of the guidebook", () => {
    const [source] = SUPPLY_CATALOG.sources;
    expect(errors({ ...SUPPLY_CATALOG, sources: [{ ...source!, url: "not an address" }, ...SUPPLY_CATALOG.sources.slice(1)] })).toEqual(["bad-url"]);
    expect(errors({ ...SUPPLY_CATALOG, facts: [...SUPPLY_CATALOG.facts, { id: "extra", use: "fact", text: "A fact.", source: "unknown" }] })).toEqual(["missing-source"]);
  });

  it("warns of a fact and a source that no product uses", () => {
    const catalog: SupplyCatalog = {
      ...SUPPLY_CATALOG,
      sources: [...SUPPLY_CATALOG.sources, { id: "spare", title: "A spare page", url: "https://www.ready.gov/spare", license: "us-public-domain", checked: "2026-11-22" }],
      facts: [...SUPPLY_CATALOG.facts, { id: "spare-fact", use: "fact", text: "A fact that no product uses.", source: "ready.water" }],
    };
    const unused = checkSupplies(catalog).filter((finding) => finding.code === "supplies-unused");
    expect(unused.map((finding) => `${finding.record} ${finding.id}`)).toEqual(["unit spare-fact", "source spare"]);
  });
});

/** This function gives an average price of the rice series of BLS, with the shape of the parser of market-sources. */
const ricePrice = (period: string, value: number, unit = "USD/lb", at = "2026-11-22T16:00:00Z"): AveragePrice => ({
  id: `bls-ap:APU0000701312:${period}`,
  source: "bls-ap",
  series: "APU0000701312",
  item: "Rice, white, long grain, uncooked, per lb. (453.6 gm)",
  area: "U.S. city average",
  period,
  price: { value, unit },
  at,
});

describe("the prices of the supplies from average prices", () => {
  it("gives the price of 1 kg of rice from the last month of its series, and a no read for the oats", () => {
    const prices = averageSupplyPrices(SUPPLY_CATALOG, [ricePrice("2026-09", 1.118), ricePrice("2026-10", 1.101)]);
    expect(prices.map((each) => each.product)).toEqual(["food.rice-white-1kg", "food.oats-1kg", "food.beans-dry-1kg", "food.peanut-butter-1kg", "food.pasta-dry-1kg", "food.flour-white-1kg", "food.soup-can"]);
    const [rice, oats, beans] = prices;
    expect(beans).toEqual({ product: "food.beans-dry-1kg", read: false, why: "The prices have no average price of the series APU0000714233 of bls-ap." });
    expect(rice).toMatchObject({ read: true, average: "bls-ap:APU0000701312:2026-10", period: "2026-10" });
    if (rice?.read !== true) return;
    expect(rice.price.unit).toBe("USD");
    // 1 lb is exactly 0.45359237 kg, so 1 kg is 1 / 0.45359237 lb.
    expect(rice.price.value).toBeCloseTo(1.101 / 0.45359237, 10);
    expect(oats).toEqual({ product: "food.oats-1kg", read: false, why: "The known series of average prices have no series of oats yet." });
  });

  it("gives a no read, not 0, for a series with no price and for a unit that does not fit the product", () => {
    expect(averageSupplyPrices(SUPPLY_CATALOG, [])[0]).toEqual({
      product: "food.rice-white-1kg",
      read: false,
      why: "The prices have no average price of the series APU0000701312 of bls-ap.",
    });
    const [volume] = averageSupplyPrices(SUPPLY_CATALOG, [ricePrice("2026-10", 1.101, "USD/L")]);
    expect(volume?.read).toBe(false);
    expect(volume).not.toHaveProperty("price");
    expect(volume?.read === false && volume.why).toContain("does not convert to USD/kg");
    const unknownUnit = { ...rice, average: { read: true as const, source: "bls-ap", series: "APU0000701312", per: { read: true as const, amount: 1, unit: "foo", definition: "A test." } } };
    expect(averageSupplyPrices(withProduct(unknownUnit), [ricePrice("2026-10", 1.101)])[0]).toMatchObject({ read: false });
    expect(errors(withProduct(unknownUnit))).toEqual(["supplies-unit"]);
  });

  it("gives a no read for a last price before the month since, and refuses a since that is not a month", () => {
    const prices = [ricePrice("2023-01", 0.95)];
    expect(averageSupplyPrices(SUPPLY_CATALOG, prices, { since: "2026-01" })[0]).toEqual({
      product: "food.rice-white-1kg",
      read: false,
      why: "The last average price of the series APU0000701312 of bls-ap is for 2023-01, before 2026-01.",
    });
    expect(averageSupplyPrices(SUPPLY_CATALOG, prices, { since: "2023-01" })[0]?.read).toBe(true);
    expect(averageSupplyPrices(SUPPLY_CATALOG, prices)[0]?.read).toBe(true);
    for (const since of ["2026", "2026-13", "x"]) expect(() => averageSupplyPrices(SUPPLY_CATALOG, prices, { since }), since).toThrow(RangeError);
  });

  it("examines the amount of the join as each other amount", () => {
    const join = { read: true as const, source: "bls-ap", series: "APU0000701312" };
    expect(errors(withProduct({ ...rice, average: { ...join, per: { read: true, amount: 0, unit: "kg", definition: "A test." } } }))).toEqual(["supplies-amount"]);
    expect(errors(withProduct({ ...rice, average: { ...join, per: { read: true, amount: 1, unit: "kg", fact: "unknown" } } }))).toEqual(["supplies-fact"]);
    expect(codes(withProduct({ ...rice, average: { read: false, why: "" } }))).toContain("supplies-no-reason");
  });
});
