import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  BEST_BUY_HOST,
  DIGIKEY_HOST,
  DIGIKEY_SANDBOX_HOST,
  EBAY_HOST,
  EBAY_SANDBOX_HOST,
  ApiError,
  createBestBuyClient,
  createDigiKeyClient,
  createEbayClient,
  redact,
  type Pace,
  type ParseResult,
  type Transport,
} from "@mark1russell7/market-sources";
import type { Clock, ProcessPort } from "@mark1russell7/service";
import { errorMessage } from "@mark1russell7/text";
import { writeFileAtomicSync } from "@procedures/fs/files";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { SOURCE_NAMES, loadKeys, type KeysResult, type SourceName } from "./keys.ts";
import { apiTransport } from "./transport.ts";

/** The help text of the command. */
export const USAGE: string = `Usage: market-crawler read <source> <id> [options]
       market-crawler read <source> --search <words> [--limit <n>]
       market-crawler run <plan file> [--out <file>] [--record <file>]
       market-crawler watch <watch file> [--board <file>] [--once]

Sources and ids:
  digikey <product number>   ProductDetails of the Digi-Key Product Information API v4
  ebay <item id>             getItem of the eBay Browse API, with an item id v1|#|#
  bestbuy <sku>              one product of the Best Buy Products API

Options:
  --search          Search for the words: KeywordSearch, search, or a product search
  --limit <n>       The most results of a search (Digi-Key 50, eBay 200, Best Buy 100)
  --open-box        Best Buy: the open-box offers of the SKU
  --sandbox         Digi-Key and eBay: the sandbox host of the API
  -h, --help        This text

Each observation goes to stdout as one line of JSON. Notes and problems go to stderr.
The keys come from ~/.market/seller-keys.env. No output has a key.
Exit codes: 0 read, 1 a problem of the source or of the keys, 2 a bad command.

run reads each read of a plan file, in order, with one pace and one client for each source:
  {"reads": [{"source": "digikey", "search": "BE600M1", "limit": 5, "tag": "ups"}, {"source": "bestbuy", "id": "6534613"}]}
Each read has an id or a search, and the options limit, openBox and sandbox. A tag is free text for the record.
  --out <file>      The observations of all reads, as JSON lines in UTF-8 (default <plan>-<time>.jsonl)
  --record <file>   The record of each read: its time, its count, its notes, its problems (default <plan>-<time>.reads.json)
A read with a problem does not stop the run. The exit code is 1 when a read has a problem.

watch reads each entry of a watch file when it is due, and keeps the board of current prices in one file:
  {"slack": {"value": 30, "unit": "min"}, "tick": {"value": 1, "unit": "min"},
   "entries": [{"name": "ups", "every": {"value": 2, "unit": "h"}, "source": "ebay", "search": "BE600M1", "limit": 20}]}
Each entry has a name, a time every, and the fields of a read. The terms of each source limit the board.
  --board <file>    The board file (default <watch>.board.json). A new board starts when the file does not exist.
  --once            One pass: read each due entry, write the board, and stop. The exit code is 1 when a read has a problem.
Without --once, the watch runs until Ctrl+C. It wakes each tick, and a pass takes at most the slack less the tick.`;

/** The ports of the command. A test gives fakes. */
export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly keys: (source: SourceName) => KeysResult;
  readonly transport: (hosts: readonly string[]) => Transport<AbortSignal>;
  readonly pace: () => Pace<AbortSignal>;
  /**
   * The text files: the plan file, the watch file, and the files of the observations, of the record and of the board.
   * `replace` writes a file in one step: a reader sees the old file or the whole new file.
   */
  readonly files: {
    readonly read: (path: string) => string;
    readonly write: (path: string, text: string) => void;
    readonly replace: (path: string, text: string) => void;
  };
  /** The time in milliseconds since 1970. */
  readonly now: () => number;
  readonly signal?: AbortSignal | undefined;
  /** The clock and the process of the service of `watch`. A test gives fakes. The defaults are the real ones. */
  readonly service?: { readonly clock?: Clock | undefined; readonly process?: ProcessPort | undefined } | undefined;
}

/** A read of a plan file: a source, an id or the words of a search, and the options of a read. */
export interface PlanRead {
  readonly source: string;
  readonly id?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly openBox?: boolean;
  readonly sandbox?: boolean;
  /** Free text for the record, for example the name of the thing that the read prices. */
  readonly tag?: string;
}

/** The record of one read of a run: the read, its start time, its count of observations, its notes and its problems. */
export interface ReadRecord extends PlanRead {
  readonly at: string;
  readonly observations: number;
  readonly notes: readonly string[];
  readonly problems: readonly string[];
}

