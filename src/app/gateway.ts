import type { GatewayConfig } from "../config.js";
import type { Logger, MessageContext } from "../types.js";
import type { ReplyAdapter } from "../lark/reply-adapter.js";
import type { DownloadedImages, ImageDownloader } from "../lark/image-download.js";
import { ClaudeChatExecutor } from "../runtime/claude.js";
import type { AgentChatExecutor } from "../runtime/types.js";
import { ClaudeSessionStore } from "../state/sessions.js";
import { TaskLock } from "./task-lock.js";
import { StopController } from "./stop-controller.js";
import { VERSION } from "../version.js";

type Reply = Pick<ReplyAdapter, "replyText" | "replyRich" | "sendText" | "sendRich">;
const CONTROLS = new Set(["/help", "/status", "/new", "/clear", "/model", "/sessions", "/switch", "/pin", "/unpin", "/top", "/stop"]);

/** 单实例共享一套消息处理与会话控制；业务能力由指定工作区的 Claude Skills 提供。 */
export class GatewayApp {
  private readonly seen = new Set<string>();
  private readonly lock = new TaskLock();
  private readonly cancellation = new StopController(this.lock);
  private readonly sessions: ClaudeSessionStore;
  private readonly reverseAliases: Map<string, string>;
  private controller: AbortController | null = null;
  private stopping = false;
  private model: string;

  constructor(
    private readonly config: GatewayConfig,
    private readonly logger: Logger,
    private readonly reply: Reply,
    private readonly downloadImages: ImageDownloader,
    private readonly executor: AgentChatExecutor = new ClaudeChatExecutor(config, logger)
  ) {
    this.sessions = new ClaudeSessionStore(config.dataDir);
    this.model = config.model;
    this.reverseAliases = new Map(Object.entries(config.modelAliases ?? {}).map(([alias, real]) => [real, alias]));
  }

  displayModel(realId: string): string {
    const alias = this.reverseAliases.get(realId);
    return alias ? alias : realId;
  }

  private resolveModelInput(input: string): string {
    const aliases = this.config.modelAliases ?? {};
    if (aliases[input]) return aliases[input];
    return input;
  }

  /** 获得实例控制权后恢复会话模型；配置移除的模型不静默替换。 */
  initialize(): void {
    const current = this.sessions.getCurrentThreadId();
    if (!current) return;
    const thread = this.sessions.getThread(current);
    if (thread && this.config.models.includes(thread.model)) {
      this.model = thread.model;
    } else {
      this.sessions.setCurrentThreadId(null);
      this.logger.warn("Current session model is unavailable; next message starts a new session", { sessionId: current });
    }
  }

  /** 暴露不含凭据的当前执行状态。 */
  status() { return { model: this.model, busy: this.lock.isBusy(), stopping: this.stopping }; }

