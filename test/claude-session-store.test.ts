import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeSessionStore } from "../src/state/sessions.js";

test("session index preserves history and pins across restart, leaving unrelated files intact", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unrelatedFile = path.join(dir, "unrelated-state.txt");
  fs.writeFileSync(unrelatedFile, "unregistered-session");
  const store = new ClaudeSessionStore(dir);
  assert.equal(store.getCurrentThreadId(), null);
  assert.throws(() => store.setCurrentThreadId("unregistered-session"), /未找到/);
  store.recordThread({ id: "claude-one", title: "首个问题", model: "gemini-3.8-flash-high", updatedAt: 1, pinned: false });
  store.setCurrentThreadId("claude-one");
  store.pinThread("claude-one", true);
  store.recordThread({ id: "claude-one", title: "后续问题", model: "gemini-3.8-flash-high", updatedAt: 2, pinned: false });
  const restarted = new ClaudeSessionStore(dir);
  assert.equal(restarted.getCurrentThreadId(), "claude-one");
  assert.equal(restarted.getThread("claude-one")?.title, "首个问题");
  assert.equal(restarted.getThread("claude-one")?.pinned, true);
  assert.equal(restarted.resolveTarget("1", restarted.listThreads()), "claude-one");
  restarted.setCurrentThreadId(null);
  assert.equal(restarted.listThreads().length, 1);
  assert.equal(fs.readFileSync(unrelatedFile, "utf8"), "unregistered-session");
});
