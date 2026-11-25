import { meteredCost, meteredObservationSchema, type MeteredObservation } from "@mark1russell7/market";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linodeAvailability, linodeRegions, linodeTypes, vultrPlans, vultrRegions } from "../test/plan-fixtures.ts";
import { AT, meteredNotes, meteredObservations, mutated } from "../test/fixtures.ts";
import type { MeteredParseResult } from "./parse.ts";
import {
  PLAN_METER,
  parsePlanLists,
  parsePlanProvider,
  planListUrl,
  planNextPage,
  type PlanAnswers,
  type PlanProvider,
} from "./plans.ts";
import { LINODE_PLANS, PLAN_PROVIDERS, VULTR_PLANS } from "./providers.ts";

const vultr = (): MeteredParseResult => parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrPlans] }, AT);
const linode = (): MeteredParseResult => parsePlanLists(LINODE_PLANS, { places: [linodeRegions], plans: [linodeTypes], regions: linodeAvailability }, AT);

/** This function gives the observation of an offer id, and it throws when the result does not have it. */
function offer(result: MeteredParseResult, id: string): MeteredObservation {
  const found = meteredObservations(result).find((observation) => observation.offer.id === id);
  if (found === undefined) throw new Error(`The result has no offer ${id}.`);
  return found;
}

/** This function gives the hourly price and the start of the cap of the meter of an offer. */
function compute(observation: MeteredObservation): { hourly: number; cap: number | undefined } {
  const meter = observation.reading.meters.find((each) => each.name === PLAN_METER);
  if (meter === undefined) throw new Error("The offer has no compute meter.");
  return { hourly: meter.tiers[0]?.unitPrice.value ?? Number.NaN, cap: meter.tiers[1]?.from.value };
}

/** This function gives the cost of a month with `hours` hours of use. */
function cost(observation: MeteredObservation, hours: number): number {
  return meteredCost(observation, { [PLAN_METER]: { value: hours, unit: "h" } }).total.value;
}

/** This function examines the invariants of a result: a refusal has a problem, each record is valid, and each id is unique. */
function expectValid(result: MeteredParseResult): void {
  if (!result.ok) {
    expect(result.problems.length).toBeGreaterThan(0);
    return;
  }
  const observations = meteredObservations(result);
  for (const observation of observations) expect(meteredObservationSchema.safeParse(observation).success).toBe(true);
  expect(new Set(observations.map((observation) => observation.offer.id)).size).toBe(observations.length);
}

/** A copy of a Vultr page in which the plan `index` has these fields. */
function vultrWith(index: number, fields: Record<string, unknown>): unknown {
  return { ...vultrPlans, plans: vultrPlans.plans.map((plan, at) => (at === index ? { ...plan, ...fields } : plan)) };
}

