import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { GatewayConfig } from "../src/config.js";

export function fixture(t: TestContext): GatewayConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, "work space");
  const dataDir = path.join(dir, "state");
  fs.mkdirSync(workspace); fs.mkdirSync(dataDir);
  return {
    configFile: path.join(dir, "config.json"), workspace, dataDir, logDir: path.join(dataDir, "logs"), pidFile: path.join(dataDir, "gateway.pid"),
    runtime: "claude-sdk", model: "gemini-3.8-flash-high", models: ["gemini-3.8-flash-high", "gpt-5.6-sol"], effort: "high",
    provider: { type: "cpa", baseUrl: "http://127.0.0.1:8317", apiKey: "fixture-cpa-key" }, controlPort: 0,
    feishuSecretsFile: "fixture", feishuAppId: "fixture-app", feishuAppSecret: "fixture-app-secret", feishuAllowedOpenId: "ou_owner", allowedChatIds: [], listeners: []
  };
}
export const logger = { info() {}, warn() {}, error() {} };
