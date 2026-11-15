import { join } from "node:path";
import { tmpdir } from "node:os";
import { BEST_BUY_HOST, type Exchange, type Pace, type Reply, type Transport } from "@mark1russell7/market-sources";
import { HostScheduler, type Clock } from "polite-crawler/politeness";
import { describe, expect, it } from "vitest";
import { USAGE, parseCommand, parsePlan, type Io, type ReadRecord } from "./cli.ts";
import { main } from "./main.ts";
import { KEY_VARIABLES, keyFile, loadKeys, readKeys, type KeysResult } from "./keys.ts";
import { apiTransport, flatHeaders } from "./transport.ts";
import * as entry from "./index.ts";

const API_KEY = "bestbuy-key-0001";
const CLIENT_ID = "digikey-id-0001";
const CLIENT_SECRET = "digikey-secret-0001";

/** A product of the Best Buy Products API, with the fields that the parser reads. */
const product = {
  sku: 1234567,
  name: "ExampleBrand - Example Widget 1000 - Black",
  upc: "036000291452",
  modelNumber: "EXW-1000",
  manufacturer: "ExampleBrand",
  salePrice: 99.99,
  regularPrice: 129.99,
  freeShipping: true,
  onlineAvailability: true,
  orderable: "Available",
  condition: "New",
  active: true,
  url: "https://www.example.com/click/-/1234567/pdp",
};

function fakeClock(): Clock {
  let time = Date.parse("2026-11-12T18:00:00Z");
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly sent: Exchange[];
  readonly hosts: (readonly string[])[];
}

async function run(
  argv: readonly string[],
  answer: (exchange: Exchange) => Reply | Error,
  keys?: KeysResult | ((source: string) => KeysResult),
  files: Map<string, string> = new Map(),
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const sent: Exchange[] = [];
  const hosts: (readonly string[])[] = [];
  const clock = fakeClock();
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    keys: (source) =>
      (typeof keys === "function" ? keys(source) : keys) ??
      readKeys(source, `BESTBUY_API_KEY=${API_KEY}\nDIGIKEY_CLIENT_ID=${CLIENT_ID}\nDIGIKEY_CLIENT_SECRET=${CLIENT_SECRET}\n`),
    transport: (allowed): Transport<AbortSignal> => {
      hosts.push(allowed);
      return async (exchange) => {
        sent.push(exchange);
        const reply = answer(exchange);
        if (reply instanceof Error) throw reply;
        return reply;
      };
    },
    pace: (): Pace<AbortSignal> => ({ scheduler: new HostScheduler(clock, 4), now: clock.now }),
    files: {
      read: (path) => {
        const text = files.get(path);
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return text;
      },
      write: (path, text) => {
        files.set(path, text);
      },
      replace: (path, text) => {
        files.set(path, text);
      },
    },
    now: clock.now,
  };
  const code = await main(argv, io);
  return { code, out, err, sent, hosts };
}

const json = (status: number, body: unknown, statusText = ""): Reply => ({ status, statusText, headers: {}, body: JSON.stringify(body) });

describe("the keys", () => {
  it("reads the keys of a source, and names only the variable of a missing or bad value", () => {
    expect(readKeys("bestbuy", `BESTBUY_API_KEY=${API_KEY}\n`)).toEqual({ ok: true, keys: { BESTBUY_API_KEY: API_KEY } });
    expect(readKeys("digikey", `DIGIKEY_CLIENT_ID=${CLIENT_ID}\nDIGIKEY_CLIENT_SECRET=\n`)).toEqual({
      ok: false,
      problems: ["The key file has no value for DIGIKEY_CLIENT_SECRET."],
    });
    const bad = readKeys("ebay", 'EBAY_CLIENT_ID="has a space"\nEBAY_CLIENT_SECRET=short\n');
    expect(bad.ok).toBe(false);
    const text = JSON.stringify(bad);
    expect(text).toContain("EBAY_CLIENT_ID");
    expect(text).toContain("EBAY_CLIENT_SECRET");
    expect(text).not.toContain("has a space");
    expect(text).not.toContain("short.");
  });

  it("names the five variables of the key file, and its path under the home folder", () => {
    expect(Object.values(KEY_VARIABLES).flat()).toEqual([
      "DIGIKEY_CLIENT_ID",
      "DIGIKEY_CLIENT_SECRET",
      "EBAY_CLIENT_ID",
      "EBAY_CLIENT_SECRET",
      "BESTBUY_API_KEY",
    ]);
    expect(keyFile("<home>")).toBe(join("<home>", ".market", "seller-keys.env"));
  });

  it("gives a problem with the code when the key file does not exist", () => {
    const path = join(tmpdir(), `no-such-folder-${process.pid}`, "seller-keys.env");
    expect(loadKeys("digikey", path)).toEqual({ ok: false, problems: [`The crawler cannot read the key file ${path} (ENOENT).`] });
  });
});

