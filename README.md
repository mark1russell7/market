# market

A live catalog of products. The catalog has the offers of many sellers, and the price of each offer over time.

The first package, `@mark1russell7/market`, has the records and their checks. [`docs/ROADMAP.md`](docs/ROADMAP.md) has the plan, and [`docs/HAND-CRAWL.md`](docs/HAND-CRAWL.md) has the record of the sellers.

## The model

- A **product** is one thing that a person can buy, with its attributes. The first data set is computer parts.
- An **offer** is one product at one seller, with a price, a condition and its availability.
- A **price reading** is the price of one offer at one time. The readings of an offer give its history and its trend.
- A **source** is the adapter of one seller. It uses the official API of the seller first.
- A source reads a page only where the terms of the seller and its `robots.txt` permit it.

## The packages

The first package exists. The second package is the plan.

| Package | What it has |
| --- | --- |
| [`@mark1russell7/market`](packages/market/README.md) | The records of a product, an offer and a price reading, their checks, and the storage rules of a source. The history of a price and its trend come later. |
| [`@mark1russell7/market-sources`](packages/market-sources/README.md) | One adapter for each seller: the parsers of the answers of eBay, Best Buy and Digi-Key, and the terms of each source. |

Other packages give the general parts:

- `polite-crawler` does each fetch. It obeys `robots.txt`, and it sends one request at a time to a site.
- `@mark1russell7/service` gives the live loops, the backoff and the retries.
- `@mark1russell7/rigor-statistics` gives the statistics of a trend.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint:ste
```

The license is MIT.
