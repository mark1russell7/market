import { parseGtin } from "@mark1russell7/market";
import { describe, expect, it } from "vitest";
import { SAMPLE_CODES, SAMPLE_OFFERS } from "./demo-data.ts";
import { choiceOf, curveOf, DEFAULT_STATE, gtinOf, hashOf, MAX_AGE, MAX_COUNT, stateOf, termsOf, type DemoState } from "./demo.ts";

const at = (change: Partial<DemoState>): DemoState => ({ ...DEFAULT_STATE, ...change });

describe("the state in the address", () => {
  it("gives an empty hash for the defaults, and reads each value back", () => {
    expect(hashOf(DEFAULT_STATE)).toBe("");
    const state = at({ count: 25, conditions: ["new", "used"], part: "ACM-NV", code: "4006381333931", age: 30, ended: true });
    expect(stateOf(hashOf(state))).toEqual(state);
  });

  it("gives the default or the nearest limit for a value that is not valid", () => {
    expect(stateOf("#count=0&age=999&cond=new,stolen")).toEqual(at({ count: 1, age: MAX_AGE, conditions: ["new"] }));
    expect(stateOf("#count=abc&age=-3").count).toBe(DEFAULT_STATE.count);
    expect(stateOf(`#count=${MAX_COUNT + 50}`).count).toBe(MAX_COUNT);
    expect(stateOf("#cond=").conditions).toEqual([]);
  });
});

describe("the choice of an offer", () => {
  it("chooses the lowest price in stock, and tells why a lower price is not the choice", () => {
    const view = choiceOf(DEFAULT_STATE);
    expect(view.best?.id).toBe("shop-a:1001");
    expect(view.verdict).toBe("Buy 1 unit from Shop A: $89.99 for the goods, $89.99 with the shipping.");
    expect(view.why).toBe('The offer "Acme NVMe drive 1 TB, bulk box" of Shop A has a lower price, but it is not in stock.');
    expect(view.rows.map((row) => row.id)).toEqual(["shop-a:1002", "shop-a:1001", "parts-b:NV1T-ND"]);
  });

  it("follows the price breaks and the minimum order as the count changes", () => {
    const ten = choiceOf(at({ count: 10 }));
    expect([ten.best?.id, ten.best?.goods, ten.best?.cost]).toEqual(["parts-b:NV1T-ND", "$861.00", "$867.99"]);
    const short = choiceOf(at({ count: 24 }));
    expect(short.skipped.find((row) => row.id === "parts-b:NV1T-TR")?.why).toBe("The minimum order is 25 units, more than the count 24.");
    const tray = choiceOf(at({ count: 25 }));
    expect([tray.best?.id, tray.best?.goods, tray.best?.cost]).toEqual(["parts-b:NV1T-TR", "$1,862.50", "$1,874.50"]);
    expect(choiceOf(at({ count: 100 })).best?.unitPrice).toBe("$71.00");
  });

  it("skips each offer with a reason: the condition, the currency or the minimum", () => {
    const view = choiceOf(DEFAULT_STATE);
    expect(Object.fromEntries(view.skipped.map((row) => [row.id, row.why]))).toEqual({
      "bids-c:5531": "The condition used is not a condition that the buyer accepts.",
      "bids-c:5532": "The condition refurbished is not a condition that the buyer accepts.",
      "euro-d:NV1T": "The price is in EUR, not in USD.",
      "parts-b:NV1T-TR": "The minimum order is 25 units, more than the count 1.",
    });
  });

  it("tells when the shipping cost is not known", () => {
    const view = choiceOf(at({ conditions: ["new", "used"] }));
    expect(view.best?.id).toBe("bids-c:5531");
    expect(view.verdict).toBe("Buy 1 unit from Bids C: $52.00 for the goods, and the shipping cost is not known.");
  });

  it("matches the part by its maker and its part number, and lists the offers of other parts", () => {
    const view = choiceOf(DEFAULT_STATE);
    expect(view.matched).toBe(7);
    expect(view.other.map((row) => row.id)).toEqual(["shop-a:1003", "bids-c:5600"]);
    expect(choiceOf(at({ part: "ACM-NV" })).other.map((row) => row.id)).toEqual(["bids-c:5600"]);
    expect(choiceOf(at({ part: "" })).verdict).toBe("No offer has this part number of the maker.");
    expect(choiceOf(at({ conditions: [] })).verdict).toBe("No offer of the part can take an order of 1 unit.");
  });

  it("uses only the latest reading of each offer", () => {
    expect(choiceOf(DEFAULT_STATE).rows.find((row) => row.id === "shop-a:1001")?.unitPrice).toBe("$89.99");
  });
});

