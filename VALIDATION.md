# Validation — 2026-10-01

SDK: `@cursor/sdk` 1.0.35. Runtime: Node 22.22.3 on macOS arm64. Live model: explicitly selected `composer-2.5`, also reported by the returned run result. The fixture pilots used the catalog default parameter set. Three subsequent private assessment roles all passed their artifact/schema checks with requested and reported `fast=false` (standard mode). Their findings were independently reconciled; file/schema PASS is not factual acceptance.

## Executed proof

- Direct local adapter: produced a JSON fixture artifact; independent checker verified marker `CURSOR_ADAPTER_FIXTURE_V1` and numeric sum 42.
- Full Ringer local integration: PASS, one attempt, approximately 11 seconds.
- Full Ringer cloud integration: PASS, one corrected attempt, approximately 110 seconds. Cloud artifacts downloaded and verified locally.
- Both successful Ringer pilots returned SHA-256 `30dcdbf162665fb1cf944190dbbc279a0af76020a28cf18259a8c9bc5da584d3`.
- All 39 adapter tests pass; CI passes on macOS and Linux. Live SDK model execution has been exercised on macOS and Cursor-hosted cloud; Linux CI uses a fake provider.
- Ringer integration has 46 focused passing tests, including routing restrictions and no automatic Cursor retries. The PR full macOS suite passes. The broader Ubuntu job is blocked by missing `bubblewrap` in existing OpenRouter wrapper tests; the optional Windows harness also fails. See the Ringer PR for current CI details.

## Failure preserved

The first cloud run completed remotely but failed retrieval: it wrote into repository-relative `artifacts/`, which the provider did not publish. Ringer correctly reported FAIL. Changing the instruction to the provider-managed `/opt/cursor/artifacts/` directory produced a retrieved, independently checked artifact. The failed run was retained and a new explicitly reviewed pilot was used; it was not relabeled as a pass.

## Limits

Live account receipts remain private. Catalog availability is not a guarantee that every listed model supports every runtime. Tests simulate interrupted submission, cancellation uncertainty, and stale lock recovery; those disruptive scenarios were not induced against a live paid worker. Local mode offers scoped read/write tools, not arbitrary shell execution. Cloud tool permissions remain those of the Cursor environment. SDK-reported cost/usage is recorded separately from account on-demand billing; no unlimited-usage claim is made.
