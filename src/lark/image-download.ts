import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { MessageContext } from "../types.js";

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export type DownloadedImages = { paths: string[]; cleanup: () => Promise<void> };
export type ImageDownloader = (message: MessageContext, signal: AbortSignal) => Promise<DownloadedImages>;

function imageExtension(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** 限时读取飞书消息图片；晚到的响应也会关闭，避免超时后继续下载。 */
async function readImage(client: Lark.Client, messageId: string, imageKey: string, taskSignal?: AbortSignal): Promise<Buffer> {
  let stream: Readable | undefined;
  const controller = new AbortController();
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = (error: Error) => {
    controller.abort(error);
    stream?.destroy(error);
    rejectStopped(error);
  };
  const cancel = () => stop(new Error("图片下载已取消"));
  const timer = setTimeout(() => stop(new Error("图片下载超时，请稍后重发")), DOWNLOAD_TIMEOUT_MS);
  taskSignal?.addEventListener("abort", cancel, { once: true });
  if (taskSignal?.aborted) cancel();
  const read = async () => {
    controller.signal.throwIfAborted();
    // 复用 SDK 鉴权和 HTTP transport；messageResource.get 本身不透传 AbortSignal。
    // 直接调用 transport 也避免通用 request() 把含认证请求头的 AxiosError 写入日志。
    const { headers } = await client.formatPayload({});
    controller.signal.throwIfAborted();
    const request = {
      url: `${client.domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}`,
      method: "GET",
      headers,
      params: { type: "image" },
      responseType: "stream" as const,
      timeout: DOWNLOAD_TIMEOUT_MS,
      signal: controller.signal
    };
    stream = await client.httpInstance.request<Readable>(request);
    if (controller.signal.aborted) {
      stream.destroy();
      controller.signal.throwIfAborted();
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 5 MiB，请压缩后重发");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  };
  try {
    return await Promise.race([read(), stopped]);
  } finally {
    clearTimeout(timer);
    taskSignal?.removeEventListener("abort", cancel);
    stream?.destroy();
  }
}

/** 下载当前消息全部图片；仅在全部有效时返回，失败删除本次附件。 */
export async function downloadFeishuImages(
  client: Lark.Client,
  dataDir: string,
  message: MessageContext,
  signal?: AbortSignal
): Promise<DownloadedImages> {
  const keys = [...new Set(message.imageKeys ?? [])];
  if (keys.length > MAX_IMAGES_PER_MESSAGE) throw new Error("每条消息最多支持 4 张图片，请分开发送");
  if (!keys.length) return { paths: [], cleanup: async () => {} };
  const root = path.join(dataDir, "attachments", "feishu");
  await mkdir(root, { recursive: true, mode: 0o700 });
  // 路径由程序生成，绝不使用消息中的 image_key 或文件名拼接本地路径。
  const dir = await mkdtemp(path.join(root, "message-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const paths: string[] = [];
  try {
    for (const key of keys) {
      const bytes = await readImage(client, message.messageId, key, signal);
      const extension = imageExtension(bytes);
      if (!extension) throw new Error("图片格式不支持，请发送 PNG、JPEG、GIF 或 WebP 图片");
      const filePath = path.join(dir, `${paths.length + 1}.${extension}`);
      await writeFile(filePath, bytes, { mode: 0o600, flag: "wx", signal });
      paths.push(filePath);
    }
    signal?.throwIfAborted();
    return { paths, cleanup };
  } catch (err) {
    await cleanup();
    // 不把 SDK 错误中的认证信息、请求头或下载链接发回聊天。
    const reason = err instanceof Error ? err.message : "";
    if (signal?.aborted) throw new Error("图片下载已取消");
    if (/^(图片下载超时|单张图片不能超过|图片格式不支持)/.test(reason)) throw new Error(reason);
    throw new Error("图片下载失败，请重发；若持续失败，请检查机器人读取消息资源的权限");
  }
}
