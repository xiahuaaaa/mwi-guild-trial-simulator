import type { GroupDailyQuotaStore } from "../group-daily-quota.ts";

/** Minimal OneBot 11 payloads. IDs intentionally stay strings: QQ IDs exceed JS safe integers. */
export interface OneBotSegment {
  type: string;
  data?: Record<string, unknown>;
}

export interface OneBot11Event {
  post_type?: string;
  message_type?: "group" | "private" | string;
  sub_type?: string;
  self_id?: string | number;
  user_id?: string | number;
  group_id?: string | number;
  message_id?: string | number;
  time?: number;
  message?: OneBotSegment[] | string;
  raw_message?: string;
  sender?: {
    nickname?: string;
    card?: string;
    role?: "owner" | "admin" | "member" | string;
  };
}

export type ConversationKind = "group" | "private";

export interface TransportContext {
  platform: "qq";
  protocol: "onebot-11";
  conversation: ConversationKind;
  userId: string;
  groupId?: string;
  messageId?: string;
  selfId?: string;
  senderName?: string;
  groupRole?: "owner" | "admin" | "member";
  /** Text after @bot and command-prefix cleanup. Never log this value. */
  text: string;
  mentionedBot: boolean;
  timestamp?: number;
}

export interface BotImage {
  /** A remotely reachable URL, or an already encoded base64 payload. */
  url?: string;
  base64?: string;
  alt?: string;
}

export interface PrivateFollowup {
  userId: string;
  text?: string;
  images?: BotImage[];
}

export interface GroupFileUpload {
  groupId: string;
  fileName: string;
  file: string;
}

/** Structurally compatible with the transport-neutral command-core reply. */
export interface BotReply {
  text?: string;
  images?: BotImage[];
  privateFollowups?: PrivateFollowup[];
  groupFileUploads?: GroupFileUpload[];
}

export interface OneBotTransportConfig {
  /** Inbound OneBot access token. */
  accessToken?: string;
  /** Additional inbound event secret, normally supplied via X-Event-Key. */
  eventKey?: string;
  /** OneBot HTTP API root, e.g. http://127.0.0.1:5700. */
  apiBaseUrl?: string;
  /** Outbound API token. Defaults to accessToken when set. */
  apiToken?: string;
  timeoutMs?: number;
  botId?: string;
  /** Command prefixes to remove after a bot mention; defaults to # and /. */
  commandPrefixes?: string[];
  /** Optional per-group daily outbound reply quota (group sends only). */
  groupDailyQuota?: GroupDailyQuotaStore;
}

export type TransportHandler = (context: TransportContext) => Promise<BotReply | BotReply[] | void> | BotReply | BotReply[] | void;
