import { Buffer } from "node:buffer";
import { isQuotaError, memoryQuotaStore, quotaGate } from "polite-crawler/api";
import { describe, expect, it } from "vitest";
import { failure, fakePace, fakeTransport, reply } from "../test/fakes.ts";
import { KROGER_LOCATION, krogerDetails, krogerSearch } from "../test/fixtures.ts";
import { SECRET_MARK, instantOf, type Exchange, type Reply } from "./client.ts";
import { KROGER_QUOTA, KROGER_QUOTA_KEY, createKrogerClient } from "./kroger-client.ts";
import { parseKrogerProduct, parseKrogerProducts } from "./kroger.ts";

const CLIENT_ID = "client-id-0001";
const CLIENT_SECRET = "client-secret-0001";
const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const basic = base64(`${CLIENT_ID}:${CLIENT_SECRET}`);

function token(name: string, expiresIn = 1800): Reply {
  return reply(200, { access_token: name, expires_in: expiresIn, token_type: "bearer" });
}

function isToken(exchange: Exchange): boolean {
  return exchange.url.endsWith("/oauth2/token");
}

function setup(handler: (exchange: Exchange, index: number) => Reply | Error, extra: { sandbox?: boolean } = {}) {
  const { pace, clock } = fakePace();
  const { transport, sent } = fakeTransport(clock, handler);
  const client = createKrogerClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace, locationId: KROGER_LOCATION, ...extra });
  return { client, sent, clock };
}

describe("the Kroger client", () => {
  it("gets a client token with Basic and the scope, then reads Product details at the location", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, krogerDetails)));
    const result = await client.product(" 0003600029145 ");
    expect(result).toEqual(parseKrogerProduct(krogerDetails, instantOf(clock.now()), KROGER_LOCATION));
    expect(result.ok).toBe(true);
    const [grant, read] = sent.map(({ exchange }) => exchange);
    expect(grant).toEqual({
      method: "POST",
      url: "https://api.kroger.com/v1/connect/oauth2/token",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials&scope=product.compact",
    });
    expect(read).toEqual({
      method: "GET",
      url: "https://api.kroger.com/v1/products/0003600029145?filter.locationId=01234567",
      headers: { accept: "application/json", authorization: "Bearer token-0001" },
      body: null,
    });
  });

  it("reads one page of Product search with the term, the location, the limit and the start, 1 s after the token", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, krogerSearch)));
    const result = await client.search("  spring   water ", 50, 20);
    expect(result).toEqual(parseKrogerProducts(krogerSearch, instantOf(clock.now()), KROGER_LOCATION));
    expect(sent[1]!.exchange.url).toBe(
      "https://api.kroger.com/v1/products?filter.term=spring%20water&filter.locationId=01234567&filter.limit=50&filter.start=20",
    );
    expect(sent[1]!.at - sent[0]!.at).toBe(1000);
  });

  it("sends no start for the first page, and keeps one token for many reads", async () => {
    const { client, sent } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, krogerSearch)));
    await client.search("milk");
    await client.search("milk");
    expect(sent.filter(({ exchange }) => isToken(exchange))).toHaveLength(1);
    expect(sent[1]!.exchange.url).toBe("https://api.kroger.com/v1/products?filter.term=milk&filter.locationId=01234567&filter.limit=10");
  });

  it("uses the certification host with the option sandbox", async () => {
    const { client, sent } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, krogerDetails)), { sandbox: true });
    await client.product("0003600029145");
    expect(sent.map(({ exchange }) => new URL(exchange.url).host)).toEqual(["api-ce.kroger.com", "api-ce.kroger.com"]);
  });

  it("refuses a bad product id, term, limit, start and location before a request", async () => {
    const { client, sent } = setup(() => reply(200, {}));
    await expect(client.product("003600029145")).rejects.toThrow("is not 13 digits");
    await expect(client.search("ab")).rejects.toThrow(RangeError);
    await expect(client.search("a b c d e f g h i")).rejects.toThrow(RangeError);
    await expect(client.search("milk", 51)).rejects.toThrow(RangeError);
    await expect(client.search("milk", 10, 251)).rejects.toThrow(RangeError);
    await expect(client.search("milk", 10, -1)).rejects.toThrow(RangeError);
    expect(sent).toHaveLength(0);
    const { pace } = fakePace();
    const transport = async (): Promise<Reply> => reply(200, {});
    expect(() =>
      createKrogerClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace, locationId: "0123" }),
    ).toThrow(RangeError);
    expect(() => createKrogerClient({ clientId: "x", clientSecret: CLIENT_SECRET, base64, transport, pace, locationId: KROGER_LOCATION })).toThrow(
      RangeError,
    );
  });

  it("keeps a margin under the daily limit of 10,000, and counts no token request", async () => {
    expect(KROGER_QUOTA.limit - (KROGER_QUOTA.reserve ?? 0)).toBe(9_000);
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, (exchange) => (isToken(exchange) ? token("token-0001") : reply(200, krogerDetails)));
    const quota = quotaGate(KROGER_QUOTA, { key: KROGER_QUOTA_KEY, store: memoryQuotaStore(), now: clock.now });
    const client = createKrogerClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace, locationId: KROGER_LOCATION, quota });
    await client.product("0003600029145");
    expect(quota.state()).toMatchObject({ used: 1, left: 8_999 });
    // The test takes the other 8,999 units of the window from the gate, not with 8,999 calls.
    quota.take(8_999);
    const error = await failure(client.search("milk"));
    expect(isQuotaError(error)).toBe(true);
    expect(sent.filter(({ exchange }) => !isToken(exchange))).toHaveLength(1);
  });

  it("sets the count to the limit after a 429", async () => {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, (exchange) => (isToken(exchange) ? token("token-0001") : reply(429, {}, {}, "Too Many Requests")));
    const quota = quotaGate(KROGER_QUOTA, { key: KROGER_QUOTA_KEY, store: memoryQuotaStore(), now: clock.now });
    const client = createKrogerClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace, locationId: KROGER_LOCATION, quota });
    expect(await client.product("0003600029145")).toMatchObject({ ok: false });
    expect(quota.state().left).toBe(0);
    await expect(client.product("0003600029145")).rejects.toSatisfy(isQuotaError);
    expect(sent.filter(({ exchange }) => !isToken(exchange))).toHaveLength(1);
  });

  it("puts no secret and no Basic form of the secret in an error", async () => {
    const { client } = setup((exchange) => new Error(`failed with ${exchange.headers["authorization"] ?? ""}`));
    const error = await failure(client.product("0003600029145"));
    expect(error.message).toBe(`Kroger gave no answer to the token: failed with Basic ${SECRET_MARK}`);
    expect(error.message).not.toContain(basic);
    expect(error.message).not.toContain(CLIENT_SECRET);
  });
});
