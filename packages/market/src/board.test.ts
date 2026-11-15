import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BOARD_FORMAT,
  boardSchema,
  keepObservations,
  observationSchema,
  planReads,
  readInterval,
  watchEntrySchema,
  watchProblems,
  type ScheduleOptions,
  type WatchEntry,
} from "./board.ts";
import type { Observation } from "./offers.ts";
import type { Offer, PriceReading } from "./records.ts";
import { isKept, type SourceTerms } from "./terms.ts";

const terms = (source: string, retention: SourceTerms["retention"], deleteWhenEnded = false): SourceTerms => ({
  source,
  retention,
  deleteWhenEnded,
  priceModel: false,
  clause: `the terms of ${source}`,
});

/** The terms of the tests: a source with no limit, two sources with a limit, and a source with no store. */
const TERMS: readonly SourceTerms[] = [
  terms("keep", { kind: "keep" }),
  terms("bids", { kind: "max-age", age: { value: 6, unit: "h" } }, true),
  terms("shop", { kind: "max-age", age: { value: 72, unit: "h" } }),
  terms("parts", { kind: "no-store" }),
];

const NOW = "2026-11-15T12:00:00.000Z";

function observation(id: string, at: string, more: Partial<Offer> = {}, price = 10): Observation {
  const [source = "keep", sourceId = id] = id.split(":");
  const offer: Offer = { id, source, sourceId, title: `Offer ${id}`, seller: {}, condition: "new", format: "fixed-price", gtins: [], partNumbers: [], specs: [], ...more };
  const reading: PriceReading = { offerId: id, at, price: { value: price, unit: "USD" }, shipping: { kind: "free" }, availability: "in-stock" };
  return { offer, reading };
}

describe("the schemas of a board", () => {
  it("accept a board, and refuse a reading of another offer and two observations of one offer", () => {
    const one = observation("shop:1", NOW);
    expect(boardSchema.parse({ format: BOARD_FORMAT, at: NOW, observations: [one] })).toEqual({ format: BOARD_FORMAT, at: NOW, observations: [one] });
    expect(observationSchema.safeParse({ offer: one.offer, reading: { ...one.reading, offerId: "shop:2" } }).success).toBe(false);
    expect(boardSchema.safeParse({ format: BOARD_FORMAT, at: NOW, observations: [one, one] }).success).toBe(false);
    expect(boardSchema.safeParse({ format: "price-board/2", at: NOW, observations: [] }).success).toBe(false);
    expect(watchEntrySchema.safeParse({ name: "ups", source: "shop", every: { value: 0, unit: "h" } }).success).toBe(false);
    expect(watchEntrySchema.parse({ name: "ups", source: "shop", every: { value: 2, unit: "h" } }).every).toEqual({ value: 2, unit: "h" });
  });
});

