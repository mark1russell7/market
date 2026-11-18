import { instantOf, readJson, redact, send, type Pace, type Signal, type Transport } from "./client.ts";
import { refused, type MeteredParseResult, type Refused } from "./parse.ts";
import { parsePlanLists, parsePlanProvider, planListUrl, planNextPage, type PlanListRead, type PlanProvider } from "./plans.ts";

/** The most pages of one list in one read. */
export const PLAN_PAGE_LIMIT = 20;

/** The options of a plan client. The plan lists of the records of this package need no key. */
export interface PlanClientOptions<S extends Signal> {
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
}

/** The options of one read of a provider. */
export interface PlanReadOptions {
  /** The most pages of each list, from 1 to `PLAN_PAGE_LIMIT`. The default is `PLAN_PAGE_LIMIT`. */
  readonly pages?: number | undefined;
}

/** A client of the plan lists of providers. */
export interface PlanClient<S extends Signal> {
  /** This method reads each page of the lists of a provider, and gives the result of `parsePlanLists`. */
  plans(provider: PlanProvider, options?: PlanReadOptions, signal?: S): Promise<MeteredParseResult>;
}

function checkPages(pages: number): number {
  if (!Number.isInteger(pages) || pages < 1 || pages > PLAN_PAGE_LIMIT) {
    throw new RangeError(`The count of pages is not a whole number from 1 to ${PLAN_PAGE_LIMIT}.`);
  }
  return pages;
}

type Pages = { readonly ok: true; readonly pages: readonly unknown[] } | Refused;

/**
 * This function makes a client of the plan lists of providers. Each address comes from the provider record. An
 * answer gives only the number or the cursor of the next page. A read refuses a list with more pages than the limit,
 * because a part of a list gives wrong regions.
 */
export function createPlanClient<S extends Signal>(options: PlanClientOptions<S>): PlanClient<S> {
  const { pace, transport } = options;

  const readList = async (provider: PlanProvider, read: PlanListRead, what: string, limit: number, signal?: S): Promise<Pages> => {
    const pages: unknown[] = [];
    let after: string | undefined;
    while (pages.length < limit) {
      const page = pages.length + 1;
      const exchange = { method: "GET" as const, url: planListUrl(provider, read, after), headers: { accept: "application/json" }, body: null };
      const input = {
        source: provider.name,
        host: provider.host,
        minIntervalMs: provider.paceMs,
        what: page === 1 ? what : `${what}, page ${page}`,
        secrets: [],
        redact,
        exchange,
      };
      const answer = await send(pace, transport, input, signal);
      const json = readJson(answer, input);
      if (!json.ok) return json;
      pages.push(json.json);
      const next = planNextPage(read, json.json, page);
      if (next.kind === "end") return { ok: true, pages };
      if (next.kind === "fault") return refused(`The read stops at the page ${page} of ${what}. ${next.why}`);
      if (next.after === after) return refused(`The read stops: ${what} gives the cursor of its page ${page} again.`);
      after = next.after;
    }
    return refused(`The read stops: ${what} has more pages than the limit of ${limit}.`);
  };

  return {
    async plans(provider, readOptions = {}, signal) {
      const checked = parsePlanProvider(provider);
      if (!checked.ok) throw new RangeError(`The provider record is not valid: ${checked.problems.join(" ")}`);
      const limit = checkPages(readOptions.pages ?? PLAN_PAGE_LIMIT);
      const record = checked.provider;
      const plans = await readList(record, record.plans, "the plan list", limit, signal);
      if (!plans.ok) return plans;
      let regions: readonly unknown[] | undefined;
      if (record.regions.kind === "list") {
        const read = await readList(record, record.regions.read, "the list of regions", limit, signal);
        if (!read.ok) return read;
        regions = read.pages;
      }
      return parsePlanLists(record, { plans: plans.pages, regions }, instantOf(pace.now()));
    },
  };
}