/** The result of the parse of a plan file: each read with its command, or the problems of the plan. */
export type PlanResult =
  | { readonly ok: true; readonly reads: readonly { readonly plan: PlanRead; readonly command: ReadCommand }[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The fields of a read, and the type of each one. */
export type ReadFields = Readonly<Record<string, "string" | "number" | "boolean">>;

/** The fields of a read of a plan or of a watch. */
export const READ_FIELDS: ReadFields = {
  source: "string",
  id: "string",
  search: "string",
  limit: "number",
  openBox: "boolean",
  sandbox: "boolean",
};

const PLAN_FIELDS: ReadFields = { ...READ_FIELDS, tag: "string" };

/** The result of the check of one read: the read with its command, or the problem of the read. */
export type ReadCheck = { readonly ok: true; readonly plan: PlanRead; readonly command: ReadCommand } | { readonly ok: false; readonly problem: string };

/** A read of one source, from the arguments of the command. */
export interface ReadCommand {
  readonly source: SourceName;
  readonly words: string;
  readonly search: boolean;
  readonly limit: number | undefined;
  readonly openBox: boolean;
  readonly sandbox: boolean;
}

/** The result of the parse of the arguments: a read, the help, or a usage problem. */
export type Parsed = { readonly kind: "read"; readonly command: ReadCommand } | { readonly kind: "help" } | { readonly kind: "usage"; readonly problem: string };

const isSource = (value: string | undefined): value is SourceName => SOURCE_NAMES.some((name) => name === value);

function parseFlags(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      search: { type: "boolean" },
      limit: { type: "string" },
      "open-box": { type: "boolean" },
      sandbox: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

/** This function reads the arguments of the command. It does not throw. */
export function parseCommand(argv: readonly string[]): Parsed {
  let flags: ReturnType<typeof parseFlags>;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return { kind: "usage", problem: errorMessage(error) };
  }
  const { values, positionals } = flags;
  if (values.help === true) return { kind: "help" };
  const [verb, source, ...rest] = positionals;
  if (verb !== "read") return { kind: "usage", problem: "The command is read." };
  if (!isSource(source)) return { kind: "usage", problem: `The source is one of ${SOURCE_NAMES.join(", ")}.` };
  const search = values.search === true;
  const openBox = values["open-box"] === true;
  const sandbox = values.sandbox === true;
  if (rest.length === 0) return { kind: "usage", problem: search ? "Give the words of the search." : "Give the id to read." };
  if (!search && rest.length > 1) return { kind: "usage", problem: "Give one id. Use --search for words." };
  if (openBox && (source !== "bestbuy" || search)) return { kind: "usage", problem: "--open-box is for one Best Buy SKU." };
  if (sandbox && source === "bestbuy") return { kind: "usage", problem: "Best Buy has no sandbox host." };
  let limit: number | undefined;
  if (values.limit !== undefined) {
    if (!search) return { kind: "usage", problem: "--limit is for a search." };
    if (!/^\d{1,3}$/.test(values.limit)) return { kind: "usage", problem: "--limit is a whole number." };
    limit = Number(values.limit);
  }
  return { kind: "read", command: { source, words: rest.join(" "), search, limit, openBox, sandbox } };
}

/**
 * This function reads the text of a plan file. Each read becomes the arguments of `read`, so a read of a plan has
 * the same checks as a read of the command line. It does not throw.
 */
export function parsePlan(text: string): PlanResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`The plan is not JSON: ${errorMessage(error)}`] };
  }
  const list = typeof data === "object" && data !== null ? (data as { reads?: unknown }).reads : undefined;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, problems: ["The plan has no list reads, or the list is empty."] };
  const problems: string[] = [];
  const reads: { plan: PlanRead; command: ReadCommand }[] = [];
  list.forEach((value: unknown, index) => {
    const checked = checkRead(value, `The read ${String(index + 1)}`, PLAN_FIELDS);
    if (checked.ok) reads.push({ plan: checked.plan, command: checked.command });
    else problems.push(checked.problem);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, reads };
}

/**
 * This function checks one read of a plan or of a watch. The read becomes the arguments of `read`, so it gets the
 * same checks as a read of the command line. Each problem starts with `name`. It does not throw.
 */
