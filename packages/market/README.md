# @mark1russell7/market

The records of a market: a product, an offer of a seller and a price reading, with their checks. The package also has the GTIN check, the match keys of a record, the cost of an order and the storage rules of a source. The offers of a part and the best offer join the observations of the sources to the parts that a buyer wants. The board keeps the current prices within the terms of each source, and plans the reads of a watch. A buy plan gives the best baskets of the parts that a need names.

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

A watch reads its sources on a schedule. A board keeps the last read of each entry of the watch, and the terms of each source limit it. The functions of the board are calculations with no effect. A host does the reads, and it writes the board.

- `settleBoard(board, { terms, now, names }, read)` gives the new board. A new read replaces the last read of its entry, so an offer that the new read does not give leaves the board. Then the terms apply to each read. The board also drops the read of an entry that the watch does not have.
- `boardObservations(board, { terms, now })` gives the current observations of a board: the latest observation of each offer over the reads, within the terms.
- `keepObservations(observations, { terms, now, ended })` gives the latest observation of each offer that a store keeps at `now`, and each dropped offer with its reason. The board drops a reading of a source with `no-store` or with no terms. It also drops a reading past its limit, and an ended offer.
- `readInterval(entry, { terms, slack })` gives the time from one read of a watch entry to the next. It is the shorter of `every` and the limit of the terms less the slack of the loop. Thus the board has a current reading of the entry at each instant after its first read.
- `watchProblems(entries, { terms, slack })` gives each entry with no interval, and each name that two entries have. A source with `no-store` has no interval: a program reads it for each request.
- `planReads(entries, last, now, { terms, slack })` gives the due entries at `now`, and the instant of the next due read. `lastReads(board)` gives `last`. Its `queue` puts the entry that is due for the longest time first. Read the entries in that order.
- `boardSchema`, `boardReadSchema`, `observationSchema` and `watchEntrySchema` examine a board file, a read, an observation and a watch entry.

Settle the board after each read, and also when no read is due: a reading can pass its limit between two reads. Write each new board in place of the old board.

```ts
import { bestOffer, boardObservations, lastReads, offersOfPart, planReads, settleBoard } from "@mark1russell7/market";

const plan = planReads(entries, lastReads(board), now, { terms, slack: { value: 2, unit: "min" } });
// Read each entry of plan.due. Then settle the board with each read, and write the board.
board = settleBoard(board, { terms, now, names }, { name: "ups", at: now, observations }).board;
const chosen = bestOffer(offersOfPart(boardObservations(board, { terms, now }), want), { currency: "USD" });
```

## A buy plan

The entry `@mark1russell7/market/plan` chooses the parts of a purchase. A need names the slots of a basket and the parts that can fill each slot. Each part has facts, for example its watts. Vex programs over a basket give its measures and its rules. The plan searches the baskets with `@mark1russell7/strategy-search`. It gives the Pareto front of the price against the measures.

- `planBuys(need, observations, { evaluations, seed, population })` gives the plan. Each item of a basket is the offer in stock with the lowest cost for its part and its count.
- **The search.** A space with no more baskets than `evaluations` gets a grid of each basket. A larger space gets a genetic search. The seed of the search is `seed`, or else the id of the need.
- `needProblems(need)` gives the problems of a need. Examples are two slots with one name, a bad count, and a program that is not valid. `buyNeedSchema` examines the form of a need file.
- **The records of a basket.** A program evaluates at the key `need`, which has the inputs of the need. The key of each slot has the facts of its part, `slot`, `part`, `count` and `cost`. An empty slot has the count 0. The axis `others` gives the slots.
- **The breaks.** A basket breaks `price:<slot>` with no usable offer at its count. It breaks `measure:<name>` when a measure gives no number, and `limit:<name>` outside the limits of a measure. It breaks `rule:<name>` when a rule does not give `true`. The plan counts the baskets of each break, with the reason of the first basket.
- **The parts with no offer.** `unpriced` names each part with no usable offer at a count of its slot. A slot with a minimum of 1 or more and no such part gives the method `none` and an empty front.

```ts
import { app, axes, each, lit, ref } from "@mark1russell7/vex";
import { NEED_FORMAT, planBuys, type BuyNeed } from "@mark1russell7/market/plan";

const part = (key: string, wattHours: number, outputWatts: number) => ({ key, want: { brands: ["Acme"], partNumbers: [key] }, facts: { wattHours, outputWatts } });
const need: BuyNeed = {
  format: NEED_FORMAT,
  id: "closet-ups",
  currency: "USD",
  inputs: { loadWatts: 300 },
  slots: [
    { name: "ups", parts: [part("UPS-600", 100, 360), part("UPS-1000", 200, 600)] },
    { name: "battery", parts: [part("PACK-1", 150, 0)], count: { min: 0, max: 2 } },
  ],
  // The minutes of the batteries at the load.
  measures: [{ name: "minutes", goal: "max", unit: "min", program: app("multiply", app("divide", app("sum", each(axes.others, app("multiply", ref("wattHours"), ref("count")))), ref("loadWatts")), lit(60)) }],
  // The largest output of a part is the load or more.
  rules: [{ name: "output", program: app("gte", app("max", each(axes.others, ref("outputWatts"))), ref("loadWatts")) }],
};
// The offers: a UPS-600 for $120, a UPS-1000 for $260 and a PACK-1 for $80, each with free shipping.
const plan = planBuys(need, observations);
plan.front.map((choice) => [choice.price.value, choice.values["minutes"]]); // [[120, 20], [200, 50], [280, 80], [420, 100]]
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
- The price of a basket adds the cost of each item. Each item is one order with its own shipping, so the plan does not know a shared shipping cost.
- A buy plan does not compare the count of an item with the count of the available units of its offer.
- The package has no history of prices yet. Roadmap item R5 adds it, after the owner chooses its source.
- The board does not know if an offer ended when a new read does not give it. It drops the offer from that read. Another read can still give it.
