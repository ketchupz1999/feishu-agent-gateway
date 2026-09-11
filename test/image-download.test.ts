import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { createServer } from "node:http";
import { Client } from "@larksuiteoapi/node-sdk";
import { downloadFeishuImages, MAX_IMAGE_BYTES } from "../src/lark/image-download.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=", "base64");
const message = { messageId: "om_1", chatId: "oc_1", openId: "ou_1", text: "", imageKeys: ["../../escape"] };

function clientWith(get: (payload: any) => Promise<any>) {
  return {
    domain: "https://open.feishu.cn",
    formatPayload: async () => ({ headers: { Authorization: "Bearer test-token" } }),
    httpInstance: { request: async (payload: any) => (await get(payload)).getReadableStream() }
  } as any;
}

test("message images use the resource API and private generated paths", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let payload: any;
  const images = await downloadFeishuImages(clientWith(async p => {
    payload = p;
    return { getReadableStream: () => Readable.from([png.subarray(0, 9), png.subarray(9)]) };
  }), dir, message);
  assert.equal(payload.url, "https://open.feishu.cn/open-apis/im/v1/messages/om_1/resources/..%2F..%2Fescape");
  assert.equal(payload.method, "GET");
  assert.equal(payload.responseType, "stream");
  assert.deepEqual(payload.params, { type: "image" });
  assert.equal(payload.headers.Authorization, "Bearer test-token");
  assert.ok(payload.signal instanceof AbortSignal);
  assert.equal(images.paths.length, 1);
  assert.ok(images.paths[0]!.startsWith(path.join(dir, "attachments", "feishu", "message-")));
  assert.equal(path.basename(images.paths[0]!), "1.png");
  assert.deepEqual(await fs.readFile(images.paths[0]!), png);
  assert.equal((await fs.stat(images.paths[0]!)).mode & 0o777, 0o600);
  await images.cleanup();
  assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
});

test("too many images fail before requesting resources", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-count-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(downloadFeishuImages(clientWith(async () => {
    assert.fail("must not download");
  }), dir, { ...message, imageKeys: ["1", "2", "3", "4", "5"] }), /最多支持 4/);
});

test("oversized, invalid and interrupted downloads leave no partial attachments", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-fail-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const [stream, expected] of [
    [Readable.from([png, Buffer.alloc(MAX_IMAGE_BYTES)]), /不能超过 5/],
    [Readable.from([Buffer.from('<html>401 unauthorized</html>')]), /图片格式不支持/],
    [Readable.from((async function* () { yield png; throw new Error("secret-token upstream error"); })()), /图片下载失败/]
  ] as const) {
    await assert.rejects(downloadFeishuImages(clientWith(async () => ({ getReadableStream: () => stream })), dir, message), expected);
    assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
    assert.equal(stream.destroyed, true);
  }
});

test("failure in a later image rolls back earlier files and hides upstream credentials", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-batch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(downloadFeishuImages(clientWith(async () => {
    if (++calls === 2) throw new Error("Bearer private-key");
    return { getReadableStream: () => Readable.from([png]) };
  }), dir, { ...message, imageKeys: ["img_1", "img_2"] }), error => {
    assert.match(String(error), /图片下载失败/);
    assert.doesNotMatch(String(error), /private-key/);
    return true;
  });
  assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
});

test("resource response arriving after timeout is closed and never persisted", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-timeout-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveResource!: (resource: any) => void;
  let announceRequest!: () => void;
  const started = new Promise<void>(resolve => { announceRequest = resolve; });
  const pending = downloadFeishuImages(clientWith(async () => {
    announceRequest();
    return await new Promise(resolve => { resolveResource = resolve; });
  }), dir, message);
  const rejected = assert.rejects(pending, /图片下载超时/);
  await started;
  t.mock.timers.tick(30_000);
  await rejected;
  const late = Readable.from([png]);
  resolveResource({ getReadableStream: () => late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.destroyed, true);
  assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
});

test("cancel aborts the HTTP signal and destroys a stalled response stream immediately", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-cancel-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  const stream = new PassThrough();
  let transportSignal!: AbortSignal;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const pending = downloadFeishuImages(clientWith(async request => {
    transportSignal = request.signal;
    started();
    return { getReadableStream: () => stream };
  }), dir, message, controller.signal);
  const rejected = assert.rejects(pending, /图片下载已取消/);
  await requestStarted;
  await new Promise(resolve => setImmediate(resolve));
  stream.write(png);
  controller.abort();
  await rejected;
  assert.equal(transportSignal.aborted, true);
  assert.equal(stream.destroyed, true);
  assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
});

test("SDK transport downloads bytes and closes the actual HTTP connection on cancellation", { timeout: 5000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-images-http-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let announceStalled!: () => void;
  let announceClosed!: () => void;
  const stalled = new Promise<void>(resolve => { announceStalled = resolve; });
  const closed = new Promise<void>(resolve => { announceClosed = resolve; });
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    assert.ok(request.url?.endsWith("?type=image"));
    response.writeHead(200, { "Content-Type": "image/png" });
    if (request.url?.includes("img_stalled")) {
      response.on("close", announceClosed);
      response.write(png);
      announceStalled();
    } else {
      response.end(png);
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const client = new Client({ appId: "fixture", appSecret: "fixture", domain: `http://127.0.0.1:${port}` });
  client.formatPayload = async () => ({ headers: { Authorization: "Bearer fixture-token" }, data: {}, params: {}, path: {} });
  const images = await downloadFeishuImages(client, dir, { ...message, imageKeys: ["img_normal"] });
  assert.deepEqual(await fs.readFile(images.paths[0]!), png);
  await images.cleanup();

  const abort = new AbortController();
  const canceled = assert.rejects(downloadFeishuImages(client, dir, { ...message, imageKeys: ["img_stalled"] }, abort.signal), /图片下载已取消/);
  await stalled;
  abort.abort();
  await canceled;
  await closed;
  assert.deepEqual(await fs.readdir(path.join(dir, "attachments", "feishu")), []);
});
