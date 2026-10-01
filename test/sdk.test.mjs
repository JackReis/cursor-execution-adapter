import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent } from "@cursor/sdk";
import { sdkDriver } from "../dist/sdk.js";
test("local driver disables ambient/builtin tools and constrains custom file writes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-tools-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskDir = path.join(root, "task");
  await mkdir(taskDir);
  const old = Agent.create;
  t.after(() => {
    Agent.create = old;
  });
  let captured;
  Agent.create = async (options) => {
    captured = options;
    return { agentId: "agent-test" };
  };
  await sdkDriver("test-placeholder").create(
    {
      mode: "local",
      taskDir,
      stateDir: path.join(root, "state"),
      model: "fixture",
      spec: "test",
      request: { expectFiles: ["out.json"], inputFiles: [] },
    },
    "agent-test",
  );
  assert.deepEqual(captured.tools, ["mcp"]);
  assert.deepEqual(captured.local.settingSources, []);
  assert.equal(captured.local.sandboxOptions.enabled, true);
  assert.equal(captured.local.enableAgentRetries, false);
  const { read_file, write_file } = captured.local.customTools;
  await assert.rejects(
    write_file.execute({ path: "../outside", content: "bad" }, {}),
  );
  await assert.rejects(
    write_file.execute({ path: "undeclared", content: "bad" }, {}),
  );
  await assert.rejects(read_file.execute({ path: "undeclared" }, {}));
  await write_file.execute({ path: "out.json", content: '{"ok":true}' }, {});
  assert.equal(
    await readFile(path.join(taskDir, "out.json"), "utf8"),
    '{"ok":true}',
  );
});
test("cloud pins ref, disables PR creation, and passes no host environment", async (t) => {
  const old = Agent.create;
  t.after(() => {
    Agent.create = old;
  });
  let captured;
  Agent.create = async (options) => {
    captured = options;
    return { agentId: "bc-test" };
  };
  await sdkDriver("test-placeholder").create(
    {
      mode: "cloud",
      taskDir: "/task",
      stateDir: "/state",
      model: "fixture",
      spec: "test",
      request: {
        repo: "https://github.com/example/fixture",
        ref: "a".repeat(40),
        expectFiles: ["out"],
      },
    },
    "bc-test",
  );
  assert.equal(captured.cloud.repos[0].startingRef, "a".repeat(40));
  assert.equal(captured.cloud.autoCreatePR, false);
  assert.equal(captured.cloud.workOnCurrentBranch, false);
  assert.equal(captured.cloud.envVars, undefined);
  assert.equal(captured.idempotencyKey, "bc-test");
});
