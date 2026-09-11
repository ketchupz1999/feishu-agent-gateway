import test from "node:test";
import assert from "node:assert/strict";
import { GatewayApp } from "../src/app/gateway.js";
import { ClaudeSessionStore } from "../src/state/sessions.js";
import { fixture, logger } from "./helpers.js";

test("picture input, follow-up, deduplication and model change share one lifecycle", async t => {
  const c = fixture(t);
  const messages: string[] = [];
  const inputs: any[] = [];
  let downloads = 0;
  const reply = { replyText: async (_id: string, text: string) => { messages.push(text); }, replyRich: async (_id: string, _chat: string, text: string) => { messages.push(text); }, sendText: async () => {}, sendRich: async () => {} };
  const app = new GatewayApp(c, logger, reply, async () => { downloads++; return { paths: ["image.png"], cleanup: async () => {} }; }, {
    run: async input => { inputs.push(input); return { status: "ok", resultKind: "text", payload: "ok", providerSessionId: "claude-first", durationMs: 1 }; }, interrupt: async () => true
  });
  const picture = { messageId: "om_image", chatId: "chat", openId: "owner", text: "", imageKeys: ["img"] };
  await app.handleMessage(picture);
  await app.handleMessage(picture);
  await app.handleMessage({ ...picture, messageId: "om_follow", text: "继续", imageKeys: undefined });
  assert.equal(downloads, 1);
  assert.equal(inputs[1].providerSessionId, "claude-first");
  assert.match(messages[0], /Claude Code/);
  await app.handleMessage({ ...picture, messageId: "om_model", text: "/model gpt-5.6-sol", imageKeys: undefined });
  assert.equal(app.status().model, "gpt-5.6-sol");
  assert.equal(new ClaudeSessionStore(c.dataDir).getCurrentThreadId(), null);
  assert.equal(new ClaudeSessionStore(c.dataDir).listThreads().length, 1);
});

test("stop cancels a pending task and a late success cannot restore its session", async t => {
  const c = fixture(t);
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const replies: string[] = [];
  const app = new GatewayApp(c, logger, {
    replyText: async (_id, text) => { replies.push(text); }, replyRich: async (_id, _chat, text) => { replies.push(text); }, sendText: async () => {}, sendRich: async () => {}
  }, async () => ({ paths: [], cleanup: async () => {} }), {
    run: async input => {
      started();
      await new Promise<void>(resolve => input.signal!.addEventListener("abort", () => resolve(), { once: true }));
      return { status: "ok", resultKind: "text", payload: "late", providerSessionId: "late-id", durationMs: 1 };
    }, interrupt: async () => true
  });
  const task = app.handleMessage({ messageId: "om_start", chatId: "chat", openId: "owner", text: "开始" });
  await ready;
  await app.handleMessage({ messageId: "om_model", chatId: "chat", openId: "owner", text: "/model gpt-5.6-sol" });
  assert.equal(app.status().model, c.model);
  await app.handleMessage({ messageId: "om_stop", chatId: "chat", openId: "owner", text: "/stop" });
  await task;
  assert.equal(app.status().busy, false);
  assert.equal(new ClaudeSessionStore(c.dataDir).getCurrentThreadId(), null);
});


test("restart restores the current session model and removed models start fresh", async t => {
  const c = fixture(t);
  const sessions = new ClaudeSessionStore(c.dataDir);
  sessions.recordThread({ id: "saved", title: "saved", model: "gpt-5.6-sol", updatedAt: 1, pinned: false });
  sessions.setCurrentThreadId("saved");
  const inputs: any[] = [];
  const reply = { replyText: async () => {}, replyRich: async () => {}, sendText: async () => {}, sendRich: async () => {} };
  const executor = { run: async (input: any) => { inputs.push(input); return { status: "ok" as const, resultKind: "text" as const, payload: "ok", providerSessionId: "saved", durationMs: 1 }; }, interrupt: async () => true };
  const download = async () => ({ paths: [], cleanup: async () => {} });
  const restored = new GatewayApp(c, logger, reply, download, executor);
  restored.initialize();
  await restored.handleMessage({ messageId: "follow", chatId: "chat", openId: "owner", text: "continue" });
  assert.equal(inputs[0].model, "gpt-5.6-sol");
  assert.equal(inputs[0].providerSessionId, "saved");
  const warnings: string[] = [];
  const removed = new GatewayApp({ ...c, models: [c.model] }, { ...logger, warn: text => { warnings.push(text); } }, reply, download, executor);
  assert.equal(sessions.getCurrentThreadId(), "saved", "construction must not mutate state before acquiring control");
  removed.initialize();
  assert.equal(sessions.getCurrentThreadId(), null);
  assert.equal(removed.status().model, c.model);
  assert.equal(warnings.length, 1);
});

test("model aliases: /model displays aliases and /model <alias> switches correctly", async t => {
  const aliases = { "g-gemini": "gemini-3.8-flash-high", "g-sol": "gpt-5.6-sol" };
  const c = { ...fixture(t), modelAliases: aliases };
  const messages: string[] = [];
  const reply = { replyText: async (_id: string, text: string) => { messages.push(text); }, replyRich: async (_id: string, _chat: string, text: string) => { messages.push(text); }, sendText: async () => {}, sendRich: async () => {} };
  const app = new GatewayApp(c, logger, reply, async () => ({ paths: [], cleanup: async () => {} }), {
    run: async () => ({ status: "ok" as const, resultKind: "text" as const, payload: "ok", providerSessionId: "s1", durationMs: 1 }), interrupt: async () => true
  });
  await app.handleMessage({ messageId: "m1", chatId: "chat", openId: "owner", text: "/model" });
  assert.match(messages[messages.length - 1], /g-gemini/);
  assert.match(messages[messages.length - 1], /g-sol/);
  await app.handleMessage({ messageId: "m2", chatId: "chat", openId: "owner", text: "/model g-sol" });
  assert.equal(app.status().model, "gpt-5.6-sol");
  assert.match(messages[messages.length - 1], /g-sol/);
  await app.handleMessage({ messageId: "m3", chatId: "chat", openId: "owner", text: "/status" });
  assert.match(messages[messages.length - 1], /g-sol/);
  await app.handleMessage({ messageId: "m4", chatId: "chat", openId: "owner", text: "/model gpt-5.6-sol" });
  assert.equal(app.status().model, "gpt-5.6-sol");
});
