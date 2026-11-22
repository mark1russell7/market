import { averagePriceSchema } from "@mark1russell7/market";
import { valueIn } from "@mark1russell7/quantity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BLS_PACE_MS, createBlsClient } from "./bls-client.ts";
import { BLS_API_URL, BLS_SERIES_LIMIT, BLS_STAPLES, blsRequest, parseBlsSeries } from "./bls.ts";
import { instantOf } from "./client.ts";
import { fakePace, fakeTransport, reply } from "../test/fakes.ts";

const AT = "2026-11-22T16:00:00Z";
const RICE = "APU0000701312";
const SUGAR = "APU0000715211";

/** An answer of version 1 with the shape of a read on 2026-11-22: the latest values of rice, and a series with no data. */
const answer = {
  status: "REQUEST_SUCCEEDED",
  responseTime: 19,
  message: ["No Data Available for Series APU0100701312 Year: 2024"],
  Results: {
    series: [
      {
        seriesID: RICE,
        data: [
          { year: "2026", period: "M10", periodName: "October", latest: "true", value: "1.101", footnotes: [{}] },
          { year: "2026", period: "M09", periodName: "September", value: "1.118", footnotes: [{ code: "P", text: "Preliminary" }] },
        ],
      },
      { seriesID: SUGAR, data: [{ year: "2025", period: "M10", periodName: "October", value: "-", footnotes: [{}] }] },
    ],
  },
};

