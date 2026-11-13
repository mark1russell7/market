# @mark1russell7/market-sources

The adapters of the sellers of a market. Each parser reads the answer of an official API at one instant. It gives the current offers and their price readings as records of [`@mark1russell7/market`](../market/README.md).

A parser is a pure function. It sends no request, it keeps no store, and it reads no key. The clients of the APIs come in a later step (R3 of [`docs/ROADMAP.md`](../../docs/ROADMAP.md)).

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

Each parser takes the JSON of the answer and the instant `at` of the answer. It gives one of two results:

- `{ ok: true, observations, notes }`. The answer has the documented shape. Each observation is an offer and its reading, and the schemas of `@mark1russell7/market` accept both. Each note tells why the parser skipped a record or a field.
- `{ ok: false, problems }`. The answer does not have the documented shape, for example the error body of an API.

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

## The terms of each source

Each source has its terms as a `SourceTerms` record of `@mark1russell7/market`, from the hand crawl ([`docs/HAND-CRAWL.md`](../../docs/HAND-CRAWL.md)). A store examines a reading with `isKept` before it keeps or shows the reading.

| Source | Terms | Retention | Ended offers | Model of prices |
| --- | --- | --- | --- | --- |
| `ebay` | `EBAY_TERMS` | 6 hours | deleted | no |
| `bestbuy` | `BEST_BUY_TERMS` | 72 hours | kept until the limit | no |
| `digikey` | `DIGIKEY_TERMS` | no store | not applicable | no |

`SOURCE_TERMS` has the three records.

## Tests

- Each parser has a test of the documented answer of its API, and tests of each rule above.
- Property tests with `fast-check` mutate each documented answer: they delete fields, and put edge values and random JSON in their place. Each result has only valid records, and each reading belongs to its offer.
- A property test gives each parser random JSON values. No parser throws.
