import type { ExecutorResult } from "../types.js";

// 统一的流式事件回调
export type StreamCallbacks = {
  onText: (chunk: string) => Promise<void>;
  onStatus: (status: string) => Promise<void>;
};

// 抽象出的执行器输入
export type AgentRunInput = {
  text: string;
  imagePaths?: string[];
  signal?: AbortSignal;
  gatewaySessionId: string;
  providerSessionId?: string; // 具体的 Thread ID 或 Agent Session ID
  model?: string; // provider 侧的模型名
} & StreamCallbacks;

export interface AgentChatExecutor {
  run(input: AgentRunInput): Promise<ExecutorResult>;
  interrupt(): Promise<boolean>;
}
