# The hand crawl

This file is the record of item R1 of the roadmap. On 2026-11-12, the crawl read the official APIs, the `robots.txt` files and the terms of 22 sellers and aggregators of computer parts. The scope is the US market, new parts and used parts.

The records of R2 and the adapters of R3 come from this file. The crawl made no account, asked for no key, and fetched no page that a `robots.txt` file disallows.

The readings of the terms are plain readings. They are not legal advice.

## The main result

The terms of each official API limit how long a program keeps the data. Some terms also forbid a database of the data, or a model of the prices. The crawl read each clause below on the page of the terms.

| Source | Clause | Where |
| --- | --- | --- |
| eBay Browse API | "Displayed item listing information may not be more than six (6) hours older than information displayed on the eBay Site" | API License Agreement of 2025-09-03, section 8.1(c) |
| eBay Browse API | "When the eBay Content is no longer publicly available, you must delete it from your Application." | the same agreement, section 8.1(b)(1) |
| eBay Browse API | Do not "Use eBay Content, either alone or in combination with third-party information, to suggest or model prices for items listed on eBay Site." | the same agreement, section 9.5 |
| Best Buy Products API | Do not "store or cache any Content except on a temporary basis not to exceed seventy-two (72) hours" | the API terms of 2021-02-23 |
| Best Buy Products API | "You will not use the Services or the Content on behalf of or for the benefit of any third party" to analyze the prices of Best Buy | the same terms |
| Amazon Creators API | "Unless otherwise agreed by Amazon, your Site must not have price tracking and/or price alerting functionality." | Associates Program Policies, Participation Requirements |
| Amazon Creators API | Text other than images stays in a cache "for up to 24 hours" | Associates Program Policies, IP License, section 2(h) |
| Digi-Key Product Information v4 | Do not use the API or its data "to update or create your own database of information" | API User Agreement, section 5.1(e) |
| Shopify catalog | Do not use the results "to build a standing product database or commerce index, without Shopify's or the merchant's consent." The price and the availability stay in a cache "up to 10 minutes." | `shopify.dev/docs/agents/catalog` |

Only Keepa sells a price history, for the offers of Amazon. The crawl did not find the terms of Keepa on reuse.

## What this result changes in the plan

- **Live offers.** The official APIs permit the display of the current offers. Each adapter of R3 obeys the cache limit of its source.
- **The current price of a part.** A build plan needs the price at the time of the plan. A live lookup gives it, inside the limits.
- **A stored history (R5).** A history of the readings of these APIs needs the written consent of each seller. The alternative is a source that sells a history, for example Keepa. The owner decides this point.
- **Page crawls.** Many `robots.txt` files permit product pages. But the terms of eBay, Best Buy and ServerPartDeals forbid automated access to their sites. Thus R3 starts with official APIs only.

## The sellers

| Seller | Official read API | Account | Product pages in `robots.txt` | Terms on automated access | History |
| --- | --- | --- | --- | --- | --- |
| Amazon | Creators API. PA-API 5 is deprecated. | Associates, and 10 sales in 30 days | `/dp/` yes, `/gp/offer-listing/` no | forbidden by the Associates policy | no |
| Best Buy | Products API, Open Box API | developer account | product pages yes, `/pricing/*` and `/availability/*` no | forbidden by the site terms | no, only `priceUpdateDate` |
| Newegg | none for buyers. The Marketplace API is for sellers. | an affiliate feed through Rakuten (not checked) | yes | not read | no |
| Walmart | Affiliate API on `walmart.io` | account and RSA key | `/ip/` yes, `/search` no | not read | no |
| B&H | none found | none | `/c/product/` yes | not read (HTTP 403) | no |
| Micro Center | none found | none | not read (HTTP 403) | not read (HTTP 403) | no |
| CDW | for customers only | customer account | `/product/` yes | not read | no |
| eBay | Browse API | developer account, and production access through the eBay Partner Network | `/itm/<id>` has no rule, `/sch/` no. The header forbids automated access. | forbidden | no |
| ServerMonkey | none found | none | clean product URLs yes | not read (HTTP 403) | no |
| ServerPartDeals | Shopify catalog over MCP | no key, an agent profile | `/products/` yes | forbidden | no |
| TheServerStore | none found | none | yes | not read | no |
| UnixSurplus | none found | none | yes | not read | no |
| Digi-Key | Product Information v4 | an API application of an organization | yes | the API forbids a database | no |
| Mouser | Search API (not checked) | Mouser account | not read (timeout) | not read (timeout) | no |
| Adafruit | Products API, no key | none | `/product/` yes, `/api/` no | the content license is for stores | no |
| PiShop.us | none found | none | yes | no terms page found | no |
| CanaKit | none found | none | yes | no terms page found | no |
| Keepa | Keepa API | paid subscription | partial | not found | yes, Amazon |
| CamelCamelCamel | none | none | `/product/<asin>` yes, `/search` no | forbidden (seen in a copy only) | on the site only |
| PCPartPicker | none | none | yes, with `Crawl-delay: 60` | forbidden (seen in a copy only) | on the site only |
| LabGopher | none | none | no `robots.txt` | no commercial or public use | no |
| rpilocator | an RSS feed | none | no valid `robots.txt`. The site asks for one request in each minute at most. | no commercial use | no |

Adafruit has a conflict: its API page invites use of `/api/`, but its `robots.txt` disallows `/api/`. An adapter waits for the consent of Adafruit.

