/**
 * This script makes `src/azure-regions-data.ts` from the page of the list of the regions of the Azure documentation.
 * The request goes through the polite send of `polite-crawler`. The script keeps only the country and the physical
 * location of each region, because the page states no license.
 *
 * Start: `node scripts/azure-regions.ts` in the package folder.
 */
import { writeFileSync } from "node:fs";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { azureRegionsDataText, parseAzureRegionsPage, type AzureRegionsSource } from "../src/azure-regions.ts";
import { redact, send, type Transport } from "../src/client.ts";

const PAGE = "https://learn.microsoft.com/en-us/azure/reliability/regions-list";
const USER_AGENT = "market-sources";

const transport: Transport<AbortSignal> = async (exchange, signal) => {
  const init: RequestInit = { method: exchange.method, headers: { ...exchange.headers, "user-agent": USER_AGENT }, body: exchange.body, redirect: "manual" };
  const answer = await fetch(exchange.url, signal === undefined ? init : { ...init, signal });
  return { status: answer.status, statusText: answer.statusText, headers: Object.fromEntries(answer.headers), body: await answer.text() };
};
const pace = { scheduler: new HostScheduler(realClock, 2), now: realClock.now };
const host = new URL(PAGE).host;
const input = { source: host, host, minIntervalMs: 1000, what: "the list of the regions", secrets: [], redact, exchange: { method: "GET" as const, url: PAGE, headers: {}, body: null } };
const answer = await send(pace, transport, input, undefined);
if (answer.reply.status !== 200) throw new Error(`${host} answered ${answer.reply.status} to the list of the regions.`);
const read = parseAzureRegionsPage(answer.reply.body);
if (read.regions.length === 0) throw new Error("The page has no table of the regions.");
const day = new Date().toISOString().slice(0, 10);
const source: AzureRegionsSource = {
  page: PAGE,
  read: day,
  terms: "The page states no license. The table keeps only facts: the country and the physical location of each region.",
  attribution: `The country and the physical location of each region come from the list of the regions of the Azure documentation, Microsoft, ${PAGE}, read on ${day}.`,
};
writeFileSync(new URL("../src/azure-regions-data.ts", import.meta.url), azureRegionsDataText(source, read.regions));
console.log(JSON.stringify({ regions: read.regions.length, notes: read.notes.length }));
for (const note of read.notes.slice(0, 40)) console.log(note);
