import { describe, expect, it } from "vitest";
import { checkSupplies, type SupplyCatalog, type SupplyProduct } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const errors = (catalog: SupplyCatalog): string[] =>
  checkSupplies(catalog)
    .filter((finding) => finding.level === "error")
    .map((finding) => `${finding.code} ${finding.message}`);
const product = (id: string): SupplyProduct => SUPPLY_CATALOG.products.find((each) => each.id === id)!;
const withProduct = (next: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === next.id ? next : each)) });
const formula = product("food.infant-formula-ready-1kg");

describe("the facts of an opened container", () => {
  it("cites the use of an opened container of ready-to-feed formula with no cold storage", () => {
    expect(formula.opened?.noCold).toBe("wic.formula-opened");
    const fact = SUPPLY_CATALOG.facts.find((each) => each.id === "wic.formula-opened");
    expect(fact?.text).toContain("use formula immediately after a ready-to-feed container is opened");
    expect(SUPPLY_CATALOG.sources.find((each) => each.id === fact?.source)?.license).toBe("us-public-domain");
    expect(formula.opened?.container.read).toBe(false);
  });

  it("passes a size that holds a whole count of containers", () => {
    expect(errors(withProduct({ ...formula, opened: { container: { read: true, amount: 1, unit: "kg", size: true }, noCold: "wic.formula-opened" } }))).toEqual([]);
    expect(errors(withProduct({ ...formula, opened: { container: { read: true, amount: 250, unit: "g", definition: "A test container." }, noCold: "wic.formula-opened" } }))).toEqual([]);
  });

  it("refuses a size that holds part of a container", () => {
    const found = errors(withProduct({ ...formula, opened: { container: { read: true, amount: 300, unit: "g", definition: "A test container." }, noCold: "wic.formula-opened" } }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^supplies-amount .*holds 3\.33\d* containers/);
  });

  it("refuses a container in a unit that does not convert to the unit of the size", () => {
    const found = errors(withProduct({ ...formula, opened: { container: { read: true, amount: 946, unit: "mL", definition: "A test container." }, noCold: "wic.formula-opened" } }));
    expect(found).toEqual([expect.stringMatching(/^supplies-unit .*does not convert to kg/)]);
  });

  it("refuses a fact that is not in the catalog, a container with no size and an opened field that is not a record", () => {
    expect(errors(withProduct({ ...formula, opened: { ...formula.opened!, noCold: "no.such-fact" } }))).toEqual([expect.stringMatching(/^supplies-fact .*cites no\.such-fact/)]);
    const { size: _size, ...noSize } = formula;
    expect(errors(withProduct({ ...noSize } as SupplyProduct))).toContainEqual(expect.stringMatching(/^supplies-amount .*has a container, and it has no size/));
    expect(errors(withProduct({ ...formula, opened: null } as unknown as SupplyProduct))).toEqual([expect.stringMatching(/^supplies-amount The field opened .* must be a record of facts/)]);
  });
});
