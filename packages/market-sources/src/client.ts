/**
 * The shared parts of the clients of the seller APIs. Each client sends its exchanges with the polite send of
 * `polite-crawler/api`. The scheduler of `polite-crawler` keeps the pace of each host. The reaction to each
 * answer is the reaction of the crawler. This module adds the checks of the inputs of a client and the form body.
 * It also adds the read of an answer with a parser of this package, and the redaction of each message.
 *
 * This module uses no type of a platform: the host of a client gives the transport, the clock and the signal.
 */
import { redactSecrets } from "@mark1russell7/text/redact";
import { statusLine, type Answer, type Send } from "polite-crawler/api";
import { refused, type ParseResult } from "./parse.ts";

export {
  ApiError,
  readGrant,
  send,
  sendWithToken,
  statusLine,
  tokenStore,
  TOKEN_MARGIN_MS,
} from "polite-crawler/api";
export type {
  Answer,
  ApiScheduler,
  Exchange,
  Grant,
  Pace,
  Redact,
  Reply,
  Send,
  Signal,
  Tokens,
  Transport,
} from "polite-crawler/api";

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

/**
 * This function puts `SECRET_MARK` in the place of each secret and of its forms in a URL and in a form body.
 * It uses `redactSecrets` of `@mark1russell7/text`. Then it cuts the text to `MESSAGE_LIMIT`. Each client gives
 * it to the send as its `redact`.
 */
export function redact(text: string, secrets: readonly string[]): string {
  const out = redactSecrets(text, secrets, { mark: SECRET_MARK });
  return out.length > MESSAGE_LIMIT ? `${out.slice(0, MESSAGE_LIMIT)}…` : out;
}

/** This function gives the body of a form (`application/x-www-form-urlencoded`) with the fields in their order. */
export function formBody(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
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
    return refused(redact(`${input.source} answered ${statusLine(reply)} to ${input.what}.`, input.secrets ?? []));
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