describe("the transport", () => {
  it("joins a list of header values, with lowercase names", () => {
    expect(flatHeaders({ "Retry-After": "30", "set-cookie": ["a=1", "b=2"] })).toEqual({ "retry-after": "30", "set-cookie": "a=1, b=2" });
  });

  it("refuses an exchange to another host, to http and to a port, before a request", async () => {
    const transport = apiTransport(["api.bestbuy.com"]);
    const exchange = (url: string): Exchange => ({ method: "GET", url, headers: {}, body: null });
    await expect(transport(exchange("https://example.com/v1/products/1.json"), undefined)).rejects.toThrow(
      "The exchange goes to example.com, and it is not an API host on https.",
    );
    await expect(transport(exchange("http://api.bestbuy.com/v1/products/1.json"), undefined)).rejects.toThrow("not an API host");
    await expect(transport(exchange("https://api.bestbuy.com:8443/v1/products/1.json"), undefined)).rejects.toThrow("not an API host");
  });

  it("refuses a method that it does not send, before a request", async () => {
    const transport = apiTransport(["api.bestbuy.com"]);
    const exchange: Exchange = { method: "TRACE", url: "https://api.bestbuy.com/v1/products/1.json", headers: {}, body: null };
    await expect(transport(exchange, undefined)).rejects.toThrow("The exchange has the method TRACE, and the transport does not send it.");
  });
});

describe("the command", () => {
  it("parses each form of a read, and refuses a bad command", () => {
    expect(parseCommand(["read", "digikey", "P5555-ND"])).toEqual({
      kind: "read",
      command: { source: "digikey", words: "P5555-ND", search: false, limit: undefined, openBox: false, sandbox: false },
    });
    expect(parseCommand(["read", "ebay", "--search", "ddr4", "ecc", "--limit", "20", "--sandbox"])).toEqual({
      kind: "read",
      command: { source: "ebay", words: "ddr4 ecc", search: true, limit: 20, openBox: false, sandbox: true },
    });
    expect(parseCommand(["--help"])).toEqual({ kind: "help" });
    const problems = [
      [],
      ["fetch", "digikey", "x"],
      ["read", "amazon", "x"],
      ["read", "digikey"],
      ["read", "digikey", "a", "b"],
      ["read", "digikey", "x", "--open-box"],
      ["read", "bestbuy", "1", "--sandbox"],
      ["read", "bestbuy", "1", "--limit", "5"],
      ["read", "bestbuy", "--search", "ssd", "--limit", "-5"],
      ["read", "bestbuy", "1", "--unknown"],
    ];
    for (const argv of problems) expect(parseCommand(argv).kind).toBe("usage");
  });

  it("writes each observation of a Best Buy product as a line of JSON, and gives 0", async () => {
    const result = await run(["read", "bestbuy", "1234567"], () => json(200, product));
    expect(result.code).toBe(0);
    expect(result.hosts).toEqual([["api.bestbuy.com"]]);
    expect(result.sent.map(({ url }) => url)).toEqual([`https://api.bestbuy.com/v1/products/1234567.json?apiKey=${API_KEY}`]);
    expect(result.out).toHaveLength(1);
    const observation = JSON.parse(result.out[0]!) as { offer: { title: string }; reading: { price: { value: number } } };
    expect(observation.offer.title).toBe(product.name);
    expect(observation.reading.price.value).toBe(99.99);
    expect(result.err.at(-1)).toMatch(/^read: 1 observations, \d+ notes\.$/);
  });

  it("gets a Digi-Key token, and reads from the sandbox host with --sandbox", async () => {
    const result = await run(["read", "digikey", "P5555-ND", "--sandbox"], (exchange) =>
      exchange.url.endsWith("/oauth2/token") ? json(200, { access_token: "token-0001", expires_in: 599 }) : json(404, {}, "Not Found"),
    );
    expect(result.hosts).toEqual([["sandbox-api.digikey.com"]]);
    expect(result.sent.map(({ url }) => url)).toEqual([
      "https://sandbox-api.digikey.com/v1/oauth2/token",
      "https://sandbox-api.digikey.com/products/v4/search/P5555-ND/productdetails",
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["problem: Digi-Key answered 404 Not Found to ProductDetails of P5555-ND."]);
  });

  it("gives 1 and the problems of the keys, before a request", async () => {
    const result = await run(["read", "ebay", "v1|1|0"], () => json(200, {}), { ok: false, problems: ["The key file has no value for EBAY_CLIENT_ID."] });
    expect(result).toMatchObject({ code: 1, err: ["problem: The key file has no value for EBAY_CLIENT_ID."], sent: [] });
  });

  it("gives 2 and the help for a bad id, before a request", async () => {
    const result = await run(["read", "bestbuy", "12AB"], () => json(200, {}));
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain("is not a number of 1 to 12 digits");
    expect(result.err[0]).toContain(USAGE);
    expect(result.sent).toEqual([]);
  });

  it("gives 1 for a source with no answer, and no output has a key", async () => {
    const result = await run(["read", "bestbuy", "1234567"], (exchange) => new Error(`connect failed: ${exchange.url}`));
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "problem: Best Buy gave no answer to the product 1234567: connect failed: https://api.bestbuy.com/v1/products/1234567.json?apiKey=[secret]",
    ]);
    expect([...result.out, ...result.err].join("\n")).not.toContain(API_KEY);
  });

  it("gives 0 and the help for --help", async () => {
    expect(await run(["--help"], () => json(200, {}))).toMatchObject({ code: 0, out: [USAGE], sent: [] });
  });
});