## The fields of an offer

The table gives the union of the offer fields of the APIs that the crawl read. The names are the names of each API.

| Field | Form | Names in the sources |
| --- | --- | --- |
| Offer id | text | eBay `itemId`, `legacyItemId`. Amazon ASIN with `merchantInfo.id`. Best Buy `sku`. Adafruit `product_id`. Keepa `asin` with `sellerId`. Shopify variant `id`. |
| Title | text | Best Buy `name`. Adafruit `product_name`. Shopify `title`. |
| Current price | money | Amazon `price.money`. Best Buy `salePrice`. eBay `price.value` (a decimal string) with `price.currency`. Digi-Key `UnitPrice`. Adafruit `product_price` (a formatted string). Keepa integer cents, with `-1` for no offer. Shopify `price.amount` with `price.currency`. |
| List price | money | Amazon `savingBasis`. Best Buy `regularPrice`. eBay `marketingPrice.originalPrice`. Keepa `LISTPRICE`. Shopify `list_price`. |
| Price breaks | a list of a quantity and a unit price | Digi-Key `StandardPricing`. Adafruit `discount_pricing`. |
| Shipping cost | money | eBay `shippingOptions.shippingCost`. Best Buy `shippingCost`, `freeShipping`. Keepa shipping arrays. Amazon gives no shipping cost. |
| Condition | a set of values | Amazon `condition.value`. Best Buy `condition`, and Open Box `excellent` or `certified`. eBay `conditionId` (`1000` is new). Keepa codes 0 to 11. Shopify `condition`. |
| Availability | a set of values or a count | Amazon `availability.type`. Best Buy `onlineAvailability`, `orderable`. eBay `estimatedAvailabilities`. Digi-Key `ManufacturerPublicQuantity`. Adafruit `product_stock`. Shopify `availability`. |
| Seller | id, name, rating | Amazon `merchantInfo`. eBay `seller` with `feedbackScore`. Keepa `sellerId`, `isAmazon`. Shopify `seller`. Best Buy sells all its offers. |
| Buying format | a set of values | eBay `buyingOptions` (`AUCTION`, `FIXED_PRICE`), `currentBidPrice`, `itemEndDate`. |
| Times | instants | Best Buy `priceUpdateDate`. eBay `itemCreationDate`, `itemEndDate`. Keepa `lastPriceChange` in Keepa minutes. |
| Specifications | name and value pairs | Best Buy `details`. eBay `localizedAspects`. Amazon `technicalInfo`. |
| Category | a path | Best Buy `categoryPath`. eBay `categoryId`. Digi-Key `Categories`. |
| Link | URL | eBay `itemWebUrl`. Adafruit `product_url`. |

No API gives the specifications of a computer part with typed units. Watts, gigabytes, cores and form factors come from name and value text. An adapter parses them.

A Keepa time converts to Unix milliseconds with `(keepaTime + 21564000) * 60000`.

## The identifiers for a match

- **GTIN** (UPC-A, EAN-13, GTIN-14): Amazon `externalIds`, Best Buy `upc`, eBay `gtin`, Keepa `upcList` and `eanList`. The Shopify catalog gives no GTIN.
- **Part number of the maker, with the brand**: Amazon `manufactureInfo.itemPartNumber`, eBay `mpn` and `brand`, Digi-Key `ManufacturerProductNumber`, Adafruit `product_mpn`, Keepa `partNumber`, Best Buy `modelNumber`.
- **The ids of one source**: the ASIN of Amazon, the `epid` of eBay, the `sku` of Best Buy.
- **Used computers and servers** usually have no GTIN. A match uses the brand and the model, with the processor, the memory and the storage from the specifications.

## The first sources for R3

1. **eBay Browse API.** It is the only official API for used computers and servers. An adapter keeps the current offers only, reads them again inside 6 hours, and deletes each ended listing.
2. **Best Buy Products API with Open Box.** It gives 50,000 requests each day, with `upc`, `modelNumber`, the prices and the condition of new parts.
3. **Digi-Key Product Information v4.** It covers single-board computers and parts for electronics, with clear rate limits. It is for live lookups only.
4. **Keepa API.** It is the only source of a price history. It costs a fee each month, and its terms need a check before a public display.

The crawl does not recommend these sources at this time:

- The Amazon Creators API. It needs 10 sales in 30 days, and the policy forbids price tracking.
- Page crawls of Newegg, Walmart, Best Buy, CDW and ServerPartDeals. Their terms forbid them, or the crawl did not read the terms.
- The Shopify catalog. It forbids a standing database, and its cache limit is 10 minutes.
- CamelCamelCamel, PCPartPicker, LabGopher and rpilocator. They have no API, and their terms forbid commercial reuse.

## The accounts

Each source of R3 needs an account or a key. The owner makes each account.

| Account | For | Cost |
| --- | --- | --- |
| eBay Developers Program, and the eBay Partner Network | Browse API in production | no fee found |
| Best Buy developer account | Products API, Open Box API | no fee found. A note of 2016 refuses free email addresses (seen in a search result only). |
| Digi-Key account and an API application | Product Information v4 | no fee found |
| Keepa subscription | the price history of Amazon | a fee each month |

## Not read yet

- The terms of Micro Center and Mouser, and their `robots.txt` files. The sites refused or timed out.
- The site terms of Amazon, Newegg, Walmart and B&H.
- The terms of Keepa on reuse and display.
