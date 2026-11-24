# @mark1russell7/market

The records of a market: a product, an offer of a seller and a price reading, with their checks. The package also has the GTIN check, the match keys of a record, the cost of an order and the storage rules of a source. The offers of a part and the best offer join the observations of the sources to the parts that a buyer wants. The board keeps the current prices within the terms of each source, and plans the reads of a watch. A buy plan gives the best baskets of the parts that a need names. A metered price gives the cost of a cloud resource from its usage, with tiers, free amounts and terms.

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

## A buy order under a budget

A buy order chooses units of products, one unit at a time, under a budget. Each step buys the unit with the largest gain for each unit of money. The choice is `greedy` of `@mark1russell7/strategy-search`. The module knows no topic: the caller gives the value of a choice as a function.

- `buyCandidates(wants, observations, { currency, conditions })` gives a candidate for each product with a usable offer. The price is the cost of one unit with its shipping, from the in-stock offer with the lowest cost. Each unit is one order, so the price is an upper limit of the cost of more units. `unpriced` names each product with no usable offer.
- `orderBuys(candidates, { budget, stages, goal, start })` gives the order. Each stage has a name and a value function. A stage starts from the units of the stage before it, with the money that is left.
- **The value.** A value is a list of numbers, the most important number first. Thus a gain on the first number comes before each gain on the second number. With `goal: "min"`, a smaller value is better, as for a shortfall.
- **The stops.** A stage stops at `budget` when no unit fits the money that is left. It stops at `units` when each product is at its `max`. It stops at `no-gain` when no unit has a gain.
- **The bound.** With gains that do not increase as the order grows, the order holds at least `(1 - 1/e) / 2` of the best value. When two products give more together than apart, set `lazy` to `false`.

```ts
import { orderBuys, type BuyCandidate } from "@mark1russell7/market/plan";

const candidates: BuyCandidate[] = [
  { product: "JUG", price: 4, max: 10, quote: "a:1" },
  { product: "CAN", price: 1, max: 10, quote: "a:2" },
];
// The days short of a target: water first, then food. A jug gives 4/3 days, and a can gives 1 day.
const short = (target: number) => (units: Readonly<Record<string, number>>) => [Math.max(0, target - ((units["JUG"] ?? 0) * 4) / 3), Math.max(0, target - (units["CAN"] ?? 0))];
const order = orderBuys(candidates, { budget: 15, goal: "min", stages: [{ name: "2 days", value: short(2) }, { name: "5 days", value: short(5) }] });
order.units; // { JUG: 3, CAN: 3 }
order.stages.map((stage) => stage.spent); // [10, 5]
```

## A catalog of supplies

The entry `@mark1russell7/market/supplies` has the format and the gate of a catalog of supplies: the products that a household keeps for an emergency. It is an add-on: the core of the package names no supply.