describe("parsePlanLists with the Vultr record", () => {
  it("gives one offer for each region of each plan, and a note for each plan with no region", () => {
    const result = vultr();
    expectValid(result);
    expect(meteredObservations(result).map((observation) => observation.offer.id)).toEqual([
      "vultr:vc2-1c-1gb/ewr/on-demand",
      "vultr:vc2-1c-1gb/ams/on-demand",
      "vultr:vc2-1c-1gb/sao/on-demand",
    ]);
    expect(meteredNotes(result)).toEqual([
      "The plan vcg-h100-216c-1914gb-640vram has no offer: it has no available region.",
      "The plan vcg-l40s-16c-180g-48vram has no offer: it has no available region.",
    ]);
  });

  it("gives the offer, the location, the term and the specs of a plan", () => {
    const { offer: found, reading } = offer(vultr(), "vultr:vc2-1c-1gb/ewr/on-demand");
    expect(found).toEqual({
      id: "vultr:vc2-1c-1gb/ewr/on-demand",
      source: "vultr",
      sourceId: "vc2-1c-1gb/ewr/on-demand",
      title: "Vultr vc2-1c-1gb",
      location: { provider: "vultr", region: "ewr" },
      term: { kind: "on-demand" },
      specs: [
        { name: "type", value: "vc2" },
        { name: "vcpu", value: "1" },
        { name: "memory", value: "1024 MiB" },
        { name: "disk", value: "25 GB" },
        { name: "disk-type", value: "SSD" },
        { name: "transfer", value: "1024 GB" },
        { name: "cpu-vendor", value: "Intel" },
        { name: "pricing", value: "on-demand" },
      ],
    });
    expect(reading.at).toBe(AT);
    expect(reading.period).toEqual({ value: 1, unit: "mo" });
  });

  it("uses the price of a region in location_cost, and the price of the plan in each other region", () => {
    const result = vultr();
    expect(compute(offer(result, "vultr:vc2-1c-1gb/sao/on-demand"))).toEqual({ hourly: 0.01, cap: 750 });
    const ewr = compute(offer(result, "vultr:vc2-1c-1gb/ewr/on-demand"));
    expect(ewr.hourly).toBe(0.007);
    expect(ewr.cap).toBeCloseTo(5 / 0.007, 9);
  });

  it("costs the hourly price up to the monthly cap", () => {
    const ewr = offer(vultr(), "vultr:vc2-1c-1gb/ewr/on-demand");
    expect(cost(ewr, 100)).toBeCloseTo(0.7, 9);
    expect(cost(ewr, 730)).toBeCloseTo(5, 9);
    const sao = offer(vultr(), "vultr:vc2-1c-1gb/sao/on-demand");
    expect(cost(sao, 730)).toBeCloseTo(7.3, 9);
    expect(cost(sao, 744)).toBeCloseTo(7.44, 9);
    expect(cost(sao, 800)).toBeCloseTo(7.5, 9);
  });

  it("gives only the preemptible term of a plan with deploy_ondemand false", () => {
    const result = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(1, { locations: ["ewr"] })] }, AT);
    expectValid(result);
    const spot = offer(result, "vultr:vcg-h100-216c-1914gb-640vram/ewr/spot");
    expect(spot.offer.term).toEqual({ kind: "spot" });
    expect(compute(spot)).toEqual({ hourly: 18.4, cap: 672 });
    expect(meteredObservations(result).some((observation) => observation.offer.id.endsWith("/ewr/on-demand") && observation.offer.id.includes("h100"))).toBe(false);
  });

  it("skips an offer with an hourly price of 0 and a monthly price, notes a monthly price of 0, and keeps a free plan", () => {
    const priced = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { hourly_cost: 0, monthly_cost: 5, location_cost: {} })] }, AT);
    expect(meteredObservations(priced)).toEqual([]);
    expect(meteredNotes(priced)).toContain("The offer vultr:vc2-1c-1gb/ewr/on-demand is skipped: its hourly price is 0 and its monthly price is 5.");
    const uncapped = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { hourly_cost: 0.01, monthly_cost: 0, location_cost: {} })] }, AT);
    expect(meteredObservations(uncapped)).toHaveLength(3);
    expect(meteredNotes(uncapped)).toContain("The offer vultr:vc2-1c-1gb/ewr/on-demand has no monthly cap: its monthly price is 0 and its hourly price is 0.01.");
    const free = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { hourly_cost: 0, monthly_cost: 0, location_cost: {} })] }, AT);
    expect(meteredObservations(free).map((observation) => observation.offer.id)).toEqual(["vultr:vc2-1c-1gb/ewr/on-demand", "vultr:vc2-1c-1gb/ams/on-demand", "vultr:vc2-1c-1gb/sao/on-demand"]);
  });

  it("skips an offer with a bad price, with a note", () => {
    const result = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { hourly_cost: "-1", monthly_cost: 5 })] }, AT);
    expect(meteredObservations(result).map((observation) => observation.offer.id)).toEqual(["vultr:vc2-1c-1gb/sao/on-demand"]);
    expect(meteredNotes(result)).toContain('The offer vultr:vc2-1c-1gb/ewr/on-demand is skipped: its hourly price "-1" is not a number of 0 or more.');
    const monthly = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { monthly_cost: -5, location_cost: {} })] }, AT);
    expect(meteredObservations(monthly)).toEqual([]);
    expect(meteredNotes(monthly)[0]).toBe("The offer vultr:vc2-1c-1gb/ewr/on-demand is skipped: its monthly price -5 is not a number of 0 or more.");
  });

  it("skips a plan with no id, and counts a plan of two pages one time", () => {
    const result = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrWith(0, { id: " " }), vultrPlans] }, AT);
    expect(meteredNotes(result)[0]).toBe('The plan 1 is skipped: it has no text at "id".');
    expect(meteredObservations(result)).toHaveLength(3);
    const twice = parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrPlans, vultrPlans] }, AT);
    expect(meteredObservations(twice)).toEqual(meteredObservations(vultr()));
  });

  it("refuses a page with no list of plans", () => {
    expect(parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrPlans, { meta: {} }] }, AT)).toEqual({
      ok: false,
      problems: ['The page 2 of the plan list has no list at "plans".'],
    });
  });

  it("refuses an instant that is not an instant in UTC", () => {
    expect(() => parsePlanLists(VULTR_PLANS, { places: [vultrRegions], plans: [vultrPlans] }, "2026-11-18")).toThrow(RangeError);
  });
});

