# @market/crawler

The crawler of the market. It is the host of the clients of [`@mark1russell7/market-sources`](../market-sources/README.md): it gives the transport, the keys and the clock. This package is private, and it is not on npm.

At this time, the crawler has one command: a live read of one product or one search. The service that reads each offer on a schedule comes later (R4 of [`docs/ROADMAP.md`](../../docs/ROADMAP.md)).

## The live read

```sh
node packages/crawler/src/bin.ts read digikey P5555-ND
node packages/crawler/src/bin.ts read digikey --search "tantalum 10uF" --limit 5
node packages/crawler/src/bin.ts read ebay "v1|110000000001|0"
node packages/crawler/src/bin.ts read bestbuy 6534613 --open-box
```

- Each observation goes to stdout as one line of JSON: an offer and its price reading.
- Each note and each problem goes to stderr. The last line of stderr counts the observations and the notes.
- `--sandbox` reads from the sandbox host of Digi-Key or eBay.
- The exit code is 0 for a read, 1 for a problem of the source or of the keys, and 2 for a bad command.

A Ctrl+C stops the read in progress.

## The keys

The keys are in the file `~/.market/seller-keys.env`, in the `.env` form. Only the crawler reads this file.

| Source | Variables |
| --- | --- |
| `digikey` | `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` |
| `ebay` | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |
| `bestbuy` | `BESTBUY_API_KEY` |

The command reads only the variables of its source. A problem names a variable, and it does not show a value. No output of the command has a key: each message goes through `redact` of `@mark1russell7/market-sources`.

## The transport

`apiTransport(hosts)` sends each exchange through `httpRequest` of `@procedures/http`:

- It sends an exchange only to the API host of the source, with `https:` and port 443. The host policy of `httpRequest` refuses each other host.
- It gives a redirect as an answer, and does not follow it. Thus no key goes to another host.
- One exchange takes 30 seconds at most.

The scheduler of `polite-crawler` keeps the pace of each host, and the clients keep the rules of each answer. The README of `@mark1russell7/market-sources` has these rules.

## Tests

The tests use a fake transport and a fake clock. They hold the parse of the command, the exit codes, the keys and the guard of the transport. A test also holds that no output has a key.
