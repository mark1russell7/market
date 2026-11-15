import { boardObservations, boardSchema, type Board } from "@mark1russell7/market";
import { BEST_BUY_TERMS, parseBestBuyProduct, type Exchange, type Pace, type Reply, type Transport } from "@mark1russell7/market-sources";
import { fakeClock, fakeProcess } from "@mark1russell7/service/testing";
import fc from "fast-check";
import { HostScheduler, type Clock } from "polite-crawler/politeness";
import { describe, expect, it } from "vitest";
import type { Io } from "./cli.ts";
import { readKeys, type KeysResult } from "./keys.ts";
import { main } from "./main.ts";
import {
  READ_BOUND_MS,
  WATCH_PROFILE,
  declareWatch,
  emptyBoard,
  parseBoard,
  parseWatch,
  passLines,
  stepLines,
  watchLint,
  watchPass,
  watchStep,
  type PassPorts,
  type Watch,
  type WatchState,
} from "./watch.ts";

const API_KEY = "bestbuy-key-0001";
const T0 = Date.parse("2026-11-15T12:00:00.000Z");
const MIN = 60_000;
const H = 60 * MIN;
const iso = (ms: number): string => new Date(ms).toISOString();

/** A product of the Best Buy Products API, with the fields that the parser reads. */
const product = (sku: number) => ({
  sku,
  name: `ExampleBrand - Example Widget ${String(sku)} - Black`,
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
  url: `https://www.example.com/click/-/${String(sku)}/pdp`,
});

const time = (value: number, unit: string) => ({ value, unit });

const ENTRIES = [
  { name: "widget", every: time(2, "h"), source: "bestbuy", id: "1234567" },
  { name: "gadget", every: time(24, "h"), source: "bestbuy", id: "7654321" },
];

function watchOf(entries: unknown[], slack = time(30, "min"), tick = time(1, "min"), terms = [BEST_BUY_TERMS]): Watch {
  const parsed = parseWatch(JSON.stringify({ slack, tick, entries }), terms);
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.watch;
}

/** A pass harness: a clock that the test moves, a reader that answers with a Best Buy product, and the saved boards. */
function harness() {
  const made = {
    time: T0,
    saves: [] as Board[],
    reads: [] as string[],
    state: { board: emptyBoard(iso(T0)), retries: new Map() } as WatchState,
    ports: undefined as unknown as PassPorts,
  };
  made.ports = {
    now: () => made.time,
    secrets: [API_KEY],
    save: (board) => {
      made.saves.push(board);
    },
    read: async (read) => {
      made.reads.push(read.entry.name);
      return parseBestBuyProduct(product(Number(read.command.words)), iso(made.time));
    },
  };
  return made;
}

