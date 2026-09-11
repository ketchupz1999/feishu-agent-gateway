import test from "node:test";
import assert from "node:assert/strict";
import { safeJson } from "../src/logger.js";
test("SDK log metadata cannot expose configured keys, headers, or circular request objects", () => {
  const value: any = { app_secret: "private", url: "https://example.com/?token=dynamic", error: new Error("API private-cpa-key failed"), headers: { Authorization: "Bearer tenant-token" } };
  value.self = value;
  const text = safeJson(value, ["private-cpa-key"]);
  assert.doesNotMatch(text, /private-cpa-key|tenant-token|=dynamic|"private"/);
  assert.match(text, /REDACTED/);
});
