import { LIFE_SIMULATION_USAGE } from "../life-assignment.ts";
import {
  AURA_TYPES,
  COMBAT_TYPES,
  type AuraType,
  type CombatType,
} from "./types.ts";

export type QueryCommand =
  | { kind: "help" }
  | { kind: "guild-bottleneck" }
  | { kind: "profession-distribution" }
  | { kind: "guild-roster" }
  | { kind: "unregistered-trial-members" }
  | { kind: "signup-assignment-mismatches" }
  | { kind: "aura-assignment" }
  | { kind: "guild-bosses" }
  | { kind: "guild-plugin" }
  | { kind: "life-trials" }
  | { kind: "generate-life-assignment" }
  | { kind: "latest-life-assignment" }
  | { kind: "simulate-life-trial"; trialToken: string; memberIds: string[] }
  /** Latest combat trial assignment + rendered images (formerly 本周测试分工 / 图片). */
  | { kind: "latest-combat-assignment" };

export type AdminCommand =
  | { kind: "help-admin" }
  | { kind: "help-admin-advanced" }
  | { kind: "guild-report" }
  | { kind: "start-assignment"; exhaustive: boolean }
  | { kind: "assignment-progress" }
  | { kind: "stop-assignment" }
  | { kind: "simulate-current-assignment" }
  | { kind: "optimization-audit" }
  | { kind: "unavailable-roster" }
  | { kind: "equipment-check" }
  | { kind: "skill-recommendation" }
  | { kind: "start-test-assignment" }
  | { kind: "current-test-assets" }
  | { kind: "promote-test-assignment" }
  | { kind: "missing-uploads" }
  | { kind: "expired-uploads" }
  | { kind: "upload-latest-plugin" }
  | { kind: "unbind-combat"; characterName: string }
  | {
      kind: "rebind-combat";
      characterName: string;
      qqUserId: string;
      combatType: CombatType;
    };

export type PersonalCommand =
  | {
      kind: "bind-combat";
      characterName: string;
      combatType: CombatType;
      qqUserId?: string;
    }
  | {
      kind: "set-aura";
      characterName?: string;
      auraType: AuraType;
      level: number;
    };

export type ParsedCommand = QueryCommand | AdminCommand | PersonalCommand;

export type ParseResult =
  | { ok: true; command: ParsedCommand }
  | { ok: false; error: string }
  | { ok: false; ignored: true };

