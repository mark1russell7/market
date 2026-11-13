/**
 * The shared parts of the clients of the seller APIs. A client sends each exchange through a transport port, and
 * the scheduler of `polite-crawler` keeps the pace of each host. This module uses no type of a platform: the host
 * of a client gives the transport, the clock and the signal.
 *
 * Three parts of this module have no home package at this time. The function `react` copies the reaction of the
 * `Crawler` of `polite-crawler` to an outcome, because `polite-crawler` does not export it. The functions `redact`
 * and `tokenStore` match no area of the map of homes. Each part moves to its home when the home has it.
 */
import { classify, isClientError, type Classified } from "polite-crawler/classify";
import { equalJitterMs, MAX_STOP_MS, policyFor, restAfter, type Paced, type PolicyOptions } from "polite-crawler/politeness";
import { field, refused, type ParseResult } from "./parse.ts";

/** One request of a client to the API of a source. */
export interface Exchange {
  readonly method: "GET" | "POST";
  readonly url: string;
  /** The headers of the request. Each name is in lowercase. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body of a `POST`, or null. */
  readonly body: string | null;
}

/** The answer of an API to one exchange. */
export interface Reply {
  readonly status: number;
  /** The reason phrase of the status line. HTTP/2 has no reason phrase, thus it can be empty. */
  readonly statusText: string;
  /** The headers of the answer. Each name is in lowercase. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The part of a signal that a client reads. An `AbortSignal` has it. */
export interface Signal {
  readonly aborted: boolean;
}

/**
 * A transport sends one exchange and gives the answer. It does not follow a redirect. It throws when the source
 * gives no answer, and when the signal stops the request.
 */
export type Transport<S extends Signal> = (exchange: Exchange, signal: S | undefined) => Promise<Reply>;

/** The part of `HostScheduler` of `polite-crawler/politeness` that a client uses. A `HostScheduler` has each method. */
export interface Scheduler<S extends Signal> {
  run<T>(host: string, task: () => Promise<Paced<T>>, signal?: S): Promise<T>;
  park(host: string, untilMs: number): void;
  stop(host: string, reason: string, untilMs?: number): void;
  failed(host: string): number;
  waited(host: string): number;
  succeeded(host: string): void;
}

/** The pace of the clients of one process. Give one pace to each client, thus each host keeps one pace. */
export interface Pace<S extends Signal> {
  readonly scheduler: Scheduler<S>;
  /** This function gives the time in milliseconds since the epoch. Give the clock of the scheduler. */
  readonly now: () => number;
  /** The politeness policy of `polite-crawler`. The default is its `DEFAULT_POLICY`. */
  readonly policy?: PolicyOptions | undefined;
  /** This function gives a number in [0, 1) for the jitter of a backoff. The default is `Math.random`. */
  readonly random?: (() => number) | undefined;
}

/** An error of a client. Its message has no secret: the client puts `[secret]` in the place of each secret. */
export class SourceError extends Error {
  override readonly name: string = "SourceError";
}

/** The text in the place of a secret in a message. */
export const SECRET_MARK = "[secret]";

/** The longest message of a client, in code units. */
export const MESSAGE_LIMIT = 300;

/** A key, a secret or a token is printable ASCII with no space, from 8 to 4096 characters. */
const SECRET = /^[!-~]{8,4096}$/;

/**
 * This function examines a key or a secret of a client.
 *
 * @throws RangeError when the value is not printable ASCII with no space, from 8 to 4096 characters. The message
 * names the field, and it does not show the value.
 */
export function checkSecret(name: string, value: unknown): void {
  if (typeof value !== "string" || !SECRET.test(value)) {
    throw new RangeError(`The field ${name} is not a key: printable ASCII with no space, from 8 to 4096 characters.`);
  }
}

/**
 * This function examines a value that a client puts in a URL, for example a product number.
 *
 * @throws RangeError when the value is empty, has more than 200 characters, or has a control character.
 */
export function checkName(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RangeError(`The field ${name} is not a text of 1 to 200 characters with no control character.`);
  }
  return value.trim();
}

