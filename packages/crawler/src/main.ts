/**
 * The command `market-crawler`: it sends `watch` to the watch, and each other command to `read` and `run`.
 */
import { readOrRun, type Io } from "./cli.ts";
import { runWatch } from "./watch.ts";

/** This function is the command. It gives the exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  return argv[0] === "watch" ? runWatch(argv.slice(1), io) : readOrRun(argv, io);
}
