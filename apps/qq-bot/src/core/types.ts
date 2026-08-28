export type ChatKind = "private" | "group";
export type InboundSource = "onebot" | "official-qq";

/**
 * The only message shape understood by the command layer. Transports must
 * discard malformed events before calling the command handler.
 */
export interface CommandContext {
  source: InboundSource;
  chatKind: ChatKind;
  userId: string;
  groupId?: string;
  isAdmin: boolean;
  text: string;
  /** Populated by the transport layer when group context is available and the command needs cross-referencing. */
  groupMemberNames?: string[];
}

export interface BotImage {
  url?: string;
  base64?: string;
  alt?: string;
}

export interface PrivateFollowup {
  userId: string;
  text?: string;
  images?: BotImage[];
}

/** Upload a file to a QQ group file folder via the transport layer. */
export interface GroupFileUpload {
  groupId: string;
  fileName: string;
  /** Local path, file://, http(s)://, or base64:// payload understood by NapCat. */
  file: string;
}

/**
 * A transport-neutral response. OneBot and official QQ transports may render
 * these fields differently without changing command semantics.
 */
export interface BotReply {
  text: string;
  images: BotImage[];
  privateFollowups: PrivateFollowup[];
  groupFileUploads?: GroupFileUpload[];
}

export function reply(
  text: string,
  options: {
    images?: BotImage[];
    privateFollowups?: PrivateFollowup[];
    groupFileUploads?: GroupFileUpload[];
  } = {},
): BotReply {
  return {
    text,
    images: options.images ?? [],
    privateFollowups: options.privateFollowups ?? [],
    groupFileUploads: options.groupFileUploads,
  };
}

export const COMBAT_TYPES = [
  "弓",
  "弩",
  "火",
  "水",
  "自",
  "盾",
  "枪",
  "剑",
  "锤",
] as const;

export type CombatType = (typeof COMBAT_TYPES)[number];

export const AURA_TYPES = [
  "速度",
  "守护",
  "物理",
  "暴击",
  "元素",
] as const;

export type AuraType = (typeof AURA_TYPES)[number];
