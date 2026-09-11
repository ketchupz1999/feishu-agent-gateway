import test from "node:test";
import assert from "node:assert/strict";
import type * as Lark from "@larksuiteoapi/node-sdk";
import { createLarkRuntime } from "../src/lark/client.js";
import type { ParsedMessage } from "../src/lark/event-parser.js";

test("image-only events still require the sender allowlist before application dispatch", async (t) => {
  // SDK 构造时会启动不可显式释放的缓存清理 interval；测试里不启动真实定时器。
  t.mock.timers.enable({ apis: ["setInterval"] });
  const runtime = createLarkRuntime({
    feishuAppId: "cli_test", feishuAppSecret: "test-secret", feishuAllowedOpenId: "ou_owner"
  } as any, { info() {}, warn() {}, error() {} });
  t.after(() => runtime.stop());
  let dispatcher!: Lark.EventDispatcher;
  // 使用 SDK 真实事件解析与处理器，只替换 WebSocket 建连。
  runtime.wsClient.start = async (params) => { dispatcher = params.eventDispatcher; };
  const accepted: ParsedMessage[] = [];
  await runtime.start(async message => { accepted.push(message); });
  for (const openId of ["ou_stranger", "ou_owner"]) {
    await dispatcher.invoke({
      schema: "2.0", header: { event_type: "im.message.receive_v1", event_id: `evt_${openId}` },
      event: {
        sender: { sender_id: { open_id: openId } },
        message: { message_id: `om_${openId}`, chat_id: "oc_test", message_type: "image", content: JSON.stringify({ image_key: "img_test" }) }
      }
    }, { needCheck: false });
  }
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.openId, "ou_owner");
  assert.equal(accepted[0]!.text, "");
  assert.deepEqual(accepted[0]!.imageKeys, ["img_test"]);
});

test("event ACK completes while the Agent task is still running, and later failures are handled", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const errors: string[] = [];
  const replies: string[] = [];
  const runtime = createLarkRuntime({
    feishuAppId: "cli_test", feishuAppSecret: "test-secret", feishuAllowedOpenId: "ou_owner"
  } as any, { info() {}, warn() {}, error: text => { errors.push(text); } });
  t.after(() => runtime.stop());
  let dispatcher!: Lark.EventDispatcher;
  runtime.wsClient.start = async params => { dispatcher = params.eventDispatcher; };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.after(release);
  let handled!: () => void;
  const failureHandled = new Promise<void>(resolve => { handled = resolve; });
  runtime.reply.sendText = async (_chat, text) => { replies.push(text); handled(); };
  let taskFinished = false;
  await runtime.start(async () => {
    await pending;
    taskFinished = true;
    throw new Error("test task failure");
  });
  const ack = dispatcher.invoke({
    schema: "2.0", header: { event_type: "im.message.receive_v1", event_id: "evt_ack" },
    event: {
      sender: { sender_id: { open_id: "ou_owner" } },
      message: { message_id: "om_ack", chat_id: "oc_test", message_type: "text", content: JSON.stringify({ text: "long task" }) }
    }
  }, { needCheck: false });
  const acknowledged = await Promise.race([
    ack.then(() => true),
    new Promise<boolean>(resolve => setImmediate(() => resolve(false)))
  ]);
  assert.equal(acknowledged, true, "SDK handler must ACK without waiting for task completion");
  assert.equal(taskFinished, false);
  release();
  await failureHandled;
  assert.equal(taskFinished, true);
  assert.equal(errors.length, 1);
  assert.match(replies[0]!, /test task failure/);
});

test("background failures stay handled when both logging and error replies fail", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let logAttempts = 0;
  let replyAttempts = 0;
  const runtime = createLarkRuntime({
    feishuAppId: "cli_test", feishuAppSecret: "test-secret", feishuAllowedOpenId: "ou_owner"
  } as any, { info() {}, warn() {}, error() { logAttempts++; throw new Error("log disk full"); } });
  t.after(() => runtime.stop());
  let dispatcher!: Lark.EventDispatcher;
  runtime.wsClient.start = async params => { dispatcher = params.eventDispatcher; };
  runtime.reply.sendText = async () => { replyAttempts++; throw new Error("Feishu unreachable"); };
  await runtime.start(async () => { throw new Error("task failed"); });
  await dispatcher.invoke({
    schema: "2.0", header: { event_type: "im.message.receive_v1", event_id: "evt_failure" },
    event: {
      sender: { sender_id: { open_id: "ou_owner" } },
      message: { message_id: "om_failure", chat_id: "oc_test", message_type: "text", content: JSON.stringify({ text: "task" }) }
    }
  }, { needCheck: false });
  // 让后台 Promise 链和 Node 的 unhandled-rejection 检查经过一轮事件循环。
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(replyAttempts, 1, "broken logging must not suppress the error reply attempt");
  assert.equal(logAttempts, 2);
});
