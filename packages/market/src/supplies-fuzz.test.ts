import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkSupplies, SUPPLY_CATALOG } from "./supplies-entry.ts";

/** A place in the catalog: the keys and the indexes from the root to a value. */
type Path = readonly (string | number)[];

/** This function gives each place of a value, the root first, in the order of a walk. */
function pathsOf(value: unknown, at: Path = []): Path[] {
  const out: Path[] = [at];
  if (Array.isArray(value)) value.forEach((each, index) => out.push(...pathsOf(each, [...at, index])));
  else if (typeof value === "object" && value !== null) for (const [key, each] of Object.entries(value)) out.push(...pathsOf(each, [...at, key]));
  return out;
}

/** This function gives a deep copy of a value with a new value at a place. An absent value deletes the key of a record. */
function withValueAt(value: unknown, path: Path, put: unknown, absent: boolean): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return put;
  if (Array.isArray(value)) {
    const copy: unknown[] = [...(value as unknown[])];
    copy[Number(head)] = withValueAt(copy[Number(head)], rest, put, absent);
    return copy;
  }
  const record: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const key = String(head);
  if (rest.length === 0 && absent) return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
  record[key] = withValueAt(record[key], rest, put, absent);
  return record;
}

const PATHS = pathsOf(SUPPLY_CATALOG);
/** The bad values of the review probe: null, absent, a number, a text, a list, a record and a boolean, and more. */
const BAD: readonly { readonly value: unknown; readonly absent?: true }[] = [
  { value: null },
  { value: undefined, absent: true },
  { value: undefined },
  { value: 0 },
  { value: -1 },
  { value: Number.NaN },
  { value: "text" },
  { value: "" },
  { value: [] },
  { value: [null] },
  { value: {} },
  { value: true },
];

describe("the supplies gate with a bad value at any place of the catalog", () => {
  it("does not throw, for each bad value at each top place, list and record of the catalog", () => {
    // Each place to a depth of 2 (the root, each list and each record of a list), with each bad value: an exhaustive table.
    const throws: string[] = [];
    for (const path of PATHS.filter((each) => each.length <= 2))
      for (const bad of BAD) {
        const catalog = withValueAt(SUPPLY_CATALOG, path, bad.value, bad.absent === true);
        try {
          checkSupplies(catalog as never);
        } catch (thrown) {
          throws.push(`${JSON.stringify(path)} = ${bad.absent === true ? "absent" : String(bad.value)}: ${String(thrown)}`);
        }
      }
    expect(throws.slice(0, 20)).toEqual([]);
  });

  it("does not throw, for a bad value at a random place of any depth (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: PATHS.length - 1 }), fc.constantFrom(...BAD), (index, bad) => {
        const catalog = withValueAt(SUPPLY_CATALOG, PATHS[index] ?? [], bad.value, bad.absent === true);
        expect(() => checkSupplies(catalog as never)).not.toThrow();
      }),
      { numRuns: 2000, seed: 20261124 },
    );
  });

  it("does not throw, for two bad values at two random places (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: PATHS.length - 1 }), fc.integer({ min: 1, max: PATHS.length - 1 }), fc.constantFrom(...BAD), fc.constantFrom(...BAD), (i, j, a, b) => {
        const once = withValueAt(SUPPLY_CATALOG, PATHS[i] ?? [], a.value, a.absent === true);
        const twice = withValueAt(once, PATHS[j] ?? [], b.value, b.absent === true);
        expect(() => checkSupplies(twice as never)).not.toThrow();
      }),
      { numRuns: 1000, seed: 20261125 },
    );
  });
});
