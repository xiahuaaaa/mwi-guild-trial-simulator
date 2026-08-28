import type {
  ChatKind,
  CommandContext,
  InboundSource,
} from "./types.ts";

export interface NormalizationPolicy {
  adminUserIds: ReadonlySet<string>;
  /**
   * OneBot's sender.role is trusted only inside these explicitly configured
   * QQ groups.
   */
  roleAdminGroupIds?: ReadonlySet<string>;
}

export type NormalizationResult =
  | { ok: true; context: CommandContext }
  | { ok: false; reason: string };

export function normalizeInboundEvent(
  source: InboundSource,
  rawEvent: unknown,
  policy: NormalizationPolicy,
): NormalizationResult {
  return source === "onebot"
    ? normalizeOneBotEvent(rawEvent, policy)
    : normalizeOfficialQqEvent(rawEvent, policy);
}

export function normalizeOneBotEvent(
  rawEvent: unknown,
  policy: NormalizationPolicy,
): NormalizationResult {
  const event = asRecord(rawEvent);
  if (!event || event.post_type !== "message") {
    return { ok: false, reason: "不是 OneBot 消息事件。" };
  }
  const messageType = event.message_type;
  if (messageType !== "private" && messageType !== "group") {
    return { ok: false, reason: "OneBot 消息类型不受支持。" };
  }
  const userId = scalarString(event.user_id);
  const text = messageText(event.raw_message ?? event.message);
  if (!userId || text === undefined) {
    return { ok: false, reason: "OneBot 消息缺少 user_id 或文本。" };
  }
  const groupId = messageType === "group"
    ? scalarString(event.group_id)
    : undefined;
  if (messageType === "group" && !groupId) {
    return { ok: false, reason: "OneBot 群消息缺少 group_id。" };
  }
  const sender = asRecord(event.sender);
  const trustedRole = messageType === "group" &&
    groupId !== undefined &&
    policy.roleAdminGroupIds?.has(groupId) === true &&
    (sender?.role === "admin" || sender?.role === "owner");
  return {
    ok: true,
    context: {
      source: "onebot",
      chatKind: messageType as ChatKind,
      userId,
      groupId,
      isAdmin: policy.adminUserIds.has(userId) || trustedRole,
      text,
    },
  };
}

/**
 * Accepts both group OpenAPI events and C2C events after signature
 * verification by the transport. The transport should pass the event body,
 * not an unverified webhook envelope.
 */
export function normalizeOfficialQqEvent(
  rawEvent: unknown,
  policy: NormalizationPolicy,
): NormalizationResult {
  const event = asRecord(rawEvent);
  if (!event) return { ok: false, reason: "QQ 事件不是对象。" };
  const author = asRecord(event.author);
  const userId = scalarString(
    author?.id ?? author?.user_openid ?? event.user_openid ?? event.openid,
  );
  const text = messageText(event.content ?? event.text);
  if (!userId || text === undefined) {
    return { ok: false, reason: "QQ 消息缺少用户标识或文本。" };
  }

  const groupId = scalarString(
    event.group_openid ?? event.group_id ?? event.channel_id,
  );
  const direct = event.message_scene === "c2c" ||
    event.chat_type === "private" ||
    event.direct_message === true ||
    !groupId;
  return {
    ok: true,
    context: {
      source: "official-qq",
      chatKind: direct ? "private" : "group",
      userId,
      groupId: direct ? undefined : groupId,
      // Never trust an is_admin field supplied in an event payload.
      isAdmin: policy.adminUserIds.has(userId),
      text,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function messageText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;

  // OneBot array messages: only text segments are command input. CQ mentions
  // and images are deliberately not coerced into command text.
  return value
    .map((segment) => {
      const record = asRecord(segment);
      if (record?.type !== "text") return "";
      const data = asRecord(record.data);
      return typeof data?.text === "string" ? data.text : "";
    })
    .join("");
}
