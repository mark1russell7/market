# @mark1russell7/market-sources

The adapters of the sellers of a market and of the price APIs of clouds. Each parser reads the answer of an official API at one instant. It gives the current offers and their price readings as records of [`@mark1russell7/market`](../market/README.md). The parsers of a cloud give metered offers and their metered readings.

```sh
pnpm add @mark1russell7/market-sources
```

A parser is a pure function. It sends no request, it keeps no store, and it reads no key.

A client sends the requests of one API, and gives the result of a parser. Its host gives the transport, the keys and the clock. The scheduler of [`polite-crawler`](https://www.npmjs.com/package/polite-crawler) keeps the pace of each host.

## Usage

```ts
import { parseEbayItem, EBAY_TERMS } from "@mark1russell7/market-sources";
import { isKept } from "@mark1russell7/market";

const at = new Date().toISOString();
const result = parseEbayItem(await answer.json(), at);
if (!result.ok) throw new Error(result.problems.join(" "));
for (const { offer, reading } of result.observations) {
  console.log(offer.title, reading.price, isKept(EBAY_TERMS, reading, at));
}
for (const note of result.notes) console.warn(note);
```

## The parsers

| Parser | The answer that it reads |
| --- | --- |
| `parseEbayItem` | `getItem` of the eBay Browse API: `GET /buy/browse/v1/item/{item_id}` |
| `parseEbaySearch` | `search` of the eBay Browse API: `GET /buy/browse/v1/item_summary/search` |
| `parseBestBuyProduct` | one product of the Best Buy Products API: `GET /v1/products/{sku}.json` |
| `parseBestBuyProducts` | a search of the Best Buy Products API: `GET /v1/products(...)?format=json` |
| `parseBestBuyOpenBox` | the Best Buy Open Box API: `GET /beta/products/{sku}/openBox` |
| `parseDigiKeyProductDetails` | `ProductDetails` of the Digi-Key Product Information API v4 |
| `parseDigiKeyKeywordSearch` | `KeywordSearch` of the Digi-Key Product Information API v4 |
| `parseAzureRetailPrices` | one page of the Azure Retail Prices API: `GET /api/retail/prices` |
| `parseAzureRetailPricePages` | all the pages of one read of the Azure Retail Prices API |
| `parsePlanLists` | all the pages of the plan list of a provider record, for example `GET /v2/plans` of the Vultr API |

Each parser takes the JSON of the answer and the instant `at` of the answer. It gives one of two results:

- `{ ok: true, observations, notes }`. The answer has the documented shape. Each observation is an offer and its reading, and the schemas of `@mark1russell7/market` accept both. Each note tells why the parser skipped a record or a field.
- `{ ok: false, problems }`. The answer does not have the documented shape, for example the error body of an API.

The Azure parsers and the plan parser give metered observations of `@mark1russell7/market`, and `next`. The field `next` is the link of the next page, or `null`.

A parser throws a `RangeError` only when `at` is not an ISO 8601 instant in UTC. It does not throw on the answer, for any JSON value.

## The rules of the parsers

- **Money.** A price is an exact decimal. A text, for example `"129.99"`, must have digits, and a point and digits as an option. The parser refuses an exponent, a sign and a space. The currency must be a money unit of [`@mark1russell7/quantity`](https://www.npmjs.com/package/@mark1russell7/quantity). At this time, that unit is `USD` only.
- **Absent values.** The parsers accept `null`, an empty text and a missing key as an absent value.
- **List prices.** A reading has a list price only when the list price is more than the price, in the same currency.
- **Repeated offers.** An offer that an answer repeats counts once.
- **The records are final.** Each observation goes through `offerSchema` and `priceReadingSchema`. A record that a schema refuses becomes a note, and the parser skips it.

### eBay

| Field | Rule |
| --- | --- |
| Format | With `FIXED_PRICE` in `buyingOptions`, the offer is `fixed-price`, because a buyer can pay the price at once. With `AUCTION` only, the offer is an `auction`, and its price is `currentBidPrice`. With no buying options, the offer is `fixed-price`, the default of search. Other options give a note. |
| Condition | The condition id of eBay maps to a condition, for example `3000` gives `used`. The text of eBay is the `grade`. |
| Shipping | The cheapest `FIXED` option. A cost of 0 is `free`. With no fixed option, a `CALCULATED` option gives `calculated`. Else the shipping is `unknown`. |
| Stock | `IN_STOCK`, `LIMITED_STOCK` and `OUT_OF_STOCK` give `in-stock`, `low-stock` and `out-of-stock`. The count is the estimated quantity, but not with the threshold `MORE_THAN`. A count that does not agree with the status gives a note. |
| Ended listings | A listing that ended at or before `at` gives a note, and no observation. The terms delete it. |
| Identifiers | A valid GTIN, the brand and the MPN. The placeholder `Does not apply` gives no identifier. |

A search answer has no GTIN, no part number, no aspects and no stock. A `getItem` call gives them.

### Best Buy

| Field | Rule |
| --- | --- |
| Price | `salePrice`. The list price is `regularPrice` when it is more. The field `onSale` is not used, because it can be `true` with equal prices. |
| Shipping | `freeShipping` gives `free`. A `shippingCost` above 0, as a number or a text, gives `fixed`. Else the shipping is `unknown`. |
| Stock | `onlineAvailability: false` or `active: false` gives `out-of-stock`. `orderable: "Available"` gives `in-stock`. Other values give `unknown`. |
| Open box | Each open-box offer of a SKU is its own offer, with the source id `{sku}/open-box/{listingId}`, the condition `open-box` and the grade of Best Buy. |

The US APIs of Best Buy give each price in US dollars.

### Digi-Key

| Field | Rule |
| --- | --- |
| Offers | Each variation of a product (a package type) is one offer. Its source id is the Digi-Key product number. |
| Seller | `Digi-Key`, or the supplier of a marketplace variation. |
| Price breaks | The minimum is the larger of `MinimumOrderQuantity` and the lowest break. The price is the price of the largest break at or below the minimum. The breaks above the minimum are the `priceBreaks` of the reading. |
| Stock | `QuantityAvailableforPackageType`: above 0 gives `in-stock`, and 0 gives `out-of-stock`. |
| Currency | The currency is `SearchLocaleUsed.Currency`. An answer with no currency gives a problem. |

The API has no GTIN and no shipping cost. The shipping of a reading is `unknown`.

### Azure

The Azure Retail Prices API gives the public retail prices of Azure. It needs no key. Each observation goes through `meteredObservationSchema`.

| Field | Rule |
| --- | --- |
| Offers | Each SKU in a region on a term is one offer, with the source id `{armRegionName}/{skuId}/{term}`. Each meter of the SKU is a meter of the offer. |
| Terms | A `Consumption` row gives `on-demand`, or `spot` when its SKU name ends in `Spot` or `Low Priority`. Each entry of `savingsPlan` gives a `committed` offer at its rate. |
| Reservations | A `Reservation` row gives a `committed` offer. Its price is the total for the term. Thus it is the `upfront` money of the reading, and the rate is 0. |
| Dev/Test | A `DevTestConsumption` row gives its own offer, with `Dev/Test` in its title. |
| Units | The unit of measure gives a unit of `@mark1russell7/quantity`. `1 Hour` gives `h`, `1 GB/Month` gives `GiB·mo` and `10K` gives 10,000 `{count}`. |
| Unit prices | The price of a unit is the price of the row over its count, with exact rationals. |
| Data | A GB of Azure is 2^30 bytes, from the pricing pages of Blob Storage. Thus `GB`, `MB` and `TB` give `GiB`, `MiB` and `TiB`. |
| Tiers | `tierMinimumUnits` is the start of a tier, in the unit of its meter. A free first amount stays a tier at the price 0. |
| Period | Each reading has the period of 1 month. |
| Specs | `serviceName`, `serviceFamily`, `productName`, `skuName`, `armSkuName` and `location`, and `pricing`: the key of the term, for example `savings-plan-3y`. |
| Pages | A page has 1,000 rows at most. The tiers of a meter can continue on the next page. Thus `parseAzureRetailPricePages` reads the pages of one read together. |

These rows give a note, and the parser skips them:

- A meter whose tiers start above 0 in a unit of more than 1 count. The documentation does not tell the unit of the start.
- A meter with no tier at 0, or with two prices for one tier.
- A unit of measure that the parser does not know, for example `1 PB`. The unit `PiB` is not in `@mark1russell7/quantity`.

A reservation and a savings plan cover a fixed amount of use. The metered model has no limit of coverage. Thus give the usage of a committed offer only for the covered hours.

### Plan lists

A plan list is an API that gives each plan of virtual machines with its prices and its regions. A `PlanProvider` record tells where the API keeps each value. Each value is at a path of names with dots, for example `price.hourly`. Thus a new provider is a record of data, and not new code. `parsePlanProvider` examines a record, for example a record from a JSON file.

| Record | API | Regions | Prices of a region | Terms |
| --- | --- | --- | --- | --- |
| `VULTR_PLANS` | `GET /v2/plans` of the Vultr API v2 | the list `locations` of each plan | the object `location_cost` | `on-demand` when `deploy_ondemand` is true, `spot` when `deploy_preemptible` is true |
| `LINODE_PLANS` | `GET /v4/linode/types` of the Linode API v4 of Akamai Cloud | the rows of `GET /v4/regions/availability` with `available: true` | the list `region_prices` | `on-demand` |

| Field | Rule |
| --- | --- |
| Offers | Each plan in each available region on each term is one offer, with the source id `{plan}/{region}/{term}`. A plan with no available region gives a note. |
| Meter | The meter `compute` counts the hours of use in 1 month. Its first tier is the hourly price. A tier at the price 0 starts at the monthly price over the hourly price. |
| Cost | Thus the cost of a month is the smaller of the hourly cost and the monthly price. A plan with no monthly price has only the hourly tier. A plan with an hourly price of 0 and a monthly price above 0 has no offer, and a note tells why. A monthly price of 0 above an hourly price gives no cap, with a note. |
| Prices of a region | The price of a region replaces the price of the plan. A field that the price of a region does not have comes from the plan. |
| Specs | Each spec of the record, with its unit, for example `memory` with the value `1024 MiB`. The spec `pricing` has the key of the term. |
| Availability | The rows of the list of regions with no plan, no region or no `available` of true or false count in one note. The pairs that are not available count in one note. |
| Transfer | The included transfer is a spec. The plan lists do not give the price of the transfer above it. Thus an offer has no meter of transfer. |

`parsePlanLists(provider, { plans, regions }, at)` takes the pages of the plan list. A record with regions of the kind `list` also needs the pages of that list. The field `next` of the result is always `null`, because the client reads each page before the parse.

## The clients

| Client | Methods | Pace | Access |
| --- | --- | --- | --- |
| `createDigiKeyClient` | `productDetails(productNumber)`, `keywordSearch(keywords, limit)` | 500 ms | OAuth 2.0 client credentials, the client id in a header |
| `createEbayClient` | `item(itemId)`, `search(words, limit)` | 1 s | OAuth 2.0 client credentials with Basic, the scope `api_scope` |
| `createBestBuyClient` | `product(sku)`, `search(words, pageSize)`, `openBox(sku)` | 1 s | the API key in the query |
| `createAzureClient` | `prices(filter, { pages, currency })`, `more(next, pages)` | 6 s | no key |
| `createPlanClient` | `plans(provider, { pages })` | the pace of the record, 2 s for each record of the package | no key |

```ts
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { createDigiKeyClient, type Transport } from "@mark1russell7/market-sources";

const transport: Transport<AbortSignal> = async (exchange, signal) => {
  const answer = await fetch(exchange.url, { ...exchange, redirect: "manual", signal });
  return { status: answer.status, statusText: answer.statusText, headers: Object.fromEntries(answer.headers), body: await answer.text() };
};
const pace = { scheduler: new HostScheduler(realClock, 4), now: realClock.now };
const digiKey = createDigiKeyClient({ clientId, clientSecret, transport, pace });
const result = await digiKey.productDetails("P5555-ND");
```

The package uses no type of a platform. Thus the host gives each port:

- **The transport** sends one exchange: a method, a URL, headers with lowercase names, and a body. It gives the status, the headers and the body of the answer. It does not follow a redirect.
- **The pace** is a `HostScheduler` of `polite-crawler` and its clock. Give one pace to the clients of one process, thus each host keeps one pace.
- **The eBay client** also takes a `base64` function for the Basic header.

### The rules of the clients

- **Pace.** Before each request, the scheduler waits the rest of its host. After each answer, the host rests for the pace of the table, or for a longer `Retry-After`.
- **Answers to wait.** A 429, 502, 503 or 504 parks the host for its `Retry-After`, or for a backoff with jitter. A `Retry-After` above 1 hour stops the host.
- **Stops.** A 401 or a 403 stops the host for 1 hour. A 402 and a bot challenge stop it for 24 hours. A request to a stopped host throws an `ApiError` of `polite-crawler/api`.
- **Failures.** An error 5xx and a request with no answer are failures. After 5 failures in sequence, the host stops for 1 hour.
- **Tokens.** A client keeps its token until 1 minute before its end. After a 401, it gets a new token and sends the request one more time.
- **Answers.** An answer that is not a 2xx gives `{ ok: false, problems }` with its status line. The problem has no part of the body.
- **Secrets.** No message of a client has a key, a secret or a token. The text `[secret]` is in the place of each one, also in its URL form, its form-body form and its Basic form. `redact` uses `redactSecrets` of `@mark1russell7/text`.
- **Inputs.** A client refuses a bad key, a bad product number, a bad SKU and a limit out of range with a `RangeError`, before a request.
- **Pages.** The Azure client follows the link of the next page only to the same API, up to 10 pages. An empty filter is a `RangeError`, because a read of all the prices is a large crawl.
- **Plan lists.** The plan client makes each address from the record. An answer gives only the number or the cursor of the next page. A list with more pages than the limit gives a problem, because a part of a list gives wrong regions. The limit is 20 pages. A cursor that comes again also gives a problem.
- **Paging faults.** A page whose paging field is missing or of a wrong type gives a problem too, not the end of the list. A cursor of empty text or null is the end. A cursor goes back with no change.
- **Pace of Azure.** Each answer of Azure tells the requests that remain in a window of 60 seconds, from 10. Thus the client sends 1 request in 6 seconds at most.

The clients send each request with `send` of `polite-crawler/api`. It has the scheduler, the classifier and the reaction of the crawler to an answer, with no page store. The entry also gives the token store and the grant. The clients do not use the `Crawler`. The crawler keeps a copy of each page, and the terms of Digi-Key permit no store. The crawler also sends only `GET`, and a token request is a `POST`.

## The terms of each source

Each source has its terms as a `SourceTerms` record of `@mark1russell7/market`, from the hand crawl ([`docs/HAND-CRAWL.md`](../../docs/HAND-CRAWL.md)). A store examines a reading with `isKept` before it keeps or shows the reading.

| Source | Terms | Retention | Ended offers | Model of prices |
| --- | --- | --- | --- | --- |
| `ebay` | `EBAY_TERMS` | 6 hours | deleted | no |
| `bestbuy` | `BEST_BUY_TERMS` | 72 hours | kept until the limit | no |
| `digikey` | `DIGIKEY_TERMS` | no store | not applicable | no |
| `azure` | `AZURE_TERMS` | no limit | kept | yes |
| `linode` | `LINODE_TERMS` | no store | not applicable | no |
| `vultr` | `VULTR_TERMS` | no store | not applicable | no |

`SOURCE_TERMS` has the six records.

The terms pages of Vultr and of Akamai refused an automated read on 2026-11-18. Thus `LINODE_TERMS` and `VULTR_TERMS` have the strictest rules: no store and no model of prices. A person reads the terms before a rule changes. The Linode API reference tells that the reads of the plan list need no permissions.

The Microsoft APIs Terms of Use permit copies of the Azure prices only as the application needs them. They forbid the redistribution and the resale of the data.

## Tests

- Each parser has a test of the documented answer of its API, and tests of each rule above.
- The Azure parser has a test of a page of 18 real public rows, read on 2026-11-18. Each row has only the fields that the parser reads. The tests also find the cost of each offer with `meteredCost`.
- Property tests with `fast-check` mutate each documented answer: they delete fields, and put edge values and random JSON in their place. Each result has only valid records, and each reading belongs to its offer.
- A property test gives each parser random JSON values. No parser throws.
- The plan parser has tests of plans from public answers of Vultr and Linode, read on 2026-11-18. Property tests mutate each answer. A property test holds the cost of each offer: the smaller of the hourly cost and the monthly price.
- The tests of the clients use a fake transport and a real scheduler of `polite-crawler` on a fake clock. They hold each rule of the clients: the pace, the waits, the stops, the tokens and the secrets. `polite-crawler/api` has the tests of the send and of the token store.
- A property test puts a random secret in random texts. No text that `redact` gives has the secret.
