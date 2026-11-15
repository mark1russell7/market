import { readOrRun, type Io } from "./cli.ts";
import { prepareWatch } from "./watch.ts";

/**
 * This function is the entry of the crawler. It gives the exit code of the command `read`, `run` or `watch`. It starts
 * the service of the watch, and its exit code is the code of the service at its shutdown.
 */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  if (argv[0] !== "watch") return readOrRun(argv, io);
  const start = await prepareWatch(argv.slice(1), io);
  if (start.kind === "exit") return start.code;
  const life = await start.builder.run({
    ...(io.service?.clock === undefined ? {} : { clock: io.service.clock }),
    ...(io.service?.process === undefined ? {} : { process: io.service.process }),
  });
  return life.done;
}
