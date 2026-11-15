# @mark1russell7/market

The records of a market: a product, an offer of a seller and a price reading, with their checks. The package also has the GTIN check, the match keys of a record, the cost of an order and the storage rules of a source. The offers of a part and the best offer join the observations of the sources to the parts that a buyer wants. The board keeps the current prices within the terms of each source, and plans the reads of a watch.

```sh
pnpm add @mark1russell7/market
```

The records come from the hand crawl ([`docs/HAND-CRAWL.md`](../../docs/HAND-CRAWL.md)). The fields are the common fields of the official APIs of the sellers.

## The records

Each record has a `zod` schema. A schema refuses an unknown field, an empty text and a text with a space at an end. An adapter of a source gives records in their final form, and the schema examines them.

| Record | Schema | What it has |
| --- | --- | --- |
| Product | `productSchema` | An id of the catalog, a title, a brand, a category path, GTINs, part numbers and specifications as text. |
| Offer | `offerSchema` | One product at one seller: the source, the id at the source, the seller, the condition, the buying format and the identifiers that the source gives. |
| Price reading | `priceReadingSchema` | The state of one offer at one instant: the unit price, the list price, the shipping, the availability, the minimum quantity and the price breaks. |
| Terms of a source | `sourceTermsSchema` | The storage rule of the source, the deletion of ended offers, and the permission of a model of prices. |

- **Money.** An amount of money is a quantity of [`@mark1russell7/quantity`](https://www.npmjs.com/package/@mark1russell7/quantity), for example `{ "value": 64.99, "unit": "USD" }`. A price is zero or more.
- **Instants.** An instant is an ISO 8601 text in UTC, for example `2026-11-12T18:00:00Z`.
- **Ids.** The id of an offer is the name of its source, a colon and the id at the source: `offerId("ebay", "1234")` gives `ebay:1234`. A source name has small letters, digits and hyphens.
- **Conditions.** A source maps its own condition to `new`, `open-box`, `refurbished`, `used`, `for-parts` or `unknown`. The field `grade` keeps the text of the source, for example `excellent`.
- **Shipping.** The shipping is `free`, `fixed` with a cost, `calculated` (it depends on the address) or `unknown`.
- **Price breaks.** `price` is the unit price for an order of `minimumQuantity` units, or of one unit. The quantities of the breaks increase, and each is more than the minimum.
- **Stock.** A count of `available` units agrees with the availability: `out-of-stock` has the count 0, and `in-stock` and `low-stock` have a count of 1 or more.

## The functions

- `parseGtin(text)` gives the GTIN-14 form of a GTIN-8, a UPC-A, an EAN-13 or a GTIN-14, or null. It examines the check digit, and it refuses a GTIN of zeros only.
- `matchKeys({ gtins, partNumbers })` gives the keys of a record. A key is `gtin:` with the GTIN-14, or `part:` with the folded brand and part number. Two records with a key in common name one product.
- `unitPriceFor(reading, count)` gives the unit price for an order of `count` units. `costOf(reading, count)` adds the shipping, or it gives null when the shipping cost is not known. The cost is exact and not rounded.
- `keepUntil(terms, reading)` gives the last instant at which a store keeps a reading, or null with no limit. `isKept(terms, reading, now, ended)` tells if a store keeps it at `now`.
- `permitsHistory(terms)` and `permitsTrend(terms)` tell if the terms of a source permit a stored history and a trend of its prices.

## The offers of a part

An observation is one offer and its price reading at one instant. The parsers of `@mark1russell7/market-sources` give observations.

- `offersPart(offer, want)` tells if an offer is an offer of a part. A want has the names of the maker and the part numbers of the maker. One part number of the offer must have a brand of the want and start with a part number of the want, after the fold.
- `offersOfPart(observations, want)` gives the latest observation of each offer of the part. `latestObservations(observations)` does the same for each offer.
- `bestOffer(observations, { currency, count, conditions })` chooses the offer to buy. It skips an offer with another condition, another currency, or a minimum above the count. Each skipped offer has its reason. The offers go from the lowest price of the goods, then the lowest cost with the shipping. The best offer is the first offer in stock, or else the first offer.

The brand is necessary, because many makers use short part numbers. A search for the number of a power bank found a solder tip and a fan of other makers.

```ts
import { bestOffer, offersOfPart, type PartWant } from "@mark1russell7/market";

const want: PartWant = { brands: ["Acme", "Acme Power Inc."], partNumbers: ["UPS-600X"] };
const chosen = bestOffer(offersOfPart(observations, want), { currency: "USD" });
chosen.best?.goods; // { value: 89.99, unit: "USD" }
chosen.skipped; // [{ offerId: "ebay:1234", why: "The condition used is not a condition that the buyer accepts." }]
```

## The board of current prices

A watch reads its sources on a schedule and keeps the latest price of each offer on a board. The terms of each source limit the board. The functions of the board are calculations with no effect. A host does the reads, and it writes the board.

- `keepObservations(observations, { terms, now, ended })` gives the latest observation of each offer that a store keeps at `now`, and each dropped offer with its reason. The board drops a reading of a source with `no-store` or with no terms. It also drops a reading past its limit, and an ended offer.
- `readInterval(entry, { terms, slack })` gives the time from one read of a watch entry to the next. It is the shorter of `every` and the limit of the terms less the slack of the loop. Thus the board has a current reading of the entry at each instant after its first read.
- `watchProblems(entries, { terms, slack })` gives each entry with no interval, and each name that two entries have. A source with `no-store` has no interval: a program reads it for each request.
- `planReads(entries, last, now, { terms, slack })` gives the due entries at `now`, and the instant of the next due read.
- `boardSchema`, `observationSchema` and `watchEntrySchema` examine a board file, an observation and a watch entry.

Give the board and the new observations together to `keepObservations`. Then write its `kept` list as the new board. To read the board at an instant, give the board alone. A reading can pass its limit after the last change of the board.

```ts
import { bestOffer, keepObservations, offersOfPart, planReads } from "@mark1russell7/market";

const plan = planReads(entries, lastReads, now, { terms, slack: { value: 2, unit: "min" } });
// Read each entry of plan.due, then keep the board within the terms.
const { kept, dropped } = keepObservations([...board.observations, ...read], { terms, now });
const chosen = bestOffer(offersOfPart(kept, want), { currency: "USD" });
```

## Example

```ts
import { costOf, isKept, priceReadingSchema, type SourceTerms } from "@mark1russell7/market";

const reading = priceReadingSchema.parse({
  offerId: "example:sku-1",
  at: "2026-11-12T18:00:00Z",
  price: { value: 0.1, unit: "USD" },
  shipping: { kind: "fixed", cost: { value: 0.2, unit: "USD" } },
  availability: "in-stock",
});
costOf(reading, 3); // { value: 0.5, unit: "USD" }

const terms: SourceTerms = {
  source: "example",
  retention: { kind: "max-age", age: { value: 72, unit: "h" } },
  deleteWhenEnded: false,
  priceModel: false,
  clause: "a cache of 72 hours at most",
};
isKept(terms, reading, "2026-11-16T00:00:00Z"); // false
```

## Limits

- The match keys do not know the aliases of a brand. `Western Digital` and `WD` give two keys. A want of a part names each form of the brand.
- A part number of a want matches each longer part number that starts with it. A want gives the full part number of the maker.
- The money of the quantity package has one currency: the US dollar.
- The package has no history of prices yet. Roadmap item R5 adds it, after the owner chooses its source.
- The board keeps one reading of each offer. A search that does not find an offer again does not end the offer: its reading stays until the limit of its terms.