describe("the run of a plan", () => {
  const TOKEN = "/oauth2/token";
  /** Digi-Key gives a token and a 404 to each product, and Best Buy gives the product. */
  const answer = (exchange: Exchange): Reply =>
    exchange.url.endsWith(TOKEN)
      ? json(200, { access_token: "token-0001", expires_in: 599 })
      : new URL(exchange.url).host === BEST_BUY_HOST
        ? json(200, product)
        : json(404, {}, "Not Found");
  const plan = (reads: unknown[]): string => JSON.stringify({ reads });
  const recordOf = (files: Map<string, string>, path: string): ReadRecord[] => (JSON.parse(files.get(path) ?? "{}") as { reads: ReadRecord[] }).reads;

  it("turns each read into a command, with the checks of a read of the command line", () => {
    expect(parsePlan(plan([{ source: "digikey", search: "BE600M1", limit: 5 }, { source: "bestbuy", search: "ssd", openBox: true }]))).toEqual({
      ok: false,
      problems: ["The read 2: --open-box is for one Best Buy SKU."],
    });
    expect(parsePlan(plan([{ source: "digikey", search: "-x BE600M1", limit: 5, tag: "ups" }]))).toEqual({
      ok: true,
      reads: [
        {
          plan: { source: "digikey", search: "-x BE600M1", limit: 5, tag: "ups" },
          command: { source: "digikey", words: "-x BE600M1", search: true, limit: 5, openBox: false, sandbox: false },
        },
      ],
    });
    const problems = [
      "{",
      JSON.stringify({ reads: [] }),
      JSON.stringify([]),
      plan([1]),
      plan([{ source: "digikey" }]),
      plan([{ source: "digikey", id: "a", search: "b" }]),
      plan([{ source: "digikey", id: " " }]),
      plan([{ source: "amazon", id: "a" }]),
      plan([{ source: "digikey", id: "a", limit: 5 }]),
      plan([{ source: "digikey", search: "a", limit: "5" }]),
      plan([{ source: "digikey", id: "a", price: 1 }]),
      plan([{ source: "bestbuy", id: "1", sandbox: true }]),
    ];
    for (const text of problems) expect(parsePlan(text).ok, text).toBe(false);
  });

  it("reads each read in order with one Digi-Key token, and writes the observations and the record", async () => {
    const files = new Map([["plans/prep.json", plan([
      { source: "digikey", id: "P5555-ND", tag: "first" },
      { source: "bestbuy", id: "1234567", tag: "widget" },
      { source: "digikey", id: "P5556-ND" },
    ])]]);
    const result = await run(["run", "plans/prep.json"], answer, undefined, files);
    expect(result.code).toBe(1);
    expect(result.sent.filter(({ url }) => url.endsWith(TOKEN))).toHaveLength(1);
    expect(result.sent.filter(({ url }) => !url.endsWith(TOKEN)).map(({ url }) => new URL(url).origin + new URL(url).pathname)).toEqual([
      "https://api.digikey.com/products/v4/search/P5555-ND/productdetails",
      "https://api.bestbuy.com/v1/products/1234567.json",
      "https://api.digikey.com/products/v4/search/P5556-ND/productdetails",
    ]);
    const out = join("plans", "prep-2026-11-12T18-00-00Z.jsonl");
    const record = join("plans", "prep-2026-11-12T18-00-00Z.reads.json");
    expect([...files.keys()].sort()).toEqual([out, "plans/prep.json", record].sort());
    const lines = (files.get(out) ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as { offer: { title: string } }).offer.title).toBe(product.name);
    const reads = recordOf(files, record);
    expect(reads.map(({ source, tag, observations, problems }) => ({ source, tag, observations, problems }))).toEqual([
      { source: "digikey", tag: "first", observations: 0, problems: ["Digi-Key answered 404 Not Found to ProductDetails of P5555-ND."] },
      { source: "bestbuy", tag: "widget", observations: 1, problems: [] },
      { source: "digikey", tag: undefined, observations: 0, problems: ["Digi-Key answered 404 Not Found to ProductDetails of P5556-ND."] },
    ]);
    for (const { at } of reads) expect(Date.parse(at)).toBeGreaterThanOrEqual(Date.parse("2026-11-12T18:00:00Z"));
    expect(result.err.at(-3)).toBe("run: 3 of 3 reads, 1 observations, 2 reads with a problem.");
    expect([...result.out, ...result.err, ...files.values()].join("\n")).not.toContain(CLIENT_SECRET);
  });

  it("records the problem of the keys of a source, runs the other reads, and writes to the named files", async () => {
    const files = new Map([["prep.json", plan([{ source: "ebay", search: "BE600M1" }, { source: "bestbuy", id: "1234567" }])]]);
    const keys = (source: string): KeysResult =>
      source === "ebay"
        ? { ok: false, problems: ["The key file has no value for EBAY_CLIENT_ID."] }
        : readKeys("bestbuy", `BESTBUY_API_KEY=${API_KEY}\n`);
    const result = await run(["run", "prep.json", "--out", "o.jsonl", "--record", "r.json"], answer, keys, files);
    expect(result.code).toBe(1);
    expect(result.sent.map(({ url }) => new URL(url).origin + new URL(url).pathname)).toEqual(["https://api.bestbuy.com/v1/products/1234567.json"]);
    expect(recordOf(files, "r.json").map(({ observations, problems }) => ({ observations, problems }))).toEqual([
      { observations: 0, problems: ["The key file has no value for EBAY_CLIENT_ID."] },
      { observations: 1, problems: [] },
    ]);
    expect((files.get("o.jsonl") ?? "").trimEnd().split("\n")).toHaveLength(1);
  });

  it("gives 0 when each read has no problem, and 2 for a bad plan or no plan file, before a request", async () => {
    const files = new Map([["ok.json", plan([{ source: "bestbuy", id: "1234567" }])], ["bad.json", plan([{ source: "bestbuy" }])]]);
    expect((await run(["run", "ok.json"], answer, undefined, files)).code).toBe(0);
    const bad = await run(["run", "bad.json"], answer, undefined, files);
    expect(bad).toMatchObject({ code: 2, sent: [], err: ["problem: The read 1 has one id or one search, with text."] });
    expect(await run(["run", "none.json"], answer, undefined, files)).toMatchObject({ code: 2, sent: [] });
    expect(await run(["run"], answer, undefined, files)).toMatchObject({ code: 2, sent: [] });
    expect(await run(["run", "ok.json", "--unknown"], answer, undefined, files)).toMatchObject({ code: 2, sent: [] });
  });
});

describe("the entry", () => {
  it("exports the transport, the keys, the commands and the watch", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "EXCHANGE_TIMEOUT_MS",
      "KEY_VARIABLES",
      "READ_BOUND_MS",
      "READ_FIELDS",
      "SOURCE_NAMES",
      "USAGE",
      "WATCH_LOOP",
      "WATCH_PROFILE",
      "WATCH_PROGRESS",
      "apiSettings",
      "apiTransport",
      "checkRead",
      "declareWatch",
      "emptyBoard",
      "flatHeaders",
      "keyFile",
      "loadKeys",
      "main",
      "nodeIo",
      "parseBoard",
      "parseCommand",
      "parsePlan",
      "parseWatch",
      "passLines",
      "read",
      "readKeys",
      "readOrRun",
      "readerFor",
      "runWatch",
      "stepLines",
      "watchLint",
      "watchPass",
      "watchStep",
    ]);
  });
});
