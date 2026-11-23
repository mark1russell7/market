import { quotaGate, type Quota, type QuotaGate } from "polite-crawler/api";
import { BLS_STAPLES, blsRequest, parseBlsSeries, type AverageParseResult, type BlsSeries } from "./bls.ts";
import { instantOf, readJson, redact, send, type Pace, type Signal, type Transport } from "./client.ts";

/** The host of the BLS Public Data API. */
export const BLS_HOST = "api.bls.gov";

/**
 * The shortest time between two queries of one client, 10 seconds. The API documents no rate in a second, so the
 * pace is slow. The quota `BLS_QUOTA`, not the pace, keeps the count of each day.
 */
export const BLS_PACE_MS = 10_000;

/**
 * The quota of version 1 of the API: 25 queries each day to a user with no key. The gate keeps 5 in reserve, so a
 * client sends at most 20 queries in each window. The documentation does not tell when the day of the count starts,
 * thus the window is a rolling 24 hours. It is stricter than each calendar day.
 */
export const BLS_QUOTA: Quota = {
  name: "BLS Public Data API queries",
  limit: 25,
  reserve: 5,
  window: { kind: "rolling", ms: 86_400_000 },
};

/** The name of the key of `BLS_QUOTA`. Version 1 has no key: the API counts the queries of each address. */
export const BLS_QUOTA_KEY = "bls:v1";

/** The options of a BLS client. Version 1 of the API needs no key. */
export interface BlsClientOptions<S extends Signal> {
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
  /**
   * The gate of `BLS_QUOTA`. The default is a gate in memory with the clock of the pace, for this client only. A gate
   * with a shared store counts each process of one address in one record. An example store is `SqliteHostStateStore`
   * of `polite-crawler`.
   */
  readonly quota?: QuotaGate | undefined;
}

/** A client of the average prices of the BLS Public Data API. */
export interface BlsClient<S extends Signal> {
  /**
   * This method reads the average prices of some known series in one query. Without years, the API gives the last
   * three years. The default series are `BLS_STAPLES`.
   *
   * @throws QuotaError of `polite-crawler/api` when the quota refuses the query. Its `resetAt` tells when the gate
   * gives a query again. The client sent nothing.
   */
  averages(series?: readonly BlsSeries[], years?: { readonly start: number; readonly end: number }, signal?: S): Promise<AverageParseResult>;
}

const SOURCE = "BLS Public Data API";

/**
 * This function makes a client of the average prices of the BLS Public Data API, version 1.
 *
 * - The gate counts each query before the client sends it, and it refuses a query over the quota.
 * - An answer that tells that the daily threshold is reached sets the count to the limit. Then the gate refuses each
 *   query until the queries of the window go out of it, 24 hours at most.
 */
export function createBlsClient<S extends Signal>(options: BlsClientOptions<S>): BlsClient<S> {
  const { pace, transport } = options;
  const quota = options.quota ?? quotaGate(BLS_QUOTA, { key: BLS_QUOTA_KEY, now: pace.now });
  return {
    async averages(series = BLS_STAPLES, years, signal) {
      const exchange = blsRequest(
        series.map((each) => each.series),
        years,
      );
      quota.take();
      const what = `the average prices of ${series.length} series`;
      const input = { source: SOURCE, host: BLS_HOST, minIntervalMs: BLS_PACE_MS, what, secrets: [], redact, exchange };
      const answer = await send(pace, transport, input, signal);
      const json = readJson(answer, input);
      if (!json.ok) return json;
      const result = parseBlsSeries(json.json, instantOf(pace.now()), series);
      if (!result.ok && result.threshold === true) quota.note({ remaining: 0 });
      return result;
    },
  };
}