const SIMPLE_COMMANDS: Readonly<Record<string, ParsedCommand>> = {
  帮助: { kind: "help" },
  菜单: { kind: "help" },
  指令: { kind: "help" },
  管理: { kind: "help-admin" },
  管理进阶: { kind: "help-admin-advanced" },

  // Member read: weekly gallery
  本周分工: { kind: "latest-combat-assignment" },
  本周生活分工: { kind: "latest-life-assignment" },
  本周战斗分工: { kind: "latest-combat-assignment" },
  本周测试分工: { kind: "latest-combat-assignment" },
  本周测试分工图片: { kind: "latest-combat-assignment" },
  测试分工图片: { kind: "latest-combat-assignment" },

  // Published combat plan is official; old “正式分工” names read the same gallery.
  正式分工: { kind: "latest-combat-assignment" },
  本周正式分工: { kind: "latest-combat-assignment" },

  公会短板: { kind: "guild-bottleneck" },
  职业分布: { kind: "profession-distribution" },
  公会名单: { kind: "guild-roster" },
  未报名名单: { kind: "unregistered-trial-members" },
  试炼报名检查: { kind: "unregistered-trial-members" },
  未覆盖名单: { kind: "unregistered-trial-members" },
  分工未覆盖: { kind: "unregistered-trial-members" },
  报名检查: { kind: "signup-assignment-mismatches" },
  "[报名检查]": { kind: "signup-assignment-mismatches" },
  "【报名检查】": { kind: "signup-assignment-mismatches" },
  光环分配: { kind: "aura-assignment" },
  公会boss: { kind: "guild-bosses" },
  公会插件: { kind: "guild-plugin" },
  生活试炼: { kind: "life-trials" },

  // Life regenerate (admin-gated; old names kept as silent aliases)
  "[生活模拟]": { kind: "generate-life-assignment" },
  "【生活模拟】": { kind: "generate-life-assignment" },
  生活模拟: { kind: "generate-life-assignment" },
  重算生活: { kind: "generate-life-assignment" },
  生活分工: { kind: "generate-life-assignment" },
  试跑生活: { kind: "generate-life-assignment" },
  测试生活分工: { kind: "generate-life-assignment" },

  // Combat simulate + publish (admin-gated; published gallery is the official plan)
  "[战斗模拟]": { kind: "start-test-assignment" },
  "【战斗模拟】": { kind: "start-test-assignment" },
  战斗模拟: { kind: "start-test-assignment" },
  试跑战斗: { kind: "start-test-assignment" },
  测试分工: { kind: "start-test-assignment" },

  // Data / ops (admin)
  未上传名单: { kind: "missing-uploads" },
  上传过期名单: { kind: "expired-uploads" },
  生活top20: { kind: "guild-report" },
  公会查询: { kind: "guild-report" },
  数据体检: { kind: "optimization-audit" },
  优化: { kind: "optimization-audit" },
  不可用名单: { kind: "unavailable-roster" },
  装备检查: { kind: "equipment-check" },
  技能推荐: { kind: "skill-recommendation" },
  私聊本周分工: { kind: "current-test-assets" },
  当前测试: { kind: "current-test-assets" },
  转正方案: { kind: "promote-test-assignment" },
  测试分工转正: { kind: "promote-test-assignment" },
  上传最新插件: { kind: "upload-latest-plugin" },

  // Production engine (admin advanced; often unavailable)
  开始正式分工: { kind: "start-assignment", exhaustive: false },
  开始分工: { kind: "start-assignment", exhaustive: false },
  完全搜索分工: { kind: "start-assignment", exhaustive: true },
  开始完全分工: { kind: "start-assignment", exhaustive: true },
  分工进度: { kind: "assignment-progress" },
  终止分工: { kind: "stop-assignment" },
  模拟正式: { kind: "simulate-current-assignment" },
  当前分工模拟: { kind: "simulate-current-assignment" },
};

export function parseCommand(input: string): ParseResult {
  const text = normalizeText(input);
  if (!text) return { ok: false, ignored: true };

  const simple = SIMPLE_COMMANDS[text.toLowerCase()];
  if (simple) return { ok: true, command: simple };

  const retiredExclusion = rejectRetiredExclusion(text);
  if (retiredExclusion) return retiredExclusion;

  if (text.startsWith("生活模拟")) {
    const rest = text.slice("生活模拟".length).trim();
    if (!rest) {
      return { ok: false, error: LIFE_SIMULATION_USAGE };
    }
    const hashIndex = Math.max(rest.indexOf("#"), rest.indexOf("＃"));
    if (hashIndex >= 0) {
      return {
        ok: true,
        command: {
          kind: "simulate-life-trial",
          trialToken: rest.slice(0, hashIndex).trim(),
          memberIds: rest
            .slice(hashIndex + 1)
            .split(/[,，]/u)
            .map((name) => name.trim())
            .filter(Boolean),
        },
      };
    }
    return {
      ok: true,
      command: {
        kind: "simulate-life-trial",
        trialToken: rest,
        memberIds: [],
      },
    };
  }

  const tokens = text.split(/\s+/u);
  switch (tokens[0]) {
    case "#战斗绑定":
    case "＃战斗绑定":
    case "战斗绑定":
      return parseCombatBind(tokens);
    case "#战斗解绑":
    case "＃战斗解绑":
    case "战斗解绑":
      if (tokens.length !== 2) {
        return { ok: false, error: "格式：#战斗解绑 角色名" };
      }
      return {
        ok: true,
        command: { kind: "unbind-combat", characterName: tokens[1] },
      };
    case "#战斗改绑":
    case "＃战斗改绑":
    case "战斗改绑":
      return parseCombatRebind(tokens);
    case "#光环":
    case "＃光环":
    case "光环":
      return parseAura(tokens);
    default:
      return { ok: false, ignored: true };
  }
}

