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
