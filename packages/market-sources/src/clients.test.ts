import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createBestBuyClient } from "./bestbuy-client.ts";
import { parseBestBuyOpenBox, parseBestBuyProduct, parseBestBuyProducts } from "./bestbuy.ts";
import { SECRET_MARK, ApiError, instantOf, type Exchange, type Reply } from "./client.ts";
import { createDigiKeyClient, DIGIKEY_PACE_MS } from "./digikey-client.ts";
import { parseDigiKeyKeywordSearch, parseDigiKeyProductDetails } from "./digikey.ts";
import { createEbayClient } from "./ebay-client.ts";
import { parseEbayItem, parseEbaySearch } from "./ebay.ts";
import { failure, fakePace, fakeTransport, reply, type Sent } from "../test/fakes.ts";
import { bestBuyOpenBox, bestBuyProduct, bestBuyProducts, digiKeyDetails, digiKeyKeyword, ebayItem, ebaySearch } from "../test/fixtures.ts";

const CLIENT_ID = "client-id-0001";
const CLIENT_SECRET = "client-secret-0001";
const API_KEY = "apikey00001";

function token(name: string, expiresIn = 599): Reply {
  return reply(200, { access_token: name, expires_in: expiresIn, token_type: "Bearer" });
}

function isToken(exchange: Exchange): boolean {
  return exchange.url.endsWith("/oauth2/token");
}

/** This function gives each message and each URL that a client made, so a test can look for a secret. */
function texts(sent: readonly Sent[], errors: readonly Error[]): string {
  return [...sent.map(({ exchange }) => exchange.url), ...errors.map((error) => error.message)].join("\n");
}

