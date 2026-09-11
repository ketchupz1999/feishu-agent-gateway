import fs from "node:fs";
import path from "node:path";
import type { GatewayConfig } from "./config.js";
import type { Logger } from "./types.js";

/** 序列化日志时移除密钥和循环对象，SDK 错误只保留错误说明。 */
export function safeJson(value: unknown, secrets: string[]): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, item) => {
    if (/secret|api_?key|authorization|access_token|refresh_token|^token$/i.test(key)) return "[REDACTED]";
    if (item instanceof Error) return { name: item.name, message: item.message };
    if (typeof item === "string") {
      for (const secret of secrets.filter(Boolean)) item = item.replaceAll(secret, "[REDACTED]");
      return item.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
        .replace(/([?&](?:access_token|token|key|secret)=)[^&\s"']+/gi, "$1[REDACTED]");
    }
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  });
}

/** 同时写 stdout 和按日文件，日志目录独立于程序安装目录。 */
export function createLogger(config: GatewayConfig): Logger {
  fs.mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
  const write = (level: string, message: string, meta?: Record<string, unknown>) => {
    const line = safeJson({ time: new Date().toISOString(), level, message, ...meta }, [config.provider.apiKey, config.feishuAppSecret]);
    console.log(line);
    fs.appendFileSync(path.join(config.logDir, `${new Date().toISOString().slice(0, 10)}-gateway.log`), line + "\n", { mode: 0o600 });
  };
  return { info: (m, v) => write("info", m, v), warn: (m, v) => write("warn", m, v), error: (m, v) => write("error", m, v) };
}
