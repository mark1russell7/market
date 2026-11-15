# @market/crawler

The crawler of the market. It is the host of the clients of [`@mark1russell7/market-sources`](../market-sources/README.md): it gives the transport, the keys and the clock. This package is private, and it is not on npm.

At this time, the crawler has two commands: a live read of one product or one search, and a run of a plan of reads. The service that reads each offer on a schedule comes later (R4 of [`docs/ROADMAP.md`](../../docs/ROADMAP.md)).

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

## The run of a plan

A plan file is JSON. It has a list of reads:

```json
{
  "reads": [
    { "source": "digikey", "search": "BE600M1", "limit": 5, "tag": "ups" },
    { "source": "bestbuy", "id": "6534613" }
  ]
}
```

```sh
node packages/crawler/src/bin.ts run plans/prep.json
```

- Each read has one `id` or one `search`, and the options `limit`, `openBox` and `sandbox` of a read. A `tag` is free text for the record.
- Each read gets the checks of a read of the command line. A bad plan gives the exit code 2 before a request.
- The reads go in order. The run has one pace, and one client for each source, so Digi-Key and eBay give one token for all reads.
- The run writes the observations of all reads as JSON lines in UTF-8. The default file is next to the plan: `<plan>-<time>.jsonl`. `--out <file>` names another file.
- The run also writes the record of each read: its time, its count of observations, its notes and its problems. The default file is `<plan>-<time>.reads.json`. `--record <file>` names another file.
- The run writes the two files after each read. Thus a Ctrl+C keeps the reads before it.
- A read with a problem, for example a source with no keys, does not stop the run. The exit code is 1 when a read has a problem.

The run writes its files itself. Thus a redirect of the shell does not change the encoding: in Windows PowerShell 5.1, `>` writes UTF-16.

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
