import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const cwd = new URL("../", import.meta.url);
const secret = "fixture-secret-must-not-escape";
function run(args, setup = "") {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${setup}\nprocess.argv = [process.execPath, 'cli.js', ...${JSON.stringify(args)}]; await import('./dist/cli.js');`,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent-cursor-test-home",
        CURSOR_API_KEY: secret,
      },
    },
  );
}
test("CLI parse errors never echo argument values or stack traces", () => {
  for (const args of [[`--${secret}`], ["--mode"]]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stderr).error, "PROVIDER_OR_INPUT_ERROR");
    assert.ok(!r.stderr.includes(secret));
    assert.ok(!r.stderr.includes(" at "));
  }
});
test("auth-status exposes only status even when SDK supplies identity metadata", () => {
  const r = run(
    ["auth-status"],
    `import { Cursor } from '@cursor/sdk'; Cursor.auth.status = async () => ({status:'authenticated', apiKey:${JSON.stringify(secret)}, email:'private@example.test'});`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { status: "authenticated" });
});
test("catalog preserves full model metadata without disclosing the key", () => {
  const models = [
    {
      id: "example",
      aliases: ["example-latest"],
      parameters: [{ id: "effort", values: [{ value: "low" }] }],
      variants: [{ params: [{ id: "effort", value: "low" }], isDefault: true }],
    },
  ];
  const r = run(
    ["catalog"],
    `import { Cursor, FileCredentialStore } from '@cursor/sdk'; FileCredentialStore.prototype.load = async () => null; Cursor.models.list = async () => ${JSON.stringify(models)};`,
  );
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.models, models);
  assert.match(result.sdkVersion, /^\d+\.\d+\.\d+/);
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  assert.ok(!r.stdout.includes(secret));
});
