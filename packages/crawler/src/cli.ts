import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";
import {
  BEST_BUY_HOST,
  DIGIKEY_HOST,
  DIGIKEY_SANDBOX_HOST,
  EBAY_HOST,
  EBAY_SANDBOX_HOST,
  SourceError,
  createBestBuyClient,
  createDigiKeyClient,
  createEbayClient,
  redact,
  type Pace,
  type ParseResult,
  type Transport,
} from "@mark1russell7/market-sources";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { SOURCE_NAMES, loadKeys, type KeysResult, type SourceName } from "./keys.ts";
import { apiTransport } from "./transport.ts";

/** The help text of the command. */
export const USAGE: string = `Usage: market-crawler read <source> <id> [options]
       market-crawler read <source> --search <words> [--limit <n>]

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
Exit codes: 0 read, 1 a problem of the source or of the keys, 2 a bad command.`;

/** The ports of the command. A test gives fakes. */
export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly keys: (source: SourceName) => KeysResult;
  readonly transport: (hosts: readonly string[]) => Transport<AbortSignal>;
  readonly pace: () => Pace<AbortSignal>;
  readonly signal?: AbortSignal | undefined;
}

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
    return { kind: "usage", problem: error instanceof Error ? error.message : String(error) };
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

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** This function sends the read of a command with the keys, and gives the result of the parser. */
export async function read(command: ReadCommand, keys: Readonly<Record<string, string>>, io: Io): Promise<ParseResult> {
  const pace = io.pace();
  const { words, limit } = command;
  const { signal } = io;
  switch (command.source) {
    case "digikey": {
      const host = command.sandbox ? DIGIKEY_SANDBOX_HOST : DIGIKEY_HOST;
      const client = createDigiKeyClient({
        clientId: keys["DIGIKEY_CLIENT_ID"] ?? "",
        clientSecret: keys["DIGIKEY_CLIENT_SECRET"] ?? "",
        transport: io.transport([host]),
        pace,
        sandbox: command.sandbox,
      });
      return command.search ? client.keywordSearch(words, limit, signal) : client.productDetails(words, signal);
    }
    case "ebay": {
      const host = command.sandbox ? EBAY_SANDBOX_HOST : EBAY_HOST;
      const client = createEbayClient({
        clientId: keys["EBAY_CLIENT_ID"] ?? "",
        clientSecret: keys["EBAY_CLIENT_SECRET"] ?? "",
        base64,
        transport: io.transport([host]),
        pace,
        sandbox: command.sandbox,
      });
      return command.search ? client.search(words, limit, signal) : client.item(words, signal);
    }
    case "bestbuy": {
      const client = createBestBuyClient({ apiKey: keys["BESTBUY_API_KEY"] ?? "", transport: io.transport([BEST_BUY_HOST]), pace });
      if (command.search) return client.search(words, limit, signal);
      return command.openBox ? client.openBox(words, signal) : client.product(words, signal);
    }
  }
}

/**
 * This function is the command. It reads the arguments, loads the keys of the source, sends the read, and writes
 * each observation as one line of JSON. It gives the exit code. Each message goes through `redact` with the keys.
 */
export async function main(argv: readonly string[], io: Io): Promise<number> {
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
    const message = redact(error instanceof Error ? error.message : String(error), secrets);
    if (error instanceof RangeError) {
      io.err(`${message}\n\n${USAGE}`);
      return 2;
    }
    io.err(`problem: ${error instanceof SourceError ? message : `${error instanceof Error ? error.name : "Error"}: ${message}`}`);
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
    signal,
  };
}
