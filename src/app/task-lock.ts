import type { ActiveTask } from "../types.js";

export class TaskLock {
  private activeTask: ActiveTask | null = null;

  getActiveTask(): ActiveTask | null {
    return this.activeTask;
  }

  isBusy(): boolean {
    return this.activeTask !== null;
  }

  acquire(task: ActiveTask): boolean {
    if (this.activeTask) {
      return false;
    }
    this.activeTask = task;
    return true;
  }

  markCancelRequested(): boolean {
    if (!this.activeTask) {
      return false;
    }
    this.activeTask = {
      ...this.activeTask,
      status: "cancel_requested"
    };
    return true;
  }

  release(requestId: string): boolean {
    if (!this.activeTask || this.activeTask.requestId !== requestId) {
      return false;
    }
    this.activeTask = null;
    return true;
  }
}
