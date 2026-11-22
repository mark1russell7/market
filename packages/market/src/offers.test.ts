import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bestOffer, latestObservations, offersOfPart, offersPart, type Observation, type PartWant } from "./offers.ts";
import type { Availability, Condition, Offer, PriceReading, Shipping } from "./records.ts";

const usd = (value: number) => ({ value, unit: "USD" });

/** The part of the tests: a maker that sellers write in two forms. */
const WANT: PartWant = { brands: ["Acme", "Acme Power Inc."], partNumbers: ["UPS-600X"] };

interface Make {
  readonly id: string;
  readonly brand?: string;
  readonly part?: string;
  readonly at?: string;
  readonly price?: number;
  readonly availability?: Availability;
  readonly condition?: Condition;
  readonly shipping?: Shipping;
  readonly unit?: string;
  readonly minimumQuantity?: number;
}

function observation(make: Make): Observation {
  const offer: Offer = {
    id: make.id,
    source: make.id.split(":")[0] ?? "example",
    sourceId: make.id.split(":")[1] ?? make.id,
    title: `Offer ${make.id}`,
    seller: {},
    condition: make.condition ?? "new",
    format: "fixed-price",
    gtins: [],
    partNumbers: [{ brand: make.brand ?? "Acme", partNumber: make.part ?? "UPS-600X" }],
    specs: [],
  };
  const reading: PriceReading = {
    offerId: make.id,
    at: make.at ?? "2026-11-15T02:00:00Z",
    price: { value: make.price ?? 100, unit: make.unit ?? "USD" },
    shipping: make.shipping ?? { kind: "free" },
    availability: make.availability ?? "in-stock",
    ...(make.minimumQuantity === undefined ? {} : { minimumQuantity: make.minimumQuantity }),
  };
  return { offer, reading };
}

describe("offersPart", () => {
  it("matches a part number of the maker after the fold, and a part number that starts with it", () => {
    expect(offersPart(observation({ id: "a:1", part: "ups600x" }).offer, WANT)).toBe(true);
    expect(offersPart(observation({ id: "a:2", brand: "ACME POWER INC", part: "UPS600X-LM" }).offer, WANT)).toBe(true);
  });

  it("does not match the same part number of another maker, or a part number of the maker that is shorter", () => {
    // A bare number is also a part of other makers: a solder tip and a fan had the part number of a power bank.
    expect(offersPart(observation({ id: "a:3", brand: "Other Tools", part: "UPS-600X" }).offer, WANT)).toBe(false);
    expect(offersPart(observation({ id: "a:4", part: "UPS-600" }).offer, WANT)).toBe(false);
    expect(offersPart(observation({ id: "a:5", part: "XUPS600X" }).offer, WANT)).toBe(false);
  });

  it("matches nothing for a want with no brand or no part number that folds to a text", () => {
    const offer = observation({ id: "a:6" }).offer;
    expect(offersPart(offer, { brands: [], partNumbers: ["UPS-600X"] })).toBe(false);
    expect(offersPart(offer, { brands: ["Acme"], partNumbers: ["-/-"] })).toBe(false);
    expect(offersPart({ partNumbers: [{ brand: "Acme", partNumber: "UPS-600X" }] }, { brands: ["  "], partNumbers: ["UPS-600X"] })).toBe(false);
  });
});

describe("offersOfPart", () => {
  it("gives the latest observation of each offer of the part, in the order of the offer ids", () => {
    const list = [
      observation({ id: "b:2", at: "2026-11-15T02:00:00.500Z", price: 90 }),
      observation({ id: "b:1", at: "2026-11-14T02:00:00Z", price: 80 }),
      observation({ id: "b:2", at: "2026-11-15T02:00:00Z", price: 70 }),
      observation({ id: "b:3", brand: "Other Tools", price: 10 }),
      observation({ id: "b:1", at: "2026-11-15T02:00:00Z", price: 85 }),
    ];
    const found = offersOfPart(list, WANT);
    expect(found.map((each) => [each.offer.id, each.reading.price.value])).toEqual([
      ["b:1", 85],
      ["b:2", 90],
    ]);
  });

  it("takes the later reading in the list when two readings of an offer have one instant", () => {
    const list = [observation({ id: "c:1", price: 1 }), observation({ id: "c:1", price: 2 })];
    expect(latestObservations(list).map((each) => each.reading.price.value)).toEqual([2]);
  });
});

