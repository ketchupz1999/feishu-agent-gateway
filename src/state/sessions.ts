import fs from "node:fs";
import path from "node:path";
import type { ThreadMeta } from "./types.js";

type Index = { version: 1; current: string | null; sessions: Record<string, ThreadMeta> };

/** 索引此 Gateway 创建的 Claude 原生会话。 */
export class ClaudeSessionStore {
  private readonly file: string;

  constructor(dataDir: string) { this.file = path.join(dataDir, ".gateway_claude_sessions.json"); }

  private read(): Index {
    if (!fs.existsSync(this.file)) return { version: 1, current: null, sessions: {} };
    const index = JSON.parse(fs.readFileSync(this.file, "utf8")) as Index;
    if (index.version !== 1 || !index.sessions || typeof index.sessions !== "object" || Array.isArray(index.sessions)) {
      throw new Error("Claude 会话索引格式错误");
    }
    return index;
  }

  private save(index: Index): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(index, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  /** 保存 SDK 返回的会话 ID 和必要展示信息，保留首次问题与置顶状态。 */
  recordThread(thread: ThreadMeta): void {
    const index = this.read();
    const old = index.sessions[thread.id];
    index.sessions[thread.id] = { ...thread, title: old?.title || thread.title,
      pinned: old?.pinned ?? false };
    this.save(index);
  }

  /** 按最近使用时间列出本 Gateway 的 Claude 会话。 */
  listThreads(limit = 20): ThreadMeta[] {
    return Object.values(this.read().sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  /** 获取当前索引内的 Claude 会话。 */
  getThread(id: string): ThreadMeta | null {
    const sessions = this.read().sessions;
    return Object.hasOwn(sessions, id) ? sessions[id]! : null;
  }

  /** 读取当前 Claude 会话指针。 */
  getCurrentThreadId(): string | null { return this.read().current; }

  /** 切换或清空 Claude 指针；只允许索引中存在的会话 ID。 */
  setCurrentThreadId(id: string | null): void {
    const index = this.read();
    if (id && !Object.hasOwn(index.sessions, id)) throw new Error("未找到 Claude 会话");
    index.current = id;
    this.save(index);
  }

  /** 修改已有 Claude 会话的置顶状态。 */
  pinThread(id: string, pinned: boolean): void {
    const index = this.read();
    if (!Object.hasOwn(index.sessions, id)) throw new Error("未找到 Claude 会话");
    index.sessions[id]!.pinned = pinned;
    this.save(index);
  }

  /** 格式化当前列表；序号与切换命令一致。 */
  formatThreadList(threads: ThreadMeta[], current: string | null): string {
    if (!threads.length) return "暂无 Claude 历史会话";
    return ["## Claude Code 会话", ...threads.map((thread, i) =>
      `${i + 1}. ${thread.pinned ? "[置顶] " : ""}${thread.title.replace(/[\r\n]+/g, " ").slice(0, 80)}${thread.id === current ? " ◀ 当前" : ""}\n模型：${thread.model}`
    ), "切换：`/switch 1`"].join("\n\n");
  }

  /** 展示列表内已置顶的 Claude 会话。 */
  formatPinnedList(threads: ThreadMeta[], current: string | null): string {
    return this.formatThreadList(threads.filter(thread => thread.pinned), current);
  }

  /** 只解析给定列表中的序号或会话 ID。 */
  resolveTarget(target: string, threads: ThreadMeta[]): string | null {
    const key = target.trim();
    return /^\d+$/.test(key) ? threads[Number(key) - 1]?.id ?? null : threads.find(thread => thread.id === key)?.id ?? null;
  }
}