describe("the watch file", () => {
  it("gives each entry with its read and its command", () => {
    const watch = watchOf([{ ...ENTRIES[0], limit: undefined }, { name: "ssd", every: time(6, "h"), source: "bestbuy", search: "nvme 1tb", limit: 10 }]);
    expect(watch.slack).toEqual(time(30, "min"));
    expect(watch.reads.map(({ entry, command }) => [entry.name, command.words, command.search, command.limit])).toEqual([
      ["widget", "1234567", false, undefined],
      ["ssd", "nvme 1tb", true, 10],
    ]);
  });

  it("gives each problem of a bad watch", () => {
    const problems = (value: unknown) => {
      const parsed = parseWatch(typeof value === "string" ? value : JSON.stringify(value), [BEST_BUY_TERMS]);
      return parsed.ok ? [] : parsed.problems;
    };
    const good = { slack: time(30, "min"), tick: time(1, "min"), entries: ENTRIES };
    expect(problems(good)).toEqual([]);
    expect(problems("{")[0]).toMatch(/^The watch is not JSON/);
    expect(problems([])).toEqual(["The watch is not an object."]);
    expect(problems({ ...good, every: 1 })).toEqual(["The watch has an unknown field: every."]);
    expect(problems({ ...good, slack: time(0, "min") })).toEqual(['The field slack is not a time more than 0, for example {"value": 30, "unit": "min"}.']);
    expect(problems({ ...good, tick: time(30, "min") })).toEqual(["The tick is not less than the slack, so a read has no time."]);
    expect(problems({ ...good, slack: time(3, "min") })).toEqual([
      "The slack 180 s is not more than the tick and 2 reads of at most 90 s: 240 s. Give a longer slack, or fewer entries.",
    ]);
    expect(problems({ ...good, entries: [{ ...ENTRIES[0], every: time(30, "s") }] })).toEqual([
      "The entry widget has an interval of less than one tick. Give it a longer every, or give the watch a shorter tick.",
    ]);
    expect(problems({ ...good, entries: [] })).toEqual(["The watch has no list entries, or the list is empty."]);
    expect(problems({ ...good, entries: [1] })).toEqual(["The entry 1 is not an object."]);
    expect(problems({ ...good, entries: [{ ...ENTRIES[0], every: time(1, "kg") }] })).toEqual(["The entry 1 has no name, no time every more than 0, or no source."]);
    expect(problems({ ...good, entries: [{ ...ENTRIES[0], openBox: true, search: "x", id: undefined }] })).toEqual([
      "The entry 1 (widget): --open-box is for one Best Buy SKU.",
    ]);
    expect(problems({ ...good, entries: [{ ...ENTRIES[0], tag: "x" }] })).toEqual(["The entry 1 (widget) has an unknown field or a field of the wrong type: tag."]);
    expect(problems({ ...good, entries: [ENTRIES[0], ENTRIES[0]] })).toEqual(["Two entries have the name widget."]);
    expect(problems({ ...good, slack: time(80, "h"), tick: time(1, "h") })).toEqual([
      "The slack 80 h is not less than the limit 72 h of the terms of bestbuy, so the board has gaps in the prices of the entry widget.",
      "The slack 80 h is not less than the limit 72 h of the terms of bestbuy, so the board has gaps in the prices of the entry gadget.",
    ]);
  });

  it("refuses a source whose terms permit no store, with the terms of the crawler", () => {
    const parsed = parseWatch(JSON.stringify({ slack: time(30, "min"), tick: time(1, "min"), entries: [{ name: "ups", every: time(1, "h"), source: "digikey", id: "P5555-ND" }] }));
    expect(parsed).toEqual({
      ok: false,
      problems: ["The terms of digikey permit no store, so a watch cannot keep the prices of the entry ups. Read the source for each request."],
    });
  });
});

describe("the board file", () => {
  it("reads a board, and gives the problem of a file that is not a board", () => {
    expect(parseBoard(JSON.stringify(emptyBoard(iso(T0))))).toEqual({ ok: true, board: emptyBoard(iso(T0)) });
    expect(parseBoard("{").ok).toBe(false);
    const wrong = parseBoard(JSON.stringify({ format: "price-board/0", at: iso(T0), reads: [] }));
    expect(wrong.ok ? "" : wrong.problem).toMatch(/^The board is not a board of the format price-board\/1: format: /);
  });
});

