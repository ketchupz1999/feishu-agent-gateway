import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GatewayConfig } from "../config.js";
import type { ExecutorResult, Logger } from "../types.js";
import type { AgentChatExecutor, AgentRunInput } from "./types.js";

const IMAGE_TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp"
} as const;

/** 构造 Claude SDK 子进程的 CPA 路由与权限，不改用户全局 Claude 配置。 */
export function claudeQueryOptions(config: GatewayConfig, input: AgentRunInput, abortController: AbortController): Options {
  if (!config.provider) throw new Error("Claude SDK Gateway 需要启用 CPA");
  // 显式传入完整子进程环境；宿主应用凭据默认不继承。
  const safeKeys = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TZ", "TERM",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "SystemRoot", "COMSPEC", "PATHEXT",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES",
    "CODEX_APP_TOOLS_PIPE_PATH", "CODEX_CI", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "CODEX_MCP_NODE_PATH",
    "CODEX_PERMISSION_PROFILE", "CODEX_SAGE_BACKFILL_TRACKER_TAB_REUSE", "CODEX_SESSION_ID", "CODEX_SHELL", "CODEX_THREAD_ID"
  ]);
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    safeKeys.has(key) || key.startsWith("LC_") || key.startsWith("AGENTD_") || key.startsWith("CODEX_SANDBOX") ||
    config.passEnv?.includes(key)));
  // 显式透传也不能改变本实例的认证和 provider 路由。
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CPA_|GATEWAY_CPA_|FEISHU_)/.test(key)) delete env[key];
  }
  env.ANTHROPIC_BASE_URL = config.provider.baseUrl.replace(/\/v1$/, "");
  env.ANTHROPIC_AUTH_TOKEN = config.provider.apiKey;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return {
    cwd: config.workspace,
    ...(config.claudeCodePath ? { pathToClaudeCodeExecutable: config.claudeCodePath } : {}),
    model: input.model ?? config.model,
    ...(input.providerSessionId ? { resume: input.providerSessionId } : {}),
    abortController,
    env,
    effort: config.effort,
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: "你通过飞书与用户对话。回复简洁，适合手机阅读；需要澄清时直接用文字询问。" },
    permissionMode: "acceptEdits",
    sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
    // 自动允许的工作区操作由 Claude 的权限系统处理；需额外批准的操作不静默放行。
    canUseTool: async () => ({ behavior: "deny", message: "该操作需要额外授权；请向用户说明所需权限。" })
  };
}

/** 使用官方 Claude Agent SDK 执行图片/文字任务，并复用 Claude 原生 session。 */
export class ClaudeChatExecutor implements AgentChatExecutor {
  private active: Query | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly config: GatewayConfig, private readonly logger: Logger, private readonly queryFn: typeof query = query) {}

  /** 把一轮输入交给 Claude Code；只有 SDK 明确给出成功 result 才报告成功。 */
  async run(input: AgentRunInput): Promise<ExecutorResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    this.controller = controller;
    const cancel = () => controller.abort();
    if (input.signal?.aborted) cancel();
    else input.signal?.addEventListener("abort", cancel, { once: true });
    let sessionId = input.providerSessionId;
    let payload = "Claude Code 未返回完成结果";
    let ok = false;
    let lastText = "";
    try {
      controller.signal.throwIfAborted();
      const content: Exclude<SDKUserMessage["message"]["content"], string> = [{ type: "text", text: input.text }];
      for (const file of input.imagePaths ?? []) {
        const mediaType = IMAGE_TYPES[path.extname(file).toLowerCase() as keyof typeof IMAGE_TYPES];
        if (!mediaType) throw new Error("Claude 图片格式不支持");
        content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: await readFile(file, "base64") } });
      }
      controller.signal.throwIfAborted();
      async function* messages(): AsyncGenerator<SDKUserMessage> {
        yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
      }
      this.active = this.queryFn({ prompt: messages(), options: claudeQueryOptions(this.config, input, controller) });
      for await (const message of this.active) {
        if ("session_id" in message && typeof message.session_id === "string") sessionId = message.session_id;
        if (message.type === "assistant" && !message.error) {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text.trim()) {
              lastText = block.text;
              await this.notify(() => input.onText(block.text));
            } else if (block.type === "tool_use") {
              const command = block.name === "Bash" && typeof block.input === "object" && block.input
                ? (block.input as Record<string, unknown>).command : undefined;
              await this.notify(() => input.onStatus(typeof command === "string" ? `执行命令: ${command}` : `工具调用: ${block.name}`));
            }
          }
        }
        if (message.type === "result") {
          ok = message.subtype === "success" && !message.is_error;
          payload = message.subtype === "success" ? message.result || lastText : message.errors.join("\n") || message.subtype;
          if (ok && payload && payload !== lastText) await this.notify(() => input.onText(payload));
          break;
        }
      }
    } catch (error) {
      payload = error instanceof Error ? error.message : "Claude Code 执行失败";
      if (this.config.provider?.apiKey) payload = payload.replaceAll(this.config.provider.apiKey, "[REDACTED]");
      this.logger.error("claude executor failed", { message: payload, gatewaySessionId: input.gatewaySessionId });
    } finally {
      input.signal?.removeEventListener("abort", cancel);
      this.active?.close();
      this.active = null;
      this.controller = null;
    }
    return { status: controller.signal.aborted ? "canceled" : ok ? "ok" : "error", resultKind: "text", payload,
      providerSessionId: sessionId, durationMs: Date.now() - startedAt };
  }

  /** 终止当前 SDK 子进程，和图片下载共享上层任务取消状态。 */
  async interrupt(): Promise<boolean> {
    if (!this.controller) return false;
    this.controller.abort();
    this.active?.close();
    return true;
  }

  private async notify(send: () => Promise<void>): Promise<void> {
    try { await send(); } catch { this.logger.warn("claude notification failed"); }
  }
}