export function checkRead(value: unknown, name: string, fields: ReadFields = READ_FIELDS): ReadCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, problem: `${name} is not an object.` };
  const bad = Object.entries(value).filter(([field, x]) => fields[field] === undefined || typeof x !== fields[field]);
  if (bad.length > 0) return { ok: false, problem: `${name} has an unknown field or a field of the wrong type: ${bad.map(([field]) => field).join(", ")}.` };
  const plan = value as PlanRead;
  const words = plan.search ?? plan.id;
  if ((plan.id === undefined) === (plan.search === undefined) || words === undefined || words.trim() === "") {
    return { ok: false, problem: `${name} has one id or one search, with text.` };
  }
  const argv = [
    "read",
    plan.source,
    ...(plan.search === undefined ? [] : ["--search"]),
    ...(plan.limit === undefined ? [] : ["--limit", String(plan.limit)]),
    ...(plan.openBox === true ? ["--open-box"] : []),
    ...(plan.sandbox === true ? ["--sandbox"] : []),
    "--",
    words,
  ];
  const parsed = parseCommand(argv);
  if (parsed.kind !== "read") return { ok: false, problem: `${name}: ${parsed.kind === "usage" ? parsed.problem : "it is not a read."}` };
  return { ok: true, plan, command: parsed.command };
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}


/**
 * A reader sends the read of a command to one source, with one client. The client keeps its token between reads.
 * The signal stops the read. The default is the signal of the ports.
 */
export type Reader = (command: ReadCommand, signal?: AbortSignal) => Promise<ParseResult>;

/** This function makes the reader of one source with its keys. Each read of the reader uses the same client. */
export function readerFor(source: SourceName, sandbox: boolean, keys: Readonly<Record<string, string>>, io: Io, pace: Pace<AbortSignal>): Reader {
  switch (source) {
    case "digikey": {
      const host = sandbox ? DIGIKEY_SANDBOX_HOST : DIGIKEY_HOST;
      const client = createDigiKeyClient({
        clientId: keys["DIGIKEY_CLIENT_ID"] ?? "",
        clientSecret: keys["DIGIKEY_CLIENT_SECRET"] ?? "",
        transport: io.transport([host]),
        pace,
        sandbox,
      });
      return async (command, signal = io.signal) =>
        command.search ? client.keywordSearch(command.words, command.limit, signal) : client.productDetails(command.words, signal);
    }
    case "ebay": {
      const host = sandbox ? EBAY_SANDBOX_HOST : EBAY_HOST;
      const client = createEbayClient({
        clientId: keys["EBAY_CLIENT_ID"] ?? "",
        clientSecret: keys["EBAY_CLIENT_SECRET"] ?? "",
        base64,
        transport: io.transport([host]),
        pace,
        sandbox,
      });
      return async (command, signal = io.signal) => (command.search ? client.search(command.words, command.limit, signal) : client.item(command.words, signal));
    }
    case "bestbuy": {
      const client = createBestBuyClient({ apiKey: keys["BESTBUY_API_KEY"] ?? "", transport: io.transport([BEST_BUY_HOST]), pace });
      return async (command, signal = io.signal) => {
        if (command.search) return client.search(command.words, command.limit, signal);
        return command.openBox ? client.openBox(command.words, signal) : client.product(command.words, signal);
      };
    }
  }
}

/** This function sends the read of a command with the keys, and gives the result of the parser. */
export async function read(command: ReadCommand, keys: Readonly<Record<string, string>>, io: Io): Promise<ParseResult> {
  return readerFor(command.source, command.sandbox, keys, io, io.pace())(command);
}

/** The text of a read of a plan, for a line of the progress. */
function readText(plan: PlanRead): string {
  return `${plan.source} ${plan.search === undefined ? (plan.id ?? "") : `--search "${plan.search}"`}`;
}

/** The time of a file name: an ISO time with no colons and no milliseconds, for example 2026-11-15T01-22-36Z. */
function fileTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
}

/**
 * This function is the command `run`. It reads each read of the plan file in order, with one pace for the run and
 * one client for each source. After each read, it writes the file of the observations and the file of the record.
 * A read with a problem does not stop the run.
 */
