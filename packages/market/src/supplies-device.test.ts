import { describe, expect, it } from "vitest";
import { checkSupplies, type DeviceFacts, type SupplyCatalog, type SupplyProduct } from "./supplies.ts";
import { SUPPLY_CATALOG } from "./supplies-data.ts";

const errors = (catalog: SupplyCatalog): string[] =>
  checkSupplies(catalog)
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.code);
const product = (id: string): SupplyProduct => SUPPLY_CATALOG.products.find((each) => each.id === id)!;
const withProduct = (next: SupplyProduct): SupplyCatalog => ({ ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === next.id ? next : each)) });
const radio = product("communication.noaa-radio");
const withDevice = (device: DeviceFacts): SupplyCatalog => withProduct({ ...radio, device });
const fact = "ready.kit-radio";
const cells = { amount: 3, unit: "{each}" };

describe("the devices of the catalog", () => {
  it("gives the radio and the flashlight their need and their cells, with a no read of the run time", () => {
    const devices = SUPPLY_CATALOG.products.filter((each) => each.device !== undefined).map((each) => [each.id, each.device!.need, each.device!.battery, "read" in each.device!.run && each.device!.run.read]);
    expect(devices).toEqual([
      ["light.flashlight", "light.see", "battery.aa", false],
      ["communication.noaa-radio", "alert.watch", "battery.aa", false],
    ]);
    const cell = SUPPLY_CATALOG.resources.find((each) => each.code === "battery.aa");
    expect(cell).toEqual({ code: "battery.aa", unit: "{each}", title: "AA cells", kind: "power" });
    expect(product("power.aa-alkaline").gives).toEqual([{ resource: "battery.aa", amount: { read: true, amount: 1, unit: "{each}", size: true } }]);
  });

  it("accepts a run time in a time on a count of cells, with its fact", () => {
    expect(errors(withDevice({ need: "alert.watch", battery: "battery.aa", run: { amount: 48, unit: "h", per: cells, fact } }))).toEqual([]);
    expect(errors(withDevice({ need: "alert.watch", battery: "battery.aa", run: { amount: 720, unit: "min", per: cells, fact } }))).toEqual([]);
    expect(errors(withDevice({ need: "light.see", battery: "battery.aa", run: { read: false, why: "No page is read yet." } }))).toEqual([]);
  });

  it("refuses cells that are not a counted power resource of the catalog", () => {
    const run = { amount: 48, unit: "h", per: cells, fact };
    expect(errors(withDevice({ need: "alert.watch", battery: "battery.d", run }))).toEqual(["supplies-resource"]);
    expect(errors(withDevice({ need: "alert.watch", battery: "fuel.butane", run }))).toEqual(["supplies-kind"]);
    // The resource energy.battery is in Wh: a device runs on a count of cells, not on an energy.
    expect(errors(withDevice({ need: "alert.watch", battery: "energy.battery", run }))).toEqual(["supplies-unit"]);
  });

  it("refuses a run time that is not a time on a count of cells, or that has no fact", () => {
    const device = (run: DeviceFacts["run"]): SupplyCatalog => withDevice({ need: "alert.watch", battery: "battery.aa", run });
    expect(errors(device({ amount: 48, unit: "Wh", per: cells, fact }))).toEqual(["supplies-unit"]);
    expect(errors(device({ amount: 48, unit: "h", per: { amount: 1, unit: "L" }, fact }))).toEqual(["supplies-unit"]);
    expect(errors(device({ amount: 48, unit: "h", per: cells, fact: "no.such-fact" }))).toEqual(["supplies-fact"]);
    expect(errors(device({ amount: 0, unit: "h", per: cells, fact }))).toEqual(["supplies-amount"]);
    expect(errors(device({ amount: 48, unit: "h", per: cells, fact, bound: "least" } as never))).toEqual(["supplies-amount"]);
    expect(errors(device({ amount: 48, unit: "h", fact } as never))).toEqual(["supplies-amount"]);
  });

  it("refuses a device with no need code, and warns on a no read with no reason", () => {
    const run = { amount: 48, unit: "h", per: cells, fact };
    expect(errors(withDevice({ need: " ", battery: "battery.aa", run }))).toEqual(["supplies-amount"]);
    expect(errors(withDevice({ need: 7, battery: "battery.aa", run } as never))).toEqual(["supplies-amount"]);
    const findings = checkSupplies(withDevice({ need: "alert.watch", battery: "battery.aa", run: { read: false, why: "" } }));
    expect(findings.filter((finding) => finding.id === radio.id).map((finding) => finding.code)).toContain("supplies-no-reason");
    const raw = withProduct({ ...radio, device: "a radio" } as unknown as SupplyProduct);
    expect(checkSupplies(raw).find((finding) => finding.code === "supplies-amount")?.message).toContain("It must be a record of facts");
  });
});
