export type Logger = {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};
export type MessageContext = { messageId: string; chatId: string; openId: string; text: string; imageKeys?: string[] };
export type ExecutorResult = {
  status: "ok" | "error" | "canceled" | "timeout";
  resultKind: "text"; payload: string; providerSessionId?: string; durationMs: number;
};
export type ActiveTask = {
  requestId: string; taskType: "chat"; startedAt: number; gatewaySessionId?: string;
  cancelMode: "agent_interrupt"; status: "running" | "cancel_requested";
};
