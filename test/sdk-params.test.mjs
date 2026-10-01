import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, Cursor } from "@cursor/sdk";
import { sdkDriver } from "../dist/sdk.js";
const model = {
  id: "fixture",
  displayName: "Fixture",
  parameters: [
    {
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true" }],
    },
  ],
};
function fixture(t) {
  const originals = {
    list: Cursor.models.list,
    create: Agent.create,
    resume: Agent.resume,
  };
  t.after(() => {
    Cursor.models.list = originals.list;
    Agent.create = originals.create;
    Agent.resume = originals.resume;
  });
  let listed = 0;
  const dispatched = [];
  Cursor.models.list = async () => {
    listed++;
    return [model];
  };
  Agent.create = async (o) => {
    dispatched.push(o);
    return { agentId: "bc-fixture" };
  };
  Agent.resume = async (id, o) => {
    dispatched.push(o);
    return { agentId: id };
  };
  const o = {
    mode: "cloud",
    taskDir: "/task",
    stateDir: "/state",
    model: "fixture",
    spec: "fixture",
    request: {
      repo: "https://github.com/example/fixture",
      ref: "a".repeat(40),
      expectFiles: ["out"],
      modelParams: [{ id: "fast", value: "false" }],
    },
  };
  return {
    o,
    driver: sdkDriver("fixture-key"),
    dispatched,
    listed: () => listed,
  };
}
test("preflight metadata validates parameters and is reused by create and resume", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.driver.models(), ["fixture"]);
  await f.driver.create(f.o, "bc-fixture");
  await f.driver.resume(f.o, "bc-fixture");
  assert.equal(f.listed(), 1);
  for (const o of f.dispatched)
    assert.deepEqual(o.model, {
      id: "fixture",
      params: [{ id: "fast", value: "false" }],
    });
});
test("parameter selection fetches catalog when caller omitted preflight", async (t) => {
  const f = fixture(t);
  await f.driver.create(f.o, "bc-fixture");
  assert.equal(f.listed(), 1);
});
test("unsupported parameter IDs and values fail before either dispatch method", async (t) => {
  const f = fixture(t);
  for (const method of ["create", "resume"])
    for (const params of [
      [{ id: "effort", value: "low" }],
      [{ id: "fast", value: "FALSE" }],
    ]) {
      f.o.request.modelParams = params;
      await assert.rejects(
        f.driver[method](f.o, "bc-fixture"),
        /MODEL_PARAMETER_UNAVAILABLE/,
      );
    }
  f.o.model = "missing";
  await assert.rejects(f.driver.create(f.o, "bc-fixture"), /MODEL_UNAVAILABLE/);
  assert.equal(f.dispatched.length, 0);
});
test("a new explicit preflight replaces stale parameter metadata", async (t) => {
  const f = fixture(t);
  await f.driver.models();
  Cursor.models.list = async () => [
    { id: "fixture", displayName: "Fixture", parameters: [] },
  ];
  await f.driver.models();
  await assert.rejects(
    f.driver.resume(f.o, "bc-fixture"),
    /MODEL_PARAMETER_UNAVAILABLE/,
  );
  assert.equal(f.dispatched.length, 0);
});
