# Roadmap

This file is the plan of market. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The hand crawl | open | Read the offers of a small set of products at some sellers by hand. Record the fields that each seller gives, and the rules of its terms and its `robots.txt`. The schema comes from these records. |
| R2 | The first package | open | Make `@mark1russell7/market` with `pnpm package add`. It has the records of a product, an offer and a price reading, with their checks. Replace the first site with a demo. |
| R3 | The sources | open | Make `@mark1russell7/market-sources`: one adapter for each seller, the official API first. Each fetch goes through `polite-crawler`. |
| R4 | The live crawler | open | A service reads each offer on a schedule, and it adds a price reading. It uses `@mark1russell7/service` for its loops and its retries. |
| R5 | History and trends | open | The price history of each offer and its trend, with statistics from `@mark1russell7/rigor-statistics`. A page shows them. |
