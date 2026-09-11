import test from "node:test";
import assert from "node:assert/strict";

import { TaskLock } from "../src/app/task-lock.js";
import { StopController } from "../src/app/stop-controller.js";

test("TaskLock only allows one active task", () => {
  const lock = new TaskLock();
  const acquired1 = lock.acquire({
    requestId: "req1",
    taskType: "chat",
    startedAt: Date.now(),
    cancelMode: "agent_interrupt",
    status: "running"
  });
  const acquired2 = lock.acquire({
    requestId: "req2",
    taskType: "chat",
    startedAt: Date.now(),
    cancelMode: "agent_interrupt",
    status: "running"
  });
  assert.equal(acquired1, true);
  assert.equal(acquired2, false);
});

test("StopController marks cancel requested and discards late results", () => {
  const lock = new TaskLock();
  lock.acquire({
    requestId: "req1",
    taskType: "chat",
    startedAt: Date.now(),
    cancelMode: "agent_interrupt",
    status: "running"
  });
  const controller = new StopController(lock);
  const result = controller.requestCancel();
  assert.equal(result.requested, true);
  assert.equal(result.task?.status, "cancel_requested");
  assert.equal(controller.shouldDiscardLateResult("req1"), true);
});
