#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, loadStateConfig, initConfig, defaultConfigFile, type GatewayConfig, type StateConfig } from "./config.js";
import { controlRequest, readControl, assertNoLivePid } from "./control.js";
import { VERSION } from "./version.js";

const usage = `feishu-agent-gateway ${VERSION}
Usage: feishu-agent-gateway <init|doctor|run|start|stop|restart|status|logs> [--config FILE] [--workspace DIR]
  init       Create a config template without secrets
  doctor     Validate config; --online also checks CPA authentication/model
  run        Run in foreground (for launchd/systemd)
  start      Start detached and wait for Feishu readiness
  stop       Stop this instance through authenticated loopback control
  restart    Stop then start using this installed version
  status     Print authenticated instance state as JSON
  logs       Print the stdout log path
`;

async function stop(config: StateConfig): Promise<void> {
  const previous = readControl(config);
  await controlRequest(config, "stop");
  for (let n = 0; n < 50; n++) {
    if (readControl(config)?.token !== previous?.token) { console.log("Gateway stopped"); return; }
    await delay(100);
  }
  throw new Error("Gateway has not stopped yet; inspect its log before retrying");
}

async function start(config: GatewayConfig): Promise<void> {
  assertNoLivePid(config);
  fs.mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
  const log = path.join(config.logDir, "gateway-stdout.log");
  const fd = fs.openSync(log, "a", 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", "--config", config.configFile, "--workspace", config.workspace], {
    cwd: config.workspace, detached: true, stdio: ["ignore", fd, fd], env: process.env
  });
  fs.closeSync(fd);
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  for (let n = 0; n < 60; n++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited; inspect ${log}`);
    try {
      const state = await controlRequest(config, "status");
      if (state.pid === child.pid && state.ready) { console.log(JSON.stringify(state)); return; }
    } catch { /* 等待子进程建立控制服务 */ }
    await delay(500);
  }
  // 仅清理本次刚创建且未退出的子进程，不根据旧 PID 文件杀进程。
  if (child.exitCode === null) child.kill("SIGTERM");
  throw new Error(`Gateway did not become ready; inspect ${log}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: "string" }, workspace: { type: "string" }, online: { type: "boolean" }, help: { type: "boolean" }, version: { type: "boolean" }
  } });
  if (values.version) { console.log(VERSION); return; }
  const command = positionals[0];
  if (positionals.length > 1) throw new Error("Use --config/--workspace for paths; unexpected positional argument");
  if (values.help || !command) { console.log(usage); return; }
  const file = values.config ?? defaultConfigFile();
  if (command === "init") { initConfig(file, values.workspace ?? process.cwd()); console.log(path.resolve(file)); return; }
  if (command === "stop") { await stop(loadStateConfig(file)); return; }
  if (command === "status") { console.log(JSON.stringify(await controlRequest(loadStateConfig(file), "status"))); return; }
  if (command === "logs") { console.log(path.join(loadStateConfig(file).logDir, "gateway-stdout.log")); return; }
  const config = loadConfig(file, values.workspace);
  if (command === "doctor") {
    if (config.claudeCodePath) fs.accessSync(config.claudeCodePath, fs.constants.X_OK);
    let providerChecked = false;
    if (values.online) {
      const base = config.provider.baseUrl.replace(/\/v1$/, "");
      const response = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${config.provider.apiKey}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`CPA authentication/model check failed (${response.status})`);
      const data = await response.json() as any;
      if (!(data.data ?? []).some((model: any) => model.id === config.model)) throw new Error("Configured model is not listed by CPA");
      providerChecked = true;
    }
    console.log(JSON.stringify({ ok: true, version: VERSION, workspace: config.workspace, dataDir: config.dataDir, runtime: config.runtime, model: config.model, providerChecked }));
  } else if (command === "run") {
    const { runForeground } = await import("./run.js");
    await runForeground(config);
  } else if (command === "start") await start(config);
  else if (command === "restart") { await stop(config); await start(config); }
  else throw new Error(`Unknown command: ${command}`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Gateway command failed"); process.exitCode = 1; });
