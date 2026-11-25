/**
 * The sizes of the virtual machines of Azure: the count of vCPUs and the memory of each size. The Azure Retail
 * Prices API gives no size of a machine. The tables of the size pages of the Azure documentation give them. The
 * dataset `AZURE_VM_SIZE_TABLE` comes from these tables, under the license CC BY 4.0.
 */
import { AZURE_VM_SIZE_TABLE, AZURE_VM_SIZES_SOURCE } from "./azure-sizes-data.ts";

export { AZURE_VM_SIZE_TABLE, AZURE_VM_SIZES_SOURCE };

/** The source of a dataset of sizes: the repository, the commit, the folder, the license and the attribution. */
export interface AzureVmSizesSource {
  /** The GitHub repository of the documentation, as `owner/name`. */
  readonly repository: string;
  /** The commit of the repository that the generator read. */
  readonly commit: string;
  /** The folder of the size pages in the repository. */
  readonly path: string;
  /** The SPDX identifier of the license of the documentation. */
  readonly license: string;
  /** The address of the text of the license. */
  readonly licenseUrl: string;
  /** The date of the read, as `YYYY-MM-DD`. */
  readonly read: string;
  /** The attribution that each copy of the data keeps. */
  readonly attribution: string;
}

/** One size of a virtual machine: its ARM SKU name, its count of vCPUs and its memory in GiB. */
export interface AzureVmSize {
  readonly sku: string;
  readonly vcpu: number;
  readonly memoryGiB: number;
}

/** The result of a read of one size page: the sizes, the include files that the page names, and the notes. */
export interface AzureSizeTablesResult {
  readonly sizes: readonly AzureVmSize[];
  /** The path of each include file that the page names, relative to the page. An include file can have a table too. */
  readonly includes: readonly string[];
  readonly notes: readonly string[];
}

/** A memory column. A GB of the Azure size tables is 2^30 bytes, thus a GiB. */
const MEMORY = /^memory\s*\((gib|gb)\)$/i;
const SIZE_NAME = /^size\s*name$/i;
const VCPUS = /^vcpus\b/i;
const SKU = /^Standard_[A-Za-z0-9_-]+$/;
const INCLUDE = /\[!INCLUDE\s*\[[^\]]*\]\(([^)\s]+)\)\s*\]/gi;

function cellsOf(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return undefined;
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.slice(1, trimmed.endsWith("|") ? -1 : undefined);
}

function plain(cell: string | undefined): string {
  return (cell ?? "")
    .replace(/<sup>.*?<\/sup>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[*`]/g, "")
    .trim();
}

/** A count from a cell: a decimal of 0 or more, with the commas of thousands. */
function amount(cell: string | undefined): number | undefined {
  const value = plain(cell).replace(/,/g, "");
  return /^[0-9]+(\.[0-9]+)?$/.test(value) ? Number(value) : undefined;
}

/**
 * This function reads the size tables of one page of the Azure documentation in Markdown. A size table has the
 * columns `Size Name`, `vCPUs` and `Memory (GiB)` or `Memory (GB)`. A row that has no `Standard_` name, or no count
 * of vCPUs and memory, gives a note.
 */
export function parseAzureSizeTables(markdown: string): AzureSizeTablesResult {
  const sizes: AzureVmSize[] = [];
  const notes: string[] = [];
  const includes = [...markdown.matchAll(INCLUDE)].map((match) => match[1] ?? "").filter((path) => path !== "");
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = cellsOf(lines[index] ?? "");
    if (header === undefined) continue;
    const name = header.findIndex((cell) => SIZE_NAME.test(plain(cell)));
    const vcpu = header.findIndex((cell) => VCPUS.test(plain(cell)));
    const memory = header.findIndex((cell) => MEMORY.test(plain(cell)));
    if (name < 0 || vcpu < 0 || memory < 0) continue;
    let row = index + 2;
    for (; row < lines.length; row += 1) {
      const cells = cellsOf(lines[row] ?? "");
      if (cells === undefined) break;
      const sku = plain(cells[name]);
      const count = amount(cells[vcpu]);
      const gib = amount(cells[memory]);
      if (!SKU.test(sku) || count === undefined || !Number.isInteger(count) || gib === undefined) {
        notes.push(`The row ${row + 1} is skipped: ${JSON.stringify(cells.join(" | ").slice(0, 80))} has no size name, whole count of vCPUs and memory.`);
        continue;
      }
      sizes.push({ sku, vcpu: count, memoryGiB: gib });
    }
    index = row - 1;
  }
  return { sizes, includes, notes };
}

const BY_NAME = new Map(Object.entries(AZURE_VM_SIZE_TABLE).map(([sku, [vcpu, memoryGiB]]) => [sku.toLowerCase(), { sku, vcpu, memoryGiB }]));

/**
 * This function gives the size of a virtual machine from its ARM SKU name, for example `Standard_D2s_v5`. It gives
 * `undefined` when the dataset does not have the name. The match ignores the case.
 */
export function azureVmSize(armSkuName: string | undefined): AzureVmSize | undefined {
  return armSkuName === undefined ? undefined : BY_NAME.get(armSkuName.toLowerCase());
}
