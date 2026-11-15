# @market/crawler

The crawler of the market. It is the host of the clients of [`@mark1russell7/market-sources`](../market-sources/README.md): it gives the transport, the keys and the clock. This package is private, and it is not on npm.

The crawler has three commands: a live read of one product or one search, a run of a plan of reads, and a watch. The watch reads each entry on a schedule, and keeps a board of current prices in one file.

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

## The watch

A watch file is JSON. It has the slack and the tick of the loop, and a list of entries:

```json
{
  "slack": { "value": 30, "unit": "min" },
  "tick": { "value": 1, "unit": "min" },
  "entries": [
    { "name": "ssd", "every": { "value": 6, "unit": "h" }, "source": "bestbuy", "search": "nvme 1tb", "limit": 10 },
    { "name": "ups", "every": { "value": 2, "unit": "h" }, "source": "ebay", "id": "v1|110000000001|0" }
  ]
}
```

```sh
node packages/crawler/src/bin.ts watch watches/parts.json
node packages/crawler/src/bin.ts watch watches/parts.json --once
```

- Each entry has a name, a time `every`, and the fields of a read of a plan. The terms of its source must permit a store. Thus the watch refuses Digi-Key.
- The board file is next to the watch: `<watch>.board.json`. `--board <file>` names another file. A board file that does not exist starts an empty board.
- The board is the board of `@mark1russell7/market`. Its `settleBoard` applies the terms of each source, and its `planReads` gives the due entries.
- The watch reads one entry at a time, the entry that is due for the longest time first. It writes the board after each read, with an atomic replace.
- When no entry is due, the watch sleeps one tick.
- One read takes 90 s at most. The loop stops a longer read, and the read fails.
- A failed read keeps the last read of its entry on the board until the terms end it. Its retry comes one tick later, then two times later for each next failure.
- `--once` reads each due entry one time, and stops. The exit code is 1 when a read has a problem.
- Without `--once`, the watch is a service of `@mark1russell7/service`. A Ctrl+C stops the read in progress, and the board keeps each read before it.

The parse checks the times of the loop. A due entry is on the board after one tick and one read of each entry, at most. Thus the slack must be more than the tick plus 90 s for each entry. The time `every` of each entry must be one tick or more. A bad watch or a corrupt board file gives an exit code before a request, and the watch does not change the board file.

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

The tests of the watch run its service on the fake clock and the fake process of `@mark1russell7/service/testing`. A property test holds the time bound of the watch. Each due entry is on the board within the slack, for each length of the reads up to their bound.