describe("bestOffer", () => {
  it("gives the lowest price in stock, before a lower price out of stock", () => {
    const list = [
      observation({ id: "d:1", price: 120 }),
      observation({ id: "d:2", price: 95, availability: "out-of-stock" }),
      observation({ id: "d:3", price: 110, availability: "low-stock" }),
    ];
    const chosen = bestOffer(list, { currency: "USD" });
    expect(chosen.best?.observation.offer.id).toBe("d:3");
    expect(chosen.offers.map((each) => [each.observation.offer.id, each.inStock])).toEqual([
      ["d:2", false],
      ["d:3", true],
      ["d:1", true],
    ]);
  });

  it("gives the lowest price when no offer is in stock, and null with no offer", () => {
    const list = [observation({ id: "e:1", price: 120, availability: "out-of-stock" }), observation({ id: "e:2", price: 99, availability: "unknown" })];
    expect(bestOffer(list, { currency: "USD" }).best?.observation.offer.id).toBe("e:2");
    expect(bestOffer([], { currency: "USD" })).toEqual({ best: null, offers: [], skipped: [] });
  });

  it("skips a condition that the buyer does not accept, another currency and a minimum above the count", () => {
    const list = [
      observation({ id: "f:1", price: 10, condition: "used" }),
      observation({ id: "f:2", price: 10, unit: "EUR" }),
      observation({ id: "f:3", price: 10, minimumQuantity: 5 }),
      observation({ id: "f:4", price: 50 }),
    ];
    const chosen = bestOffer(list, { currency: "USD" });
    expect(chosen.best?.observation.offer.id).toBe("f:4");
    expect(chosen.skipped).toEqual([
      { offerId: "f:1", why: "The condition used is not a condition that the buyer accepts." },
      { offerId: "f:2", why: "The price is in EUR, not in USD." },
      { offerId: "f:3", why: "The minimum order is 5 units, more than the count 1." },
    ]);
    const used = bestOffer(list, { currency: "USD", conditions: ["new", "used"], count: 5 });
    expect(used.offers.map((each) => [each.observation.offer.id, each.goods.value])).toEqual([
      ["f:1", 50],
      ["f:3", 50],
      ["f:4", 250],
    ]);
  });

  it("orders equal prices by the cost with the shipping, then by the offer id", () => {
    const list = [
      observation({ id: "g:3", price: 40, shipping: { kind: "calculated" } }),
      observation({ id: "g:2", price: 40, shipping: { kind: "fixed", cost: usd(5) } }),
      observation({ id: "g:4", price: 40, shipping: { kind: "fixed", cost: { value: 1, unit: "EUR" } } }),
      observation({ id: "g:1", price: 40 }),
      observation({ id: "g:0", price: 40 }),
    ];
    const chosen = bestOffer(list, { currency: "USD", count: 2 });
    expect(chosen.offers.map((each) => [each.observation.offer.id, each.cost?.value ?? null])).toEqual([
      ["g:0", 80],
      ["g:1", 80],
      ["g:2", 85],
      ["g:3", null],
      ["g:4", null],
    ]);
  });

  it("refuses a count that is not a whole number of 1 or more, and a currency that is not a unit of money", () => {
    for (const count of [0, -1, 1.5, Number.NaN]) expect(() => bestOffer([], { currency: "USD", count })).toThrow(RangeError);
    expect(() => bestOffer([], { currency: "ZZZ" })).toThrow("The currency ZZZ is not a unit of money of @mark1russell7/quantity.");
    expect(() => bestOffer([], { currency: "W" })).toThrow(RangeError);
  });

  it("keeps the offers in EUR for a call in EUR, and skips the offers in USD", () => {
    const list = [observation({ id: "e:1", price: 10, unit: "EUR" }), observation({ id: "e:2", price: 8 })];
    const chosen = bestOffer(list, { currency: "EUR" });
    expect(chosen.best?.observation.offer.id).toBe("e:1");
    expect(chosen.skipped).toEqual([{ offerId: "e:2", why: "The price is in USD, not in EUR." }]);
  });

  it("gives one choice for each order of the observations, and the best has the lowest price of the offers in stock", () => {
    const make = fc.record({
      offer: fc.integer({ min: 0, max: 5 }),
      minute: fc.integer({ min: 0, max: 10_000 }),
      price: fc.integer({ min: 0, max: 50_000 }).map((cents) => cents / 100),
      availability: fc.constantFrom<Availability>("in-stock", "low-stock", "out-of-stock", "preorder", "unknown"),
    });
    // Each reading has its own instant, so the latest reading of each offer does not depend on the order.
    const lists = fc.uniqueArray(make, { maxLength: 12, selector: (each) => each.minute }).chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length })));
    fc.assert(
      fc.property(lists, ([rows, shuffled]) => {
        const toList = (each: typeof rows): Observation[] =>
          each.map((row) =>
            observation({ id: `p:${row.offer}`, at: new Date(Date.UTC(2026, 10, 15) + row.minute * 60_000).toISOString(), price: row.price, availability: row.availability }),
          );
        const one = bestOffer(toList(rows), { currency: "USD" });
        expect(bestOffer(toList(shuffled), { currency: "USD" })).toEqual(one);
        const stocked = one.offers.filter((each) => each.inStock);
        if (stocked.length > 0) {
          expect(one.best?.inStock).toBe(true);
          for (const each of stocked) expect(each.goods.value).toBeGreaterThanOrEqual(one.best?.goods.value ?? Number.NaN);
        } else expect(one.best).toBe(one.offers[0] ?? null);
      }),
      { numRuns: 200, seed: 20261115 },
    );
  });
});