- A product has a kind (`water`, `food`, `power`, `light`, `heat`, `first-aid` or `communication`), the resources that one unit gives, its shelf life and, as an option, a part for the offers.
- A product can give no stored resource, for example a radio. Its `basis` is the id of a fact that tells why a kit has it, and the gate examines that fact. A product that gives no resource and has no basis is an error.
- Each amount has a cited fact, the definition of the product, or a no read with its reason. A no read is not 0.
- An amount can also be a rate of a cited fact times an amount of the product, in the field `scaled`. For example, the food energy of 1 kg of rice is 365 kcal in 100 g times 1 kg. The amount that the rate applies to has its own fact, definition or the size. The gate calculates the product with `@mark1russell7/quantity`, and the error `supplies-amount` tells of an amount that is not equal to it.
- An amount can cite the size of the product with `size: true`, for example the gift of 1 kg of a package of 1 kg. The size has its own reason, and one place holds it. The gate compares the two amounts in one unit. The error `supplies-amount` tells of an amount that is not equal to the size. The error `supplies-fact` tells of a product with no read size, or of a size that cites itself.
- Each resource has a supply kind, for example `food` for `food.no-cook` and `power` for `energy.battery`. The error `supplies-kind` tells of a kind that is not a supply kind.
- A food resource can be in a unit of energy, for example `food.no-cook` in kcal. A product with a food energy and a gift of that resource gives the same energy two times. With two such gifts, their sum is the food energy. A food gift in a mass, for example dry rice in kg, also has food energy, so the sum is then a lower limit. A gift of the kind `power`, for example in Wh, is not food energy. The error `supplies-energy` tells of two values that are not equal.
- The facts and their sources are the records of [`@mark1russell7/guidebook`](https://www.npmjs.com/package/@mark1russell7/guidebook). Its gate examines each license and each address. Since 0.7.0, a source can have the fields `terms`, `updated`, `sha256` and `note` of guidebook 0.3.0. The gate examines the first three, with the codes `bad-url`, `bad-date`, `updated-after-check` and `bad-sha256`.
- The shelf life of a food is the id of a product of the FoodKeeper data of USDA FSIS. The entry `/foodkeeper` of `@mark1russell7/stock` gives its due rule.
- The resource codes are the codes of a store of `@mark1russell7/stack-endurance`, for example `water.stored` in `L`.
- A product can have a `size`: the amount of one unit as sold, for example 1 kg, 530 g or 1 gal. Its unit is a mass or a volume that converts to `kg` or `L`, or one bare count, for example `{each}`. A page can thus convert a size in a mass to `lb` with `valueIn` of `@mark1russell7/quantity`. The gate refuses a unit that does not convert, for example `g/{each}`. A no read is for a product that has a size, when the source of the size is not read yet. The gate examines a size as each other amount.
- A product can join a series of average prices. The join names the source, the series and the amount of the item in one unit, with its reason. A product with no series has a no read with its reason.
- With the option `foodKeeper`, the gate examines each FoodKeeper id of a shelf life. An id that is not in the known ids is the error `supplies-shelf`. The option is a set or a list of ids, for example the ids of `FOODKEEPER_PRODUCTS` of `@mark1russell7/stock/foodkeeper`. With no option, the gate does not examine the ids against the data.
- A catalog from JSON can have a field of a product that is null or not a record, for example `size: null`. The gate gives one error for each such field and does not throw. Then it examines the product with no such field.
- market has no runtime dependency on `@mark1russell7/stock`. The code that calls the gate gives the ids. The tests of market gate the reference catalog with the ids of stock.
- The gate does not examine a resource code against a layer of stores. The code that joins the catalog to a layer of stores gives that gate.
- Since 0.8.1, a food product can have cook facts in the field `cook`. The field `water` is the water for each volume or mass of the dry food. The field `bulk` is the mass of a volume of the dry food. The field `time` is the cook time from low to high. Each cites a fact and keeps the two values of the source, for example 2 cup of water for 1 cup of rice.
- A water rate for each volume needs a bulk mass, or the gate gives the error `supplies-fact`. Cook facts on a product that is not food give the error `supplies-kind`.
- A resource of a fuel can have the field `fuelEnergy`: a cited energy for each mass, with its heating value (`higher` or `lower`). For example, 2219.2 kJ in 44.0956 g of propane. The gate examines its fact and its units.
- A product can have the field `stove`: the resource of the fuel that it burns and, as an option, its fuel rate at full heat. The fuel rate is an energy or a mass in a time, for example 227 g in 90 min. A rate in an energy also has its heating value.
- The fuel of a stove is a resource of the catalog with the kind `heat`. A fuel that is not in the catalog is the error `supplies-resource`.
- The cook time starts when the water boils. The heat to boil the water is a calculation from the cook water.
- A field with no cited value is not in the catalog. It is not 0 and not a default.

| Function | What it does |
| --- | --- |
| `checkSupplies(catalog, options)` | It gives the findings of the catalog: the errors of the gate, and a warning for each no read and for each fact or source that no product uses. The option `foodKeeper` gives the known FoodKeeper ids. |
| `supplyWants(catalog, max)` | It gives the wants of the products with a part, for `buyCandidates`. A product with no part has no offer, so it has no price. |
| `kitMax(people)` | It gives the `max` of `supplyWants` for a household. A product with a count for each person (`perPerson`) has that count times the persons, divided by its count of persons (`forPersons`, 1 by default), up to the next whole unit. Each other product has 1. |
| `giftsOf(catalog, id, units)` | It gives the resources of a count of units, each in the unit of its resource. A unit converts exactly, so 1 gal gives 3.785411784 L. |
| `averageSupplyPrices(catalog, prices, { since })` | It gives the price of one unit of each product with a join, from the last month of its series. A series with no price and a unit that does not fit give a no read. With `since`, so does a last price before that month. |
| `foodPlanCost(plan, members, days)` | It gives the cost of a food plan for the members of a household and a count of days. It applies the change for the size of the household. |
| `foodPlanCheck(cost, plan, members, days)` | It compares the cost of the food of a buy list with the cost of the plan. A ratio above 1 tells that a price or an amount is possibly wrong. |
| `cookWater(product)` | It gives the cook water of a dry food in `L/kg`. A water rate for each volume divides by the bulk mass. With no water rate, or with no bulk mass for a rate for each volume, it gives `undefined`. |
| `fuelEnergyPerMass(resource)` | It gives the energy of a fuel in `kJ/kg`, for example 50327 kJ/kg for propane. A resource with no fuel energy gives `undefined`. |
| `buyListEnergy(catalog, units)` | It gives the food energy of each line of a buy list in `kcal`, with the resources of the product, and their sum. |

`SUPPLY_CATALOG` is the reference catalog. Its facts come from Ready.gov (FEMA, a US federal work) and from FoodData Central (USDA, CC0 1.0). It has gaps:

- The energy of the power bank is no read. The page of the maker gives 24,000 mAh and no Wh, and a charge does not convert to energy without its voltage.
- The flashlight, the sleeping bag, the first aid kit and the NOAA weather radio cite the kit list of Ready.gov. Their shelf life is no read, because the source gives no time.
- Peanut butter gives `food.no-cook` in kcal: food that needs no water and no fuel. This is important in a long power cut. The unit of a resource is the unit that its next step takes. A cooking converter takes dry food in kg, and no-cook food goes to the food need in kcal. It has no series of average prices yet.
- Since 0.8.7, the catalog has infant formula powder. Its resource and its product are in the tables below. The powder is not ready to feed: a converter mixes it with safe water first.
- The canned soup is ready to serve, so it also gives `food.no-cook`. One can is 530 g, the portion of the FDC item, so it gives 217.3 kcal. It has no series of average prices yet.
- Each product with a size in its definition has that size, and the soup has the 530 g of its FDC portion. A product with no known size has no field `size`. It does not have a no read. These products are the flashlight, the sleeping bag, the three stoves, the first aid kit, the radio and the power bank.
- The water container has no size. It is sold empty, so 1 gal is its capacity and not an amount as sold. Its gift gives the 1 gal of water that it holds when it is full.
- The shelf life of commercially bottled water is no read. The source gives no time, so the date on the label applies.
- The resources `fuel.propane` and `fuel.butane` are in `kg`. Their fuel energy is the higher heating value from the NIST Chemistry WebBook (SRD 69). It is the standard enthalpy of combustion of the gas for each mole, and the molecular weight. The page has a copyright of the U.S. Secretary of Commerce, so the catalog keeps only the cited values.
- The cook water of the rice comes from USA Rice and of the oats from the label of Quaker. The bulk mass of 1 cup of each comes from FoodData Central. The cook times of the beans come from a USDA sheet, and of the pasta from the label of Ronzoni.
- Since 0.8.8, the dry beans have a cook water and a soak water. A USDA recipe for schools gives 1 3/4 qt of water for each lb of dry beans for each of the two. The cook discards the soak water, so `soakWater` is a second draw on the stored water.
- Since 0.8.8, the dry pasta has a cook water from a USDA recipe for child care. It gives 3 gal for 1 lb 9 oz of dry spaghetti, approximately 16 L/kg.
- The USDA recipes do not agree on the pasta water. The recipe for a pasta salad gives 2 gal 3 qt for 6 lb 4 oz. That is approximately 3.7 L/kg. The catalog keeps the spaghetti recipe, because it is the same pasta. The flour has no cook facts.
- The dry beans are pinto beans. Their food energy comes from the raw pinto bean item of FoodData Central, the same bean as the USDA sheet of the cook time.
- Since 0.8.5, the catalog has three stoves. They are a canister stove with 1 burner, a propane stove with 2 burners and a butane cartridge stove with 1 burner. Ready.gov names camp stoves as a source of heat to cook, so each stove cites it as its basis.
- The fuel rate of each stove is a mass in a time from the page of its maker. The rates are 227 g in 60 min, 16.4 oz in 1 h and 8.8 oz in 1.25 h. A rate in a mass needs no heating value.
- The two Coleman pages give an upper limit of the time ("up to"). Thus each of their rates is a lower limit of the fuel that the stove burns at full heat, and it has `bound: "least"`. A reader that takes a rate as the value takes only a rate with no bound. The butane page gives no burner setting for its time.
- The MSR page gives a burn time of "approximately" 60 min. Thus its rate has no bound.
- Each Coleman page also gives a rating in BTU. At the higher heating value of the catalog, the rating gives less fuel than the burn time. The propane stove gives 0.419 kg/h against 0.465 kg/h. The butane stove gives 0.163 kg/h against 0.200 kg/h. Thus the catalog takes the burn time, the side with more fuel. The rating is not an upper limit of the fuel.
- Only the fuel rate and the boil yield of a stove have a bound (`RATE_BOUNDS`: `least` or `most`). The gate refuses an unknown bound, and a bound on a cook water, a bulk mass or a fuel energy.
- Since 0.8.6, the canister stove has a boil yield: 16 L of water for each 227 g of fuel, from its maker page. The maker test is in calm air from a warm start, so the yield has `bound: "most"`. A reader takes no value from it until a cited field figure exists.
- The start of 21 °C is the general test convention of the maker blog for most makers. The spec page of this stove gives no start of its own. A field figure with `bound: "least"` brings its own start.
- The canister stove burns `fuel.isobutane-mix`. The mix of a canister differs between makers, and the read page gives no mix. Thus this fuel has no fuel energy, and a converter gives a no read for its energy.
- The product ids of the stoves name no maker. The source records name the maker and the model.
- A cup is 236.6 mL in `@mark1russell7/quantity` and in FoodData Central. A cup on a label can be 240 mL, a difference of 1.4%.
- The oats have no series of average prices. The pasta has its own resource `food.pasta-dry`, because the cook drains its water, and rice and oats absorb their water. The dry beans, the pasta and the flour join the BLS series `APU0000714233`, `APU0000701322` and `APU0000701111` in `USD/lb`. The rice joins the BLS series `APU0000701312` in `USD/lb`, so 1 kg of rice costs 2.2046 times the price of 1 lb.

The infant formula of the catalog:

| Resource | Unit | Next step |
| --- | --- | --- |
| `food.infant-formula-ready` | `kcal` | It goes to the formula need with no water and no fuel. |
| `food.infant-formula-powder` | `kg` | A converter mixes it with safe water, with no fuel. The converter gives `food.infant-formula-ready`. |

| Product | Gift | Food energy | Fact |
| --- | --- | --- | --- |
| `food.infant-formula-ready-1kg` | 630 kcal of `food.infant-formula-ready` | 630 kcal | `fdc.infant-formula-ready`: FDC 172319, 63 kcal in 100 g |
| `food.infant-formula-powder-1kg` | 1 kg of `food.infant-formula-powder` | 5240 kcal | `fdc.infant-formula-powder`: FDC 173554, 524 kcal in 100 g |

- The two FDC items are the powder and the ready-to-feed formula of one store brand, in the SR Legacy file of FoodData Central (CC0 1.0).
- The size of each product is 1 kg by definition, in one or more containers. The fact of the powder also gives 8.4 g for 1 scoop.
- The powder is in `kg`, as the dry rice. The amount of mix water is a calculation from the mass, so the unit of the next step is a mass.
- The powder has no cook facts. It is not a food to cook, and it needs no fuel.
- The powder has no field `opened`. The WIC guide tells to prepare one bottle at a time with powder, so a feed opens no container of ready formula.
- No product of the two has a part, so `supplyWants` gives no want for them. The mix rule is in `@mark1russell7/stack-needs`.

`FOOD_PLANS` has the costs of the Thrifty Food Plan of USDA for October 2026, in the U.S. average. The costs come from the monthly report of the cost of food (a US federal work). Each cost is for one person of an age and sex group, in a household of four. The changes for the other sizes come from footnote 2 of the report. The plan is a full diet, so a list of dry staples costs much less than the plan. A low ratio is normal. The check of the amount of food is a check of its energy, not of its cost. The members of a household are input data.

`buyListEnergy` gives only the data of the catalog. The energy of a line is the field `energy` of the product times its count of units.

- A product with a no read gives a line with no read. A no read is not 0. Then the sum is a lower limit.
- A food product with no field `energy` also gives a no read. A product of another kind gives no line, for example water. The gate refuses a field `energy` on a product that is not food.
- For the food energy of a product, use its field `energy`. A no-cook product also gives its energy as a gift of `food.no-cook`, for the model of the endurance of the stores. Do not add the two: that counts the energy two times.
- Each line has the resource codes of the product. A caller can thus split the energy of `food.no-cook` from the energy of the dry foods.
- The energy need of the members, the days of food and the shortfall are not in this package. The days depend on the water and the fuel that a case leaves. The model of the endurance of the stores gives them.

## Metered prices

A cloud resource has a metered price: a price for each unit of an amount that the provider meters. A metered amount is a `time` (the hours of a machine), a `data-time` (stored data in GiB-months), a `data` (a transfer) or a `count` (requests).

| Record | Schema | What it has |
| --- | --- | --- |
| Metered offer | `meteredOfferSchema` | One resource of a provider in one location, on one term: the source, the id at the source, the location, the term and the specifications. |
| Metered reading | `meteredReadingSchema` | The metered prices of one offer at one instant: the billing period, the meters, and the upfront money of a committed term. |
| Metered observation | `meteredObservationSchema` | A metered offer and a reading of that offer. |

- **Prices.** A metered price is a quantity with a compound unit of `@mark1russell7/quantity`, for example `USD/h`, `USD/GiB`, `USD/(GiB·mo)` or `USD/{request}`. `meteredKindOf(unit)` gives the kind of its metered amount.
- **Meters.** A reading has one meter or more, each with its own name. A meter has its tiers, and a free amount as an option.
- **Tiers.** A tier has its start and its price for each unit. The first tier starts at zero, and the starts increase. A start can have another unit of the same amount, for example `TiB` with prices in `USD/GiB`.
- **Free amounts.** A free amount is for each billing period. Its scope tells which usage shares it: the `account`, each `region` or each `resource`.
- **Terms.** The term of an offer is `on-demand`, `spot` or `committed`. The provider can end a `spot` use at any time, after the `notice`. A preemptible use is a `spot` use. A `committed` term has its `length`, and its readings can have `upfront` money.
- **Location.** The location of an offer has the provider, its region and its zone. The region and the zone are the ids of the provider. A source gives each location and each term its own offer id, so the readings of one offer make one series.
- **Terms of a source.** A metered reading has `offerId` and `at`, as a price reading has. Thus `keepUntil`, `isKept`, `permitsHistory` and `permitsTrend` apply to it.

`meteredCost(observation, usage, { freeUsed })` gives the cost of an offer for one period. `usage` has the amount of each meter in that period, by the name of the meter.

1. The free amount comes off the usage first. `freeUsed` is the part of the free amount that other usage in its scope used.
2. The tiers count the rest of the usage from zero. Each tier applies its price to its part of the usage.
3. A committed term adds its upfront money, times the period, divided by the length.

The arithmetic is exact, and the function does not round the cost to the cent. A meter with no usage costs zero. The result has the cost of each meter, the part of the upfront money, and the total.

```ts
import { meteredCost, type MeteredObservation } from "@mark1russell7/market";

const id = "example-cloud:egress/region-1";
const observation: MeteredObservation = {
  offer: {
    id,
    source: "example-cloud",
    sourceId: "egress/region-1",
    title: "Data out to the internet",
    location: { provider: "example-cloud", region: "region-1" },
    term: { kind: "on-demand" },
    specs: [],
  },
  reading: {
    offerId: id,
    at: "2026-11-12T18:00:00Z",
    period: { value: 1, unit: "mo" },
    meters: [
      {
        name: "egress",
        tiers: [
          { from: { value: 0, unit: "GiB" }, unitPrice: { value: 0.09, unit: "USD/GiB" } },
          { from: { value: 10, unit: "TiB" }, unitPrice: { value: 0.085, unit: "USD/GiB" } },
        ],
        free: { amount: { value: 100, unit: "GiB" }, scope: "account" },
      },
    ],
  },
};
// The free 100 GiB come off first. Then 10,240 GiB cost $0.09 each, and 1 GiB costs $0.085.
meteredCost(observation, { egress: { value: 10_341, unit: "GiB" } }).total; // { value: 921.685, unit: "USD" }
```

## Average prices

An average price is the mean price of one item in one area and one month, from an official statistic. An example is the average prices of the Consumer Price Index. It is not an offer of a seller. A buyer uses it as the price of a product with no offer, and as a check of the price of an offer.

| Record | Schema | What it has |
| --- | --- | --- |
| Average price | `averagePriceSchema` | The source and its series. The item and the area, as the source names them. The month `YYYY-MM`, and the price for each unit of the item. The instant of the read, and the footnotes. |

- **Price.** The unit has one unit of money above. Below, it has the unit of an amount of the item, for example `USD/lb`, `USD/L` or `USD/{each}`. A pure time, a bare number and money below are refused, for example `USD/h` and `USD/%`. An energy is accepted, for example `USD/kWh`. `unitPriceSchema` examines it. The value is more than 0.
- **The fit to a product.** The schema does not examine the fit of the unit to a product, for example `USD/lb` to a dry grain in `kg`. The join of a product to a series examines it.
- **Id.** `averagePriceId(source, series, month)` gives the id `source:series:month`.
- **The last price.** `latestAverages(prices)` gives the last month of each series. A later read of the same month replaces an earlier read, because a source can revise a value.

The adapter of the average prices of BLS is in `@mark1russell7/market-sources`.

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
- A month of the quantity package is 730.485 hours, the mean month of the calendar. Many providers bill a month as 730 hours. Give the usage in the unit of the price.
- The quantity package has no prefix for a count. Thus a price for each million requests is a price for each request: `0.0000004 USD/{request}`.
- `meteredCost` gives the cost of one offer. When offers share a free amount, the caller divides the free amount with `freeUsed`.
- The price of a basket adds the cost of each item. Each item is one order with its own shipping, so the plan does not know a shared shipping cost.
- A buy plan does not compare the count of an item with the count of the available units of its offer.
- The package has no history of prices yet. Roadmap item R5 adds it, after the owner chooses its source.
- The board does not know if an offer ended when a new read does not give it. It drops the offer from that read. Another read can still give it.
