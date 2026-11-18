import { azureNextPage, azurePricesUrl, isAzurePricesUrl, parseAzureRetailPricePages, type AzureFilter } from "./azure.ts";
import { instantOf, readJson, redact, send, type Pace, type Signal, type Transport } from "./client.ts";
import type { MeteredParseResult } from "./parse.ts";

/** The host of the Azure Retail Prices API. */
export const AZURE_HOST = "prices.azure.com";

/**
 * The client sends one request each 6 seconds at most. The documentation gives no limit. But each answer has the
 * headers `x-ms-ratelimit-remaining-retailprices-requests` and `x-ms-ratelimit-retailprices-retry-after: 60`.
 * Thus the client sends 10 requests in 60 seconds at most.
 */
export const AZURE_PACE_MS = 6000;

/** The most pages of one read. Each page has 1,000 prices at most. */
export const AZURE_PAGE_LIMIT = 10;

/** The options of an Azure Retail Prices client. The API needs no key. */
export interface AzureClientOptions<S extends Signal> {
  readonly transport: Transport<S>;
  readonly pace: Pace<S>;
}

/** The options of one read of prices. */
export interface AzureReadOptions {
  /** The most pages that the read follows, from 1 to `AZURE_PAGE_LIMIT`. The default is 1. */
  readonly pages?: number | undefined;
  /** The currency of the prices, a money unit of `@mark1russell7/quantity`. Without it, the API gives US dollars. */
  readonly currency?: string | undefined;
}

/** A client of the Azure Retail Prices API. Each method gives the result of `parseAzureRetailPricePages`. */
export interface AzureClient<S extends Signal> {
  /** This method reads the prices of a filter: the first page, and the next pages up to the limit of the options. */
  prices(filter: AzureFilter, options?: AzureReadOptions, signal?: S): Promise<MeteredParseResult>;
  /** This method continues a read at the link `next` of a result, with `pages` pages at most. The default is 1. */
  more(next: string, pages?: number, signal?: S): Promise<MeteredParseResult>;
}

const SOURCE = "Azure Retail Prices";

function checkPages(pages: number): number {
  if (!Number.isInteger(pages) || pages < 1 || pages > AZURE_PAGE_LIMIT) {
    throw new RangeError(`The count of pages is not a whole number from 1 to ${AZURE_PAGE_LIMIT}.`);
  }
  return pages;
}

/**
 * This function makes a client of the Azure Retail Prices API. A read follows the link of the next page of each
 * answer, only to the same API, up to its count of pages. It then reads all the pages together.
 */
export function createAzureClient<S extends Signal>(options: AzureClientOptions<S>): AzureClient<S> {
  const { pace, transport } = options;

  const read = async (first: string, pages: number, what: string, signal?: S): Promise<MeteredParseResult> => {
    const answers: unknown[] = [];
    let link: string | null = first;
    while (link !== null && answers.length < pages) {
      const page = answers.length + 1;
      const exchange = { method: "GET" as const, url: link, headers: { accept: "application/json" }, body: null };
      const input = {
        source: SOURCE,
        host: AZURE_HOST,
        minIntervalMs: AZURE_PACE_MS,
        what: page === 1 ? what : `${what}, page ${page}`,
        secrets: [],
        redact,
        exchange,
      };
      const answer = await send(pace, transport, input, signal);
      const json = readJson(answer, input);
      if (!json.ok) return json;
      answers.push(json.json);
      link = azureNextPage(json.json);
    }
    return parseAzureRetailPricePages(answers, instantOf(pace.now()));
  };

  return {
    async prices(filter, readOptions = {}, signal) {
      const url = azurePricesUrl(filter, readOptions.currency);
      return read(url, checkPages(readOptions.pages ?? 1), "the prices of a filter", signal);
    },
    async more(next, pages = 1, signal) {
      if (typeof next !== "string" || !isAzurePricesUrl(next)) {
        throw new RangeError("The link is not a link of the Azure Retail Prices API.");
      }
      return read(next, checkPages(pages), "the next page of a read", signal);
    },
  };
}