const RETIRED_EXCLUSION_PREFIXES: ReadonlyArray<{
  prefixes: readonly string[];
  suggested: string;
}> = [
  {
    prefixes: ["试跑战斗", "测试分工", "战斗模拟", "[战斗模拟]", "【战斗模拟】"],
    suggested: "战斗模拟",
  },
  {
    prefixes: ["试跑生活", "测试生活分工", "生活模拟", "[生活模拟]", "【生活模拟】"],
    suggested: "生活模拟",
  },
];

function rejectRetiredExclusion(text: string): ParseResult | null {
  for (const { prefixes, suggested } of RETIRED_EXCLUSION_PREFIXES) {
    for (const prefix of prefixes) {
      for (const hash of ["#", "＃"] as const) {
        if (text.startsWith(`${prefix}${hash}`)) {
          return {
            ok: false,
            error: `排除角色已取消，请直接发送「${suggested}」。`,
          };
        }
      }
    }
  }
  return null;
}

function parseCombatBind(tokens: string[]): ParseResult {
  const usage =
    "格式：#战斗绑定 角色名 类型；管理员代绑：#战斗绑定 角色名 QQ号 类型";
  if (tokens.length !== 3 && tokens.length !== 4) {
    return { ok: false, error: usage };
  }
  const combatTypeToken = tokens.length === 4 ? tokens[3] : tokens[2];
  const combatType = combatTypeFrom(combatTypeToken);
  if (!combatType) {
    return {
      ok: false,
      error: `未知战斗类型“${combatTypeToken}”；可用：${COMBAT_TYPES.join("/")}`,
    };
  }
  if (tokens.length === 4) {
    if (!/^\d{5,20}$/u.test(tokens[2])) {
      return { ok: false, error: "QQ号必须是 5–20 位数字。" };
    }
    return {
      ok: true,
      command: {
        kind: "bind-combat",
        characterName: tokens[1],
        qqUserId: tokens[2],
        combatType,
      },
    };
  }
  return {
    ok: true,
    command: {
      kind: "bind-combat",
      characterName: tokens[1],
      combatType,
    },
  };
}

function parseCombatRebind(tokens: string[]): ParseResult {
  if (tokens.length !== 4) {
    return {
      ok: false,
      error: "格式：#战斗改绑 角色名 QQ号 类型",
    };
  }
  if (!/^\d{5,20}$/u.test(tokens[2])) {
    return { ok: false, error: "QQ号必须是 5–20 位数字。" };
  }
  const combatType = combatTypeFrom(tokens[3]);
  if (!combatType) {
    return {
      ok: false,
      error: `未知战斗类型“${tokens[3]}”；可用：${COMBAT_TYPES.join("/")}`,
    };
  }
  return {
    ok: true,
    command: {
      kind: "rebind-combat",
      characterName: tokens[1],
      qqUserId: tokens[2],
      combatType,
    },
  };
}

function parseAura(tokens: string[]): ParseResult {
  if (tokens.length !== 3 && tokens.length !== 4) {
    return {
      ok: false,
      error: "格式：#光环 类型 等级；多角色时：#光环 角色名 类型 等级",
    };
  }
  const explicitCharacter = tokens.length === 4;
  const auraToken = tokens[explicitCharacter ? 2 : 1];
  const levelToken = tokens[explicitCharacter ? 3 : 2];
  const auraType = auraTypeFrom(auraToken);
  if (!auraType) {
    return {
      ok: false,
      error: `未知光环类型“${auraToken}”；可用：${AURA_TYPES.join("/")}`,
    };
  }
  if (!/^\d+$/u.test(levelToken)) {
    return { ok: false, error: "光环等级必须是 1–200 的整数。" };
  }
  const level = Number(levelToken);
  if (level < 1 || level > 200) {
    return { ok: false, error: "光环等级必须是 1–200 的整数。" };
  }
  return {
    ok: true,
    command: {
      kind: "set-aura",
      characterName: explicitCharacter ? tokens[1] : undefined,
      auraType,
      level,
    },
  };
}

function combatTypeFrom(value: string): CombatType | undefined {
  return COMBAT_TYPES.find((candidate) => candidate === value);
}

function auraTypeFrom(value: string): AuraType | undefined {
  return AURA_TYPES.find((candidate) => candidate === value);
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/[\t\r\n ]+/gu, " ")
    .trim();
}