describe("the Digi-Key client", () => {
  function setup(handler: (exchange: Exchange, index: number) => Reply | Error, sandbox = false) {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, handler);
    const client = createDigiKeyClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, transport, pace, sandbox });
    return { client, sent, clock };
  }

  it("gets a token with the client credentials, then reads ProductDetails with the token, the id and the locale", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, digiKeyDetails)));
    const result = await client.productDetails(" P5555-ND ");
    expect(result).toEqual(parseDigiKeyProductDetails(digiKeyDetails, instantOf(clock.now())));
    expect(result.ok).toBe(true);
    const [grant, read] = sent.map(({ exchange }) => exchange);
    expect(grant).toEqual({
      method: "POST",
      url: "https://api.digikey.com/v1/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    });
    expect(read).toEqual({
      method: "GET",
      url: "https://api.digikey.com/products/v4/search/P5555-ND/productdetails",
      headers: {
        accept: "application/json",
        authorization: "Bearer token-0001",
        "x-digikey-client-id": CLIENT_ID,
        "x-digikey-locale-site": "US",
        "x-digikey-locale-language": "en",
        "x-digikey-locale-currency": "USD",
      },
      body: null,
    });
  });

  it("keeps one token for many reads, at the pace of 500 ms", async () => {
    const { client, sent } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, digiKeyDetails)));
    await client.productDetails("P5555-ND");
    await client.productDetails("P5555-ND");
    expect(sent.filter(({ exchange }) => isToken(exchange))).toHaveLength(1);
    const times = sent.map(({ at }) => at);
    expect(times.slice(1).map((at, index) => at - times[index]!)).toEqual([DIGIKEY_PACE_MS, DIGIKEY_PACE_MS]);
  });

  it("asks for a new token after the end of the token", async () => {
    let grants = 0;
    const { client, sent, clock } = setup((exchange) => {
      if (!isToken(exchange)) return reply(200, digiKeyDetails);
      grants += 1;
      return token(`token-000${grants}`, 120);
    });
    await client.productDetails("P5555-ND");
    await clock.sleep(61_000);
    await client.productDetails("P5555-ND");
    expect(grants).toBe(2);
    expect(sent.at(-1)!.exchange.headers["authorization"]).toBe("Bearer token-0002");
  });

  it("encodes a product number in the path, and uses the sandbox host", async () => {
    const { client, sent } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, digiKeyDetails)), true);
    await client.productDetails("296-1395-5/ND?x");
    expect(sent.map(({ exchange }) => exchange.url)).toEqual([
      "https://sandbox-api.digikey.com/v1/oauth2/token",
      "https://sandbox-api.digikey.com/products/v4/search/296-1395-5%2FND%3Fx/productdetails",
    ]);
  });

  it("posts a KeywordSearch with the keywords and the limit", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001") : reply(200, digiKeyKeyword)));
    const result = await client.keywordSearch("tantalum 10uF", 25);
    expect(result).toEqual(parseDigiKeyKeywordSearch(digiKeyKeyword, instantOf(clock.now())));
    const search = sent[1]!.exchange;
    expect(search.method).toBe("POST");
    expect(search.url).toBe("https://api.digikey.com/products/v4/search/keyword");
    expect(search.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(search.body!)).toEqual({ Keywords: "tantalum 10uF", Limit: 25, Offset: 0 });
  });

  it("refuses a limit out of 1 to 50 and an empty product number, before a request", async () => {
    const { client, sent } = setup(() => reply(200, {}));
    await expect(client.keywordSearch("ssd", 51)).rejects.toThrow(RangeError);
    await expect(client.keywordSearch("ssd", 0)).rejects.toThrow(RangeError);
    await expect(client.productDetails("  ")).rejects.toThrow(RangeError);
    expect(sent).toHaveLength(0);
  });

  it("gets a new token after a 401, and reads again", async () => {
    let grants = 0;
    let reads = 0;
    const { client } = setup((exchange) => {
      if (isToken(exchange)) {
        grants += 1;
        return token(`token-000${grants}`);
      }
      reads += 1;
      return reads === 1 ? reply(401, {}, {}, "Unauthorized") : reply(200, digiKeyDetails);
    });
    expect((await client.productDetails("P5555-ND")).ok).toBe(true);
    expect(grants).toBe(2);
  });

  it("gives a problem for a 404, with the status and no part of the body", async () => {
    const { client } = setup((exchange) =>
      isToken(exchange) ? token("token-0001") : reply(404, { detail: CLIENT_SECRET }, {}, "Not Found"),
    );
    expect(await client.productDetails("NOPE-ND")).toEqual({
      ok: false,
      problems: ["Digi-Key answered 404 Not Found to ProductDetails of NOPE-ND."],
    });
  });

  it("puts no secret in an error of the token or of the transport", async () => {
    const errors: Error[] = [];
    const refused = setup(() => reply(401, { error: CLIENT_SECRET }, {}, "Unauthorized"));
    errors.push(await failure(refused.client.productDetails("P5555-ND")));
    expect(errors[0]).toBeInstanceOf(ApiError);
    expect(errors[0]!.message).toBe("Digi-Key refused the token: 401 Unauthorized.");
    const broken = setup((exchange) => new Error(`socket closed after ${exchange.body ?? ""}`));
    errors.push(await failure(broken.client.productDetails("P5555-ND")));
    expect(errors[1]!.message).toContain(`client_secret=${SECRET_MARK}`);
    expect(texts([], errors)).not.toContain(CLIENT_SECRET);
    expect(texts([], errors)).not.toContain(CLIENT_ID);
  });

  it("refuses a client id or a secret that is not a key, and the message does not show it", () => {
    const { pace } = fakePace();
    const transport = async (): Promise<Reply> => reply(200, {});
    expect(() => createDigiKeyClient({ clientId: "bad id", clientSecret: CLIENT_SECRET, transport, pace })).toThrow(
      "The field clientId is not a key",
    );
    expect(() => createDigiKeyClient({ clientId: CLIENT_ID, clientSecret: "short", transport, pace })).toThrow(
      "The field clientSecret is not a key",
    );
  });
});

describe("the eBay client", () => {
  const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
  const basic = base64(`${CLIENT_ID}:${CLIENT_SECRET}`);

  function setup(handler: (exchange: Exchange, index: number) => Reply | Error) {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, handler);
    const client = createEbayClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace });
    return { client, sent, clock };
  }

  it("gets an application token with Basic, then reads getItem with the token and the marketplace", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001", 7200) : reply(200, ebayItem)));
    const result = await client.item("v1|110000000001|0");
    expect(result).toEqual(parseEbayItem(ebayItem, instantOf(clock.now())));
    const [grant, read] = sent.map(({ exchange }) => exchange);
    expect(grant).toEqual({
      method: "POST",
      url: "https://api.ebay.com/identity/v1/oauth2/token",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });
    expect(read).toEqual({
      method: "GET",
      url: "https://api.ebay.com/buy/browse/v1/item/v1%7C110000000001%7C0",
      headers: { accept: "application/json", authorization: "Bearer token-0001", "x-ebay-c-marketplace-id": "EBAY_US" },
      body: null,
    });
  });

  it("reads one page of a search with the words and the limit, 1 s after the token", async () => {
    const { client, sent, clock } = setup((exchange) => (isToken(exchange) ? token("token-0001", 7200) : reply(200, ebaySearch)));
    const result = await client.search("ddr4 ecc 32gb", 100);
    expect(result).toEqual(parseEbaySearch(ebaySearch, instantOf(clock.now())));
    expect(sent[1]!.exchange.url).toBe("https://api.ebay.com/buy/browse/v1/item_summary/search?q=ddr4%20ecc%2032gb&limit=100");
    expect(sent[1]!.at - sent[0]!.at).toBe(1000);
  });

  it("refuses an item id that is not RESTful, a limit out of 1 to 200 and a bad marketplace", async () => {
    const { client, sent } = setup(() => reply(200, {}));
    await expect(client.item("110000000001")).rejects.toThrow("is not a RESTful item id");
    await expect(client.search("ssd", 201)).rejects.toThrow(RangeError);
    expect(sent).toHaveLength(0);
    const { pace } = fakePace();
    const transport = async (): Promise<Reply> => reply(200, {});
    expect(() =>
      createEbayClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, base64, transport, pace, marketplace: "US" }),
    ).toThrow(RangeError);
  });

  it("puts no secret and no Basic form of the secret in an error", async () => {
    const { client } = setup((exchange) => new Error(`failed with ${exchange.headers["authorization"] ?? ""}`));
    const error = await failure(client.item("v1|110000000001|0"));
    expect(error.message).toBe(`eBay gave no answer to the token: failed with Basic ${SECRET_MARK}`);
    expect(error.message).not.toContain(basic);
  });
});

