[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Takoyaki061/make-fun-csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Takoyaki061/make-fun-csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Faster csv-reader 1.0.0

A faster drop-in for [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121) — it answers exactly as csv-reader does on every input, only faster. Entry for the make.fun bounty [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ("Read broken CSV files faster, 21 November 2026").

## Approach

`solve.js` exports `run({text, header}) -> {columns, rows, errors}`, matching csv-reader 1.0.0's broken-row policy exactly (BOM drop, LF/CRLF record ends, empty lines are no records, stray CR dropped with `stray_cr`, quoted fields with `""` escapes and CRLF/lone CR inside read as LF, `quote_junk` appended after a closing quote, unterminated quotes re-read as unquoted with `unterminated_quote`, short/long rows padded or cut to the first record's width, errors in order met).

Speed comes from never building a field character by character:

- **Unquoted fields** — one tight `charCodeAt` loop that only slices once per field, at its comma or line break. Stray CRs fall back to a segment-joining path (rare: ~0.4% of records).
- **Quoted fields** — native `indexOf` jumps straight to the closing quote; the common case (no doubled quotes, no embedded line break) is a single `slice`. Doubled quotes and embedded CR/LF take a slow path that rebuilds the value once.
- **No per-field allocation** — the scanner reports through run-scoped scratch variables instead of returning an array per field.
- `main.ts` keeps the house driver's contract (`/input/cases.json` → `/output/answers.json`, `--no-incremental-marking`) with a pre-sized answers array.

An `indexOf`-based unquoted scan was tried and measured slower than the char loop on the practice set, so it was dropped; only measured wins were kept.

## Measured speed (practice set, 6 cases, ~10 MB of CSV)

| | parse only (median of 5) | whole driver, end to end |
|---|---|---|
| csv-reader 1.0.0 (house baseline) | ~500 ms | ~1450–1600 ms |
| this entry | ~95–100 ms | ~750–970 ms |

Parse-only speedup ≈ **5x**; end-to-end ≈ **1.8x** (the rest is the JSON parse of `/input/cases.json` and stringify of the ~12 MB answers, identical for every entry). Practice correctness: **6/6 cases byte-identical** to the reference answers.

## Layout

- `solve.js` — the fast reader (dependency-free ES module)
- `main.ts` — the harness driver
- `LICENSE` — MIT
