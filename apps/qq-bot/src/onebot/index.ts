import { timingSafeEqual } from "node:crypto";
import type { GroupDailyQuotaStore } from "../group-daily-quota.ts";
import type {
  BotReply,
  OneBot11Event,
  OneBotTransportConfig,
  OneBotSegment,
  TransportContext,
  TransportHandler,
} from "./types.ts";

export * from "./types.ts";
export {
  createGroupDailyQuotaStore,
  parseGroupDailyReplyLimit,
  shanghaiDayKey,
} from "../group-daily-quota.ts";
export type {
  GroupDailyQuotaDecision,
  GroupDailyQuotaStore,
} from "../group-daily-quota.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export class OneBotTransportError extends Error {
  readonly status?: number;
  readonly retcode?: number;

  constructor(
    message: string,
    status?: number,
    retcode?: number,
  ) {
    super(message);
    this.name = "OneBotTransportError";
    this.status = status;
    this.retcode = retcode;
  }
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

/** Avoid early-exit comparisons for inbound credentials. */
export function timingSafeMatch(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function header(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

function bearer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^Bearer\s+/i, "");
}

/** Checks both configured secrets, without retaining or logging either incoming value. */
export function authenticateInbound(headers: Headers, config: OneBotTransportConfig): boolean {
  const token = bearer(header(headers, "authorization"))
    ?? header(headers, "x-onebot-token")
    ?? header(headers, "x-access-token");
  return timingSafeMatch(token, config.accessToken)
    && timingSafeMatch(header(headers, "x-event-key"), config.eventKey);
}

function extractText(message: OneBot11Event["message"]): { text: string; mentionedBot: boolean } {
  if (typeof message === "string") return { text: message, mentionedBot: false };
  if (!Array.isArray(message)) return { text: "", mentionedBot: false };
  const text = message
    .filter((segment): segment is OneBotSegment => !!segment && typeof segment.type === "string")
    .map((segment) => segment.type === "text" ? String(segment.data?.text ?? "") : "")
    .join("");
  return { text, mentionedBot: false };
}

function cleanupCommand(text: string, mentionedBot: boolean, prefixes: string[]): string {
  let cleaned = text.trim();
  // Some OneBot implementations serialize an @ mention as text rather than an at segment.
  if (mentionedBot) cleaned = cleaned.replace(/^\s+/, "");
  for (const prefix of prefixes) {
    if (prefix && cleaned.startsWith(prefix)) return cleaned.slice(prefix.length).trimStart();
  }
  return cleaned;
}

export function normalizeOneBotEvent(event: OneBot11Event, config: OneBotTransportConfig = {}): TransportContext | undefined {
  if (event.post_type && event.post_type !== "message") return undefined;
  if (event.message_type !== "group" && event.message_type !== "private") return undefined;
  const userId = asId(event.user_id);
  if (!userId) return undefined;
  const parts = extractText(event.message);
  const botId = config.botId ?? asId(event.self_id);
  const hasAtBot = Array.isArray(event.message) && !!botId && event.message.some((segment) =>
    segment?.type === "at" && asId(segment.data?.qq) === botId,
  );
  const mentionedBot = hasAtBot || parts.mentionedBot;
  const groupRole =
    event.message_type === "group" &&
    (event.sender?.role === "owner" ||
      event.sender?.role === "admin" ||
      event.sender?.role === "member")
      ? event.sender.role
      : undefined;
  return {
    platform: "qq",
    protocol: "onebot-11",
    conversation: event.message_type,
    userId,
    groupId: event.message_type === "group" ? asId(event.group_id) : undefined,
    messageId: asId(event.message_id),
    selfId: asId(event.self_id),
    senderName: event.sender?.card || event.sender?.nickname,
    groupRole,
    text: cleanupCommand(parts.text, mentionedBot, config.commandPrefixes ?? ["#", "/"]),
    mentionedBot,
    timestamp: typeof event.time === "number" ? event.time : undefined,
  };
}

export function replySegments(reply: BotReply): OneBotSegment[] {
  const segments: OneBotSegment[] = [];
  if (reply.text) segments.push({ type: "text", data: { text: reply.text } });
  for (const image of reply.images ?? []) {
    if (image.url) segments.push({ type: "image", data: { file: image.url } });
    if (image.base64) {
      const encoded = image.base64.startsWith("base64://") ? image.base64 : `base64://${image.base64}`;
      segments.push({ type: "image", data: { file: encoded } });
    }
  }
  return segments;
}

