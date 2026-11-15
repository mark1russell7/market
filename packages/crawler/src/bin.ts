/**
 * The entry of the command `market-crawler`. An interrupt (Ctrl+C) stops the read in progress.
 */
import { nodeIo } from "./cli.ts";
import { main } from "./main.ts";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("The read stopped at an interrupt.")));
process.exitCode = await main(process.argv.slice(2), nodeIo(controller.signal));
