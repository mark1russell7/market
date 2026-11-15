/**
 * The crawler of the market: the host of the clients of `@mark1russell7/market-sources`. It gives the transport on
 * `@procedures/http`, the keys of the key file, and the commands `market-crawler read`, `run` and `watch`.
 */
export { EXCHANGE_TIMEOUT_MS, apiSettings, apiTransport, flatHeaders } from "./transport.ts";
export { KEY_VARIABLES, SOURCE_NAMES, keyFile, loadKeys, readKeys } from "./keys.ts";
export type { KeysResult, SourceName } from "./keys.ts";
export { READ_FIELDS, USAGE, checkRead, nodeIo, parseCommand, parsePlan, read, readOrRun, readerFor } from "./cli.ts";
export type { Io, Parsed, PlanRead, PlanResult, ReadCheck, ReadCommand, ReadFields, ReadRecord, Reader } from "./cli.ts";
export { main } from "./main.ts";
export {
  READ_BOUND_MS,
  WATCH_LOOP,
  WATCH_PROFILE,
  WATCH_PROGRESS,
  declareWatch,
  emptyBoard,
  parseBoard,
  parseWatch,
  passLines,
  prepareWatch,
  stepLines,
  watchLint,
  watchPass,
  watchStep,
} from "./watch.ts";
export type { BoardResult, EntryReport, PassPorts, PassReport, StepReport, Watch, WatchRead, WatchResult, WatchServiceOptions, WatchStart, WatchState } from "./watch.ts";
