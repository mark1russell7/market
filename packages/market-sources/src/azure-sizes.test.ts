import { describe, expect, it } from "vitest";
import { AZURE_VM_SIZE_TABLE, AZURE_VM_SIZES_SOURCE, azureVmSize, parseAzureSizeTables } from "./azure-sizes.ts";
import { parseAzureRetailPrices } from "./azure.ts";

// Each page of these tests is made up. It has the form of a size page of the Azure documentation.
const PAGE = [
  "# Example series",
  "",
  "| Size Name | vCPUs (Qty.) | Memory (GiB) |",
  "| --- | --- | --- |",
  "| Standard_X1s_v9 | 1 | 0.5 |",
  "| **Standard_X2s_v9** | 2 | 8 |",
  "| Standard_X4s_v9<sup>1</sup> | 4 | 1,024 |",
  "| Example_X8 | 8 | 32 |",
  "| Standard_X16s_v9 | 16 | - |",
  "",
  "[!INCLUDE [example-specs](./includes/example-series-specs.md)]",
  "",
  "| Size Name | Max Disks (Qty.) |",
  "| --- | --- |",
  "| Standard_X1s_v9 | 4 |",
].join("\n");

const INCLUDED = ["| Size Name | vCPUs (Qty.) | Memory (GB) | L3 Cache (MB) |", "|---|---|---|---|", "| Standard_Y2_v9 | 2 | 16 | 32 |"].join("\r\n");

describe("the size tables of the Azure documentation", () => {
  it("reads each row with a size name, a count of vCPUs and the memory, and gives a note for each other row", () => {
    const read = parseAzureSizeTables(PAGE);
    expect(read.sizes).toEqual([
      { sku: "Standard_X1s_v9", vcpu: 1, memoryGiB: 0.5 },
      { sku: "Standard_X2s_v9", vcpu: 2, memoryGiB: 8 },
      { sku: "Standard_X4s_v9", vcpu: 4, memoryGiB: 1024 },
    ]);
    expect(read.notes).toHaveLength(2);
    expect(read.includes).toEqual(["./includes/example-series-specs.md"]);
  });

  it("reads the column Memory (GB) as GiB, in an include file with more columns", () => {
    expect(parseAzureSizeTables(INCLUDED)).toEqual({ sizes: [{ sku: "Standard_Y2_v9", vcpu: 2, memoryGiB: 16 }], includes: [], notes: [] });
  });

  it("gives no size for a page with no size table", () => {
    expect(parseAzureSizeTables("# A page\n\nNo table.")).toEqual({ sizes: [], includes: [], notes: [] });
  });
});

describe("the dataset of sizes", () => {
  it("keeps its source, its commit and its license", () => {
    expect(AZURE_VM_SIZES_SOURCE).toMatchObject({ repository: "MicrosoftDocs/azure-compute-docs", license: "CC-BY-4.0" });
    expect(AZURE_VM_SIZES_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(AZURE_VM_SIZES_SOURCE.attribution).toContain("CC BY 4.0");
  });

  it("has a whole count of vCPUs and memory above 0 for each size", () => {
    const rows = Object.entries(AZURE_VM_SIZE_TABLE);
    expect(rows.length).toBeGreaterThan(1000);
    for (const [sku, [vcpu, memory]] of rows) {
      expect(sku).toMatch(/^Standard_/);
      expect(Number.isInteger(vcpu) && vcpu > 0 && memory > 0).toBe(true);
    }
  });

  it("finds a size by its ARM SKU name with any case", () => {
    expect(azureVmSize("Standard_D2s_v5")).toEqual({ sku: "Standard_D2s_v5", vcpu: 2, memoryGiB: 8 });
    expect(azureVmSize("standard_d2s_v5")).toEqual(azureVmSize("Standard_D2s_v5"));
    expect(azureVmSize("Standard_None")).toBeUndefined();
    expect(azureVmSize(undefined)).toBeUndefined();
  });
});

describe("the specs of a virtual machine offer", () => {
  const row = (serviceName: string, armSkuName: string) => ({
    currencyCode: "USD",
    tierMinimumUnits: 0,
    retailPrice: 0.096,
    armRegionName: "examplecentral",
    location: "Example Central",
    meterId: "00000000-0000-0000-0000-000000000001",
    meterName: "D2s v5",
    productName: "Virtual Machines Dsv5 Series",
    skuId: "EXAMPLE/0001",
    skuName: "D2s v5",
    serviceName,
    serviceFamily: "Compute",
    unitOfMeasure: "1 Hour",
    type: "Consumption",
    armSkuName,
  });
  const specs = (item: unknown) => {
    const result = parseAzureRetailPrices({ Items: [item] }, "2026-11-25T00:00:00.000Z");
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.observations[0]?.offer.specs ?? [];
  };

  it("adds the vCPUs and the memory of the size to an offer of the service Virtual Machines", () => {
    expect(specs(row("Virtual Machines", "Standard_D2s_v5"))).toEqual(
      expect.arrayContaining([
        { name: "vcpu", value: "2" },
        { name: "memory", value: "8 GiB" },
      ]),
    );
  });

  it("adds no size to an offer of another service, or of a size that the dataset does not have", () => {
    for (const item of [row("Azure Example", "Standard_D2s_v5"), row("Virtual Machines", "Standard_None")]) {
      expect(specs(item).map((spec) => spec.name)).not.toContain("memory");
    }
  });
});