describe("a step and a pass", () => {
  it("reads one entry in a step, the entry that is due for the longest time first", async () => {
    const run = harness();
    const watch = watchOf(ENTRIES);
    run.state.board = {
      ...run.state.board,
      reads: [
        { name: "gadget", at: iso(T0 - 25 * H), observations: [] },
        // The gadget is due since 1 h, and the widget since 30 min.
        { name: "widget", at: iso(T0 - 2.5 * H), observations: [] },
      ],
    };
    const first = await watchStep(watch, run.state, run.ports);
    expect(first).toMatchObject({ read: { name: "gadget", observations: 1 }, more: true });
    expect(stepLines(first)).toEqual(["gadget: 1 observations"]);
    const second = await watchStep(watch, run.state, run.ports);
    expect(second).toMatchObject({ read: { name: "widget" }, more: false, next: iso(T0 + 2 * H) });
    const idle = await watchStep(watch, run.state, run.ports);
    expect(idle).toMatchObject({ read: null, more: false });
    expect(stepLines(idle)).toEqual([]);
  });

  it("reads each due entry, writes the board after each read, and gives the next read", async () => {
    const run = harness();
    const watch = watchOf(ENTRIES);
    const report = await watchPass(watch, run.state, run.ports);
    expect(run.reads).toEqual(["widget", "gadget"]);
    expect(run.saves.map((board) => board.reads.map((read) => read.name))).toEqual([["widget"], ["gadget", "widget"]]);
    for (const board of run.saves) expect(boardSchema.safeParse(board).success).toBe(true);
    expect(report).toMatchObject({ at: iso(T0), dropped: [], waiting: [], next: iso(T0 + 2 * H) });
    expect(report.reads.map(({ name, observations, problems }) => [name, observations, problems])).toEqual([
      ["widget", 1, []],
      ["gadget", 1, []],
    ]);
    expect(passLines(report).at(-1)).toBe(`pass ${iso(T0)}: 2 reads, 0 with a problem, 0 drops, next read ${iso(T0 + 2 * H)}.`);
  });

  it("reads nothing before the interval of an entry, and reads it again after it", async () => {
    const run = harness();
    const watch = watchOf(ENTRIES);
    await watchPass(watch, run.state, run.ports);
    run.time = T0 + H;
    const quiet = await watchPass(watch, run.state, run.ports);
    expect(quiet.reads).toEqual([]);
    expect(run.saves).toHaveLength(2);
    run.time = T0 + 2 * H;
    await watchPass(watch, run.state, run.ports);
    expect(run.reads).toEqual(["widget", "gadget", "widget"]);
    expect(run.state.board.reads.map(({ name, at }) => [name, at])).toEqual([
      ["gadget", iso(T0)],
      ["widget", iso(T0 + 2 * H)],
    ]);
  });

  it("keeps the last read of a failed entry until its terms end it, and waits longer for each retry", async () => {
    let fail = false;
    const run = harness();
    run.ports = { ...run.ports, read: async (read) => {
      run.reads.push(read.entry.name);
      if (fail && read.entry.name === "widget") throw new Error(`connect failed: https://api.bestbuy.com/x?apiKey=${API_KEY}`);
      return parseBestBuyProduct(product(Number(read.command.words)), iso(run.time));
    } };
    const watch = watchOf(ENTRIES);
    await watchPass(watch, run.state, run.ports);
    fail = true;
    run.time = T0 + 2 * H;
    const failed = await watchPass(watch, run.state, run.ports);
    expect(failed.reads[0]?.problems).toEqual(["connect failed: https://api.bestbuy.com/x?apiKey=[secret]"]);
    expect(JSON.stringify(failed)).not.toContain(API_KEY);
    expect(run.state.board.reads.find((read) => read.name === "widget")?.at).toBe(iso(T0));
    // The first retry is one tick later, and the second retry two ticks after it.
    run.time = T0 + 2 * H + 30_000;
    expect((await watchPass(watch, run.state, run.ports)).waiting).toEqual(["widget"]);
    run.time = T0 + 2 * H + MIN;
    await watchPass(watch, run.state, run.ports);
    expect(run.state.retries.get("widget")).toEqual({ failures: 2, at: T0 + 2 * H + 3 * MIN });
    // After the limit of 72 h of the terms, the board drops the reading of the failed entry.
    run.time = T0 + 72 * H + 1;
    const late = await watchPass(watch, run.state, run.ports);
    expect(late.dropped.filter((drop) => drop.entry === "widget").map((drop) => drop.why)).toEqual([
      `The reading of ${iso(T0)} passed the limit of 72 h of the terms of bestbuy at ${iso(T0 + 72 * H)}.`,
    ]);
    // The board keeps the read of the entry with no observation, so the plan keeps its last read.
    expect(run.state.board.reads.find((read) => read.name === "widget")).toEqual({ name: "widget", at: iso(T0), observations: [] });
    // A good read ends the retries.
    fail = false;
    run.time = T0 + 80 * H;
    await watchPass(watch, run.state, run.ports);
    expect(run.state.retries.size).toBe(0);
    expect(run.state.board.reads.map((read) => read.name)).toEqual(["gadget", "widget"]);
  });

  it("stops before the next read at the signal, and keeps each read before it", async () => {
    const controller = new AbortController();
    const run = harness();
    const read = run.ports.read;
    run.ports = { ...run.ports, read: async (entry, signal) => {
      const result = await read(entry, signal);
      controller.abort();
      return result;
    } };
    await watchPass(watchOf(ENTRIES), run.state, run.ports, controller.signal);
    expect(run.reads).toEqual(["widget"]);
    expect(run.saves).toHaveLength(1);
  });

  it("throws when the save of the board fails", async () => {
    const run = harness();
    run.ports = { ...run.ports, save: () => {
      throw new Error("EACCES: the board file");
    } };
    await expect(watchPass(watchOf(ENTRIES), run.state, run.ports)).rejects.toThrow("EACCES");
  });

  it("puts each due entry on the board within the slack, for each length of the reads up to their bound", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 60 }),
        fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 1, maxLength: 3 }),
        // The length of each read in thousandths of its bound: an integer is uniform by value, and a double of fc is dense near 0.
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 20, maxLength: 80 }),
        async (tickMin, extraMin, everyExtra, lengths) => {
          const terms = { ...BEST_BUY_TERMS, retention: { kind: "max-age" as const, age: time(3, "h") } };
          const entries = everyExtra.map((extra, index) => ({ name: `e${String(index)}`, every: time(tickMin + extra, "min"), source: "bestbuy", id: String(1000 + index) }));
          // The least slack that the parse accepts, and more.
          const slack = tickMin * MIN + entries.length * READ_BOUND_MS + 1 + extraMin * MIN;
          const watch = watchOf(entries, time(slack, "ms"), time(tickMin, "min"), [terms]);
          const run = harness();
          const read = run.ports.read;
          let k = 0;
          run.ports = {
            ...run.ports,
            read: async (entry, signal) => {
              run.time += Math.floor(((lengths[k % lengths.length] ?? 0) * READ_BOUND_MS) / 1000);
              k += 1;
              return read(entry, signal);
            },
          };
          const seen = new Set<string>();
          for (let step = 0; step < 300; step += 1) {
            const report = await watchStep(watch, run.state, run.ports);
            expect(report.dropped).toEqual([]);
            if (report.read !== null) seen.add(report.read.name);
            if (seen.size === entries.length) {
              const offers = boardObservations(run.state.board, { terms: [terms], now: iso(run.time) });
              expect(offers).toHaveLength(entries.length);
            }
            // The loop sleeps one tick when no entry is ready.
            if (!report.more) run.time += tickMin * MIN;
          }
        },
      ),
      { numRuns: 60, seed: 7 },
    );
  });
});

