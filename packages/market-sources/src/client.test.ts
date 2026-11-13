import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  MESSAGE_LIMIT,
  SECRET_MARK,
  checkName,
  checkSecret,
  formBody,
  readAnswer,
  redact,
  send,
  sendWithToken,
  tokenStore,
  type Send,
} from "./client.ts";
import { parseDigiKeyProductDetails } from "./digikey.ts";
import { START, failure, fakePace, fakeTransport, reply } from "../test/fakes.ts";
import { digiKeyDetails } from "../test/fixtures.ts";

const SECRET = "s3cr3t-Value_9";

function input(changes: Partial<Send> = {}): Send {
  return {
    source: "Example",
    host: "api.example.com",
    minIntervalMs: 500,
    what: "the thing",
    exchange: { method: "GET", url: "https://api.example.com/thing", headers: {}, body: null },
    secrets: [SECRET],
    redact,
    ...changes,
  };
}

describe("the checks of the inputs", () => {
  it("refuses a key that is short, has a space or is not ASCII, and the message does not show it", () => {
    for (const bad of ["short", "has a space in it", "ключ-ключ-ключ", 12345678, undefined]) {
      expect(() => checkSecret("clientId", bad)).toThrow(RangeError);
      try {
        checkSecret("clientId", bad);
      } catch (error) {
        expect(String(error)).toContain("clientId");
        if (typeof bad === "string") expect(String(error)).not.toContain(bad);
      }
    }
    expect(() => checkSecret("clientId", SECRET)).not.toThrow();
  });

  it("refuses an empty name, a long name and a control character, and trims a name", () => {
    expect(() => checkName("sku", "  ")).toThrow(RangeError);
    expect(() => checkName("sku", "x".repeat(201))).toThrow(RangeError);
    expect(() => checkName("sku", "a\nb")).toThrow(RangeError);
    expect(checkName("sku", " P5555-ND ")).toBe("P5555-ND");
  });
});

describe("redact", () => {
  it("puts the mark in the place of a secret, of its form in a URL and of its form in a form body", () => {
    const secret = "a+b/c=d&e";
    const text = `key ${secret} and ${encodeURIComponent(secret)} and ${new URLSearchParams({ k: secret }).toString()}`;
    expect(redact(text, [secret])).toBe(`key ${SECRET_MARK} and ${SECRET_MARK} and k=${SECRET_MARK}`);
  });

  it("cuts a long text", () => {
    expect(redact("x".repeat(MESSAGE_LIMIT + 50), [])).toHaveLength(MESSAGE_LIMIT + 1);
  });

  it("leaves no secret in a text, for each secret and each text around it", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[!-~]{8,40}$/), fc.string(), fc.string(), (secret, before, after) => {
        const out = redact(`${before}${secret}${after}${encodeURIComponent(secret)}`, [secret]);
        const cut = out.endsWith("…") ? out.slice(0, -1) : out;
        return !cut.includes(secret) || `${before}${after}`.includes(secret) || SECRET_MARK.includes(secret);
      }),
      { numRuns: 300 },
    );
  });
});

describe("formBody", () => {
  it("encodes each field in its order", () => {
    expect(formBody({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" })).toBe(
      "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    );
  });
});

// The send, the token store and the grant are in polite-crawler/api, with their tests. These tests hold the
// part of this package: each message goes through the redact of this package.
describe("the send of polite-crawler with the redact of this package", () => {
  it("stops the host after 5 exchanges in sequence with no answer, and no message has the secret", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, () => new Error(`connect failed for https://api.example.com/?key=${SECRET}`));
    for (let round = 0; round < 5; round += 1) {
      const error = await failure(send(pace, transport, input()));
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe(`Example gave no answer to the thing: connect failed for https://api.example.com/?key=${SECRET_MARK}`);
    }
    const stopped = await failure(send(pace, transport, input()));
    expect(stopped.message).toContain("The client of Example did not send the thing");
    expect(stopped.message).not.toContain(SECRET);
    expect(sent).toHaveLength(5);
  });

  it("puts the token among the secrets of a message", async () => {
    const { pace, clock } = fakePace();
    const { transport } = fakeTransport(clock, (exchange) => new Error(`failed with ${exchange.headers["authorization"]}`));
    const tokens = tokenStore<AbortSignal>(async () => ({ token: "token-0001", until: Number.POSITIVE_INFINITY }), () => START);
    const error = await failure(sendWithToken(pace, transport, tokens, input(), (token) => ({ authorization: `Bearer ${token}` })));
    expect(error.message).toBe(`Example gave no answer to the thing: failed with Bearer ${SECRET_MARK}`);
  });
});

describe("readAnswer", () => {
  const context = { source: "Digi-Key", what: "ProductDetails of P5555-ND", secrets: [SECRET] };
  const classified = { outcome: "ok" as const, retryAfterMs: undefined, note: undefined };

  it("gives the result of the parser for a 2xx", () => {
    const at = "2026-11-12T18:00:00.000Z";
    expect(readAnswer({ reply: reply(200, digiKeyDetails), classified }, context, parseDigiKeyProductDetails, at)).toEqual(
      parseDigiKeyProductDetails(digiKeyDetails, at),
    );
  });

  it("gives a problem with the status line and no part of the body", () => {
    const answer = { reply: reply(404, { detail: SECRET }, {}, "Not Found"), classified };
    expect(readAnswer(answer, context, parseDigiKeyProductDetails, "2026-11-12T18:00:00Z")).toEqual({
      ok: false,
      problems: ["Digi-Key answered 404 Not Found to ProductDetails of P5555-ND."],
    });
    expect(readAnswer({ reply: reply(200, "<html>"), classified }, context, parseDigiKeyProductDetails, "2026-11-12T18:00:00Z")).toEqual({
      ok: false,
      problems: ["The answer of Digi-Key to ProductDetails of P5555-ND is not JSON."],
    });
  });
});
