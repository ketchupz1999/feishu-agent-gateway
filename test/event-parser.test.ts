import test from "node:test";
import assert from "node:assert/strict";

import { parseFeishuMessage, type ParseWarning } from "../src/lark/event-parser.js";

test("parseFeishuMessage warns and returns null for invalid json payload", () => {
  const warnings: ParseWarning[] = [];
  const parsed = parseFeishuMessage(
    {
      event: {
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          message_type: "text",
          content: "{bad-json"
        },
        sender: {
          sender_id: {
            open_id: "ou_xxx"
          }
        }
      }
    },
    (warning) => warnings.push(warning)
  );

  assert.equal(parsed, null);
  assert.deepEqual(warnings, [
    {
      reason: "invalid_json",
      messageId: "msg_1",
      messageType: "text"
    }
  ]);
});

test("parseFeishuMessage supports Node SDK top-level payload shape", () => {
  const parsed = parseFeishuMessage({
    event_id: "evt_1",
    sender: {
      sender_id: {
        open_id: "ou_top"
      },
      sender_type: "user"
    },
    message: {
      message_id: "msg_top",
      chat_id: "chat_top",
      create_time: "1742460000000",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "你好 @_user_1" }),
      mentions: [{ key: "@_user_1" }]
    }
  });

  assert.deepEqual(parsed, {
    messageId: "msg_top",
    chatId: "chat_top",
    openId: "ou_top",
    text: "你好",
    raw: {
      event_id: "evt_1",
      sender: {
        sender_id: {
          open_id: "ou_top"
        },
        sender_type: "user"
      },
      message: {
        message_id: "msg_top",
        chat_id: "chat_top",
        create_time: "1742460000000",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "你好 @_user_1" }),
        mentions: [{ key: "@_user_1" }]
      }
    },
    messageType: "text"
  });
});

test("parseFeishuMessage warns on malformed payload", () => {
  const warnings: ParseWarning[] = [];
  const parsed = parseFeishuMessage({ foo: "bar" }, (warning) => warnings.push(warning));

  assert.equal(parsed, null);
  assert.deepEqual(warnings, [
    {
      reason: "malformed_payload",
      detail: "missing event/message/sender",
      messageId: undefined,
      messageType: undefined
    }
  ]);
});

function imageEvent(type: string, content: unknown) {
  return {
    message: { message_id: "om_image", chat_id: "oc_image", message_type: type, content: JSON.stringify(content) },
    sender: { sender_id: { open_id: "ou_image" } }
  };
}

test("standalone image keeps its resource key even without text", () => {
  const message = parseFeishuMessage(imageEvent("image", { image_key: "img_1" }));
  assert.equal(message?.text, "");
  assert.deepEqual(message?.imageKeys, ["img_1"]);
});

test("post extracts localized text, links and images without duplicating image keys", () => {
  for (const wrap of [(body: unknown) => body, (body: unknown) => ({ zh_cn: body })]) {
    const message = parseFeishuMessage(imageEvent("post", wrap({
      title: "截图问题",
      content: [[{ tag: "text", text: "解释这里" }, { tag: "img", image_key: "img_1" }],
        [{ tag: "img", image_key: "img_1" }, { tag: "img", image_key: "img_2" },
          { tag: "a", text: "来源", href: "https://example.com" }]]
    })));
    assert.equal(message?.text, "截图问题 解释这里 来源 https://example.com");
    assert.deepEqual(message?.imageKeys, ["img_1", "img_2"]);
  }
});

test("malformed image or null content is rejected", () => {
  assert.equal(parseFeishuMessage(imageEvent("image", {})), null);
  assert.equal(parseFeishuMessage(imageEvent("image", null)), null);
});
