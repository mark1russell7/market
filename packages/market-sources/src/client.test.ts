import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MESSAGE_LIMIT,
  SECRET_MARK,
  SourceError,
  checkName,
  checkSecret,
  formBody,
  readAnswer,
  readGrant,
  redact,
  send,
  sendWithToken,
  statusLine,
  tokenStore,
  type Grant,
  type Reply,
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
  it("puts the mark in the place of a secret and of its form in a URL", () => {
    const secret = "a+b/c=d&e";
    const text = `key ${secret} and ${encodeURIComponent(secret)}`;
    expect(redact(text, [secret])).toBe(`key ${SECRET_MARK} and ${SECRET_MARK}`);
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

describe("formBody and statusLine", () => {
  it("encodes each field in its order", () => {
    expect(formBody({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" })).toBe(
      "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    );
  });

  it("gives the status and the reason phrase with no control character", () => {
    expect(statusLine(reply(404, "", {}, "Not Found"))).toBe("404 Not Found");
    expect(statusLine(reply(404, ""))).toBe("404");
    expect(statusLine(reply(400, "", {}, "Bad\r\nInjected: yes"))).toBe("400 Bad  Injected: yes");
  });
});

describe("send", () => {
  it("keeps the pace of the source between two exchanges to one host", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, () => reply(200, {}));
    await send(pace, transport, input());
    await send(pace, transport, input());
    const [first, second] = sent;
    expect(second!.at - first!.at).toBe(500);
  });

  it("waits the Retry-After of a 429 before the next exchange, and gives the 429", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, (_, index) => (index === 0 ? reply(429, {}, { "retry-after": "30" }) : reply(200, {})));
    const first = await send(pace, transport, input());
    expect(first.reply.status).toBe(429);
    expect(first.classified.outcome).toBe("rate-limited");
    await send(pace, transport, input());
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(30_000);
  });

  it("stops the host after a 403, and the next exchange does not go", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, () => reply(403, {}));
    expect((await send(pace, transport, input())).reply.status).toBe(403);
    const error = await failure(send(pace, transport, input()));
    expect(error).toBeInstanceOf(SourceError);
    expect(error.message).toContain("The client of Example did not send the thing");
    expect(sent).toHaveLength(1);
  });

  it("stops the host after 5 exchanges in sequence with no answer, and no message has the secret", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, () => new Error(`connect failed for https://api.example.com/?key=${SECRET}`));
    for (let round = 0; round < 5; round += 1) {
      const error = await failure(send(pace, transport, input()));
      expect(error).toBeInstanceOf(SourceError);
      expect(error.message).toContain("Example gave no answer to the thing");
      expect(error.message).not.toContain(SECRET);
    }
    await failure(send(pace, transport, input()));
    expect(sent).toHaveLength(5);
  });

  it("does not stop the host for a client error 400 or a 404", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, (_, index) => reply(index % 2 === 0 ? 400 : 404, {}));
    for (let round = 0; round < 8; round += 1) await send(pace, transport, input());
    expect(sent).toHaveLength(8);
  });

  it("gives the reason of the signal when the signal stops the exchange, and counts no failure", async () => {
    const { pace, clock, scheduler } = fakePace();
    const { transport } = fakeTransport(clock, () => reply(200, {}));
    const controller = new AbortController();
    const reason = new Error("stopped by the test");
    controller.abort(reason);
    const error = await failure(send(pace, transport, input(), controller.signal));
    expect(error).toBe(reason);
    // The method failed records one failure and gives the count. Thus 1 shows that the abort counted no failure.
    expect(scheduler.failed("api.example.com")).toBe(1);
  });
});

describe("readGrant", () => {
  const issuedAt = START;

  it("keeps a token until 1 minute before its end, or for half of a short life", () => {
    expect(readGrant(reply(200, { access_token: "token-0001", expires_in: 599 }), "X", issuedAt, [])).toEqual({
      token: "token-0001",
      until: issuedAt + 539_000,
    });
    expect(readGrant(reply(200, { access_token: "token-0001", expires_in: 60 }), "X", issuedAt, []).until).toBe(issuedAt + 30_000);
  });

  it("gives an error with no part of the body for each bad answer", () => {
    const cases: [Reply, string][] = [
      [reply(401, { error: SECRET }, {}, "Unauthorized"), "X refused the token: 401 Unauthorized."],
      [reply(200, `<html>${SECRET}</html>`), "The token answer of X is not JSON."],
      [reply(200, { access_token: "no space allowed", expires_in: 10 }), "The token answer of X has no valid access_token."],
      [reply(200, { access_token: "token-0001", expires_in: 0 }), "The token answer of X has no valid expires_in."],
      [reply(200, { access_token: "token-0001", expires_in: "600" }), "The token answer of X has no valid expires_in."],
    ];
    for (const [answer, message] of cases) {
      expect(() => readGrant(answer, "X", issuedAt, [SECRET])).toThrow(new SourceError(message));
    }
  });
});

describe("tokenStore", () => {
  it("asks for one token for two exchanges that wait at one time, and for a new token after its end", async () => {
    let time = START;
    let grants = 0;
    const tokens = tokenStore<AbortSignal>(async () => {
      grants += 1;
      return { token: `token-000${grants}`, until: time + 1000 } satisfies Grant;
    }, () => time);
    expect(await Promise.all([tokens.get(), tokens.get()])).toEqual(["token-0001", "token-0001"]);
    expect(grants).toBe(1);
    time += 999;
    expect(await tokens.get()).toBe("token-0001");
    time += 1;
    expect(await tokens.get()).toBe("token-0002");
    tokens.drop();
    expect(await tokens.get()).toBe("token-0003");
  });

  it("asks again after a grant that failed", async () => {
    let grants = 0;
    const tokens = tokenStore<AbortSignal>(async () => {
      grants += 1;
      if (grants === 1) throw new SourceError("no token");
      return { token: "token-0002", until: Number.POSITIVE_INFINITY };
    }, () => START);
    await expect(tokens.get()).rejects.toThrow("no token");
    expect(await tokens.get()).toBe("token-0002");
  });
});

describe("sendWithToken", () => {
  function tokens(): { store: ReturnType<typeof tokenStore<AbortSignal>>; count: () => number } {
    let grants = 0;
    const store = tokenStore<AbortSignal>(async () => {
      grants += 1;
      return { token: `token-000${grants}`, until: Number.POSITIVE_INFINITY };
    }, () => START);
    return { store, count: () => grants };
  }
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it("asks for a new token after a 401, and sends the exchange one more time", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, (_, index) => reply(index === 0 ? 401 : 200, {}));
    const { store, count } = tokens();
    const answer = await sendWithToken(pace, transport, store, input(), bearer);
    expect(answer.reply.status).toBe(200);
    expect(count()).toBe(2);
    expect(sent.map(({ exchange }) => exchange.headers["authorization"])).toEqual(["Bearer token-0001", "Bearer token-0002"]);
  });

  it("stops the host after a second 401", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, () => reply(401, {}));
    const { store } = tokens();
    expect((await sendWithToken(pace, transport, store, input(), bearer)).reply.status).toBe(401);
    await expect(sendWithToken(pace, transport, store, input(), bearer)).rejects.toThrow(SourceError);
    expect(sent).toHaveLength(2);
  });

  it("puts the token among the secrets of a message", async () => {
    const { pace, clock } = fakePace();
    const { transport } = fakeTransport(clock, (exchange) => new Error(`failed with ${exchange.headers["authorization"]}`));
    const { store } = tokens();
    const error = await failure(sendWithToken(pace, transport, store, input(), bearer));
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