describe("the chart of the unit price", () => {
  it("has the best offer of choiceOf at each count", () => {
    for (const conditions of [["new"], ["new", "refurbished", "used"], []] as const) {
      const curve = curveOf(at({ conditions }));
      for (let count = 1; count <= MAX_COUNT; count += 1) {
        const run = curve.band.find((each) => each.from <= count && count <= each.to);
        expect(run?.id ?? null).toBe(choiceOf(at({ count, conditions })).best?.id ?? null);
      }
    }
  });

  it("gives the steps of the price breaks, and a line from the minimum order", () => {
    const curve = curveOf(DEFAULT_STATE);
    const steps = (id: string) => curve.series.find((line) => line.id === id)?.steps;
    expect(steps("parts-b:NV1T-ND")).toEqual([
      { from: 1, to: 9, price: 92.4 },
      { from: 10, to: 49, price: 86.1 },
      { from: 50, to: MAX_COUNT, price: 79.85 },
    ]);
    expect(steps("parts-b:NV1T-TR")).toEqual([
      { from: 25, to: 99, price: 74.5 },
      { from: 100, to: MAX_COUNT, price: 71 },
    ]);
    expect(curve.series.map((line) => line.slot)).toEqual([...curve.series.map((line) => line.slot)].sort((a, b) => a - b));
    expect([curve.low, curve.high]).toEqual([71, 92.4]);
  });

  it("keeps the color of an offer when the conditions change", () => {
    const slot = (conditions: DemoState["conditions"]) => curveOf(at({ conditions })).series.find((line) => line.id === "parts-b:NV1T-ND")?.slot;
    expect(slot(["new"])).toBe(slot(["new", "used", "refurbished"]));
    expect(slot(["new"])).toBe(SAMPLE_OFFERS.findIndex((each) => each.offer.id === "parts-b:NV1T-ND"));
  });
});

describe("the GTIN check", () => {
  it("gives the GTIN-14 form, the match key and the steps of a valid code", () => {
    const view = gtinOf("0 12345 67890 5");
    expect([view.valid, view.gtin14, view.key, view.sum, view.expected, view.given]).toEqual([true, "00012345678905", "gtin:00012345678905", 85, 5, 5]);
    expect(view.steps?.map((step) => step.weight).join("")).toBe("31313131313");
    expect(gtinOf("4006381333931").valid).toBe(true);
  });

  it("tells why a code is not valid", () => {
    expect(gtinOf("0 12345 67980 5").why).toBe("The sum gives the check digit 3, but the last digit is 5. A digit of the code is wrong.");
    expect(gtinOf("12345").why).toBe("The code has 5 digits. A GTIN has 8, 12, 13 or 14 digits.");
    expect(gtinOf("12A45").why).toBe("The code has a character that is not a digit, a space or a hyphen.");
    expect(gtinOf("00000000").why).toBe("A GTIN of zeros only is not a GTIN.");
    expect(gtinOf(" ").steps).toBeNull();
  });

  it("agrees with parseGtin for each sample code and for each last digit", () => {
    const codes = [...SAMPLE_CODES.map((each) => each.code), ...Array.from({ length: 10 }, (_, digit) => `40063813339${digit}`)];
    for (const code of codes) {
      const view = gtinOf(code);
      expect(view.valid).toBe(parseGtin(code) !== null);
      if (view.expected !== null && [8, 12, 13, 14].includes(view.digits.length)) expect(view.valid).toBe(view.expected === view.given);
    }
  });
});

describe("the storage rules", () => {
  it("keeps a reading while the terms of its source permit it", () => {
    const kept = (state: DemoState) => Object.fromEntries(termsOf(state).map((row) => [row.source, row.kept]));
    expect(kept(at({ age: 12 }))).toEqual({ "shop-a": true, "parts-b": true, "bids-c": false, "euro-d": false });
    expect(kept(at({ age: 6 }))).toEqual({ "shop-a": true, "parts-b": true, "bids-c": true, "euro-d": false });
    expect(kept(at({ age: 6, ended: true }))).toEqual({ "shop-a": true, "parts-b": true, "bids-c": false, "euro-d": false });
    expect(kept(at({ age: 30 }))["parts-b"]).toBe(false);
  });

  it("gives the limit, the reason and the permits of each source", () => {
    const rows = termsOf(at({ age: 12, ended: true }));
    expect(rows.map((row) => [row.source, row.rule, row.until, row.history, row.trend])).toEqual([
      ["shop-a", "Keep", "No limit", true, true],
      ["parts-b", "Keep 24 h", "24 h after the reading", false, false],
      ["bids-c", "Keep 6 h", "6 h after the reading", false, false],
      ["euro-d", "No store", "At the reading", false, false],
    ]);
    expect(rows.map((row) => [row.name, row.keptFor])).toEqual([
      ["Shop A", null],
      ["Parts B", 24],
      ["Bids C", 0],
      ["Euro D", 0],
    ]);
    expect(rows.map((row) => row.why)).toEqual([
      "The terms set no limit on the time.",
      "The reading is 12 h old, and the limit is 24 h.",
      "The offer ended, and the terms delete the readings of an ended offer.",
      "The offer ended, and the terms delete the readings of an ended offer.",
    ]);
  });
});
