import { describe, expect, it } from "vitest";
import { foldCode, matchKeys } from "./identifiers.ts";

describe("foldCode", () => {
  it("keeps only capital letters and digits", () => {
    expect(foldCode("MZ-V8V1T0B/AM")).toBe("MZV8V1T0BAM");
    expect(foldCode("mz v8v1t0b.am")).toBe("MZV8V1T0BAM");
    expect(foldCode("Crucial®")).toBe("CRUCIAL");
    expect(foldCode("Café")).toBe("CAFE");
    expect(foldCode(" -/ ")).toBe("");
  });
});

describe("matchKeys", () => {
  it("gives a GTIN key and a part key, sorted and with no copy", () => {
    expect(
      matchKeys({
        gtins: ["036000291452", "00036000291452", "4006381333931"],
        partNumbers: [
          { brand: "Samsung", partNumber: "MZ-V8V1T0B/AM" },
          { brand: "SAMSUNG", partNumber: "mzv8v1t0bam" },
        ],
      }),
    ).toEqual(["gtin:00036000291452", "gtin:04006381333931", "part:SAMSUNG/MZV8V1T0BAM"]);
  });

  it("ignores a GTIN that is not valid, and a brand or a part number that folds to no text", () => {
    expect(
      matchKeys({
        gtins: ["036000291453", ""],
        partNumbers: [
          { brand: "--", partNumber: "X1" },
          { brand: "Acme", partNumber: "/" },
        ],
      }),
    ).toEqual([]);
  });

  it("gives no key for a record with no identifier", () => {
    expect(matchKeys({ gtins: [], partNumbers: [] })).toEqual([]);
  });
});