describe("parsePlanLists with the Linode record", () => {
  it("gives one offer for each available region of each plan, from the list of regions", () => {
    const result = linode();
    expectValid(result);
    expect(meteredObservations(result).map((observation) => observation.offer.sourceId)).toEqual([
      "g6-nanode-1/us-central/on-demand",
      "g6-nanode-1/us-east/on-demand",
      "g6-nanode-1/id-cgk/on-demand",
      "g6-nanode-1/br-gru/on-demand",
      "g6-dedicated-2/us-central/on-demand",
      "g6-dedicated-2/us-east/on-demand",
      "g6-dedicated-2/br-gru/on-demand",
      "g1-gpu-rtx6000-1/id-cgk/on-demand",
    ]);
    expect(meteredNotes(result)).toEqual(["4 pairs of a plan and a region are not available."]);
  });

  it("uses the label in the title, the prices of region_prices, and no cap for a plan with no monthly price", () => {
    const result = linode();
    const nanode = offer(result, "linode:g6-nanode-1/us-east/on-demand");
    expect(nanode.offer.title).toBe("Linode Nanode 1GB");
    expect(nanode.offer.specs).toEqual([
      { name: "class", value: "nanode" },
      { name: "vcpu", value: "1" },
      { name: "memory", value: "1024 MiB" },
      { name: "disk", value: "25600 MiB" },
      { name: "transfer", value: "1000 GB" },
      { name: "gpu-count", value: "0" },
      { name: "network-out", value: "1000 Mbps" },
      { name: "pricing", value: "on-demand" },
    ]);
    expect(compute(nanode).hourly).toBe(0.0075);
    expect(compute(offer(result, "linode:g6-nanode-1/br-gru/on-demand")).hourly).toBe(0.0105);
    expect(cost(offer(result, "linode:g6-nanode-1/br-gru/on-demand"), 730)).toBeCloseTo(7, 9);
    expect(compute(offer(result, "linode:g1-gpu-rtx6000-1/id-cgk/on-demand"))).toEqual({ hourly: 1.5, cap: undefined });
  });

  it("refuses answers with no page of the list of regions", () => {
    expect(parsePlanLists(LINODE_PLANS, { places: [linodeRegions], plans: [linodeTypes] }, AT)).toEqual({
      ok: false,
      problems: ["The provider linode reads its regions from a list, and the answers have no page of that list."],
    });
  });

  it("counts the bad rows of the list of regions in one note", () => {
    const bad = { data: [{ region: "us-east", plan: "g6-nanode-1", available: "yes" }, { plan: "g6-nanode-1", available: true }] };
    const result = parsePlanLists(LINODE_PLANS, { places: [linodeRegions], plans: [linodeTypes], regions: [bad] }, AT);
    expect(meteredObservations(result)).toEqual([]);
    expect(meteredNotes(result)[0]).toBe('2 rows of the list of regions are skipped: each has no plan, no region or no "available" of true or false.');
  });
});

