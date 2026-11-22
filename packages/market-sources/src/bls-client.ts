import { BLS_STAPLES, blsRequest, parseBlsSeries, type AverageParseResult, type BlsSeries } from "./bls.ts";
import { instantOf, readJson, redact, send, type Pace, type Signal, type Transport } from "./client.ts";

/** The host of the BLS Public Data API. */
export const BLS_HOST = "api.bls.gov";

/**
 * The client sends one request each 57.6 minutes at most. Version 1 of the API permits 25 queries each day to a user
 * with no key, so this pace never passes the daily limit. One query reads up to 25 series and 10 years.
 */
export const BLS_PACE_MS = 86_400_000 / 25;

/** The options of a BLS client. Version 1 of the API needs no key. */
export interface BlsClientOptions<S extends Signal> {
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
}

/** A client of the average prices of the BLS Public Data API. */
export interface BlsClient<S extends Signal> {
  /**
   * This method reads the average prices of some known series in one query. Without years, the API gives the last
   * three years. The default series are `BLS_STAPLES`.
   */
  averages(series?: readonly BlsSeries[], years?: { readonly start: number; readonly end: number }, signal?: S): Promise<AverageParseResult>;
}

const SOURCE = "BLS Public Data API";

/** This function makes a client of the average prices of the BLS Public Data API, version 1. */
export function createBlsClient<S extends Signal>(options: BlsClientOptions<S>): BlsClient<S> {
  const { pace, transport } = options;
  return {
    async averages(series = BLS_STAPLES, years, signal) {
      const exchange = blsRequest(
        series.map((each) => each.series),
        years,
      );
      const what = `the average prices of ${series.length} series`;
      const input = { source: SOURCE, host: BLS_HOST, minIntervalMs: BLS_PACE_MS, what, secrets: [], redact, exchange };
      const answer = await send(pace, transport, input, signal);
      const json = readJson(answer, input);
      return json.ok ? parseBlsSeries(json.json, instantOf(pace.now()), series) : json;
    },
  };
}
