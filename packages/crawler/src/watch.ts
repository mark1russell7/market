/**
 * The watch of the crawler reads each entry of a watch file when it is due. It keeps the board of current prices in
 * one file. The math of the board is in `@mark1russell7/market`: this module does the reads and writes the file.
 */
import { basename, dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  BOARD_FORMAT,
  boardSchema,
  lastReads,
  planReads,
  readInterval,
  settleBoard,
  watchEntrySchema,
  watchProblems,
  type Board,
  type BoardDrop,
  type SourceTerms,
  type WatchEntry,
} from "@mark1russell7/market";
import { SOURCE_TERMS, redact, type ParseResult } from "@mark1russell7/market-sources";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import {
  lint,
  localDev,
  realClock,
  service,
  workerLoop,
  type CheckFn,
  type Clock,
  type Profile,
  type Scenario,
  type ServiceBuilder,
} from "@mark1russell7/service";
import { errorMessage } from "@mark1russell7/text";
import { USAGE, checkRead, readerFor, type Io, type PlanRead, type ReadCommand, type Reader } from "./cli.ts";
import type { KeysResult, SourceName } from "./keys.ts";
import { EXCHANGE_TIMEOUT_MS } from "./transport.ts";

/**
 * The longest time of one read, in milliseconds. It is two exchanges with the API, as a token and a call, and 30 s
 * for the pace. The loop of the watch stops a read at this bound, and the read then fails.
 */
export const READ_BOUND_MS: number = 2 * EXCHANGE_TIMEOUT_MS + 30_000;

/** One entry of a watch: the entry of the board, the read of the entry, and its command. */
export interface WatchRead {
  readonly entry: WatchEntry;
  readonly plan: PlanRead;
  readonly command: ReadCommand;
}

/** A watch: the slack and the tick of its loop, the terms of the sources, and its entries. */
export interface Watch {
  /** The longest time from the instant that an entry is due until its new reading is on the board. */
  readonly slack: Quantity;
  /** The sleep of the loop when no entry is due. */
  readonly tick: Quantity;
  readonly terms: readonly SourceTerms[];
  readonly reads: readonly WatchRead[];
}

/** The result of the parse of a watch file: the watch, or each problem of the file. */
export type WatchResult = { readonly ok: true; readonly watch: Watch } | { readonly ok: false; readonly problems: readonly string[] };

const timeSchema = quantitySchema("time", { positive: true });

/** The fields of an entry of a watch file that are not the fields of a read. */
const ENTRY_FIELDS: readonly string[] = ["name", "every"];

const seconds = (ms: number): string => `${String(ms / 1000)} s`;

/**
 * This function gives the problems of the times of a watch.
 *
 * - The loop sleeps one tick when no entry is due, and then reads the due entries, one at a time.
 * - Thus a due entry is on the board after at most one tick and one read of each entry.
 * - The slack must be more than that time. The interval of each entry must be one tick or more.
 */
function timeProblems(reads: readonly WatchRead[], slack: number, tick: number, schedule: { terms: readonly SourceTerms[]; slack: Quantity }): string[] {
  const problems: string[] = [];
  if (tick >= slack) problems.push("The tick is not less than the slack, so a read has no time.");
  else if (tick + reads.length * READ_BOUND_MS >= slack) {
    problems.push(
      `The slack ${seconds(slack)} is not more than the tick and ${String(reads.length)} reads of at most ${seconds(READ_BOUND_MS)}: ${seconds(tick + reads.length * READ_BOUND_MS)}. Give a longer slack, or fewer entries.`,
    );
  }
  for (const read of reads) {
    const interval = readInterval(read.entry, schedule);
    if (interval.ok && interval.ms < tick) {
      problems.push(`The entry ${read.entry.name} has an interval of less than one tick. Give it a longer every, or give the watch a shorter tick.`);
    }
  }
  return problems;
}

/**
 * This function reads the text of a watch file. It checks each entry as a read of the command line, the watch with
 * `watchProblems` of `@mark1russell7/market`, and the times of the loop. It does not throw.
 *
 * @param text - The text of the watch file, in JSON
 * @param terms - The terms of the sources. The default is the terms of the sources of the crawler.
 */