describe("the country of each offer", () => {
  it("puts the country of the region into the location of each offer, in capital letters", () => {
    expect(offer(vultr(), "vultr:vc2-1c-1gb/ams/on-demand").offer.location).toEqual({ provider: "vultr", region: "ams", country: "NL" });
    expect(offer(linode(), "linode:g6-nanode-1/us-east/on-demand").offer.location).toEqual({ provider: "linode", region: "us-east", country: "US" });
    expect(offer(linode(), "linode:g6-nanode-1/id-cgk/on-demand").offer.location.country).toBe("ID");
  });

  it("refuses answers with no page of the list of places", () => {
    expect(parsePlanLists(VULTR_PLANS, { plans: [vultrPlans] }, AT)).toEqual({
      ok: false,
      problems: ["The provider vultr reads the countries of its regions from a list, and the answers have no page of that list."],
    });
  });

  it("skips a bad row, gives no country to a region with two countries, and notes each offer with no country", () => {
    const places = {
      regions: [{ id: "ewr", country: "US" }, { id: "ewr", country: "CA" }, { id: "ams", country: "Netherlands" }, { country: "BR" }],
    };
    const result = parsePlanLists(VULTR_PLANS, { plans: [vultrPlans], places: [places] }, AT);
    expectValid(result);
    expect(meteredObservations(result).map((observation) => observation.offer.location.country)).toEqual([undefined, undefined, undefined]);
    expect(meteredNotes(result)).toEqual([
      "2 rows of the list of places are skipped: each has no region or no country of two letters.",
      "The regions ewr have no country: the list of places gives two countries for each.",
      "The plan vcg-h100-216c-1914gb-640vram has no offer: it has no available region.",
      "The plan vcg-l40s-16c-180g-48vram has no offer: it has no available region.",
      "The offers of the regions ams, ewr, sao have no country.",
    ]);
  });

  it("refuses a page of the list of places with no list", () => {
    expect(parsePlanLists(VULTR_PLANS, { plans: [vultrPlans], places: [{ meta: {} }] }, AT)).toEqual({
      ok: false,
      problems: ['The page 1 of the list of places has no list at "regions".'],
    });
  });
});

describe("the addresses of the pages of a list", () => {
  it("adds the paging parameter to the query of the record", () => {
    expect(planListUrl(VULTR_PLANS, VULTR_PLANS.plans)).toBe("https://api.vultr.com/v2/plans?per_page=500");
    expect(planListUrl(VULTR_PLANS, VULTR_PLANS.plans, "bmV4dA==")).toBe("https://api.vultr.com/v2/plans?per_page=500&cursor=bmV4dA%3D%3D");
    expect(planListUrl(LINODE_PLANS, LINODE_PLANS.plans, "2")).toBe("https://api.linode.com/v4/linode/types?page_size=500&page=2");
    const none = { ...VULTR_PLANS.plans, query: {}, paging: { kind: "none" as const } };
    expect(planListUrl(VULTR_PLANS, none, "2")).toBe("https://api.vultr.com/v2/plans");
  });

  it("gives the cursor or the number of the next page, or the end", () => {
    expect(planNextPage(VULTR_PLANS.plans, vultrPlans, 1)).toEqual({ kind: "end" });
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: { next: "bmV4dA==" } } }, 1)).toEqual({ kind: "next", after: "bmV4dA==" });
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: { next: null } } }, 1)).toEqual({ kind: "end" });
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: { next: "  " } } }, 1)).toEqual({ kind: "end" });
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: { next: " bmV4dA== " } } }, 1)).toEqual({ kind: "next", after: " bmV4dA== " });
    const [first, second] = linodeAvailability;
    expect(planNextPage(LINODE_PLANS.plans, first, 1)).toEqual({ kind: "next", after: "2" });
    expect(planNextPage(LINODE_PLANS.plans, second, 2)).toEqual({ kind: "end" });
    expect(planNextPage({ ...VULTR_PLANS.plans, paging: { kind: "none" } }, {}, 1)).toEqual({ kind: "end" });
  });

  it("gives a fault, not the end, for a paging field that is missing or of a wrong type", () => {
    for (const pages of ["2", undefined, -1, 1.5, null]) {
      expect(planNextPage(LINODE_PLANS.plans, { pages }, 1)).toEqual({ kind: "fault", why: `The count of pages ${pages === undefined ? "undefined" : JSON.stringify(pages)} at "pages" is not a whole number.` });
    }
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: {} } }, 1)).toEqual({ kind: "fault", why: `The cursor undefined at "meta.links.next" is not text or null.` });
    expect(planNextPage(VULTR_PLANS.plans, { meta: { links: { next: 2 } } }, 1)).toEqual({ kind: "fault", why: `The cursor 2 at "meta.links.next" is not text or null.` });
  });
});

