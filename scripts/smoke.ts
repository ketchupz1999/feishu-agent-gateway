import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { loadConfig } from "../src/config.js";
import { ClaudeChatExecutor } from "../src/runtime/claude.js";

function pngChunk(type: string, bytes: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, trailer]);
}

function makeImage(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(128, 0);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < 64; y++) {
    const row = Buffer.alloc(1 + 128 * 3);
    for (let x = 0; x < 128; x++) {
      row.set(x < 64 ? [255, 0, 255] : [0, 255, 255], 1 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(Buffer.concat(rows))), pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** 在临时仓库验证 CPA 图片识别、原生续聊和一次限定文件写入；不连接飞书。 */
async function main(): Promise<void> {
  const config = loadConfig(process.argv[2]);
  assert.ok(config.provider, "先配置 CPA");
  const model = config.model;
  const engine = config.runtime;
  console.log(JSON.stringify({ phase: "start", engine, model, claudeExecutable: engine === "claude-sdk" ? config.claudeCodePath ?? "sdk-bundled" : undefined }));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-cpa-smoke-"));
  execFileSync("git", ["init", "--quiet", workspace]);
  const imagePath = path.join(workspace, "fixture.png");
  await fs.writeFile(imagePath, makeImage());
  const Executor = ClaudeChatExecutor;
  const executor = new Executor({ ...config, workspace }, {
    info() {}, warn() {}, error(message) { console.error(message); }
  });
  const timer = setTimeout(() => { void executor.interrupt(); }, 180_000);
  const statuses: string[] = [];
  const callbacks = { onText: async () => {}, onStatus: async (text: string) => {
    statuses.push(text);
    console.log(JSON.stringify({ phase: "tool", kind: text.split(":")[0] }));
  } };
  try {
    const first = await executor.run({
      text: 'Look at the attached image. Identify the solid color on each half using common English color names. Do not use tools. Reply only with JSON: {"left":"color","right":"color"}.',
      imagePaths: [imagePath], gatewaySessionId: "smoke-image", model, ...callbacks
    });
    assert.equal(first.status, "ok", String(first.payload));
    assert.match(String(first.payload), /magenta/i);
    assert.match(String(first.payload), /cyan/i);
    assert.ok(first.providerSessionId);
    console.log(JSON.stringify({ phase: "image", engine, model, ok: true, answer: first.payload }));
    timer.refresh();
    const marker = randomUUID();
    const second = await executor.run({
      text: `Use our previous image and answer: what was the LEFT half's color? Use a shell command to write its English color name and this marker into continuation.txt in the current working directory: ${marker}. Do not read or modify any other files. Then reply DONE.`,
      gatewaySessionId: first.providerSessionId,
      providerSessionId: first.providerSessionId, model, ...callbacks
    });
    assert.equal(second.status, "ok", String(second.payload));
    const proof = await fs.readFile(path.join(workspace, "continuation.txt"), "utf8");
    assert.match(proof, /magenta/i);
    assert.ok(proof.includes(marker));
    assert.ok(statuses.some(status => status.startsWith("执行命令:")), "必须真实执行终端工具");
    console.log(JSON.stringify({ phase: "resume-and-tool", ok: true, sameThread: first.providerSessionId === second.providerSessionId }));
  } finally {
    clearTimeout(timer);
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "CPA smoke failed");
  process.exitCode = 1;
});
