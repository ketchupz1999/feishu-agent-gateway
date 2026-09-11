import type { ActiveTask } from "../types.js";
import { TaskLock } from "./task-lock.js";

export class StopController {
  constructor(private readonly taskLock: TaskLock) {}

  requestCancel(): { requested: boolean; task: ActiveTask | null } {
    const task = this.taskLock.getActiveTask();
    if (!task) {
      return { requested: false, task: null };
    }
    this.taskLock.markCancelRequested();
    return { requested: true, task: this.taskLock.getActiveTask() };
  }

  shouldDiscardLateResult(requestId: string): boolean {
    const active = this.taskLock.getActiveTask();
    if (!active) {
      return true;
    }
    return active.requestId !== requestId || active.status === "cancel_requested";
  }
}
