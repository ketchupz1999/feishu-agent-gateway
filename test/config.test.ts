import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadStateConfig, initConfig } from "../src/config.js";
import { fixture } from "./helpers.js";

test("configuration resolves relative paths without any host repository scaffold", t => {
  const c = fixture(t);
  const old = { ...process.env };
  for (const key of ["CPA_API_KEY", "CPA_BASE_URL", "FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ALLOWED_OPEN_ID", "CLAUDE_CODE_PATH"]) delete process.env[key];
  t.after(() => { for (const key of ["CPA_API_KEY", "CPA_BASE_URL", "FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ALLOWED_OPEN_ID", "CLAUDE_CODE_PATH"]) {
    if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  } });
  fs.writeFileSync(path.join(path.dirname(c.configFile), "credentials.json"), JSON.stringify({ api_key: "fixture-key", app_id: "app", app_secret: "secret", allowed_open_id: "owner" }));
  const raw = { runtime: "claude-sdk", workspace: "work space", data_dir: "state", model: "gemini-3.8-flash-high",
    provider: { type: "cpa", base_url: "http://127.0.0.1:8317/v1/", credentials_file: "credentials.json" },
    feishu: { credentials_file: "credentials.json" } };
  fs.writeFileSync(c.configFile, JSON.stringify(raw));
  const loaded = loadConfig(c.configFile);
  assert.equal(loaded.workspace, c.workspace);
  assert.equal(loaded.dataDir, c.dataDir);
  assert.equal(loaded.provider.baseUrl, "http://127.0.0.1:8317/v1");
  assert.equal(loaded.provider.apiKey, "fixture-key");
  assert.equal(loaded.feishuAllowedOpenId, "owner");
  assert.equal(fs.existsSync(path.join(c.workspace, "components")), false);
  process.env.CPA_API_KEY = "override";
  raw.provider.credentials_file = "missing.json";
  fs.writeFileSync(c.configFile, JSON.stringify(raw));
  assert.equal(loadConfig(c.configFile).provider.apiKey, "override");
  raw.provider.base_url = "http://user:secret@example.com/v1";
  fs.writeFileSync(c.configFile, JSON.stringify(raw));
  assert.throws(() => loadConfig(c.configFile), /without credentials/);
});

test("init is non-destructive and contains no credential values", t => {
  const c = fixture(t);
  initConfig(c.configFile, c.workspace);
  assert.equal(fs.statSync(c.configFile).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(c.configFile, "utf8"), /fixture-cpa-key/);
  assert.throws(() => initConfig(c.configFile, c.workspace), /EEXIST/);
  const second = path.join(path.dirname(c.configFile), "second.json");
  initConfig(second, c.workspace);
  assert.notEqual(loadStateConfig(second).dataDir, loadStateConfig(c.configFile).dataDir);
  fs.writeFileSync(c.configFile, JSON.stringify({ data_dir: "state", provider: { credentials_file: "deleted.json" } }));
  assert.equal(loadStateConfig(c.configFile).dataDir, c.dataDir);
});
