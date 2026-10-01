#!/usr/bin/env node
import { Cursor, FileCredentialStore } from "@cursor/sdk";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { execute, validateRequest, AdapterError } from "./core.js";
import { sdkDriver } from "./sdk.js";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string" },
    "task-dir": { type: "string" },
    "state-dir": { type: "string" },
    model: { type: "string" },
    spec: { type: "string" },
    request: { type: "string" },
    "timeout-seconds": { type: "string" },
    help: { type: "boolean" },
  },
});
async function main() {
  if (values.help) {
    console.log(
      "cursor-execution-adapter run --mode local|cloud --task-dir DIR --state-dir DIR --model ID --spec TEXT --request FILE\ncursor-execution-adapter login | auth-status | preflight\nCredential: browser login (recommended), or CURSOR_API_KEY (environment only). Request: expectFiles, inputFiles, timeoutSeconds; cloud additionally repo and immutable ref.",
    );
    return;
  }
  if (positionals[0] === "login") {
    await Cursor.auth.login({
      apiKeyName: "cursor-execution-adapter",
      onLoginUrl: () => {
        console.error("Complete Cursor sign-in in the browser window.");
      },
      signal: AbortSignal.timeout(300000),
    });
    console.log(
      JSON.stringify({ status: "logged-in", credential: "stored_locally" }),
    );
    return;
  }
  if (positionals[0] === "auth-status") {
    const s = await Cursor.auth.status();
    console.log(JSON.stringify({ status: s.status }));
    return;
  }
  const stored = await new FileCredentialStore().load();
  const key =
    process.env.CURSOR_API_KEY ??
    (stored &&
    (!stored.apiKeyExpiresAtMs || stored.apiKeyExpiresAtMs > Date.now())
      ? stored.apiKey
      : undefined);
  if (!key) throw new AdapterError("CURSOR_LOGIN_REQUIRED");
  // Do not pass parent secrets to agent shell processes. The SDK receives its key in memory.
  const keep = new Set([
    "HOME",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
  ]);
  for (const name of Object.keys(process.env))
    if (!keep.has(name)) delete process.env[name];
  const driver = sdkDriver(key);
  if (positionals[0] === "preflight") {
    console.log(
      JSON.stringify({ authenticated: true, models: await driver.models() }),
    );
    return;
  }
  if (
    positionals[0] !== "run" ||
    !["local", "cloud"].includes(values.mode ?? "") ||
    !values["task-dir"] ||
    !values["state-dir"] ||
    !values.model ||
    !values.spec ||
    !values.request
  )
    throw new AdapterError("INVALID_ARGUMENTS_USE_HELP");
  const mode = values.mode as "local" | "cloud";
  const raw = JSON.parse(await readFile(values.request, "utf8"));
  if (values["timeout-seconds"])
    raw.timeoutSeconds = Number(values["timeout-seconds"]);
  const request = validateRequest(raw, mode);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const receipt = await execute(
      {
        mode,
        taskDir: values["task-dir"],
        stateDir: values["state-dir"],
        model: values.model,
        spec: values.spec,
        request,
        signal: controller.signal,
      },
      driver,
    );
    console.log(
      JSON.stringify({
        status: receipt.status,
        agentId: receipt.agentId,
        runId: receipt.runId,
        verification: "pending_external_check",
      }),
    );
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof AdapterError ? e.code : "PROVIDER_OR_INPUT_ERROR",
      detail:
        "See configuration and private provider diagnostics; raw errors suppressed to avoid leaking credentials.",
    }),
  );
  process.exitCode = 1;
});