export class OneBot11Client {
  readonly #config: OneBotTransportConfig;

  constructor(config: OneBotTransportConfig) {
    this.#config = config;
  }

  /** Fetch group member list from OneBot. Returns both cards (群名片) and nicknames for fuzzy matching. */
  async getGroupMemberList(groupId: string): Promise<string[]> {
    if (!this.#config.apiBaseUrl) throw new OneBotTransportError("OneBot API base URL is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.#config.apiBaseUrl.replace(/\/$/, "")}/get_group_member_list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#config.apiToken || this.#config.accessToken ? { authorization: `Bearer ${this.#config.apiToken ?? this.#config.accessToken}` } : {}),
        },
        body: JSON.stringify({ group_id: groupId, no_cache: false }),
        signal: controller.signal,
      });
      let payload: { status?: string; retcode?: number; data?: Array<{ card?: string; nickname?: string }> } | undefined;
      try { payload = await response.json() as typeof payload; } catch { throw new OneBotTransportError("get_group_member_list returned malformed JSON", response.status); }
      if (!response.ok || !payload || payload.status !== "ok" || payload.retcode !== 0) {
        throw new OneBotTransportError("get_group_member_list failed", response.status, payload?.retcode);
      }
      const names: string[] = [];
      for (const member of (payload.data ?? [])) {
        if (member.card) names.push(member.card);
        if (member.nickname && member.nickname !== member.card) names.push(member.nickname);
      }
      return names.filter(Boolean);
    } catch (error) {
      if (error instanceof OneBotTransportError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new OneBotTransportError("get_group_member_list timed out");
      throw new OneBotTransportError("get_group_member_list could not be completed");
    } finally {
      clearTimeout(timer);
    }
  }

  async send(action: "send_group_msg" | "send_private_msg", targetId: string, reply: BotReply): Promise<void> {
    if (!this.#config.apiBaseUrl) throw new OneBotTransportError("OneBot API base URL is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const body = action === "send_group_msg"
        ? { group_id: targetId, message: replySegments(reply) }
        : { user_id: targetId, message: replySegments(reply) };
      const response = await fetch(`${this.#config.apiBaseUrl.replace(/\/$/, "")}/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#config.apiToken || this.#config.accessToken ? { authorization: `Bearer ${this.#config.apiToken ?? this.#config.accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let payload: { status?: string; retcode?: number; wording?: string } | undefined;
      try { payload = await response.json() as typeof payload; } catch { /* malformed success/error is handled below */ }
      if (!response.ok) {
        throw new OneBotTransportError(
          `OneBot action failed with HTTP ${response.status}`,
          response.status,
        );
      }
      if (!payload || payload.status !== "ok" || payload.retcode !== 0) {
        const retcode = payload?.retcode;
        throw new OneBotTransportError(
          `OneBot action returned an error${retcode !== undefined ? ` (retcode=${retcode})` : ""}`,
          response.status,
          retcode,
        );
      }
    } catch (error) {
      if (error instanceof OneBotTransportError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new OneBotTransportError("OneBot action timed out");
      throw new OneBotTransportError("OneBot action could not be completed");
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadGroupFile(groupId: string, file: string, name: string): Promise<void> {
    if (!this.#config.apiBaseUrl) throw new OneBotTransportError("OneBot API base URL is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.#config.apiBaseUrl.replace(/\/$/, "")}/upload_group_file`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#config.apiToken || this.#config.accessToken ? { authorization: `Bearer ${this.#config.apiToken ?? this.#config.accessToken}` } : {}),
        },
        body: JSON.stringify({ group_id: groupId, file, name }),
        signal: controller.signal,
      });
      let payload: { status?: string; retcode?: number } | undefined;
      try { payload = await response.json() as typeof payload; } catch { /* malformed success/error is handled below */ }
      if (!response.ok) {
        throw new OneBotTransportError(
          `OneBot upload_group_file failed with HTTP ${response.status}`,
          response.status,
        );
      }
      if (!payload || payload.status !== "ok" || payload.retcode !== 0) {
        const retcode = payload?.retcode;
        throw new OneBotTransportError(
          `OneBot upload_group_file returned an error${retcode !== undefined ? ` (retcode=${retcode})` : ""}`,
          response.status,
          retcode,
        );
      }
    } catch (error) {
      if (error instanceof OneBotTransportError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new OneBotTransportError("OneBot upload_group_file timed out");
      throw new OneBotTransportError("OneBot upload_group_file could not be completed");
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function deliverReplies(
  context: TransportContext,
  replies: BotReply | BotReply[] | void,
  client: OneBot11Client,
  groupDailyQuota?: GroupDailyQuotaStore,
): Promise<void> {
  for (const reply of (replies ? (Array.isArray(replies) ? replies : [replies]) : [])) {
    let text = reply.text ?? "";
    for (const upload of reply.groupFileUploads ?? []) {
      try {
        await client.uploadGroupFile(upload.groupId, upload.file, upload.fileName);
        text += `\n✓ 已上传到 TMD 群文件：${upload.fileName}`;
      } catch (error) {
        const err = error as { message?: string };
        console.error(
          `[onebot] upload_group_file failed group=${upload.groupId}` +
            ` file=${upload.fileName} msg=${err.message ?? "unknown"}`,
        );
        text += "\n✗ 群文件上传失败，请检查 NapCat 权限或稍后重试。";
      }
    }
    const outbound: BotReply = {
      text,
      images: reply.images,
      privateFollowups: reply.privateFollowups,
    };
    if (outbound.text || outbound.images?.length) {
      const action =
        context.conversation === "group"
          ? "send_group_msg"
          : "send_private_msg";
      const targetId =
        context.conversation === "group" ? context.groupId! : context.userId;
      await sendChunked(client, action, targetId, outbound, groupDailyQuota);
    }
    for (const followup of outbound.privateFollowups ?? []) {
      await sendChunked(client, "send_private_msg", followup.userId, {
        text: followup.text,
        images: followup.images,
      });
    }
  }
}

async function sendChunked(
  client: OneBot11Client,
  action: "send_group_msg" | "send_private_msg",
  targetId: string,
  reply: BotReply,
  groupDailyQuota?: GroupDailyQuotaStore,
): Promise<void> {
  const images = reply.images ?? [];
  const pieces: BotReply[] =
    images.length <= 1
      ? [reply]
      : [
          ...(reply.text ? [{ text: reply.text, images: [] as BotReply["images"] }] : []),
          ...images.map((image) => ({ text: image.alt, images: [image] })),
        ];

  for (const piece of pieces) {
    if (action === "send_group_msg" && groupDailyQuota) {
      const decision = groupDailyQuota.tryConsume(targetId);
      if (!decision.ok) {
        console.error(
          `[quota] skip group ${targetId}: daily reply limit ${decision.limit} reached (${decision.day})`,
        );
        return;
      }
    }
    await client.send(action, targetId, piece);
  }
}

/** Fetch-style webhook adapter: callers can mount it on any Node HTTP framework. */
export function createOneBot11Webhook(config: OneBotTransportConfig, handler: TransportHandler) {
  const client = new OneBot11Client(config);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!authenticateInbound(request.headers, config)) return new Response(null, { status: 401 });
    let event: OneBot11Event;
    try { event = await request.json() as OneBot11Event; } catch { return new Response(null, { status: 400 }); }
    const context = normalizeOneBotEvent(event, config);
    if (!context) return new Response(null, { status: 204 });
    // Ack NapCat immediately. Life-assignment etc. can take several seconds; blocking
    // the HTTP client caused silent "no reply" when send also timed out.
    queueMicrotask(() => {
      void (async () => {
        try {
          console.error(
            `[onebot] handle ${context.conversation} text=${JSON.stringify(context.text.slice(0, 40))}`,
          );
          await deliverReplies(
            context,
            await handler(context),
            client,
            config.groupDailyQuota,
          );
        } catch (error) {
          const err = error as { message?: string; retcode?: number; status?: number };
          console.error(
            `[onebot] delivery failed conversation=${context.conversation}` +
              ` retcode=${err.retcode ?? "n/a"} status=${err.status ?? "n/a"}` +
              ` msg=${err.message ?? "unknown"}`,
          );
        }
      })();
    });
    return new Response(null, { status: 204 });
  };
}
