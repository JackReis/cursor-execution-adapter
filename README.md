# Cursor execution adapter

Independent MIT-licensed glue for running Cursor tasks locally or in Cursor Cloud, collecting artifacts, and handing them to an external verifier such as Ringer.

**Status: experimental.** The authenticated local adapter and Ringer local pilot passed with Composer 2.5 on 2026-10-01. The Ringer cloud pilot also passed: retrieved artifacts matched the local checksum and passed the same independent verifier. The initial cloud failure and correction are documented in `VALIDATION.md`. Automated tests also exercise failure/recovery behavior with a fake provider. No claim of unlimited subscription usage.

## Install and authenticate

Requires Node 22.13+ (Node 22 LTS recommended).

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js login
node dist/cli.js auth-status
node dist/cli.js preflight
node dist/cli.js catalog > cursor-models.json
```

`login` uses Cursor's browser sign-in flow. Cursor exchanges that sign-in for an expiring, revocable API credential stored by its SDK with owner-only permissions. The credential is never printed. On a headless host use `login --no-browser` to print the temporary sign-in URL and complete it in your browser. For headless hosts, `CURSOR_API_KEY` supplied by your secret manager is also supported; never put it in a manifest. `preflight` lists account-visible model IDs without starting an agent. SDK login and an already-signed-in Cursor desktop application are distinct.

`catalog` preserves the current account-visible model IDs, aliases, parameters, variants, fetch time, and SDK version. Choose canonical IDs, not ambiguous `latest` aliases; `default`, `auto`, and `auto-smart` routing are rejected. Listing a model does not prove cloud eligibility or actual inference.

Optional `modelParams` in a request is an array of `{ "id": "fast", "value": "false" }` entries, validated against the live model catalog before launch. Composer 2.5 advertises standard and Fast modes; sample requests explicitly choose standard mode for Composer 2.5. Remove or change those parameters when choosing a different model. Parameters are model-specific. Requested and reported parameters are retained separately in receipts.

SDK requests consume Cursor plan usage; check your account's allowance and overage settings before running. The adapter neither changes billing settings nor falls back to another provider.

## Run a task

Create a private task directory and a separate durable state directory. Copy `examples/fixture.txt` into the task directory. Choose an exact model ID from preflight; do not use a placeholder model or assume availability.

```sh
node dist/cli.js run --mode local \
  --task-dir /absolute/path/task \
  --state-dir /absolute/path/state/task-001 \
  --model MODEL_ID \
  --request examples/local-request.json \
  --spec 'Read fixture.txt and write result.json with the marker from the fixture and the sum of its numbers.'
node examples/check.mjs /absolute/path/task/result.json
```

Request fields:

| Field            | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `expectFiles`    | Required nonempty list of relative output filenames, no globs                          |
| `inputFiles`     | Explicit relative UTF-8 input files; 256 KiB/file, 512 KiB total                       |
| `timeoutSeconds` | Worker wait limit, 1–3600; default 900                                                 |
| `repo`, `ref`    | Cloud only: credential-free HTTPS repository URL and immutable 40-character commit SHA |

Cloud uses `--mode cloud` with a request based on `examples/cloud-request.json`. Replace the repository and revision with an accessible fixture repository. Declared inputs are included as JSON data in the prompt. This is an explicit upload: review the files first. No directory is uploaded automatically. The whole cloud repository is accessible to its worker, including any repository/team/plugin configuration Cursor loads. Use a dedicated fixture/evidence repository without private host configuration.

Cloud workers must write outputs to **`/opt/cursor/artifacts/<relative output path>`**. A repository-relative `artifacts/` folder is not published. The SDK lists the published files as `artifacts/<relative output path>`. Only those artifacts are downloaded. Symlinks, traversal, empty outputs, and files over 16 MiB are rejected. No automatic PR is requested. The prompt prohibits commits, pushes, and delegation, but those cloud behaviors are instructions, not an enforced filesystem or source-control permission boundary.

## Local permissions

Local execution offers only two custom tools: `read_file` for explicitly declared input/output files and `write_file` for declared outputs. Built-in shell, edit, network, and subagent tools are not offered. Ambient settings sources are disabled and SDK sandboxing is enabled; unavailable sandbox support fails rather than disabling isolation. This first release produces documents and patches; it does not execute arbitrary worker shell commands. Run checks through the external orchestrator after execution.

Do not concurrently mutate the task directory from another process. Filesystem containment checks reject symlinks and replace output inodes, but are not an OS boundary against a hostile same-user process changing parent directories concurrently. Receipts and SDK checkpoints are private execution data, not public release files.

## Receipts and recovery

`receipt.json` is stored outside the task directory along with a process lock and local SDK state. It contains requested/observed model identity, agent/run IDs, input fingerprint, usage (or `null` when unavailable), artifact hashes, and lifecycle status. It deliberately omits prompt contents, credentials, and raw provider exceptions.

`artifacts_ready` means files were collected; **it does not mean checks passed**. Ringer owns the final verdict.

Repeat the identical invocation with the same state directory to resume a known run or retry artifact retrieval. A changed request is rejected without altering the original receipt. Ambiguous submissions are reconciled by agent/run lookup and are never blindly resubmitted. If reconciliation cannot find exactly one run, stop and inspect the provider. Failed or cancelled attempts require operator review and a new attempt identity; do not delete state to disguise a retry.

SIGINT/SIGTERM and timeouts request cancellation. If a terminal result cannot be confirmed, `cancellation_unconfirmed` prevents replacement execution. Stale process-lock recovery is serialized. If a process dies during the short acquisition step, a remaining `acquire.lock` requires operator inspection before removal; the adapter will not guess that ownership is safe to discard. A hard kill can interrupt cleanup; rerun with the same state identity to reconcile. External schedulers must allow at least 30 seconds of cancellation grace. SDK checkpoints may contain full working context: protect and retain them accordingly.

## Ringer connection

Ringer remains a separate installation with its own license. Configure `cursor-local` / `cursor-cloud` using the companion Ringer integration wrappers. They invoke this executable using `--mode`, `--task-dir`, `--state-dir`, `--model`, `--spec`, `--request`, and `--timeout-seconds`.

The integration adds trusted Cursor routes, durable per-task state outside worktrees, no automatic Cursor attempt retries, and a cancellation grace period. It preserves the external `check` and `expect_files` behavior. See `examples/ringer-manifest.json`; replace every placeholder before running. The installed live launcher is not changed by this package.

Other orchestrators can invoke the same CLI or import `execute` and supply a `Driver`. Only the SDK adapter depends on Cursor; core lifecycle tests are provider-independent.

## Development and license boundaries

```sh
npm test
npm run check
```

CI runs offline tests on macOS and Linux. Live tests are opt-in and require an authenticated account, an explicit model, and budget review. Tests cover duplicate dispatch prevention, interrupted submissions, cancellation uncertainty, artifact recovery, model substitution, and output containment.

This repository's original source is MIT licensed. It contains no copied Ringer implementation. Ringer's PolyForm Shield license is unchanged. `@cursor/sdk` is a separately installed dependency governed by Cursor's own license and terms; this repository does not relicense or vendor it. Cursor's hosted models and service are not open sourced by this adapter. See [Cursor SDK documentation](https://cursor.com/docs/sdk/typescript) and [Cursor ACP](https://cursor.com/docs/cli/acp) for existing native integrations.