/** This function puts `SECRET_MARK` in the place of each secret, and of its form in a URL, and cuts the text. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join(SECRET_MARK);
  }
  return out.length > MESSAGE_LIMIT ? `${out.slice(0, MESSAGE_LIMIT)}…` : out;
}

/** This function gives the body of a form (`application/x-www-form-urlencoded`) with the fields in their order. */
export function formBody(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** This function gives the status line of an answer for a message, with no control character. */
export function statusLine(reply: Reply): string {
  const reason = reply.statusText.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  return reason === "" ? String(reply.status) : `${reply.status} ${reason}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One exchange of a client, and its context for the pace and the messages. */
export interface Send {
  /** The name of the source in a message, for example `Digi-Key`. */
  readonly source: string;
  /** The host of the URL. The scheduler keeps one pace for each host. */
  readonly host: string;
  /** The documented pace of the source: the shortest time between two requests, in milliseconds. */
  readonly minIntervalMs: number;
  /** What the exchange asks for, in a message, for example `ProductDetails of P5555-ND`. */
  readonly what: string;
  readonly exchange: Exchange;
  /** The secrets of the exchange. No message has them. */
  readonly secrets: readonly string[];
  /** With true, an answer 401 does not stop the host. The client then asks for a new token one time. */
  readonly tokenRetry?: boolean | undefined;
}

/** An answer, and what it means for the host. */
export interface Answer {
  readonly reply: Reply;
  readonly classified: Classified;
}

type Attempt = Answer | { readonly error: unknown };

function react<S extends Signal>(pace: Pace<S>, input: Send, answer: Answer): void {
  const { scheduler } = pace;
  const { host, source } = input;
  const policy = policyFor(pace.policy, host);
  const now = pace.now();
  const status = answer.reply.status;
  switch (answer.classified.outcome) {
    case "ok":
    case "not-modified":
      scheduler.succeeded(host);
      return;
    case "rate-limited":
    case "unavailable": {
      const waits = scheduler.waited(host);
      const asked = answer.classified.retryAfterMs;
      if (asked !== undefined && asked > policy.maxRetryAfterMs) {
        scheduler.stop(host, `${source} asked for a wait of ${Math.ceil(asked / 1000)} s (${status}).`, now + Math.min(asked, MAX_STOP_MS));
        return;
      }
      const backoff = equalJitterMs(waits, policy.backoffBaseMs, policy.backoffCapMs, pace.random ?? Math.random);
      scheduler.park(host, now + Math.max(asked ?? 0, backoff));
      return;
    }
    case "blocked":
      if (status === 401 && input.tokenRetry === true) return;
      scheduler.stop(host, `${source} refused the access (${status}).`, now + policy.blockedStopMs);
      return;
    case "payment-required":
      scheduler.stop(host, `${source} asked for a payment (${status}).`, now + policy.paymentStopMs);
      return;
    case "challenge":
      scheduler.stop(host, `${source} gave a bot challenge (${status}).`, now + policy.challengeStopMs);
      return;
    case "error":
      if (!isClientError(status)) failed(pace, input, `${status}`);
      return;
    default:
      return;
  }
}

function failed<S extends Signal>(pace: Pace<S>, input: Send, what: string): void {
  const policy = policyFor(pace.policy, input.host);
  const failures = pace.scheduler.failed(input.host);
  if (failures >= policy.maxFailures) {
    const reason = `${failures} requests to ${input.source} failed in sequence (the last: ${what}).`;
    pace.scheduler.stop(input.host, reason, pace.now() + policy.failureStopMs);
  }
}

/**
 * This function sends one exchange at the pace of its host. The scheduler waits the rest of the host first. After
 * the answer, the host rests for the documented pace of the source, or for the `Retry-After` of the answer when it
 * is longer. The outcome of the answer then changes the host, as `polite-crawler` does:
 *
 * - A 429, 502, 503 or 504 parks the host for a backoff with jitter, or for a longer `Retry-After`.
 * - A 401 or a 403 stops the host for 1 hour. A 402 and a bot challenge stop it for 24 hours.
 * - An error 5xx and an exchange with no answer count as failures. After 5 failures in sequence, the host stops.
 *
 * The function gives each answer, with each status. The caller reads the status.
 *
 * @throws SourceError when the source gives no answer, or when the host is stopped. The message has no secret.
 * @throws the reason of the signal, when the signal stops the exchange.
 */
export async function send<S extends Signal>(pace: Pace<S>, transport: Transport<S>, input: Send, signal?: S): Promise<Answer> {
  const policy = policyFor(pace.policy, input.host);
  const rest = (elapsedMs: number, retryAfterMs?: number): number =>
    restAfter(policy, { kind: "api", elapsedMs, minIntervalMs: input.minIntervalMs, retryAfterMs }).ms;
  let attempt: Attempt;
  try {
    attempt = await pace.scheduler.run<Attempt>(
      input.host,
      async () => {
        const started = pace.now();
        try {
          const reply = await transport(input.exchange, signal);
          const classified = classify(reply.status, (name) => reply.headers[name.toLowerCase()], pace.now());
          return { value: { reply, classified }, delayMs: rest(pace.now() - started, classified.retryAfterMs) };
        } catch (error) {
          return { value: { error }, delayMs: rest(pace.now() - started) };
        }
      },
      signal,
    );
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new SourceError(redact(`The client of ${input.source} did not send ${input.what}: ${messageOf(error)}`, input.secrets));
  }
  if ("error" in attempt) {
    if (signal?.aborted === true) throw attempt.error;
    failed(pace, input, "no answer");
    throw new SourceError(redact(`${input.source} gave no answer to ${input.what}: ${messageOf(attempt.error)}`, input.secrets));
  }
  react(pace, input, attempt);
  return attempt;
}

/** The token of a client credentials grant, and the time when the client stops its use. */
export interface Grant {
  readonly token: string;
  /** The client uses the token before this time, in milliseconds since the epoch. */
  readonly until: number;
}

/** A client stops the use of a token this time before its end. */
export const TOKEN_MARGIN_MS = 60_000;

/**
 * This function reads the answer of a token endpoint of the OAuth 2.0 client credentials grant (RFC 6749,
 * section 4.4). The client uses the token until `TOKEN_MARGIN_MS` before its end, or for half of a short life.
 *
 * @throws SourceError when the answer is not a 2xx with an `access_token` and an `expires_in`. The message has no
 * part of the body.
 */
export function readGrant(reply: Reply, source: string, issuedAt: number, secrets: readonly string[]): Grant {
  if (reply.status < 200 || reply.status > 299) {
    throw new SourceError(redact(`${source} refused the token: ${statusLine(reply)}.`, secrets));
  }
  let body: unknown;
  try {
    body = JSON.parse(reply.body);
  } catch {
    throw new SourceError(`The token answer of ${source} is not JSON.`);
  }
  const token = field(body, "access_token");
  const expiresIn = field(body, "expires_in");
  if (typeof token !== "string" || !SECRET.test(token)) {
    throw new SourceError(`The token answer of ${source} has no valid access_token.`);
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new SourceError(`The token answer of ${source} has no valid expires_in.`);
  }
  const lifeMs = expiresIn * 1000;
  return { token, until: issuedAt + (lifeMs > 2 * TOKEN_MARGIN_MS ? lifeMs - TOKEN_MARGIN_MS : lifeMs / 2) };
}

/** A store of one token. Each exchange that waits for a token gets the token of one request. */
export interface Tokens<S extends Signal> {
  /** This method gives a token that the client can use, and asks for a new token when it has none. */
  get(signal?: S): Promise<string>;
  /** This method forgets the token, after an answer 401. */
  drop(): void;
}

/** This function makes a store of one token that asks `grant` for a new token when the token ends. */
export function tokenStore<S extends Signal>(grant: (signal: S | undefined) => Promise<Grant>, now: () => number): Tokens<S> {
  let held: Grant | undefined;
  let pending: Promise<Grant> | undefined;
  return {
    async get(signal) {
      if (held !== undefined && now() < held.until) return held.token;
      pending ??= grant(signal).finally(() => {
        pending = undefined;
      });
      const next = await pending;
      held = next;
      return next.token;
    },
    drop() {
      held = undefined;
    },
  };
}

/**
 * This function sends an exchange with a token. When the answer is a 401, it forgets the token, asks for a new
 * token, and sends the exchange one more time. A second 401 stops the host.
 */
export async function sendWithToken<S extends Signal>(
  pace: Pace<S>,
  transport: Transport<S>,
  tokens: Tokens<S>,
  input: Send,
  headers: (token: string) => Readonly<Record<string, string>>,
  signal?: S,
): Promise<Answer> {
  const once = async (tokenRetry: boolean): Promise<Answer> => {
    const token = await tokens.get(signal);
    const exchange = { ...input.exchange, headers: { ...input.exchange.headers, ...headers(token) } };
    return send(pace, transport, { ...input, exchange, secrets: [...input.secrets, token], tokenRetry }, signal);
  };
  const first = await once(true);
  if (first.reply.status !== 401) return first;
  tokens.drop();
  return once(false);
}

/**
 * This function reads an answer with a parser of this package at the instant `at`. An answer that is not a 2xx
 * gives a problem with its status line, and no part of its body.
 */
export function readAnswer(
  answer: Answer,
  input: Pick<Send, "source" | "what" | "secrets">,
  parse: (json: unknown, at: string) => ParseResult,
  at: string,
): ParseResult {
  const { reply } = answer;
  if (reply.status < 200 || reply.status > 299) {
    return refused(redact(`${input.source} answered ${statusLine(reply)} to ${input.what}.`, input.secrets));
  }
  let json: unknown;
  try {
    json = JSON.parse(reply.body);
  } catch {
    return refused(`The answer of ${input.source} to ${input.what} is not JSON.`);
  }
  return parse(json, at);
}

/** This function gives the instant of a time in milliseconds since the epoch, in the ISO 8601 form in UTC. */
export function instantOf(ms: number): string {
  return new Date(ms).toISOString();
}