describe("the parser of the BLS average prices", () => {
  it("gives an average price in USD/lb for each month of a known series, with its footnotes", () => {
    const result = parseBlsSeries(answer, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prices.map((price) => `${price.id} ${price.price.value} ${price.price.unit}`)).toEqual([
      "bls-ap:APU0000701312:2026-10 1.101 USD/lb",
      "bls-ap:APU0000701312:2026-09 1.118 USD/lb",
    ]);
    for (const price of result.prices) expect(averagePriceSchema.safeParse(price).success).toBe(true);
    expect(result.prices[0]).not.toHaveProperty("footnotes");
    expect(result.prices[1]?.footnotes).toEqual(["Preliminary"]);
    expect(result.prices[0]?.area).toBe("U.S. city average");
    expect(valueIn(result.prices[0]!.price, "USD/kg")).toBeCloseTo(2.4273, 4);
  });

  it("gives a note for a value with no data, for each message, for a period that is not a month and for an unknown series", () => {
    const more = {
      ...answer,
      Results: {
        series: [
          ...answer.Results.series,
          { seriesID: RICE, data: [{ year: "2025", period: "M13", value: "1.0", footnotes: [] }] },
          { seriesID: "APU0000709112", data: [{ year: "2026", period: "M10", value: "4.0", footnotes: [] }] },
        ],
      },
    };
    const result = parseBlsSeries(more, AT);
    expect(result.ok && result.notes).toEqual([
      "BLS: No Data Available for Series APU0100701312 Year: 2024",
      'The value of the series APU0000715211 for 2025-10 is skipped: "-" is not a decimal.',
      'A value of the series APU0000701312 is skipped: the period "2025" "M13" is not a month.',
      'The series "APU0000709112" is skipped: it is not a known series.',
    ]);
  });

  it("counts a repeated value once, and refuses an answer that did not succeed or has no series", () => {
    const twice = { ...answer, Results: { series: [answer.Results.series[0], answer.Results.series[0]] } };
    const result = parseBlsSeries(twice, AT);
    expect(result.ok && result.prices.length).toBe(2);
    expect(parseBlsSeries({ status: "REQUEST_NOT_PROCESSED", message: ["Daily threshold reached."] }, AT)).toEqual({
      ok: false,
      problems: ['The status of the answer is "REQUEST_NOT_PROCESSED", not "REQUEST_SUCCEEDED".', "BLS: Daily threshold reached."],
      threshold: true,
    });
    expect(parseBlsSeries({ status: "REQUEST_SUCCEEDED" }, AT).ok).toBe(false);
    for (const json of [null, 5, "text", [], {}]) expect(parseBlsSeries(json, AT).ok).toBe(false);
    expect(() => parseBlsSeries(answer, "2026-11-22")).toThrow(RangeError);
  });

  it("never throws on a random JSON value or a mutated answer, and gives only valid prices", () => {
    const series = fc.record({ seriesID: fc.constantFrom(RICE, SUGAR, "X"), data: fc.array(fc.record({ year: fc.jsonValue(), period: fc.jsonValue(), value: fc.jsonValue(), footnotes: fc.jsonValue() })) });
    const answers = fc.oneof(fc.jsonValue(), fc.record({ status: fc.constant("REQUEST_SUCCEEDED"), message: fc.jsonValue(), Results: fc.record({ series: fc.array(series) }) }));
    fc.assert(
      fc.property(answers, (json) => {
        const result = parseBlsSeries(json, AT);
        if (result.ok) for (const price of result.prices) expect(averagePriceSchema.safeParse(price).success).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("marks the answer of the daily threshold, so that a loop waits for the next day", () => {
    // The shape of this answer is not in the documentation of BLS. The message is the form that users report.
    const threshold = {
      status: "REQUEST_NOT_PROCESSED",
      responseTime: 0,
      message: ["Request could not be serviced, as the daily threshold for total number of requests allocated to the user has been reached."],
      Results: {},
    };
    const result = parseBlsSeries(threshold, AT);
    expect(result).toMatchObject({ ok: false, threshold: true });
    expect(parseBlsSeries({ status: "REQUEST_NOT_PROCESSED", message: ["Series does not exist."] }, AT)).not.toHaveProperty("threshold");
  });

  it("knows each staple once, with an item in pounds in the U.S. city average", () => {
    expect(new Set(BLS_STAPLES.map((each) => each.series)).size).toBe(BLS_STAPLES.length);
    for (const each of BLS_STAPLES) {
      expect(each.unit).toBe("lb");
      expect(each.area).toBe("U.S. city average");
      expect(each.item).toContain("per lb.");
    }
  });
});

describe("the request of the BLS API", () => {
  it("posts the series and the years as JSON, and refuses a bad count, a bad id and bad years", () => {
    expect(blsRequest([RICE], { start: 2025, end: 2026 })).toEqual({
      method: "POST",
      url: BLS_API_URL,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ seriesid: [RICE], startyear: "2025", endyear: "2026" }),
    });
    expect(JSON.parse(blsRequest([RICE, SUGAR]).body)).toEqual({ seriesid: [RICE, SUGAR] });
    expect(() => blsRequest([])).toThrow(RangeError);
    expect(() => blsRequest(Array.from({ length: BLS_SERIES_LIMIT + 1 }, (_, index) => `APU${index}`))).toThrow(RangeError);
    expect(() => blsRequest(["apu0000701312"])).toThrow(RangeError);
    expect(() => blsRequest([RICE, RICE])).toThrow(RangeError);
    expect(() => blsRequest([RICE], { start: 2026, end: 2025 })).toThrow(RangeError);
    expect(() => blsRequest([RICE], { start: 2016, end: 2026 })).toThrow(RangeError);
    expect(blsRequest([RICE], { start: 2017, end: 2026 }).body).toContain('"startyear":"2017"');
  });
});

describe("the BLS client", () => {
  function setup(handler: Parameters<typeof fakeTransport>[1]) {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, handler);
    return { client: createBlsClient({ transport, pace }), sent, clock };
  }

  it("sends one query for the staples with no key, and parses the answer", async () => {
    const { client, sent, clock } = setup(() => reply(200, answer));
    const result = await client.averages();
    expect(result).toEqual(parseBlsSeries(answer, instantOf(clock.now())));
    expect(sent.map(({ exchange }) => exchange)).toEqual([blsRequest(BLS_STAPLES.map((each) => each.series))]);
  });

  it("keeps a margin under the daily limit of 25: a second query waits the pace of 20 queries each day", async () => {
    const { client, sent } = setup(() => reply(200, answer));
    await client.averages();
    await client.averages(BLS_STAPLES.slice(0, 1), { start: 2025, end: 2026 });
    expect(sent[1]!.at - sent[0]!.at).toBe(BLS_PACE_MS);
    expect(BLS_PACE_MS * 20).toBe(86_400_000);
  });

  it("gives a problem with the status line for an answer that is not a 2xx with no part of the body, and for a body that is not JSON", async () => {
    const failed = await setup(() => reply(404, { detail: "no" }, {}, "Not Found")).client.averages(BLS_STAPLES.slice(0, 1));
    expect(failed).toEqual({ ok: false, problems: ["BLS Public Data API answered 404 Not Found to the average prices of 1 series."] });
    const notJson = await setup(() => reply(200, "<html>")).client.averages();
    expect(notJson.ok).toBe(false);
  });
});