/** A fake of the ports of the command, with files in a map and a Best Buy that answers each product. */
function commandIo(files: Map<string, string>, options: { keys?: KeysResult; answer?: (exchange: Exchange) => Reply | Error; clock?: Clock } = {}) {
  const sent: Exchange[] = [];
  const err: string[] = [];
  const clock = options.clock ?? { now: () => T0, sleep: async () => {} };
  const io: Io = {
    out: () => {},
    err: (line) => err.push(line),
    keys: () => options.keys ?? readKeys("bestbuy", `BESTBUY_API_KEY=${API_KEY}\n`),
    transport: (): Transport<AbortSignal> => async (exchange) => {
      sent.push(exchange);
      const sku = Number(/products\/(\d+)\.json/.exec(exchange.url)?.[1]);
      const reply = options.answer?.(exchange) ?? { status: 200, statusText: "", headers: {}, body: JSON.stringify(product(sku)) };
      if (reply instanceof Error) throw reply;
      return reply;
    },
    pace: (): Pace<AbortSignal> => ({ scheduler: new HostScheduler(clock, 4), now: clock.now }),
    files: {
      read: (path) => {
        const text = files.get(path);
        if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
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
  return { io, sent, err };
}

const watchText = (entries: unknown[] = ENTRIES) => JSON.stringify({ slack: time(30, "min"), tick: time(1, "min"), entries });

describe("the command watch", () => {
  it("starts a new board when the file does not exist, and a second pass reads nothing", async () => {
    const files = new Map([["w.json", watchText()]]);
    const first = commandIo(files);
    expect(await main(["watch", "w.json", "--once"], first.io)).toBe(0);
    expect(first.sent.map(({ url }) => new URL(url).pathname)).toEqual(["/v1/products/1234567.json", "/v1/products/7654321.json"]);
    const board = parseBoard(files.get("w.board.json") ?? "");
    expect(board.ok && board.board.reads.map((read) => read.name)).toEqual(["gadget", "widget"]);
    expect(first.err[0]).toBe("board: w.board.json does not exist, so the watch starts an empty board.");
    const second = commandIo(files);
    expect(await main(["watch", "w.json", "--once", "--board", "w.board.json"], second.io)).toBe(0);
    expect(second.sent).toEqual([]);
  });

  it("gives 2 for a bad command or a bad watch, before a request", async () => {
    const files = new Map([["w.json", watchText([{ name: "ups", every: time(1, "h"), source: "digikey", id: "P5555-ND" }])]]);
    const run = commandIo(files);
    expect(await main(["watch", "w.json", "--once"], run.io)).toBe(2);
    expect(run.err).toEqual(["problem: The terms of digikey permit no store, so a watch cannot keep the prices of the entry ups. Read the source for each request."]);
    expect(await main(["watch"], run.io)).toBe(2);
    expect(await main(["watch", "none.json"], run.io)).toBe(2);
    expect(await main(["watch", "w.json", "--every"], run.io)).toBe(2);
    expect(run.sent).toEqual([]);
  });

  it("gives 1 and keeps a board file that is not a board, before a request", async () => {
    const files = new Map([["w.json", watchText()], ["w.board.json", "{"]]);
    const run = commandIo(files);
    expect(await main(["watch", "w.json", "--once"], run.io)).toBe(1);
    expect(files.get("w.board.json")).toBe("{");
    expect(run.err[0]).toMatch(/^problem: The board file w\.board\.json stays as it is\. The board is not JSON/);
    expect(run.sent).toEqual([]);
  });

  it("gives 1 for a problem of the keys, before a request", async () => {
    const run = commandIo(new Map([["w.json", watchText()]]), { keys: { ok: false, problems: ["The key file has no value for BESTBUY_API_KEY."] } });
    expect(await main(["watch", "w.json", "--once"], run.io)).toBe(1);
    expect(run.err).toEqual(["board: w.board.json does not exist, so the watch starts an empty board.", "problem: The key file has no value for BESTBUY_API_KEY."]);
    expect(run.sent).toEqual([]);
  });

  it("gives 1 when a read has a problem, and no output has a key", async () => {
    const files = new Map([["w.json", watchText()]]);
    const run = commandIo(files, { answer: (exchange) => (exchange.url.includes("1234567") ? new Error(`connect failed: ${exchange.url}`) : undefined as never) });
    expect(await main(["watch", "w.json", "--once"], run.io)).toBe(1);
    expect(run.err.join("\n")).toContain("apiKey=[secret]");
    expect([...run.err, ...files.values()].join("\n")).not.toContain(API_KEY);
    const board = parseBoard(files.get("w.board.json") ?? "");
    expect(board.ok && board.board.reads.map((read) => read.name)).toEqual(["gadget"]);
  });

  it("runs the steps as a service, sleeps a tick when no entry is due, and ends at a shutdown", async () => {
    const clock = fakeClock(0);
    const process = fakeProcess({ clock });
    const files = new Map([["w.json", watchText()]]);
    const wall = { now: () => T0 + clock.now(), sleep: async () => {} };
    const run = commandIo(files, { clock: wall });
    const io: Io = { ...run.io, service: { clock, process } };
    let code: number | undefined;
    const done = main(["watch", "w.json"], io).then((value) => {
      code = value;
    });
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    for (let step = 0; step < 300; step += 1) {
      await clock.advance(1000);
      await settle();
    }
    expect(run.err.filter((line) => line.endsWith("observations"))).toEqual(["widget: 1 observations", "gadget: 1 observations"]);
    expect(run.sent).toHaveLength(2);
    const board = parseBoard(files.get("w.board.json") ?? "");
    expect(board.ok && board.board.reads.map((read) => read.name)).toEqual(["gadget", "widget"]);
    expect(run.err.filter((line) => line.startsWith("problem"))).toEqual([]);
    process.signal("SIGTERM");
    for (let step = 0; step < 200 && code === undefined; step += 1) {
      await clock.advance(100);
      await settle();
    }
    await done;
    expect(code).toBe(0);
  });

  it("has a declaration that the lint of the service accepts", () => {
    const run = harness();
    const builder = declareWatch({ watch: watchOf(ENTRIES), state: run.state, ports: run.ports, onReport: () => {} });
    expect(watchLint(builder)).toEqual([]);
    expect(() => declareWatch({ watch: { ...watchOf(ENTRIES), tick: time(0, "min") }, state: run.state, ports: run.ports, onReport: () => {} })).toThrow(RangeError);
    // The drain is longer than one read, and its abort comes at its start.
    const drain = WATCH_PROFILE.phases?.find((phase) => phase.name === "drain");
    expect(drain?.cap).toEqual({ value: READ_BOUND_MS + 1000, unit: "ms" });
    expect(WATCH_PROFILE.cooperativeFloor).toBe("none");
  });
});