async function runPlan(argv: readonly string[], io: Io): Promise<number> {
  let flags: { values: { out?: string | undefined; record?: string | undefined; help?: boolean | undefined }; positionals: string[] };
  try {
    flags = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { out: { type: "string" }, record: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    io.err(`${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  if (flags.values.help === true) {
    io.out(USAGE);
    return 0;
  }
  const [planPath, ...extra] = flags.positionals;
  if (planPath === undefined || extra.length > 0) {
    io.err(`Give one plan file.\n\n${USAGE}`);
    return 2;
  }
  let text: string;
  try {
    text = io.files.read(planPath);
  } catch (error) {
    io.err(`problem: The plan file ${planPath} does not read: ${errorMessage(error)}`);
    return 2;
  }
  const plan = parsePlan(text);
  if (!plan.ok) {
    for (const problem of plan.problems) io.err(`problem: ${problem}`);
    return 2;
  }
  const base = join(dirname(planPath), basename(planPath, extname(planPath)));
  const stamp = fileTime(io.now());
  const outPath = flags.values.out ?? `${base}-${stamp}.jsonl`;
  const recordPath = flags.values.record ?? `${base}-${stamp}.reads.json`;
  const pace = io.pace();
  const keysOf = new Map<SourceName, KeysResult>();
  const readers = new Map<string, Reader>();
  const lines: string[] = [];
  const records: ReadRecord[] = [];
  for (const { plan: entry, command } of plan.reads) {
    if (io.signal?.aborted === true) break;
    const at = new Date(io.now()).toISOString();
    const loaded = keysOf.get(command.source) ?? io.keys(command.source);
    keysOf.set(command.source, loaded);
    let record: ReadRecord;
    if (!loaded.ok) {
      record = { ...entry, at, observations: 0, notes: [], problems: [...loaded.problems] };
    } else {
      const secrets = Object.values(loaded.keys);
      try {
        const key = `${command.source}:${String(command.sandbox)}`;
        const reader = readers.get(key) ?? readerFor(command.source, command.sandbox, loaded.keys, io, pace);
        readers.set(key, reader);
        const result = await reader(command);
        if (result.ok) {
          for (const observation of result.observations) lines.push(JSON.stringify(observation));
          record = { ...entry, at, observations: result.observations.length, notes: result.notes.map((note) => redact(note, secrets)), problems: [] };
        } else {
          record = { ...entry, at, observations: 0, notes: [], problems: result.problems.map((problem) => redact(problem, secrets)) };
        }
      } catch (error) {
        record = { ...entry, at, observations: 0, notes: [], problems: [redact(errorMessage(error), secrets)] };
      }
    }
    records.push(record);
    const problems = record.problems.length > 0 ? `, problem: ${record.problems.join(" ")}` : "";
    io.err(`${readText(entry)}: ${String(record.observations)} observations${problems}`);
    io.files.write(outPath, lines.length > 0 ? `${lines.join("\n")}\n` : "");
    io.files.write(recordPath, `${JSON.stringify({ reads: records }, null, 2)}\n`);
  }
  const failed = records.filter((record) => record.problems.length > 0).length;
  io.err(
    `run: ${String(records.length)} of ${String(plan.reads.length)} reads, ${String(lines.length)} observations, ${String(failed)} reads with a problem.`,
  );
  io.err(`observations: ${outPath}`);
  io.err(`record: ${recordPath}`);
  return failed > 0 || records.length < plan.reads.length ? 1 : 0;
}

/**
 * This function is the commands `read` and `run`. A read loads the keys of the source, sends the read, and writes
 * each observation as one line of JSON. It gives the exit code. Each message goes through `redact` with the keys.
 */
export async function readOrRun(argv: readonly string[], io: Io): Promise<number> {
  if (argv[0] === "run") return runPlan(argv.slice(1), io);
  const parsed = parseCommand(argv);
  if (parsed.kind === "help") {
    io.out(USAGE);
    return 0;
  }
  if (parsed.kind === "usage") {
    io.err(`${parsed.problem}\n\n${USAGE}`);
    return 2;
  }
  const { command } = parsed;
  const loaded = io.keys(command.source);
  if (!loaded.ok) {
    for (const problem of loaded.problems) io.err(`problem: ${problem}`);
    return 1;
  }
  const secrets = Object.values(loaded.keys);
  try {
    const result = await read(command, loaded.keys, io);
    if (!result.ok) {
      for (const problem of result.problems) io.err(`problem: ${redact(problem, secrets)}`);
      return 1;
    }
    for (const observation of result.observations) io.out(JSON.stringify(observation));
    for (const note of result.notes) io.err(`note: ${redact(note, secrets)}`);
    io.err(`read: ${result.observations.length} observations, ${result.notes.length} notes.`);
    return 0;
  } catch (error) {
    const message = redact(errorMessage(error), secrets);
    if (error instanceof RangeError) {
      io.err(`${message}\n\n${USAGE}`);
      return 2;
    }
    io.err(`problem: ${error instanceof ApiError ? message : `${error instanceof Error ? error.name : "Error"}: ${message}`}`);
    return 1;
  }
}

/** The ports of the command on Node.js: the standard streams, the key file, the API transport and the real clock. */
export function nodeIo(signal?: AbortSignal): Io {
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    keys: (source) => loadKeys(source),
    transport: apiTransport,
    pace: () => ({ scheduler: new HostScheduler(realClock, 4), now: realClock.now }),
    files: {
      read: (path) => textOf(readFileSync(path)),
      write: (path, text) => writeFileSync(path, text, "utf8"),
      replace: (path, text) => writeFileAtomicSync(path, text),
    },
    now: () => Date.now(),
    signal,
  };
}

/** This function gives the text of a file in UTF-8, or in UTF-16 with its byte order mark (Windows PowerShell 5.1 writes it). */
function textOf(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  const text = bytes.toString("utf8");
  return text.startsWith("﻿") ? text.slice(1) : text;
}
