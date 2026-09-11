import * as Lark from "@larksuiteoapi/node-sdk";

import type { GatewayConfig } from "../config.js";
import type { Logger } from "../types.js";
import { parseFeishuMessage, type ParsedMessage } from "./event-parser.js";
import { ReplyAdapter } from "./reply-adapter.js";

export type LarkRuntime = {
  client: Lark.Client;
  wsClient: Lark.WSClient;
  reply: ReplyAdapter;
  start: (onMessage: (message: ParsedMessage) => Promise<void>) => Promise<void>;
  stop: () => void;
  getHealth: () => {
    readyState: number | null;
    reconnectInfo: {
      lastConnectTime: number;
      nextConnectTime: number;
    };
  };
};

export function createLarkRuntime(config: GatewayConfig, logger: Logger): LarkRuntime {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error(`missing feishu config: ${config.feishuSecretsFile}`);
  }

  const allowedOpenId = config.feishuAllowedOpenId?.trim() || null;
  if (!allowedOpenId) {
    throw new Error(
      "missing FEISHU_ALLOWED_OPEN_ID (or feishu_app.json allowed_open_id). " +
        "Refusing to start without an allowlist. " +
        "Configure one trusted sender before starting."
    );
  }

  const baseConfig = {
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: Lark.LoggerLevel.info
    ,logger: {
      error: (...details: unknown[]) => logger.error("Feishu SDK", { details }),
      warn: (...details: unknown[]) => logger.warn("Feishu SDK", { details }),
      info: (...details: unknown[]) => logger.info("Feishu SDK", { details }),
      debug() {}, trace() {}
    }
  };
  const client = new Lark.Client(baseConfig);
  const wsClient = new Lark.WSClient(baseConfig);
  const reply = new ReplyAdapter(client, logger);

  return {
    client,
    wsClient,
    reply,
    async start(onMessage) {
      const eventDispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data: any) => {
          logger.info("received raw Feishu event", {
            eventType: data?.event_type,
            appId: data?.app_id,
            messageId: data?.message?.message_id ?? data?.event?.message?.message_id,
            messageType: data?.message?.message_type ?? data?.event?.message?.message_type,
            topLevelKeys: Object.keys(data ?? {}).slice(0, 12)
          });
          const message = parseFeishuMessage(data, (warning) => {
            logger.warn("ignored Feishu event", {
              reason: warning.reason,
              messageId: warning.messageId,
              messageType: warning.messageType,
              detail: warning.detail
            });
          });
          if (!message || (!message.text && !message.imageKeys?.length)) {
            return;
          }
          if (allowedOpenId && message.openId !== allowedOpenId) {
            logger.warn("ignored message from non-allowlisted sender", {
              openId: message.openId
            });
            return;
          }
          if (config.allowedChatIds?.length && !config.allowedChatIds.includes(message.chatId)) return;
          logger.info("accepted Feishu message", {
            messageId: message.messageId,
            chatId: message.chatId,
            messageType: message.messageType,
            openId: message.openId,
            text: message.text.slice(0, 80)
          });
          // 长任务在后台继续；handler 立即完成，让 SDK 及时向飞书 ACK。
          // 从 Promise 开始也捕获调用方的同步异常，避免未处理的 rejection。
          void Promise.resolve().then(() => onMessage(message)).catch(async (err) => {
            try {
              logger.error("Feishu message handler failed", {
                messageId: message.messageId,
                chatId: message.chatId,
                message: err instanceof Error ? err.message : String(err)
              });
            } catch { /* 日志存储失败仍尝试回复用户。 */ }
            try {
              await reply.sendText(message.chatId, `[错误] ${err instanceof Error ? err.message : String(err)}`);
            } catch (replyErr) {
              logger.error("failed to send Feishu error reply", {
                messageId: message.messageId,
                chatId: message.chatId,
                message: replyErr instanceof Error ? replyErr.message : String(replyErr)
              });
            }
          }).catch(() => { /* 错误上报自身失败也不能成为未处理的后台 rejection。 */ });
        }
      });

      await wsClient.start({ eventDispatcher });
    },
    stop() {
      wsClient.close({ force: true });
    },
    getHealth() {
      const wsInstance = (wsClient as any).wsConfig?.getWSInstance?.() ?? null;
      return {
        readyState: typeof wsInstance?.readyState === "number" ? wsInstance.readyState : null,
        reconnectInfo: wsClient.getReconnectInfo()
      };
    }
  };
}
