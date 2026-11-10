# market

A live catalog of products. The catalog has the offers of many sellers, and the price of each offer over time.

This repository is new. Its first package is not written yet. [`docs/ROADMAP.md`](docs/ROADMAP.md) has the plan.

## The model

- A **product** is one thing that a person can buy, with its attributes. The first data set is computer parts.
- An **offer** is one product at one seller, with a price, a condition and its availability.
- A **price reading** is the price of one offer at one time. The readings of an offer give its history and its trend.
- A **source** is the adapter of one seller. It uses the official API of the seller first.
- A source reads a page only where the terms of the seller and its `robots.txt` permit it.

## The packages

These packages are the plan. They do not exist yet.

| Package | What it has |
| --- | --- |
| `@mark1russell7/market` | The records of a product, an offer and a price reading, their checks, the history of a price and its trend. |
| `@mark1russell7/market-sources` | One adapter for each seller. |

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
