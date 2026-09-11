import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeChatExecutor, claudeQueryOptions } from "../src/runtime/claude.js";
import type { GatewayConfig } from "../src/config.js";

const config = { workspace: "/tmp/claude-work", runtime: "claude-sdk", model: "gemini-3.8-flash-high",
  effort: "high", provider: { type: "cpa", baseUrl: "http://127.0.0.1:8317/v1", apiKey: "private-cpa-key" } } as GatewayConfig;
const logger = { info() {}, warn() {}, error() {} };
const input = { text: "解释截图", gatewaySessionId: "new", onText: async () => {}, onStatus: async () => {} };

test("Claude SDK receives CPA environment, native resume and sandbox policy", async () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  const oldBase = process.env.ANTHROPIC_BASE_URL;
  const otherKeys = ["CPA_API_KEY", "GATEWAY_CPA_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AZURE_OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "NPM_TOKEN", "DATABASE_URL", "COMPANY_CUSTOM_SECRET"];
  const oldValues = Object.fromEntries(otherKeys.map(key => [key, process.env[key]]));
  for (const key of otherKeys) process.env[key] = `unused-${key}`;
  process.env.ANTHROPIC_API_KEY = "unrelated-key";
  try {
    const options = claudeQueryOptions(config, { ...input, providerSessionId: "claude-session" }, new AbortController());
    assert.equal(options.env?.ANTHROPIC_BASE_URL, "http://127.0.0.1:8317");
    assert.equal(options.env?.ANTHROPIC_AUTH_TOKEN, "private-cpa-key");
    assert.equal(options.env?.ANTHROPIC_API_KEY, undefined);
    assert.equal(options.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    for (const key of otherKeys) {
      assert.equal(options.env?.[key], undefined, `${key} must not reach the SDK child`);
      assert.equal(process.env[key], `unused-${key}`, "parent environment must stay unchanged");
    }
    assert.equal(options.resume, "claude-session");
    assert.equal(options.model, "gemini-3.8-flash-high");
    assert.equal(options.permissionMode, "acceptEdits");
    assert.equal(options.sandbox?.enabled, true);
    assert.equal(options.sandbox?.allowUnsandboxedCommands, false);
    assert.equal(options.sandbox?.failIfUnavailable, true);
    const denied = await options.canUseTool!("Bash", { command: "outside-operation" }, { signal: AbortSignal.abort(), toolUseID: "test" } as any);
    assert.equal(denied?.behavior, "deny");
    assert.equal(process.env.ANTHROPIC_API_KEY, "unrelated-key");
    assert.equal(process.env.ANTHROPIC_BASE_URL, oldBase);
    assert.throws(() => claudeQueryOptions({ ...config, provider: undefined } as any, input, new AbortController()), /需要启用 CPA/);
  } finally {
    for (const [key, value] of Object.entries(oldValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});

test("explicit tool environment keeps runtime guards and opt-in variables", () => {
  const values = { NODE_OPTIONS: "--enable-source-maps", AGENTD_HOME: "/guard", CODEX_PERMISSION_PROFILE: "restricted", TASK_TOKEN: "explicit", ANTHROPIC_API_KEY: "forbidden" };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const env = claudeQueryOptions({ ...config, passEnv: ["TASK_TOKEN", "ANTHROPIC_API_KEY"] }, input, new AbortController()).env!;
    for (const key of ["NODE_OPTIONS", "AGENTD_HOME", "CODEX_PERMISSION_PROFILE", "TASK_TOKEN"]) assert.equal(env[key], values[key as keyof typeof values]);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("images are sent as Claude base64 image blocks", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-image-unit-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "image.png");
  const bytes = Buffer.from("test-image-bytes");
  await fs.writeFile(file, bytes);
  const received: any[] = [];
  const replies: string[] = [];
  let closed = false;
  const executor = new ClaudeChatExecutor(config, logger, ((params: any) => Object.assign((async function* () {
    for await (const message of params.prompt) received.push(message);
    yield { type: "system", subtype: "init", session_id: "claude-native-session" };
    yield { type: "assistant", message: { content: [{ type: "text", text: "图片说明" }] } };
    yield { type: "result", subtype: "success", is_error: false, result: "", session_id: "claude-native-session" };
  })(), { close: () => { closed = true; } })) as any);
  const result = await executor.run({ ...input, imagePaths: [file], onText: async text => { replies.push(text); } });
  assert.equal(result.status, "ok");
  assert.equal(result.providerSessionId, "claude-native-session");
  assert.equal(result.payload, "图片说明");
  assert.deepEqual(received[0].message.content, [
    { type: "text", text: "解释截图" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } }
  ]);
  assert.deepEqual(replies, ["图片说明"]);
  assert.equal(closed, true);
});

test("Claude result errors and missing result never become successful tasks", async () => {
  for (const resultMessage of [
    { type: "result", subtype: "success", is_error: true, result: "API rejected image", session_id: "failed-session" },
    { type: "result", subtype: "error_max_turns", is_error: true, errors: ["turn limit"], session_id: "failed-session" },
    null
  ]) {
    const executor = new ClaudeChatExecutor(config, logger, (() => Object.assign((async function* () {
      if (resultMessage) yield resultMessage;
    })(), { close() {} })) as any);
    assert.equal((await executor.run(input)).status, "error");
  }
});

test("canceling Claude SDK uses its abort controller and closes the query", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal!: AbortSignal;
  let closed = false;
  const executor = new ClaudeChatExecutor(config, logger, ((params: any) => Object.assign((async function* () {
    signal = params.options.abortController.signal;
    started();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  })(), { close() { closed = true; } })) as any);
  const pending = executor.run(input);
  await ready;
  assert.equal(await executor.interrupt(), true);
  assert.equal((await pending).status, "canceled");
  assert.equal(signal.aborted, true);
  assert.equal(closed, true);
});

test("already canceled input does not spawn Claude and exception text redacts the CPA key", async () => {
  const executor = new ClaudeChatExecutor(config, logger, (() => { throw new Error("private-cpa-key request failed"); }) as any);
  assert.equal((await executor.run({ ...input, signal: AbortSignal.abort() })).status, "canceled");
  const failure = await executor.run(input);
  assert.equal(failure.status, "error");
  assert.doesNotMatch(String(failure.payload), /private-cpa-key/);
});