describe("keepObservations", () => {
  it("keeps the latest observation of each offer while the terms of its source permit it", () => {
    const old = observation("shop:1", "2026-11-14T12:00:00Z", {}, 12);
    const fresh = observation("shop:1", "2026-11-15T11:00:00Z", {}, 11);
    const { kept, dropped } = keepObservations([fresh, old, observation("keep:1", "2020-01-01T00:00:00Z")], { terms: TERMS, now: NOW });
    expect(kept.map((each) => [each.offer.id, each.reading.price.value])).toEqual([
      ["keep:1", 10],
      ["shop:1", 11],
    ]);
    expect(dropped).toEqual([]);
  });

  it("drops each other offer with the reason", () => {
    const { kept, dropped } = keepObservations(
      [
        observation("bids:1", "2026-11-15T05:00:00Z"),
        observation("bids:2", "2026-11-15T11:00:00Z"),
        observation("bids:3", "2026-11-15T11:00:00Z", { endsAt: "2026-11-15T11:30:00Z" }),
        observation("shop:2", "2026-11-15T11:00:00Z"),
        observation("parts:1", NOW),
        observation("other:1", NOW),
      ],
      { terms: TERMS, now: NOW, ended: ["shop:2"] },
    );
    expect(kept.map((each) => each.offer.id)).toEqual(["bids:2"]);
    expect(Object.fromEntries(dropped.map((each) => [each.offerId, each.why]))).toEqual({
      "bids:1": "The reading of 2026-11-15T05:00:00Z passed the limit of 6 h of the terms of bids at 2026-11-15T11:00:00.000Z.",
      "bids:3": "The offer ended, and the terms of bids delete its readings.",
      "shop:2": "The offer ended.",
      "parts:1": "The terms of parts permit no store: a reading serves one request.",
      "other:1": "The terms of the source other are not known, so a store keeps no reading of it.",
    });
  });

  it("keeps a reading at its limit, and drops it one millisecond after", () => {
    const one = observation("bids:1", "2026-11-15T06:00:00Z");
    expect(keepObservations([one], { terms: TERMS, now: NOW }).kept).toHaveLength(1);
    expect(keepObservations([one], { terms: TERMS, now: "2026-11-15T12:00:00.001Z" }).kept).toHaveLength(0);
  });

  it("refuses an instant that is not an instant, and two terms of one source", () => {
    expect(() => keepObservations([], { terms: TERMS, now: "noon" })).toThrow(RangeError);
    expect(() => keepObservations([], { terms: [...TERMS, terms("shop", { kind: "keep" })], now: NOW })).toThrow(/two times/);
  });

  const instant = fc.integer({ min: Date.parse("2026-11-10T00:00:00Z"), max: Date.parse("2026-11-20T00:00:00Z") }).map((ms) => new Date(ms).toISOString());
  const observations = fc.array(
    fc.record({ source: fc.constantFrom("keep", "bids", "shop", "parts", "other"), n: fc.integer({ min: 1, max: 6 }), at: instant, ends: fc.option(instant, { nil: undefined }) }),
    { maxLength: 30 },
  ).map((list) => list.map((each) => observation(`${each.source}:${each.n}`, each.at, each.ends === undefined ? {} : { endsAt: each.ends })));
  const ended = fc.array(fc.constantFrom<string>("bids:1", "shop:2", "keep:3"), { maxLength: 3 });

  it("gives each offer one time, as kept or as dropped, and keeps only readings that the terms permit", () => {
    fc.assert(
      fc.property(observations, instant, ended, (list, now, gone) => {
        const { kept, dropped } = keepObservations(list, { terms: TERMS, now, ended: gone });
        const ids = [...kept.map((each) => each.offer.id), ...dropped.map((each) => each.offerId)].sort();
        expect(ids).toEqual([...new Set(list.map((each) => each.offer.id))].sort());
        for (const each of kept) {
          const rules = TERMS.find((t) => t.source === each.offer.source);
          expect(rules !== undefined && isKept(rules, each.reading, now)).toBe(true);
          expect(gone.includes(each.offer.id)).toBe(false);
          if (each.offer.endsAt !== undefined) expect(Date.parse(each.offer.endsAt)).toBeGreaterThan(Date.parse(now));
        }
      }),
    );
  });

  it("is stable: the kept observations keep each one, and a later instant keeps no more of them", () => {
    fc.assert(
      fc.property(observations, instant, fc.integer({ min: 0, max: 3 * 86_400_000 }), (list, now, wait) => {
        const first = keepObservations(list, { terms: TERMS, now });
        const again = keepObservations(first.kept, { terms: TERMS, now });
        expect(again).toEqual({ kept: first.kept, dropped: [] });
        const later = keepObservations(first.kept, { terms: TERMS, now: new Date(Date.parse(now) + wait).toISOString() });
        const before = new Set(first.kept.map((each) => each.offer.id));
        for (const each of later.kept) expect(before.has(each.offer.id)).toBe(true);
      }),
    );
  });
});

const hours = (value: number) => ({ value, unit: "h" });
const minutes = (value: number) => ({ value, unit: "min" });
const entry = (name: string, source: string, every: WatchEntry["every"]): WatchEntry => ({ name, source, every });
const SCHEDULE: ScheduleOptions = { terms: TERMS, slack: minutes(10) };

