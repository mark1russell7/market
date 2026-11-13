/**
 * The fakes of the tests of the clients: a clock whose sleep moves the time at once, a real scheduler of
 * `polite-crawler` on that clock, and a transport that records each exchange.
 */
import { HostScheduler, type Clock } from "polite-crawler/politeness";
import type { Exchange, Pace, Reply, Transport } from "../src/client.ts";

/** The start time of each fake clock. */
export const START: number = Date.parse("2026-11-12T18:00:00Z");

/** A clock whose sleep moves the time at once, with a list of each sleep. */
export function fakeClock(): { clock: Clock; sleeps: number[] } {
  let time = START;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => time,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    },
  };
}

/** A pace on a real scheduler of `polite-crawler` with a fake clock. The jitter is always the middle value. */
export function fakePace(): { pace: Pace<AbortSignal>; clock: Clock; scheduler: HostScheduler } {
  const { clock } = fakeClock();
  const scheduler = new HostScheduler(clock, 4);
  return { pace: { scheduler, now: clock.now, random: () => 0.5 }, clock, scheduler };
}

/** An answer. A body that is not a string becomes JSON. */
export function reply(status: number, body: unknown, headers: Record<string, string> = {}, statusText = ""): Reply {
  return { status, statusText, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

/** One exchange that a fake transport got, with the time of the clock. */
export interface Sent {
  readonly exchange: Exchange;
  readonly at: number;
}

/** A transport that records each exchange with its time. The handler gives the answer, or an error to throw. */
export function fakeTransport(
  clock: Clock,
  handler: (exchange: Exchange, index: number) => Reply | Error,
): { transport: Transport<AbortSignal>; sent: Sent[] } {
  const sent: Sent[] = [];
  const transport: Transport<AbortSignal> = async (exchange, signal) => {
    sent.push({ exchange, at: clock.now() });
    if (signal?.aborted === true) throw signal.reason;
    const answer = handler(exchange, sent.length - 1);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { transport, sent };
}

/** This function gives the error of a promise that rejects with an error. */
export async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`The promise rejected with a value that is not an error: ${String(error)}`);
  }
  throw new Error("The promise did not reject.");
}
