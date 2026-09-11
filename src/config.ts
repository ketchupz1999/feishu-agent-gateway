import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";

export type GatewayConfig = {
  configFile: string; workspace: string; dataDir: string; logDir: string; pidFile: string; currentDate: string;
  runtime: "claude-sdk"; model: string; models: string[]; effort: "low" | "medium" | "high" | "xhigh" | "max";
  provider: { type: "cpa"; baseUrl: string; apiKey: string };
  claudeCodePath?: string; controlPort: number; passEnv?: string[];
  feishuSecretsFile: string; feishuAppId: string; feishuAppSecret: string; feishuAllowedOpenId: string;
  allowedChatIds: string[];
  listeners: Array<{ name: string; command: string[]; env: Record<string, string> }>;
};

export const defaultConfigFile = () => path.join(os.homedir(), ".config", "feishu-agent-gateway", "config.yaml");

export type StateConfig = Pick<GatewayConfig, "configFile" | "dataDir" | "logDir" | "pidFile">;

function defaultDataDir(configFile: string): string {
  return path.join(os.homedir(), ".local", "share", "feishu-agent-gateway", createHash("sha256").update(configFile).digest("hex").slice(0, 12));
}

function readDocument(file: string) {
  const configFile = path.resolve(file);
  try { return { configFile, base: path.dirname(configFile), raw: object(parse(fs.readFileSync(configFile, "utf8")), "config") }; }
  catch { throw new Error(`Cannot read config: ${configFile}. Run 'feishu-agent-gateway init' first.`); }
}

function statePaths(raw: Record<string, any>, base: string, configFile: string): StateConfig {
  const dataDir = resolveFile(required(raw.data_dir ?? defaultDataDir(configFile), "data_dir"), base);
  return { configFile, dataDir, logDir: path.join(dataDir, "logs"), pidFile: path.join(dataDir, "gateway.pid") };
}

/** 停止与查看状态不依赖已经过期或被移除的模型/飞书凭据。 */
export function loadStateConfig(file = defaultConfigFile()): StateConfig {
  const { raw, base, configFile } = readDocument(file);
  return statePaths(raw, base, configFile);
}

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a mapping`);
  return value as Record<string, any>;
}

function resolveFile(value: string, base: string): string {
  return path.resolve(base, value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value);
}

function secretFile(value: unknown, base: string): Record<string, string> {
  if (!value) return {};
  if (typeof value !== "string") throw new Error("credentials_file must be a path");
  const file = resolveFile(value, base);
  try { return object(JSON.parse(fs.readFileSync(file, "utf8")), "credentials_file"); }
  catch { throw new Error(`Cannot read credentials file: ${file}`); }
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`);
  return value.trim();
}

/** 从显式配置加载运行目录与私有凭据；不推测任何宿主仓库结构。 */
export function loadConfig(file = defaultConfigFile(), workspaceOverride?: string): GatewayConfig {
  const { raw, base, configFile } = readDocument(file);
  const workspace = resolveFile(required(workspaceOverride ?? raw.workspace, "workspace"), base);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("workspace must be an existing directory");
  const { dataDir } = statePaths(raw, base, configFile);
  if (raw.runtime !== "claude-sdk") throw new Error("v2 requires runtime: claude-sdk");
  const provider = object(raw.provider, "provider");
  if (provider.type !== "cpa") throw new Error("v2 requires provider.type: cpa");
  let url: URL;
  try { url = new URL(required(process.env.CPA_BASE_URL ?? provider.base_url, "provider.base_url")); }
  catch { throw new Error("Invalid provider.base_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("provider.base_url must be HTTP(S) without credentials or query parameters");
  const providerSecret = process.env.CPA_API_KEY ? {} : secretFile(provider.credentials_file, base);
  const apiKey = required(process.env.CPA_API_KEY ?? providerSecret.api_key, "CPA_API_KEY or provider.credentials_file api_key");
  const feishu = object(raw.feishu, "feishu");
  const feishuSecret = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && (process.env.FEISHU_ALLOWED_OPEN_ID || feishu.allowed_open_id)
    ? {} : secretFile(feishu.credentials_file, base);
  const model = required(raw.model, "model");
  if (!Array.isArray(raw.models ?? [])) throw new Error("models must be an array");
  const models: string[] = [...new Set([model, ...(raw.models ?? [])])];
  if (models.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(id))) throw new Error("models must contain valid model IDs");
  const effort = raw.effort ?? "high";
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("Invalid effort");
  const controlPort = raw.control_port ?? (10240 + createHash("sha256").update(dataDir).digest().readUInt16BE() % 40000);
  if (!Number.isInteger(controlPort) || controlPort < 1024 || controlPort > 65535) throw new Error("control_port must be 1024..65535");
  const allowedChatIds = feishu.allowed_chat_ids ?? [];
  if (!Array.isArray(allowedChatIds) || allowedChatIds.some(id => typeof id !== "string")) throw new Error("feishu.allowed_chat_ids must be a string array");
  const passEnv = raw.pass_env ?? [];
  if (!Array.isArray(passEnv) || passEnv.some(key => typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error("pass_env must contain environment variable names");
  const listeners: GatewayConfig["listeners"] = [];
  for (const [name, value] of Object.entries(raw.listener_channels ?? {})) {
    const listener = object(value, `listener_channels.${name}`);
    if (listener.enabled !== undefined && typeof listener.enabled !== "boolean") throw new Error("listener enabled must be boolean");
    if (!listener.enabled) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !Array.isArray(listener.command) || !listener.command.length || listener.command.some((arg: unknown) => typeof arg !== "string")) throw new Error("listener command must be a nonempty argv array");
    const env = Object.fromEntries(Object.entries(listener.env ?? {}).map(([key, value]) => [key, String(value)]));
    listeners.push({ name, command: listener.command, env });
  }
  return {
    configFile, workspace, dataDir, logDir: path.join(dataDir, "logs"), pidFile: path.join(dataDir, "gateway.pid"), currentDate: new Date().toISOString().slice(0, 10),
    runtime: "claude-sdk", model, models, effort, controlPort,
    provider: { type: "cpa", baseUrl: url.toString().replace(/\/+$/, ""), apiKey },
    claudeCodePath: process.env.CLAUDE_CODE_PATH ?? (raw.claude_command ? resolveFile(raw.claude_command, base) : undefined),
    feishuSecretsFile: feishu.credentials_file ? resolveFile(feishu.credentials_file, base) : "environment",
    feishuAppId: required(process.env.FEISHU_APP_ID ?? feishuSecret.app_id, "FEISHU_APP_ID or feishu app_id"),
    feishuAppSecret: required(process.env.FEISHU_APP_SECRET ?? feishuSecret.app_secret, "FEISHU_APP_SECRET or feishu app_secret"),
    feishuAllowedOpenId: required(process.env.FEISHU_ALLOWED_OPEN_ID ?? feishu.allowed_open_id ?? feishuSecret.allowed_open_id, "FEISHU_ALLOWED_OPEN_ID or feishu.allowed_open_id"),
    allowedChatIds, listeners, passEnv
  };
}

/** 生成不含凭据的独立配置，拒绝覆盖已有文件。 */
export function initConfig(file: string, workspace: string): void {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, stringify({
    runtime: "claude-sdk", workspace: path.resolve(workspace),
    data_dir: defaultDataDir(target),
    model: "gemini-3.8-flash-high", models: ["gemini-3.8-flash-high", "gpt-5.6-sol"], effort: "high",
    provider: { type: "cpa", base_url: "http://127.0.0.1:8317" }, feishu: { allowed_open_id: "" }
  }), { flag: "wx", mode: 0o600 });
}
