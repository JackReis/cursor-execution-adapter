import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute, validateRequest, relativeFile } from "../dist/core.js";
async function fixture(t, mode = "local") {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-adapter-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskDir = path.join(root, "task");
  await mkdir(taskDir);
  const o = {
    mode,
    taskDir,
    stateDir: path.join(root, "state"),
    model: "test-model",
    spec: "Write result.json",
    request: {
      expectFiles: ["result.json"],
      timeoutSeconds: 1,
      ...(mode === "cloud"
        ? { repo: "https://github.com/example/fixture", ref: "a".repeat(40) }
        : {}),
    },
  };
  let sent = 0,
    created = 0,
    cancelled = 0;
  const result = { status: "finished", model: { id: "test-model" } };
  const run = {
    id: "run-1",
    wait: async () => result,
    cancel: async () => {
      cancelled++;
    },
  };
  const session = {
    id: "agent-test",
    send: async () => {
      sent++;
      if (mode === "local")
        await writeFile(path.join(taskDir, "result.json"), '{"ok":true}');
      return run;
    },
    artifacts: async () => [{ path: "artifacts/result.json", sizeBytes: 11 }],
    download: async () => Buffer.from('{"ok":true}'),
    usage: async () => ({ tokens: 12 }),
    close: async () => {},
  };
  const driver = {
    models: async () => ["test-model"],
    create: async () => {
      created++;
      return session;
    },
    resume: async () => session,
    getRun: async () => run,
    runs: async () => [run],
  };
  return {
    o,
    root,
    driver,
    run,
    session,
    result,
    counts: () => ({ sent, created, cancelled }),
  };
}
test("reject traversal, absolute, windows, empty components", () => {
  for (const s of ["../a", "/a", "a//b", "a/./b", "a\\b", "C:/x"])
    assert.throws(() => relativeFile(s));
});
test("cloud requires immutable ref and credential-free URL", () => {
  assert.throws(() =>
    validateRequest(
      {
        repo: "https://u:p@github.com/a/b",
        ref: "a".repeat(40),
        expectFiles: ["a"],
      },
      "cloud",
    ),
  );
  assert.throws(() =>
    validateRequest(
      { repo: "https://github.com/a/b", ref: "main", expectFiles: ["a"] },
      "cloud",
    ),
  );
});
test("local artifacts are receipts, never verification passes; rerun does not resubmit", async (t) => {
  const f = await fixture(t);
  const r = await execute(f.o, f.driver);
  assert.equal(r.status, "artifacts_ready");
  assert.equal(r.resolvedModel, "test-model");
  assert.equal((await execute(f.o, f.driver)).runId, "run-1");
  assert.deepEqual(f.counts(), { sent: 1, created: 1, cancelled: 0 });
});
test("changed output invalidates completed receipt", async (t) => {
  const f = await fixture(t);
  await execute(f.o, f.driver);
  await writeFile(path.join(f.o.taskDir, "result.json"), "changed");
  await assert.rejects(execute(f.o, f.driver), /ARTIFACT_CHANGED/);
});
test("changed specification cannot reuse dispatch state", async (t) => {
  const f = await fixture(t);
  await execute(f.o, f.driver);
  await assert.rejects(
    execute({ ...f.o, spec: "different" }, f.driver),
    /STATE_REQUEST_MISMATCH/,
  );
  assert.equal(f.counts().sent, 1);
});
test("cloud copies exact allowlisted artifacts and hashes them", async (t) => {
  const f = await fixture(t, "cloud");
  const r = await execute(f.o, f.driver);
  assert.equal(r.artifacts[0].bytes, 11);
  assert.equal(
    await readFile(path.join(f.o.taskDir, "result.json"), "utf8"),
    '{"ok":true}',
  );
});
test("cloud refuses output symlink", async (t) => {
  const f = await fixture(t, "cloud");
  const outside = path.join(f.root, "outside");
  await writeFile(outside, "untouched");
  await symlink(outside, path.join(f.o.taskDir, "result.json"));
  await assert.rejects(execute(f.o, f.driver), /UNSAFE_PATH/);
  assert.equal(await readFile(outside, "utf8"), "untouched");
});
test("cloud refuses directory symlink", async (t) => {
  const f = await fixture(t, "cloud");
  f.o.request.expectFiles = ["out/result.json"];
  await symlink(f.root, path.join(f.o.taskDir, "out"));
  f.session.artifacts = async () => [
    { path: "artifacts/out/result.json", sizeBytes: 11 },
  ];
  await assert.rejects(execute(f.o, f.driver), /UNSAFE_PATH/);
});
test("missing artifact is failure despite remote success", async (t) => {
  const f = await fixture(t, "cloud");
  f.session.artifacts = async () => [];
  await assert.rejects(execute(f.o, f.driver), /MISSING_OR_OVERSIZED_ARTIFACT/);
});
test("unsupported model makes zero dispatches", async (t) => {
  const f = await fixture(t);
  f.driver.models = async () => [];
  await assert.rejects(execute(f.o, f.driver), /MODEL_UNAVAILABLE/);
  assert.equal(f.counts().created, 0);
});
test("provider authentication failure makes zero dispatches and no raw error receipt", async (t) => {
  const f = await fixture(t);
  f.driver.models = async () => {
    throw Error("sensitive");
  };
  await assert.rejects(execute(f.o, f.driver));
  assert.equal(f.counts().created, 0);
});
test("remote failure never collects artifacts", async (t) => {
  const f = await fixture(t, "cloud");
  f.result.status = "error";
  await assert.rejects(execute(f.o, f.driver), /REMOTE_RUN_FAILED/);
});
test("resolved model substitution is explicit failure", async (t) => {
  const f = await fixture(t);
  f.result.model.id = "different";
  await assert.rejects(execute(f.o, f.driver), /RESOLVED_MODEL_MISMATCH/);
});
test("ambiguous send reconciles existing run without resubmission", async (t) => {
  const f = await fixture(t, "cloud");
  f.session.send = async () => {
    throw Error("lost response");
  };
  await assert.rejects(execute(f.o, f.driver));
  const state = JSON.parse(
    await readFile(path.join(f.o.stateDir, "receipt.json")),
  );
  assert.equal(state.status, "submission_uncertain");
  assert.equal(state.error, "PROVIDER_ERROR");
  const r = await execute(f.o, f.driver);
  assert.equal(r.runId, "run-1");
  assert.equal(f.counts().created, 1);
});
test("ambiguous send with no remote run never blindly retries", async (t) => {
  const f = await fixture(t);
  f.session.send = async () => {
    throw Error("lost response");
  };
  await assert.rejects(execute(f.o, f.driver));
  f.driver.runs = async () => [];
  await assert.rejects(execute(f.o, f.driver), /SUBMISSION_UNCERTAIN/);
  assert.equal(f.counts().created, 1);
});
test("restart resumes known run", async (t) => {
  const f = await fixture(t);
  await execute(f.o, f.driver);
  const p = path.join(f.o.stateDir, "receipt.json");
  const s = JSON.parse(await readFile(p));
  s.status = "running";
  await writeFile(p, JSON.stringify(s));
  await execute(f.o, f.driver);
  assert.equal(f.counts().sent, 1);
});
test("abort confirms cancellation and prevents subsequent dispatch", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  f.o.signal = controller.signal;
  let cancel = false;
  f.run.wait = async () => {
    if (cancel) return { status: "cancelled" };
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  };
  f.run.cancel = async () => {
    cancel = true;
  };
  await assert.rejects(execute(f.o, f.driver), /CANCEL_REQUESTED/);
  const state = JSON.parse(
    await readFile(path.join(f.o.stateDir, "receipt.json")),
  );
  assert.equal(state.status, "cancelled");
  await assert.rejects(
    execute(f.o, f.driver),
    /PREVIOUS_ATTEMPT_REQUIRES_REVIEW/,
  );
});
test("unconfirmed cancellation blocks replacement", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  f.o.signal = controller.signal;
  f.run.wait = async () => {
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  };
  f.run.cancel = async () => {
    throw Error("offline");
  };
  await assert.rejects(execute(f.o, f.driver));
  const s = JSON.parse(await readFile(path.join(f.o.stateDir, "receipt.json")));
  assert.equal(s.status, "cancellation_unconfirmed");
  await assert.rejects(
    execute(f.o, f.driver),
    /PREVIOUS_ATTEMPT_REQUIRES_REVIEW/,
  );
});
test("state cannot live inside task directory", async (t) => {
  const f = await fixture(t);
  f.o.stateDir = path.join(f.o.taskDir, "state");
  await assert.rejects(execute(f.o, f.driver), /STATE_MUST_BE_OUTSIDE_TASK/);
});
test("live process lock blocks duplicate dispatch", async (t) => {
  const f = await fixture(t);
  await mkdir(f.o.stateDir);
  await writeFile(
    path.join(f.o.stateDir, "lock.json"),
    JSON.stringify({ pid: process.pid, host: os.hostname() }),
  );
  await assert.rejects(execute(f.o, f.driver), /STATE_LOCKED/);
  assert.equal(f.counts().created, 0);
});
test("request mismatch preserves original receipt byte-for-byte", async (t) => {
  const f = await fixture(t);
  await execute(f.o, f.driver);
  const p = path.join(f.o.stateDir, "receipt.json");
  const s = JSON.parse(await readFile(p));
  s.status = "running";
  await writeFile(p, JSON.stringify(s));
  const before = await readFile(p, "utf8");
  await assert.rejects(execute({ ...f.o, spec: "mismatch" }, f.driver));
  assert.equal(await readFile(p, "utf8"), before);
});
test("artifact download can resume without a second model execution", async (t) => {
  const f = await fixture(t, "cloud");
  const download = f.session.download;
  f.session.download = async () => {
    throw Error("temporary outage");
  };
  await assert.rejects(execute(f.o, f.driver));
  const s = JSON.parse(await readFile(path.join(f.o.stateDir, "receipt.json")));
  assert.equal(s.status, "collecting");
  f.session.download = download;
  await execute(f.o, f.driver);
  assert.equal(f.counts().sent, 1);
});
test("preflight failure preserves active run for later recovery", async (t) => {
  const f = await fixture(t);
  await execute(f.o, f.driver);
  const p = path.join(f.o.stateDir, "receipt.json");
  const s = JSON.parse(await readFile(p));
  s.status = "running";
  await writeFile(p, JSON.stringify(s));
  const before = await readFile(p, "utf8");
  f.driver.models = async () => {
    throw Error("rate limited");
  };
  await assert.rejects(execute(f.o, f.driver));
  assert.equal(await readFile(p, "utf8"), before);
});
test("input and output files cannot overlap", () =>
  assert.throws(
    () => validateRequest({ inputFiles: ["a"], expectFiles: ["a"] }, "local"),
    /INPUT_OUTPUT_OVERLAP/,
  ));
