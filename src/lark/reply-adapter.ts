import * as Lark from "@larksuiteoapi/node-sdk";

import type { Logger } from "../types.js";
import { markdownToCard, shouldUseCard, splitText } from "./rich-text.js";

export class ReplyAdapter {
  constructor(
    private readonly client: Lark.Client,
    private readonly logger: Logger
  ) {}

  async replyText(messageId: string, text: string, chatId?: string): Promise<void> {
    try {
      const response = await this.client.im.v1.message.reply({
        path: {
          message_id: messageId
        },
        data: {
          content: JSON.stringify({ text }),
          msg_type: "text"
        }
      });
      this.assertSuccess(response, "replyText");
    } catch (err) {
      this.logger.warn("replyText failed", {
        messageId,
        chatId,
        message: err instanceof Error ? err.message : String(err)
      });
      if (chatId) {
        await this.sendText(chatId, text);
      }
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: "text"
      }
    });
    this.assertSuccess(response, "sendText");
  }

  async replyRich(messageId: string, chatId: string, text: string): Promise<void> {
    if (shouldUseCard(text)) {
      try {
        await this.replyCard(messageId, markdownToCard(text));
        return;
      } catch (err) {
        this.logger.warn("replyCard failed, fallback to sendCard/text", {
          messageId,
          chatId,
          message: err instanceof Error ? err.message : String(err)
        });
        try {
          await this.sendCard(chatId, markdownToCard(text));
          return;
        } catch (sendErr) {
          this.logger.warn("sendCard failed, fallback to text", {
            messageId,
            chatId,
            message: sendErr instanceof Error ? sendErr.message : String(sendErr)
          });
        }
      }
    }

    for (const chunk of splitText(text)) {
      await this.replyText(messageId, chunk, chatId);
    }
  }

  async sendRich(chatId: string, text: string): Promise<void> {
    if (shouldUseCard(text)) {
      try {
        await this.sendCard(chatId, markdownToCard(text));
        return;
      } catch (err) {
        this.logger.warn("sendCard failed, fallback to text", {
          chatId,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }
    for (const chunk of splitText(text)) {
      await this.sendText(chatId, chunk);
    }
  }

  private async replyCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    const response = await this.client.im.v1.message.reply({
      path: {
        message_id: messageId
      },
      data: {
        content: JSON.stringify(card),
        msg_type: "interactive"
      }
    });
    this.assertSuccess(response, "replyText");
  }

  private async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify(card),
        msg_type: "interactive"
      }
    });
    this.assertSuccess(response, "sendText");
  }

  private assertSuccess(response: unknown, action: "replyText" | "sendText"): void {
    const code = typeof (response as any)?.code === "number" ? (response as any).code : 0;
    if (code === 0) {
      return;
    }
    const msg = typeof (response as any)?.msg === "string" ? (response as any).msg : "unknown error";
    throw new Error(`${action} failed: code=${code}, msg=${msg}`);
  }
}