describe("readInterval", () => {
  it("gives the shorter of every and the limit less the slack", () => {
    expect(readInterval(entry("a", "keep", hours(100)), SCHEDULE)).toEqual({ ok: true, ms: 360_000_000 });
    expect(readInterval(entry("b", "bids", hours(1)), SCHEDULE)).toEqual({ ok: true, ms: 3_600_000 });
    expect(readInterval(entry("c", "bids", hours(24)), SCHEDULE)).toEqual({ ok: true, ms: 6 * 3_600_000 - 600_000 });
  });

  it("gives the reason when an entry has no interval", () => {
    expect(readInterval(entry("d", "parts", hours(1)), SCHEDULE)).toEqual({
      ok: false,
      why: "The terms of parts permit no store, so a watch cannot keep the prices of the entry d. Read the source for each request.",
    });
    expect(readInterval(entry("e", "bids", hours(1)), { terms: TERMS, slack: hours(6) })).toEqual({
      ok: false,
      why: "The slack 6 h is not less than the limit 6 h of the terms of bids, so the board has gaps in the prices of the entry e.",
    });
    expect(readInterval(entry("f", "other", hours(1)), SCHEDULE)).toEqual({ ok: false, why: "The terms of the source other of the entry f are not known." });
    expect(readInterval(entry("g", "keep", hours(0)), SCHEDULE).ok).toBe(false);
  });
});

describe("watchProblems", () => {
  it("gives each entry with no interval and each name that two entries have", () => {
    expect(watchProblems([entry("a", "keep", hours(1)), entry("b", "shop", hours(1))], SCHEDULE)).toEqual([]);
    expect(watchProblems([entry("a", "keep", hours(1)), entry("a", "parts", hours(1))], SCHEDULE)).toEqual([
      "Two entries have the name a.",
      "The terms of parts permit no store, so a watch cannot keep the prices of the entry a. Read the source for each request.",
    ]);
  });
});

describe("planReads", () => {
  const entries = [entry("a", "bids", hours(1)), entry("b", "shop", hours(24)), entry("c", "parts", hours(1))];

  it("reads each entry with no read, and gives the next due instant", () => {
    expect(planReads(entries, {}, NOW, SCHEDULE)).toEqual({ due: ["a", "b"], next: "2026-11-15T13:00:00.000Z" });
  });

  it("reads an entry when its interval has passed, and not before", () => {
    const last = { a: "2026-11-15T11:00:00.000Z", b: "2026-11-15T11:30:00.000Z" };
    expect(planReads(entries, last, NOW, SCHEDULE)).toEqual({ due: ["a"], next: "2026-11-15T13:00:00.000Z" });
    expect(planReads(entries, last, "2026-11-15T11:59:59.999Z", SCHEDULE)).toEqual({ due: [], next: NOW });
    expect(planReads([entries[2] as WatchEntry], {}, NOW, SCHEDULE)).toEqual({ due: [], next: null });
  });

  it("refuses an instant that is not an instant", () => {
    expect(() => planReads(entries, {}, "noon", SCHEDULE)).toThrow(RangeError);
    expect(() => planReads(entries, { a: "yesterday" }, NOW, SCHEDULE)).toThrow(/entry a/);
  });

  it("keeps a current reading of each entry on the board, for each pace of the loop that the slack covers", () => {
    fc.assert(
      fc.property(
        fc.record({
          limit: fc.integer({ min: 1, max: 12 }),
          every: fc.integer({ min: 1, max: 1_500 }),
          tick: fc.integer({ min: 60, max: 900 }),
          pass: fc.integer({ min: 0, max: 300 }),
          delays: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }),
        }),
        ({ limit, every, tick, pass, delays }) => {
          const source = terms("watched", { kind: "max-age", age: hours(limit) });
          const options: ScheduleOptions = { terms: [source], slack: { value: tick + pass, unit: "s" } };
          const watched = entry("w", "watched", minutes(every));
          const start = Date.parse(NOW);
          const end = start + 3 * limit * 3_600_000;
          // Each landing: the instant of the reading, and the instant that the reading is on the board.
          const landings: { at: number; on: number }[] = [];
          let last: Record<string, string> = {};
          let k = 0;
          for (let now = start; now <= end; now += tick * 1000, k += 1) {
            const plan = planReads([watched], last, new Date(now).toISOString(), options);
            if (!plan.due.includes("w")) continue;
            // The pass takes `pass` seconds at most. The source answers at an instant inside the pass.
            const share = delays[k % delays.length] ?? 0;
            landings.push({ at: now + share * pass * 1000, on: now + pass * 1000 });
            last = { w: new Date(now).toISOString() };
          }
          expect(landings.length).toBeGreaterThan(1);
          const limitMs = limit * 3_600_000;
          for (let i = 1; i < landings.length; i += 1) {
            const before = landings[i - 1];
            const after = landings[i];
            if (before !== undefined && after !== undefined) expect(after.on).toBeLessThanOrEqual(before.at + limitMs);
          }
        },
      ),
    );
  });
});