test("timeout requests cancellation and records terminal result", async (t) => {
  const f = await fixture(t);
  let cancelled = false;
  f.run.wait = async () =>
    cancelled ? { status: "cancelled" } : new Promise(() => {});
  f.run.cancel = async () => {
    cancelled = true;
  };
  await assert.rejects(execute(f.o, f.driver), /RUN_TIMEOUT/);
  assert.equal(
    JSON.parse(await readFile(path.join(f.o.stateDir, "receipt.json"))).status,
    "cancelled",
  );
});

test("automatic routing IDs are rejected before dispatch", async (t) => {
  const f = await fixture(t);
  for (const model of ["default", "auto", "auto-smart"])
    await assert.rejects(
      execute({ ...f.o, model }, f.driver),
      /EXPLICIT_MODEL_ID_REQUIRED/,
    );
  assert.equal(f.counts().created, 0);
});

test("failed artifact retrieval still records provider usage", async (t) => {
  const f = await fixture(t, "cloud");
  f.session.artifacts = async () => [];
  await assert.rejects(execute(f.o, f.driver));
  const r = JSON.parse(await readFile(path.join(f.o.stateDir, "receipt.json")));
  assert.deepEqual(r.usage, { tokens: 12 });
});
test("concurrent stale-lock recovery allows only one active dispatch", async (t) => {
  const f = await fixture(t);
  await mkdir(f.o.stateDir);
  await writeFile(
    path.join(f.o.stateDir, "lock.json"),
    JSON.stringify({ pid: 2000000000, host: os.hostname() }),
  );
  f.driver.models = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return ["test-model"];
  };
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => execute(f.o, f.driver)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.counts().created, 1);
  assert.equal(f.counts().sent, 1);
});
test("interrupted acquisition guard fails closed for operator reconciliation", async (t) => {
  const f = await fixture(t);
  await mkdir(f.o.stateDir);
  await writeFile(path.join(f.o.stateDir, "acquire.lock"), "unknown-owner");
  await assert.rejects(execute(f.o, f.driver), /STATE_LOCKED/);
  assert.equal(f.counts().created, 0);
});
test("invalid and duplicate model parameters are rejected", () => {
  for (const modelParams of [
    [{ id: "fast", value: true }],
    [
      { id: "fast", value: "false" },
      { id: "fast", value: "true" },
    ],
  ])
    assert.throws(
      () => validateRequest({ expectFiles: ["out"], modelParams }, "local"),
      /INVALID_MODEL_PARAMS/,
    );
});