describe("the Best Buy client", () => {
  function setup(handler: (exchange: Exchange, index: number) => Reply | Error) {
    const { pace, clock } = fakePace();
    const { transport, sent } = fakeTransport(clock, handler);
    const client = createBestBuyClient({ apiKey: API_KEY, transport, pace });
    return { client, sent, clock };
  }

  it("reads a product with the key in the query, and no token", async () => {
    const { client, sent, clock } = setup(() => reply(200, bestBuyProduct));
    const result = await client.product("6534613");
    expect(result).toEqual(parseBestBuyProduct(bestBuyProduct, instantOf(clock.now())));
    expect(sent.map(({ exchange }) => exchange)).toEqual([
      { method: "GET", url: `https://api.bestbuy.com/v1/products/6534613.json?apiKey=${API_KEY}`, headers: { accept: "application/json" }, body: null },
    ]);
  });

  it("reads a search with one search term for each word, and the open-box offers, 1 s apart", async () => {
    const { client, sent, clock } = setup((exchange) => reply(200, exchange.url.includes("openBox") ? bestBuyOpenBox : bestBuyProducts));
    expect(await client.search("nvme  2TB", 20)).toEqual(parseBestBuyProducts(bestBuyProducts, instantOf(clock.now())));
    expect(await client.openBox("6534613")).toEqual(parseBestBuyOpenBox(bestBuyOpenBox, instantOf(clock.now())));
    expect(sent.map(({ exchange }) => exchange.url)).toEqual([
      `https://api.bestbuy.com/v1/products(search=nvme&search=2TB)?format=json&pageSize=20&apiKey=${API_KEY}`,
      `https://api.bestbuy.com/beta/products/6534613/openBox?apiKey=${API_KEY}`,
    ]);
    expect(sent[1]!.at - sent[0]!.at).toBe(1000);
  });

  it("refuses a SKU that is not digits, and words with a sign of the query, before a request", async () => {
    const { client, sent } = setup(() => reply(200, {}));
    await expect(client.product("65346A")).rejects.toThrow("is not a number of 1 to 12 digits");
    await expect(client.search("ssd&apiKey=x")).rejects.toThrow(RangeError);
    await expect(client.search("a)b")).rejects.toThrow(RangeError);
    await expect(client.search("ssd", 101)).rejects.toThrow(RangeError);
    expect(sent).toHaveLength(0);
  });

  it("stops the host after a 403 for 1 hour, and no message has the key", async () => {
    const { client, sent } = setup(() => reply(403, { message: API_KEY }, {}, "Forbidden"));
    expect(await client.product("6534613")).toEqual({
      ok: false,
      problems: ["Best Buy answered 403 Forbidden to the product 6534613."],
    });
    const error = await failure(client.product("6534613"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("The client of Best Buy did not send the product 6534613: api.bestbuy.com stopped: blocked");
    expect(sent).toHaveLength(1);
    expect(error.message).not.toContain(API_KEY);
  });

  it("puts the mark in the place of the key of a URL in an error of the transport", async () => {
    const { client } = setup((exchange) => new Error(`fetch failed: ${exchange.url}`));
    const error = await failure(client.product("6534613"));
    expect(error.message).toBe(
      `Best Buy gave no answer to the product 6534613: fetch failed: https://api.bestbuy.com/v1/products/6534613.json?apiKey=${SECRET_MARK}`,
    );
  });
});
