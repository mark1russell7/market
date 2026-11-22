import { describe, expect, it } from "vitest";
import { buyCandidates } from "./order.ts";
import { checkSupplies, giftsOf, supplyWants, type SupplyCatalog, type SupplyProduct } from "./supplies.ts";
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
      "supplies-no-read power.anker-737",
      "supplies-no-read power.anker-737",
    ]);
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

  it("refuses a unit from JSON that is not a known unit, in an amount and in a resource, and does not throw", () => {
    const foo = withProduct({ ...rice, energy: { read: true, amount: 3650, unit: "foo", fact: "fdc.rice-white" } });
    expect(errors(foo)).toEqual(["supplies-unit"]);
    expect(checkSupplies(foo).find((finding) => finding.code === "supplies-unit")?.message).toContain("not a known unit");
    expect(errors(withProduct({ ...rice, energy: { read: true, amount: 3650, unit: 5 as unknown as string, fact: "fdc.rice-white" } }))).toEqual(["supplies-unit"]);
    const resources = SUPPLY_CATALOG.resources.map((each) => (each.code === "food.grain-dry" ? { ...each, unit: "foo" } : each));
    expect(errors({ ...SUPPLY_CATALOG, resources })).toEqual(["supplies-unit"]);
  });

  it("refuses a FoodKeeper id that is not a whole number more than 0, and a shelf life in a unit that is not a time", () => {
    expect(errors(withProduct({ ...rice, shelf: { read: true, foodKeeper: 0 } }))).toEqual(["supplies-shelf"]);
    expect(errors(withProduct({ ...rice, shelf: { read: true, amount: 2, unit: "kg", definition: "A wrong unit." } }))).toEqual(["supplies-unit"]);
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