describe("parsePlanProvider", () => {
  it("accepts each record of the package, also after a JSON round trip", () => {
    for (const record of PLAN_PROVIDERS) {
      expect(parsePlanProvider(record)).toEqual({ ok: true, provider: record });
      expect(parsePlanProvider(JSON.parse(JSON.stringify(record)))).toEqual({ ok: true, provider: record });
    }
  });

  it("refuses a record with faults, with a problem for each fault", () => {
    const record: PlanProvider = {
      ...VULTR_PLANS,
      source: "other",
      host: "https://api.vultr.com",
      currency: "XYZ",
      prices: [VULTR_PLANS.prices[0]!, VULTR_PLANS.prices[0]!],
      specs: [{ name: "pricing", path: "type" }],
    };
    const read = parsePlanProvider(record);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems).toEqual([
      "host: The host is a DNS name with small letters, digits, hyphens and dots.",
      "currency: The currency is not a money unit of @mark1russell7/quantity.",
      "terms.source: The terms are the terms of vultr, and not of other.",
      "prices: Two price terms have one key.",
      "specs: The spec name pricing is for the parser.",
    ]);
  });
});

describe("the properties of the plan parser", () => {
  const cases: readonly { name: string; record: PlanProvider; answers: (page: unknown) => PlanAnswers; fixture: unknown }[] = [
    { name: "Vultr", record: VULTR_PLANS, answers: (page) => ({ plans: [page], places: [vultrRegions] }), fixture: vultrPlans },
    { name: "Vultr places", record: VULTR_PLANS, answers: (page) => ({ plans: [vultrPlans], places: [page] }), fixture: vultrRegions },
    {
      name: "Linode plans",
      record: LINODE_PLANS,
      answers: (page) => ({ plans: [page], regions: linodeAvailability, places: [linodeRegions] }),
      fixture: linodeTypes,
    },
    {
      name: "Linode regions",
      record: LINODE_PLANS,
      answers: (page) => ({ plans: [linodeTypes], regions: [page, linodeAvailability[1]], places: [linodeRegions] }),
      fixture: linodeAvailability[0],
    },
  ];

  for (const { name, record, answers, fixture } of cases) {
    it(`gives valid records with unique ids for each mutated answer (${name})`, () => {
      fc.assert(
        fc.property(mutated(fixture), (page) => {
          expectValid(parsePlanLists(record, answers(page), AT));
        }),
        { numRuns: 200 },
      );
    });
  }

  it("costs each offer the smaller of the hourly cost and the monthly cap", () => {
    const observations = [...meteredObservations(vultr()), ...meteredObservations(linode())];
    fc.assert(
      fc.property(fc.constantFrom(...observations), fc.double({ min: 0, max: 744, noNaN: true }), (observation, hours) => {
        const { hourly, cap } = compute(observation);
        const expected = cap === undefined ? hours * hourly : Math.min(hours, cap) * hourly;
        expect(cost(observation, hours)).toBeCloseTo(expected, 6);
      }),
      { numRuns: 300 },
    );
  });
});
