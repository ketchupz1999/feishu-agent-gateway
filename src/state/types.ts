export interface ThreadMeta {
  id: string;
  title: string;
  model: string;
  updatedAt: number; // timestamp
  pinned: boolean;
  firstUserMessage?: string;
}

export interface SessionStore {
  recordThread?(thread: ThreadMeta): void;
  listThreads(limit?: number): ThreadMeta[];
  getThread(threadId: string): ThreadMeta | null;
  getCurrentThreadId(): string | null;
  setCurrentThreadId(threadId: string | null): void;
  pinThread(threadId: string, pinned: boolean): void;
  // 提供统一的格式化输出供 /sessions 和 /top 使用
  formatThreadList(threads: ThreadMeta[], currentThreadId: string | null): string;
  formatPinnedList(threads: ThreadMeta[], currentThreadId: string | null): string;
  resolveTarget(target: string, threads: ThreadMeta[]): string | null;
}
