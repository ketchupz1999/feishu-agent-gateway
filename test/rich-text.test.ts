import test from "node:test";
import assert from "node:assert/strict";

import { markdownToCard, shouldUseCard, splitText } from "../src/lark/rich-text.js";

test("shouldUseCard returns true for markdown and long multi-line text", () => {
  assert.equal(shouldUseCard("## 标题\n- a\n- b"), true);
  assert.equal(shouldUseCard("短消息"), false);
});

test("splitText splits oversized text by newline preference", () => {
  const chunks = splitText("a\n".repeat(3000), 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test("markdownToCard builds a Feishu card payload", () => {
  const card = markdownToCard("## 标题\n- 第一项\n- 第二项") as any;
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.title.content, "标题");
  assert.equal(Array.isArray(card.body.elements), true);
  assert.equal(card.body.elements[0].tag, "markdown");
});
