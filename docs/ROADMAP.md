# Roadmap

This file is the plan of market. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The hand crawl | done, 2026-11-12 | The record is [`HAND-CRAWL.md`](HAND-CRAWL.md): 22 sellers and aggregators, their official APIs, their `robots.txt` files, their terms and the fields of an offer. The terms of each official API limit how long a program keeps the data. Thus a stored history (R5) needs the consent of each seller, or a source that sells a history. |
| R2 | The first package | in progress | Part 1: `@mark1russell7/market` has the records of a product, an offer and a price reading, with their checks. It also has the GTIN check, the match keys, the cost of an order and the storage rules of a source. Part 2: replace the first site with a demo. |
| R3 | The sources | open | Make `@mark1russell7/market-sources`: one adapter for each seller, the official API first. Each fetch goes through `polite-crawler`. |
| R4 | The live crawler | open | A service reads each offer on a schedule, and it adds a price reading. It uses `@mark1russell7/service` for its loops and its retries. |
| R5 | History and trends | open | The price history of each offer and its trend, with statistics from `@mark1russell7/rigor-statistics`. A page shows them. The source of the history is an open decision of the owner (see [`HAND-CRAWL.md`](HAND-CRAWL.md)). |
