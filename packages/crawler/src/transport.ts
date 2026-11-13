import type { Reply, Transport } from "@mark1russell7/market-sources";
import { httpRequest, httpSettings, type HttpSettings } from "@procedures/http";

/** The longest time of one exchange with an API, in milliseconds. */
export const EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * This function gives the host policy of the transport: only the API hosts, on port 443. The policy refuses each
 * other host, also a public host.
 */
export function apiSettings(hosts: readonly string[]): HttpSettings {
  return httpSettings({ allow: hosts.map((host) => `${host}:443`), publicHosts: false });
}

/** This function gives the headers of an answer with one text for each name. It joins a list with commas. */
export function flatHeaders(headers: Readonly<Record<string, string | readonly string[]>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = typeof value === "string" ? value : value.join(", ");
  return out;
}

/**
 * This function makes the transport of the clients of `@mark1russell7/market-sources` on `httpRequest` of
 * `@procedures/http`.
 *
 * - The transport sends an exchange only to an API host, with `https:` and no port.
 * - The host policy of `httpRequest` lets the transport reach only those hosts, on port 443.
 * - The transport gives a redirect as an answer, and does not follow it. Thus no key goes to another host.
 *
 * @throws Error when the URL of an exchange is not an API host. The message names the host, not the URL.
 */
export function apiTransport(hosts: readonly string[]): Transport<AbortSignal> {
  const settings = apiSettings(hosts);
  const allowed = new Set(hosts);
  return async (exchange, signal): Promise<Reply> => {
    const url = new URL(exchange.url);
    if (url.protocol !== "https:" || url.port !== "" || !allowed.has(url.hostname)) {
      throw new Error(`The exchange goes to ${url.hostname}, and it is not an API host on https.`);
    }
    const reply = await httpRequest(
      {
        method: exchange.method,
        url: exchange.url,
        headers: { ...exchange.headers },
        body: exchange.body ?? undefined,
        responseType: "text",
        redirect: "manual",
        timeoutMs: EXCHANGE_TIMEOUT_MS,
      },
      { signal },
      settings,
    );
    return {
      status: reply.status,
      statusText: reply.statusText,
      headers: flatHeaders(reply.headers),
      body: typeof reply.body === "string" ? reply.body : "",
    };
  };
}