export function parseWatch(text: string, terms: readonly SourceTerms[] = SOURCE_TERMS): WatchResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`The watch is not JSON: ${errorMessage(error)}`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, problems: ["The watch is not an object."] };
  const { slack, tick, entries, ...other } = data as Record<string, unknown>;
  const problems: string[] = [];
  const extra = Object.keys(other);
  if (extra.length > 0) problems.push(`The watch has an unknown field: ${extra.join(", ")}.`);
  const slackTime = timeSchema.safeParse(slack);
  const tickTime = timeSchema.safeParse(tick);
  if (!slackTime.success) problems.push('The field slack is not a time more than 0, for example {"value": 30, "unit": "min"}.');
  if (!tickTime.success) problems.push('The field tick is not a time more than 0, for example {"value": 1, "unit": "min"}.');
  if (!Array.isArray(entries) || entries.length === 0) problems.push("The watch has no list entries, or the list is empty.");
  const reads: WatchRead[] = [];
  if (Array.isArray(entries)) {
    entries.forEach((value: unknown, index) => {
      const name = `The entry ${String(index + 1)}`;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${name} is not an object.`);
        return;
      }
      const fields = value as Record<string, unknown>;
      const entry = watchEntrySchema.safeParse({ name: fields["name"], every: fields["every"], source: fields["source"] });
      if (!entry.success) {
        problems.push(`${name} has no name, no time every more than 0, or no source.`);
        return;
      }
      const readFields = Object.fromEntries(Object.entries(fields).filter(([field]) => !ENTRY_FIELDS.includes(field)));
      const checked = checkRead(readFields, `${name} (${entry.data.name})`);
      if (!checked.ok) {
        problems.push(checked.problem);
        return;
      }
      reads.push({ entry: entry.data, plan: checked.plan, command: checked.command });
    });
  }
  if (!slackTime.success || !tickTime.success) return { ok: false, problems };
  const schedule = { terms, slack: slackTime.data };
  problems.push(...watchProblems(reads.map((read) => read.entry), schedule));
  problems.push(...timeProblems(reads, valueIn(slackTime.data, "ms"), valueIn(tickTime.data, "ms"), schedule));
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, watch: { slack: slackTime.data, tick: tickTime.data, terms, reads } };
}

/** The result of the parse of a board file: the board, or the problem of the file. */
export type BoardResult = { readonly ok: true; readonly board: Board } | { readonly ok: false; readonly problem: string };

/** This function reads the text of a board file. It does not throw. */
export function parseBoard(text: string): BoardResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: `The board is not JSON: ${errorMessage(error)}` };
  }
  const board = boardSchema.safeParse(data);
  if (!board.success) {
    const issue = board.error.issues[0];
    return { ok: false, problem: `The board is not a board of the format ${BOARD_FORMAT}: ${issue === undefined ? "" : `${issue.path.join(".")}: ${issue.message}`}` };
  }
  return { ok: true, board: board.data };
}

/** This function gives an empty board at an instant. */
export function emptyBoard(at: string): Board {
  return { format: BOARD_FORMAT, at, reads: [] };
}

/** The state of a watch between two steps: the board, and the retry of each entry whose last read failed. */
export interface WatchState {
  board: Board;
  readonly retries: Map<string, { readonly failures: number; readonly at: number }>;
}

/** The ports of a step. A test gives fakes. */
export interface PassPorts {
  /** The time in milliseconds since 1970. */
  readonly now: () => number;
  /** This function sends the read of an entry. */
  readonly read: (read: WatchRead, signal: AbortSignal | undefined) => Promise<ParseResult>;
  /** This function writes the board. A throw is a failure of the step. */
  readonly save: (board: Board) => void;
  /** The keys. No problem and no note of a report has a key. */
  readonly secrets: readonly string[];
}

/** The report of the read of one entry. */
export interface EntryReport {
  readonly name: string;
  readonly at: string;
  readonly observations: number;
  readonly notes: readonly string[];
  readonly problems: readonly string[];
}

/** The report of a step: its read, each drop from the board, each entry that waits for its retry, and the next read. */
export interface StepReport {
  readonly at: string;
  /** The read of the step, or null when no entry is ready. */
  readonly read: EntryReport | null;
  readonly dropped: readonly BoardDrop[];
  readonly waiting: readonly string[];
  readonly next: string | null;
  /** True when an entry is due and ready after the step, so the next step starts at once. */
  readonly more: boolean;
}

/** The report of a pass: each read, each drop from the board, each entry that waits for its retry, and the next read. */
export interface PassReport {
  readonly at: string;
  readonly reads: readonly EntryReport[];
  readonly dropped: readonly BoardDrop[];
  readonly waiting: readonly string[];
  readonly next: string | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

const scheduleOf = (watch: Watch) => ({ terms: watch.terms, slack: watch.slack });

/** This function gives the due entries that are ready, in the queue of the plan, and the entries that wait for a retry. */
function readyReads(watch: Watch, state: WatchState, now: number): { ready: WatchRead[]; waiting: string[]; next: string | null } {
  const plan = planReads(
    watch.reads.map((read) => read.entry),
    lastReads(state.board),
    iso(now),
    scheduleOf(watch),
  );
  const byName = new Map(watch.reads.map((read) => [read.entry.name, read]));
  const ready: WatchRead[] = [];
  const waiting: string[] = [];
  for (const name of plan.queue) {
    const read = byName.get(name);
    if (read === undefined) continue;
    const retry = state.retries.get(name);
    if (retry !== undefined && retry.at > now) waiting.push(name);
    else ready.push(read);
  }
  return { ready, waiting, next: plan.next };
}

/**
 * This function does one step of a watch: it reads the first ready entry of the queue of the plan, at most.
 *
 * - First it settles the board at the time of the step: a reading past the limit of its terms leaves the board.
 * - A good read replaces the last read of its entry. The function then writes the board.
 * - A failed read keeps the last read of its entry on the board until its terms end it. The entry then waits for
 *   its retry. The first retry comes one tick after the failure. Each next wait is two times longer, and at most the
 *   interval of the entry.
 *
 * @throws Error when the save of the board fails
 */
export async function watchStep(watch: Watch, state: WatchState, ports: PassPorts, signal?: AbortSignal): Promise<StepReport> {
  const names = watch.reads.map((read) => read.entry.name);
  const tick = valueIn(watch.tick, "ms");
  // The signal can abort during the read, so each test reads it again.
  const aborted = (): boolean => signal?.aborted === true;
  const start = ports.now();
  const settled = settleBoard(state.board, { terms: watch.terms, now: iso(start), names });
  state.board = settled.board;
  const dropped: BoardDrop[] = [...settled.dropped];
  if (settled.dropped.length > 0) ports.save(state.board);
  const before = readyReads(watch, state, start);
  const read = before.ready[0];
  if (read === undefined || aborted()) {
    return { at: iso(start), read: null, dropped, waiting: before.waiting, next: before.next, more: false };
  }
  const { name } = read.entry;
  const readAt = iso(ports.now());
  let result: ParseResult;
  try {
    result = await ports.read(read, signal);
  } catch (error) {
    result = { ok: false, problems: [errorMessage(error)] };
  }
  const clean = (texts: readonly string[]) => texts.map((text) => redact(text, ports.secrets));
  let report: EntryReport;
  if (result.ok) {
    state.retries.delete(name);
    const next = settleBoard(state.board, { terms: watch.terms, now: iso(ports.now()), names }, { name, at: readAt, observations: result.observations });
    state.board = next.board;
    dropped.push(...next.dropped);
    ports.save(state.board);
    report = { name, at: readAt, observations: result.observations.length, notes: clean(result.notes), problems: [] };
  } else {
    const failures = (state.retries.get(name)?.failures ?? 0) + 1;
    const interval = readInterval(read.entry, scheduleOf(watch));
    const cap = interval.ok ? interval.ms : tick;
    state.retries.set(name, { failures, at: ports.now() + Math.min(cap, tick * 2 ** (failures - 1)) });
    report = { name, at: readAt, observations: 0, notes: [], problems: clean(result.problems) };
  }
  const after = readyReads(watch, state, ports.now());
  return { at: iso(start), read: report, dropped, waiting: after.waiting, next: after.next, more: after.ready.length > 0 && !aborted() };
}

/**
 * This function does one pass of a watch: a step for each ready entry, until no entry is ready. It reads each entry
 * one time at most. It stops before the next read at the signal.
 *
 * @throws Error when the save of the board fails
 */
export async function watchPass(watch: Watch, state: WatchState, ports: PassPorts, signal?: AbortSignal): Promise<PassReport> {
  const at = iso(ports.now());
  const reads: EntryReport[] = [];
  const dropped: BoardDrop[] = [];
  let last: StepReport | undefined;
  for (let step = 0; step < watch.reads.length; step += 1) {
    if (signal?.aborted === true) break;
    last = await watchStep(watch, state, ports, signal);
    dropped.push(...last.dropped);
    if (last.read !== null) reads.push(last.read);
    if (!last.more) break;
  }
  return { at, reads, dropped, waiting: last?.waiting ?? [], next: last?.next ?? null };
}

const readLine = (read: EntryReport): string =>
  `${read.name}: ${String(read.observations)} observations${read.problems.length > 0 ? `, problem: ${read.problems.join(" ")}` : ""}`;

const dropLines = (dropped: readonly BoardDrop[]): string[] => dropped.map((drop) => `dropped ${drop.offerId} of ${drop.entry}: ${drop.why}`);

/** This function gives the lines of the log of a step: its read and each drop. A step with no read and no drop has none. */
export function stepLines(report: StepReport): string[] {
  return [...(report.read === null ? [] : [readLine(report.read)]), ...dropLines(report.dropped)];
}

/** This function gives the lines of the log of a pass: each read, each drop, and the counts of the pass. */
export function passLines(report: PassReport): string[] {
  const lines = [...report.reads.map(readLine), ...dropLines(report.dropped)];
  if (report.waiting.length > 0) lines.push(`waiting for a retry: ${report.waiting.join(", ")}`);
  const failed = report.reads.filter((read) => read.problems.length > 0).length;
  lines.push(
    `pass ${report.at}: ${String(report.reads.length)} reads, ${String(failed)} with a problem, ${String(report.dropped.length)} drops, next read ${report.next ?? "none"}.`,
  );
  return lines;
}

/** The name of the worker of the watch service. */
export const WATCH_LOOP = "watch";

/** The name of the check of the progress of the steps. */
export const WATCH_PROGRESS = "steps-progress";

const ms = (value: number): Quantity => ({ value, unit: "ms" });

/**
 * The profile of the shutdown of the watch: the profile `localDev` of `@mark1russell7/service`, with a drain that is
 * longer than one read. The abort of the drain comes at its start, so an interrupt stops the read in progress at once.
 * The board keeps each read before it.
 */
export const WATCH_PROFILE: Profile = {
  ...localDev,
  phases: (localDev.phases ?? []).map((phase) => (phase.name === "drain" ? { ...phase, cap: ms(READ_BOUND_MS + 1000) } : { ...phase })),
  cooperativeWindow: ms(READ_BOUND_MS + 1000),
  cooperativeFloor: "none",
};

/** The platform of the lint of the declaration: a host with no platform of pods. */
const HOST_SCENARIO: Scenario = { platform: {}, probes: { readiness: { value: 0, unit: "s" }, liveness: { value: 0, unit: "s" } } };

/** The options of the watch service. */
export interface WatchServiceOptions {
  readonly watch: Watch;
  readonly state: WatchState;
  readonly ports: PassPorts;
  /** This function receives the report of each step. */
  readonly onReport: (report: StepReport) => void;
  /** This function receives each failure of a step, with the count of failures in sequence. */
  readonly onError?: ((error: unknown, failures: number) => void) | undefined;
  /** The clock of the loop. Give the same clock to `run()`. The default is `realClock`. */
  readonly clock?: Clock | undefined;
  /** The random numbers of the jitter of a retry, from 0 up to 1. The default is `Math.random`. */
  readonly random?: (() => number) | undefined;
}

/**
 * This function declares the watch as one service of `@mark1russell7/service`. It starts nothing.
 *
 * - The loop is a worker with one lane. Each unit of the worker is one step, so it reads one entry at most.
 * - The next step starts at once while an entry is ready. Else the loop sleeps one tick.
 * - A step takes at most `READ_BOUND_MS`. The loop stops a longer read, and the read fails.
 * - A failed save of the board is a failure of the loop. The loop then waits half a tick, plus a jitter.
 * - The check `steps-progress` fails when no step ended in one tick and one read. It gates the liveness.
 */
export function declareWatch(options: WatchServiceOptions): ServiceBuilder {
  const clock = options.clock ?? realClock;
  const { watch } = options;
  const tick = valueIn(watch.tick, "ms");
  if (!(tick > 0)) throw new RangeError("The tick is not more than 0.");
  // The longest gap between the ends of two steps: the sleep or the longest backoff, and one read.
  const stall = tick + READ_BOUND_MS;
  let mark: number | null = null;
  const progress: CheckFn = () => (mark === null || clock.now() - mark <= stall ? "ok" : "error");
  const loop = workerLoop(
    {
      worker_sleep: watch.tick,
      unit_processing_time: ms(READ_BOUND_MS),
      retry_base: ms(tick / 2),
      retry_cap: ms(tick / 2),
      close_bound: ms(500),
      concurrency: { value: 1, unit: "count" },
    },
    {
      iteration: async ({ signal }): Promise<"more" | undefined> => {
        mark ??= clock.now();
        try {
          const report = await watchStep(watch, options.state, options.ports, signal);
          options.onReport(report);
          return report.more ? "more" : undefined;
        } finally {
          mark = clock.now();
        }
      },
      clock,
      random: options.random,
      onError: options.onError,
    },
  );
  return service("market-watch")
    .worker(WATCH_LOOP, loop.knobs, loop)
    .check(
      {
        name: WATCH_PROGRESS,
        dependency: null,
        step: "progress",
        ownConnection: false,
        gates: "liveness",
        poll: { interval: { value: 5, unit: "s" }, jitter: 0.2, timeout: { value: 1, unit: "s" } },
        marks: { loops: [WATCH_LOOP], stall: ms(stall) },
      },
      progress,
    )
    .readiness({ type: "debounce", interval: { value: 5, unit: "s" }, failAfter: 3, recoverAfter: 1 })
    .liveness({ type: "window", failAfter: { value: 45, unit: "s" } })
    .startup({ value: 30, unit: "s" })
    .profile(WATCH_PROFILE);
}

/** This function gives the problems of the lint of the declaration of a watch: each rule that it violates. */
export function watchLint(builder: ServiceBuilder): string[] {
  return lint(builder.describe(), HOST_SCENARIO, [])
    .filter((finding) => finding.verdict === "violated")
    .map((finding) => `The declaration violates the rule ${finding.rule} at ${finding.scope}.`);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** The result of `prepareWatch`: an exit code, or the service of the watch that the entry starts. */
export type WatchStart = { readonly kind: "exit"; readonly code: number } | { readonly kind: "service"; readonly builder: ServiceBuilder };

/**
 * This function prepares the command `watch`. It reads the watch file and the board file, and loads the keys of each
 * source of the watch.
 *
 * - A bad command or a bad watch gives the exit code 2. A problem of the keys or of the board file gives 1.
 * - With `--once`, it does one pass, and gives its exit code. The code is 1 when a read has a problem.
 * - Without it, it gives the service of the watch. The entry `main` starts it, and the service operates until its
 *   shutdown.
 */
export async function prepareWatch(argv: readonly string[], io: Io): Promise<WatchStart> {
  const exit = (code: number): WatchStart => ({ kind: "exit", code });
  let flags: { values: { board?: string | undefined; once?: boolean | undefined; help?: boolean | undefined }; positionals: string[] };
  try {
    flags = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { board: { type: "string" }, once: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    io.err(`${errorMessage(error)}\n\n${USAGE}`);
    return exit(2);
  }
  if (flags.values.help === true) {
    io.out(USAGE);
    return exit(0);
  }
  const [watchPath, ...extra] = flags.positionals;
  if (watchPath === undefined || extra.length > 0) {
    io.err(`Give one watch file.\n\n${USAGE}`);
    return exit(2);
  }
  let text: string;
  try {
    text = io.files.read(watchPath);
  } catch (error) {
    io.err(`problem: The watch file ${watchPath} does not read: ${errorMessage(error)}`);
    return exit(2);
  }
  const parsed = parseWatch(text);
  if (!parsed.ok) {
    for (const problem of parsed.problems) io.err(`problem: ${problem}`);
    return exit(2);
  }
  const { watch } = parsed;
  const boardPath = flags.values.board ?? `${join(dirname(watchPath), basename(watchPath, extname(watchPath)))}.board.json`;
  let board: Board;
  try {
    const loaded = parseBoard(io.files.read(boardPath));
    if (!loaded.ok) {
      io.err(`problem: The board file ${boardPath} stays as it is. ${loaded.problem}`);
      return exit(1);
    }
    board = loaded.board;
  } catch (error) {
    if (!isMissing(error)) {
      io.err(`problem: The board file ${boardPath} does not read: ${errorMessage(error)}`);
      return exit(1);
    }
    board = emptyBoard(iso(io.now()));
    io.err(`board: ${boardPath} does not exist, so the watch starts an empty board.`);
  }
  const sources = [...new Set(watch.reads.map((read) => read.command.source))];
  const keys = new Map<SourceName, KeysResult>(sources.map((source) => [source, io.keys(source)]));
  const missing = [...keys.values()].flatMap((loaded) => (loaded.ok ? [] : loaded.problems));
  if (missing.length > 0) {
    for (const problem of missing) io.err(`problem: ${problem}`);
    return exit(1);
  }
  const secrets = [...keys.values()].flatMap((loaded) => (loaded.ok ? Object.values(loaded.keys) : []));
  const pace = io.pace();
  const readers = new Map<string, Reader>();
  const ports: PassPorts = {
    now: io.now,
    secrets,
    save: (next) => io.files.replace(boardPath, `${JSON.stringify(next, null, 2)}\n`),
    read: async (read, signal) => {
      const { source, sandbox } = read.command;
      const id = `${source}:${String(sandbox)}`;
      const loaded = keys.get(source);
      if (loaded === undefined || !loaded.ok) return { ok: false, problems: [`The keys of ${source} are not loaded.`] };
      const reader = readers.get(id) ?? readerFor(source, sandbox, loaded.keys, io, pace);
      readers.set(id, reader);
      return reader(read.command, signal);
    },
  };
  const state: WatchState = { board, retries: new Map() };
  if (flags.values.once === true) {
    try {
      const report = await watchPass(watch, state, ports, io.signal);
      for (const line of passLines(report)) io.err(line);
      return exit(report.reads.some((read) => read.problems.length > 0) ? 1 : 0);
    } catch (error) {
      io.err(`problem: ${redact(errorMessage(error), secrets)}`);
      return exit(1);
    }
  }
  const builder = declareWatch({
    watch,
    state,
    ports,
    onReport: (report) => {
      for (const line of stepLines(report)) io.err(line);
    },
    onError: (error, failures) => io.err(`problem: step failure ${String(failures)} in sequence: ${redact(errorMessage(error), secrets)}`),
    clock: io.service?.clock,
  });
  const violations = watchLint(builder);
  if (violations.length > 0) {
    for (const problem of violations) io.err(`problem: ${problem}`);
    return exit(1);
  }
  io.err(`watch: ${String(watch.reads.length)} entries, board ${boardPath}. Ctrl+C stops the watch.`);
  return { kind: "service", builder };
}
