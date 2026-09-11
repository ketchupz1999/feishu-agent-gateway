import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "./logger.js";
import type { GatewayConfig } from "./config.js";
import { createLarkRuntime } from "./lark/client.js";
import { downloadFeishuImages } from "./lark/image-download.js";
import { GatewayApp } from "./app/gateway.js";
import { startControl } from "./control.js";
import { VERSION } from "./version.js";

/** 前台运行一个配置实例；配置、日志与状态均不写入安装目录。 */
export async function runForeground(config: GatewayConfig): Promise<void> {
  const logger = createLogger(config);
  const runtime = createLarkRuntime(config, logger);
  const app = new GatewayApp(config, logger, runtime.reply,
    (message, signal) => downloadFeishuImages(runtime.client, config.dataDir, message, signal));
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  const listeners: ChildProcess[] = [];
  let control: Awaited<ReturnType<typeof startControl>> | undefined;
  const snapshot = () => ({ version: VERSION, runtime: config.runtime, provider: config.provider.type, workspace: config.workspace,
    ...app.status(), ready: !stopping && runtime.getHealth().readyState === 1 });
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(code), 5000);
    try {
      runtime.stop();
      await app.stop();
      for (const child of listeners) {
        if (!child.pid) continue;
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch { /* 已退出 */ }
      }
      await control?.close();
      logger.info("Gateway stopped", { code });
    } finally { clearTimeout(deadline); process.exit(code); }
  };
  process.once("SIGTERM", () => { void shutdown(0); });
  process.once("SIGINT", () => { void shutdown(0); });
  try {
    control = await startControl(config, snapshot, () => { void shutdown(0); });
    app.initialize();
    logger.info("Gateway started", snapshot());
    await runtime.start(message => app.handleMessage(message));
    for (const listener of config.listeners) {
      const fd = fs.openSync(path.join(config.logDir, `listener-${listener.name}.log`), "a", 0o600);
      const child = spawn(listener.command[0], listener.command.slice(1), {
        cwd: config.workspace, env: { ...process.env, ...listener.env }, detached: process.platform !== "win32", stdio: ["ignore", fd, fd]
      });
      fs.closeSync(fd);
      listeners.push(child);
      child.on("error", error => logger.error("Listener failed", { name: listener.name, error }));
      child.on("exit", code => logger.warn("Listener exited", { name: listener.name, code }));
    }
    let lastReadyAt = Date.now();
    let readyLogged = false;
    timer = setInterval(() => {
      if (runtime.getHealth().readyState === 1) {
        lastReadyAt = Date.now();
        if (!readyLogged) { logger.info("Feishu connected", snapshot()); readyLogged = true; }
      } else if (Date.now() - lastReadyAt > 120_000) {
        logger.error("Feishu disconnected for more than 120 seconds");
        void shutdown(1);
      }
    }, 1000);
  } catch (error) {
    logger.error("Gateway startup failed", { error });
    await shutdown(1);
  }
}