  /** 停止接收新任务并中断已有下载/SDK 执行。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.cancellation.requestCancel();
    this.controller?.abort();
    await this.executor.interrupt();
  }

  /** 接收已通过飞书身份校验的消息，先去重与加锁，再产生下载和工具副作用。 */
  async handleMessage(message: MessageContext): Promise<void> {
    if (this.stopping || this.seen.has(message.messageId)) return;
    this.seen.add(message.messageId);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!);
    const [command, ...args] = message.text.trim().split(/\s+/);
    if (CONTROLS.has(command) || command === "help") {
      if (message.imageKeys?.length) {
        await this.reply.replyText(message.messageId, "图片请搭配普通提问；控制命令请单独发送", message.chatId);
        return;
      }
      const changesSession = ["/new", "/clear", "/switch"].includes(command) || (command === "/model" && args.length > 0);
      if (changesSession && this.lock.isBusy()) {
        await this.reply.replyText(message.messageId, "任务执行中，请先 /stop，待中断完成后再切换", message.chatId);
        return;
      }
      await this.control(message, command === "help" ? "/help" : command, args);
      return;
    }
    if (this.lock.isBusy()) {
      await this.reply.replyText(message.messageId, "有任务正在执行，请稍后重试；/stop 可中断", message.chatId);
      return;
    }
    await this.chat(message);
  }

  private async control(message: MessageContext, command: string, args: string[]): Promise<void> {
    const send = (text: string) => this.reply.replyRich(message.messageId, message.chatId, text);
    if (command === "/help") {
      await send("直接发送文字或图片即可提问。每条最多 4 张、每张 5 MiB。\n\n/new 新会话 · /model 模型 · /sessions 历史 · /switch 切换 · /pin 置顶 · /unpin 取消置顶 · /top 置顶列表 · /stop 中断 · /status 状态\n\n业务命令由工作区自己的 Claude Skills 提供。");
    } else if (command === "/status") {
      await send(`Gateway ${VERSION}\n运行时：Claude Code\n提供方：CPA\n模型：${this.displayModel(this.model)}\n状态：${this.lock.isBusy() ? "执行中" : "空闲"}`);
    } else if (command === "/stop") {
      if (!this.cancellation.requestCancel().requested) { await send("当前没有执行中的任务"); return; }
      this.controller?.abort();
      await this.executor.interrupt();
      this.sessions.setCurrentThreadId(null);
      await send("已中断当前任务，下次消息开启新会话");
    } else if (command === "/new" || command === "/clear") {
      this.sessions.setCurrentThreadId(null);
      await send("下次消息将开启新会话，历史记录保留");
    } else if (command === "/model") {
      if (!args[0]) { await send(`当前模型：${this.displayModel(this.model)}\n\n${this.config.models.map(id => `/model ${this.displayModel(id)}`).join("\n")}`); return; }
      const resolved = this.resolveModelInput(args[0]);
      const exact = this.config.models.find(id => id === resolved);
      const displayNames = this.config.models.map(id => ({ id, display: this.displayModel(id) }));
      const aliasMatch = !exact ? displayNames.filter(m => m.display === args[0]).map(m => m.id) : [];
      const matches = exact ? [exact] : aliasMatch.length === 1 ? aliasMatch : this.config.models.filter(id => id.startsWith(resolved) || this.displayModel(id).startsWith(args[0]));
      if (matches.length !== 1) { await send(matches.length ? "匹配多个模型，请输入完整模型名" : "模型不在配置列表中"); return; }
      this.model = matches[0];
      this.sessions.setCurrentThreadId(null);
      await send(`模型已切换为 ${this.displayModel(this.model)}，下次消息开启新会话`);
    } else {
      const threads = this.sessions.listThreads(50);
      if (command === "/sessions") { await send(this.sessions.formatThreadList(threads, this.sessions.getCurrentThreadId(), id => this.displayModel(id))); return; }
      if (command === "/top") { await send(this.sessions.formatPinnedList(threads, this.sessions.getCurrentThreadId(), id => this.displayModel(id))); return; }
      const candidates = command === "/unpin" ? threads.filter(thread => thread.pinned) : threads;
      const id = this.sessions.resolveTarget(args[0] ?? "", candidates);
      if (!id) { await send(`未找到会话；用法：${command} <序号或 ID>`); return; }
      if (command === "/switch") {
        const thread = this.sessions.getThread(id)!;
        if (!this.config.models.includes(thread.model)) { await send("该会话模型已不在配置列表中，请先更新模型配置"); return; }
        this.model = thread.model;
        this.sessions.setCurrentThreadId(id);
        await send("已切换 Claude 会话");
      } else {
        this.sessions.pinThread(id, command === "/pin");
        await send(command === "/pin" ? "已置顶" : "已取消置顶");
      }
    }
  }

  private async chat(message: MessageContext): Promise<void> {
    const requestId = message.messageId;
    const model = this.model;
    const sessionId = this.sessions.getCurrentThreadId();
    if (!this.lock.acquire({ requestId, taskType: "chat", startedAt: Date.now(), cancelMode: "agent_interrupt", status: "running" })) return;
    const controller = new AbortController();
    this.controller = controller;
    let images: DownloadedImages | undefined;
    let keepImages = false;
    try {
      await this.reply.replyText(message.messageId, `正在执行… [Claude Code · ${this.displayModel(model)}]`, message.chatId);
      if (message.imageKeys?.length) images = await this.downloadImages(message, controller.signal);
      if (this.cancellation.shouldDiscardLateResult(requestId)) return;
      const result = await this.executor.run({
        text: message.text.trim() || "请分析这条消息中的图片。", imagePaths: images?.paths, model,
        gatewaySessionId: sessionId ?? requestId, providerSessionId: sessionId ?? undefined, signal: controller.signal,
        onText: async text => { if (!this.cancellation.shouldDiscardLateResult(requestId)) await this.reply.sendRich(message.chatId, text); },
        onStatus: async status => { if (!this.cancellation.shouldDiscardLateResult(requestId)) await this.reply.sendText(message.chatId, `[进度] ${status}`); }
      });
      if (this.cancellation.shouldDiscardLateResult(requestId)) return;
      if (result.status !== "ok" || !result.providerSessionId) { await this.reply.sendRich(message.chatId, result.payload || "任务未完成"); return; }
      this.sessions.recordThread({ id: result.providerSessionId, title: message.text.trim().slice(0, 120) || "图片对话",
        model, updatedAt: Date.now() / 1000, pinned: false });
      this.sessions.setCurrentThreadId(result.providerSessionId);
      keepImages = true;
      await this.reply.sendText(message.chatId, "任务已完成");
    } catch (error) {
      this.logger.error("Task failed", { error });
      const messageText = error instanceof Error && /^(每条消息最多|单张图片不能|图片格式不|图片下载)/.test(error.message)
        ? error.message : "任务处理失败，请查看本机日志或重发";
      if (!controller.signal.aborted) await this.reply.replyText(message.messageId, messageText, message.chatId);
    } finally {
      if (images && !keepImages) await images.cleanup().catch(() => this.logger.warn("Attachment cleanup failed"));
      if (this.controller === controller) this.controller = null;
      this.lock.release(requestId);
    }
  }
}
