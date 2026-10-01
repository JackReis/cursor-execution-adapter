import {
  Agent,
  Cursor,
  JsonlLocalAgentStore,
  type AgentOptions,
  type SDKAgent,
} from "@cursor/sdk";
import path from "node:path";
import {
  readSafe,
  writeSafe,
  relativeFile,
  AdapterError,
  type Driver,
  type Options,
  type Session,
} from "./core.js";
export function sdkDriver(apiKey: string): Driver {
  const options = (o: Options): AgentOptions => ({
    apiKey,
    model: { id: o.model },
    ...(o.mode === "local"
      ? {
          tools: ["mcp"],
          local: {
            cwd: o.taskDir,
            customTools: {
              read_file: {
                description:
                  "Read an explicitly supplied input or expected output within the task directory.",
                inputSchema: {
                  type: "object",
                  properties: { path: { type: "string" } },
                  required: ["path"],
                  additionalProperties: false,
                },
                execute: async (args) => {
                  const p = relativeFile(args.path);
                  if (
                    ![
                      ...(o.request.inputFiles ?? []),
                      ...o.request.expectFiles,
                    ].includes(p)
                  )
                    throw new AdapterError("FILE_NOT_ALLOWLISTED");
                  return (await readSafe(o.taskDir, p, 256 * 1024)).toString(
                    "utf8",
                  );
                },
              },
              write_file: {
                description:
                  "Write a declared output file within the task directory.",
                inputSchema: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["path", "content"],
                  additionalProperties: false,
                },
                execute: async (args) => {
                  const p = relativeFile(args.path);
                  if (
                    !o.request.expectFiles.includes(p) ||
                    typeof args.content !== "string" ||
                    Buffer.byteLength(args.content) > 16 * 1024 * 1024
                  )
                    throw new AdapterError("INVALID_OUTPUT");
                  await writeSafe(o.taskDir, p, Buffer.from(args.content));
                  return "written";
                },
              },
            },
            store: new JsonlLocalAgentStore(path.join(o.stateDir, "sdk")),
            settingSources: [],
            enableAgentRetries: false,
            sandboxOptions: { enabled: true },
          },
        }
      : {
          cloud: {
            repos: [{ url: o.request.repo!, startingRef: o.request.ref! }],
            autoCreatePR: false,
            workOnCurrentBranch: false,
          },
        }),
  });
  const getOptions = (o: Options, id: string) =>
    o.mode === "cloud"
      ? { runtime: "cloud" as const, agentId: id, apiKey }
      : {
          runtime: "local" as const,
          cwd: o.taskDir,
          store: new JsonlLocalAgentStore(path.join(o.stateDir, "sdk")),
        };
  const wrap = (a: SDKAgent, o: Options): Session => ({
    id: a.agentId,
    send: (p, k) => a.send(p, { idempotencyKey: k }),
    artifacts: () => a.listArtifacts(),
    download: (p) => a.downloadArtifact(p),
    usage: (id) => a.getUsage(o.mode === "cloud" ? { runId: id } : {}),
    close: () => a[Symbol.asyncDispose](),
  });
  return {
    models: async () => (await Cursor.models.list({ apiKey })).map((m) => m.id),
    create: async (o, id) =>
      wrap(
        await Agent.create({ ...options(o), agentId: id, idempotencyKey: id }),
        o,
      ),
    resume: async (o, id) => wrap(await Agent.resume(id, options(o)), o),
    getRun: (o, id, runId) => Agent.getRun(runId, getOptions(o, id)),
    runs: async (o, id) =>
      (
        await Agent.listRuns(
          id,
          o.mode === "cloud"
            ? { runtime: "cloud", apiKey, limit: 2 }
            : {
                runtime: "local",
                cwd: o.taskDir,
                store: new JsonlLocalAgentStore(path.join(o.stateDir, "sdk")),
                limit: 2,
              },
        )
      ).items,
  };
}
