import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { GatewayConfig, StateConfig } from "./config.js";

type Record = { pid: number; port: number; token: string; dataDir: string; startedAt: string };
const recordPath = (config: StateConfig) => path.join(config.dataDir, "gateway-control.json");

/** 读取本实例的控制端点；控制凭据永不包含在状态输出中。 */
export function readControl(config: StateConfig): Record | null {
  try {
    const value = JSON.parse(fs.readFileSync(recordPath(config), "utf8")) as Record;
    return Number.isInteger(value.pid) && value.pid > 0 && Number.isInteger(value.port) && typeof value.token === "string" && value.dataDir === config.dataDir ? value : null;
  } catch { return null; }
}

/** 使用认证控制协议读取/停止实例，不根据裸 PID 向未知进程发信号。 */
export async function controlRequest(config: StateConfig, action: "status" | "stop"): Promise<any> {
  const record = readControl(config);
  if (!record) throw new Error("Gateway is not running (no control record)");
  const response = await fetch(`http://127.0.0.1:${record.port}/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(2000)
  });
  if (!response.ok) throw new Error("Gateway control authentication or request failed");
  const result = await response.json() as any;
  if (result.pid !== record.pid || result.dataDir !== config.dataDir) throw new Error("Gateway control identity mismatch");
  return result;
}

/** 拒绝覆盖占用当前数据目录的存活进程。 */
export function assertNoLivePid(config: GatewayConfig): void {
  if (!fs.existsSync(config.pidFile)) return;
  const pid = Number(fs.readFileSync(config.pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid gateway.pid; inspect it before recovery");
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
  throw new Error(`Gateway data directory is owned by live PID ${pid}; stop it first`);
}

/** 本机回环控制服务；固定实例端口让重复启动由内核原子拒绝。 */
export async function startControl(config: GatewayConfig, snapshot: () => object, shutdown: () => void) {
  assertNoLivePid(config);
  const record: Record = { pid: process.pid, port: config.controlPort, token: randomBytes(32).toString("hex"), dataDir: config.dataDir, startedAt: new Date().toISOString() };
  const expected = Buffer.from(`Bearer ${record.token}`);
  const server = createServer((request, response) => {
    const auth = Buffer.from(request.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { response.writeHead(401).end(); return; }
    const isStop = request.method === "POST" && request.url === "/stop";
    if (!isStop && !(request.method === "GET" && request.url === "/status")) { response.writeHead(404).end(); return; }
    response.writeHead(isStop ? 202 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ...snapshot(), pid: process.pid, dataDir: config.dataDir, startedAt: record.startedAt }));
    if (isStop) setImmediate(shutdown);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.controlPort, "127.0.0.1", resolve);
  });
  try {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(recordPath(config), JSON.stringify(record), { mode: 0o600 });
    fs.writeFileSync(config.pidFile, String(process.pid), { mode: 0o600 });
  } catch (error) { server.close(); throw error; }
  return {
    async close() {
      if (readControl(config)?.token === record.token) {
        fs.rmSync(recordPath(config), { force: true });
        fs.rmSync(config.pidFile, { force: true });
      }
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
