import { formatBeijingDate, formatBeijingTimestamp } from "./beijing-time.ts";

type Json = Record<string, unknown>;

function asRows(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Json =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    )
    : [];
}

function memberKey(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function displayName(member: Json): string {
  return String(member.displayName ?? member.memberId ?? "").trim();
}

/** Names assigned in the latest formal life-assignment run. */
export function collectLifeAssignmentNames(assignment: Json | null | undefined): string[] {
  if (!assignment || !Array.isArray(assignment.trials)) return [];
  const names: string[] = [];
  for (const trial of asRows(assignment.trials)) {
    for (const entry of Array.isArray(trial.roster) ? trial.roster : []) {
      const name = rosterMemberId(entry);
      if (name) names.push(name);
    }
  }
  return names;
}

/** Names assigned across combat boss rosters in the latest combat assignment. */
export function collectCombatAssignmentNames(assignment: Json | null | undefined): string[] {
  if (!assignment || !Array.isArray(assignment.bosses)) return [];
  const names: string[] = [];
  for (const boss of asRows(assignment.bosses)) {
    for (const entry of asRows(boss.roster)) {
      const name = String(entry.memberId ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

export interface AssignmentCoverageCheckInput {
  rosterMembers: readonly Json[];
  lifeAssignment?: Json | null;
  combatAssignment?: Json | null;
  lifeWeekStartAt?: string;
  combatGeneratedAt?: string;
  lifeSource?: "formal" | "test";
  expectedWeekStartAt?: string;
}

export function formatUnassignedAssignmentMembers(
  input: AssignmentCoverageCheckInput,
): string {
  const lifeNames = collectLifeAssignmentNames(input.lifeAssignment);
  const combatNames = collectCombatAssignmentNames(input.combatAssignment);
  const life = new Set(lifeNames.map(memberKey));
  const combat = new Set(combatNames.map(memberKey));

  const missing = input.rosterMembers
    .map((member) => {
      const id = String(member.memberId ?? "").trim();
      if (!id) return null;
      const key = memberKey(id);
      if (life.has(key) || combat.has(key)) return null;
      return displayName(member) || id;
    })
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => left.localeCompare(right, "en"));

  const lifeWeek = formatBeijingDate(
    input.lifeWeekStartAt ??
      input.lifeAssignment?.weekStartAt ??
      "",
  );
  const combatAt = formatBeijingTimestamp(
    input.combatGeneratedAt ??
      input.combatAssignment?.generatedAt ??
      "",
  );

  const expectedWeek = formatBeijingDate(input.expectedWeekStartAt ?? "");
  const lifeSourceLabel = input.lifeSource === "test"
    ? "测试方案"
    : input.lifeSource === "formal"
      ? "正式方案"
      : "";

  const lines = [
    "本周分工未覆盖检查",
    "规则：对照本周生活分工 + 战斗分工结果；两项名单都不在的成员列在下面。",
    `公会名单 ${input.rosterMembers.length} 人｜生活分工 ${life.size}｜战斗分工 ${combat.size}｜都未进 ${missing.length}`,
  ];
  if (lifeSourceLabel) lines.push(`生活分工来源：${lifeSourceLabel}`);
  if (lifeWeek) lines.push(`生活分工周起点：${lifeWeek}`);
  if (combatAt) lines.push(`战斗分工生成：${combatAt}`);
  if (expectedWeek && lifeWeek && expectedWeek !== lifeWeek) {
    lines.push(`⚠️ 生活分工周（${lifeWeek}）与本周（${expectedWeek}）不一致。`);
  }

  if (!life.size && !combat.size) {
    lines.push("还没有生活或战斗分工结果。请先生成「本周生活分工」和「本周分工」。");
    return lines.join("\n");
  }
  if (!life.size) {
    lines.push("⚠️ 尚无生活分工结果；当前只按战斗分工比对。");
  }
  if (!combat.size) {
    lines.push("⚠️ 尚无战斗分工结果；当前只按生活分工比对。");
  }

  if (!missing.length) {
    lines.push("全员都已进入生活或战斗至少一项分工。");
    return lines.join("\n");
  }

  lines.push("未进入分工名单：");
  for (const [index, name] of missing.entries()) {
    lines.push(`${index + 1}. ${name}`);
  }
  return lines.join("\n");
}

/** Keep aura allocation on combat trials only (ignore skilling rows). */
export function combatRegistrationTrials(
  trials: readonly Json[],
): Json[] {
  return trials.filter((trial) => {
    const explicit = String(trial.kind ?? "").trim();
    if (explicit === "combat") return true;
    if (explicit === "skilling") return false;
    return String(trial.trialHrid ?? "").startsWith("/guild_combat/");
  });
}

export function skillingRegistrationTrials(
  trials: readonly Json[],
): Json[] {
  return trials.filter((trial) => {
    const explicit = String(trial.kind ?? "").trim();
    if (explicit === "skilling") return true;
    if (explicit === "combat") return false;
    return String(trial.trialHrid ?? "").startsWith("/guild_skilling/");
  });
}

interface TrialSlot {
  trialKey: string;
  trialName: string;
}

interface SignupMismatch {
  memberId: string;
  assignedName: string | null;
  registeredName: string | null;
}

function trialLabel(trial: Json): string {
  const name = String(trial.trialName ?? trial.bossName ?? trial.name ?? "").trim();
  if (name) return name;
  const hrid = String(trial.trialHrid ?? trial.hrid ?? trial.bossId ?? "").trim();
  return hrid.split("/").at(-1) || hrid || "未知试炼";
}

function trialMatchKey(trial: Json): string {
  const hrid = String(trial.trialHrid ?? trial.hrid ?? trial.bossId ?? "").trim();
  if (hrid) return memberKey(hrid);
  const name = String(trial.trialName ?? trial.bossName ?? trial.name ?? "").trim();
  return memberKey(name);
}

function trialKeySlug(key: string): string {
  return key.split("/").at(-1) || key;
}

function sameTrialSlot(left: TrialSlot, right: TrialSlot): boolean {
  if (left.trialKey && right.trialKey && left.trialKey === right.trialKey) {
    return true;
  }
  const leftSlug = trialKeySlug(left.trialKey);
  const rightSlug = trialKeySlug(right.trialKey);
  if (leftSlug && rightSlug && leftSlug === rightSlug) return true;
  return Boolean(
    left.trialName &&
    right.trialName &&
    memberKey(left.trialName) === memberKey(right.trialName),
  );
}

function rosterMemberId(entry: unknown): string {
  if (typeof entry === "string" || typeof entry === "number") {
    return String(entry).trim();
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const row = entry as Json;
    return String(row.memberId ?? row.displayName ?? "").trim();
  }
  return "";
}

function collectRegistrationSlots(
  trials: readonly Json[],
): Map<string, TrialSlot> {
  const byMember = new Map<string, TrialSlot>();
  for (const trial of trials) {
    const slot: TrialSlot = {
      trialKey: trialMatchKey(trial),
      trialName: trialLabel(trial),
    };
    if (!slot.trialKey) continue;
    for (const entry of asRows(trial.members)) {
      const id = String(entry.memberId ?? "").trim();
      if (!id) continue;
      byMember.set(memberKey(id), slot);
    }
  }
  return byMember;
}

function collectLifeAssignmentSlots(
  assignment: Json | null | undefined,
): Map<string, TrialSlot> {
  const byMember = new Map<string, TrialSlot>();
  if (!assignment || !Array.isArray(assignment.trials)) return byMember;
  for (const trial of asRows(assignment.trials)) {
    const slot: TrialSlot = {
      trialKey: trialMatchKey(trial),
      trialName: trialLabel(trial),
    };
    if (!slot.trialKey) continue;
    for (const entry of Array.isArray(trial.roster) ? trial.roster : []) {
      const id = rosterMemberId(entry);
      if (!id) continue;
      byMember.set(memberKey(id), slot);
    }
  }
  return byMember;
}

function collectCombatAssignmentSlots(
  assignment: Json | null | undefined,
): Map<string, TrialSlot> {
  const byMember = new Map<string, TrialSlot>();
  if (!assignment || !Array.isArray(assignment.bosses)) return byMember;
  for (const boss of asRows(assignment.bosses)) {
    const slot: TrialSlot = {
      trialKey: trialMatchKey({
        trialHrid: boss.bossId ?? boss.trialHrid,
        trialName: boss.bossName ?? boss.trialName,
      }),
      trialName: String(boss.bossName ?? boss.trialName ?? "").trim() ||
        String(boss.bossId ?? boss.trialHrid ?? "").split("/").at(-1) ||
        "未知试炼",
    };
    if (!slot.trialKey) continue;
    for (const entry of asRows(boss.roster)) {
      const id = String(entry.memberId ?? "").trim();
      if (!id) continue;
      byMember.set(memberKey(id), slot);
    }
  }
  return byMember;
}

function collectSignupMismatches(
  assigned: Map<string, TrialSlot>,
  registered: Map<string, TrialSlot>,
  displayByKey: Map<string, string>,
): SignupMismatch[] {
  const keys = new Set([...assigned.keys(), ...registered.keys()]);
  const mismatches: SignupMismatch[] = [];
  for (const key of keys) {
    const assignedSlot = assigned.get(key);
    const registeredSlot = registered.get(key);
    if (
      assignedSlot &&
      registeredSlot &&
      sameTrialSlot(assignedSlot, registeredSlot)
    ) {
      continue;
    }
    mismatches.push({
      memberId: displayByKey.get(key) ?? key,
      assignedName: assignedSlot?.trialName ?? null,
      registeredName: registeredSlot?.trialName ?? null,
    });
  }
  return mismatches.sort((left, right) =>
    left.memberId.localeCompare(right.memberId, "en")
  );
}

function formatMismatchLine(entry: SignupMismatch): string {
  if (entry.assignedName && entry.registeredName) {
    return `${entry.memberId}：分配「${entry.assignedName}」，报名「${entry.registeredName}」`;
  }
  if (entry.assignedName) {
    return `${entry.memberId}：分配「${entry.assignedName}」，未报名`;
  }
  return `${entry.memberId}：报名「${entry.registeredName}」，未在模拟分工`;
}

function appendMismatchSection(
  lines: string[],
  title: string,
  mismatches: readonly SignupMismatch[],
): void {
  lines.push("");
  lines.push(title);
  if (!mismatches.length) {
    lines.push("无不一致成员。");
    return;
  }
  for (const [index, entry] of mismatches.entries()) {
    lines.push(`${index + 1}. ${formatMismatchLine(entry)}`);
  }
}

export interface SignupAssignmentMismatchInput {
  registrationTrials: readonly Json[];
  lifeAssignment?: Json | null;
  combatAssignment?: Json | null;
  /** Prefer current guild-week start; stale registration rows from other weeks are dropped. */
  weekStartAt?: string;
  /** When set, only these trial hrids are compared (usually this week's catalog). */
  activeTrialHrids?: readonly string[];
  lifeWeekStartAt?: string;
  lifeGeneratedAt?: string;
  lifeSource?: "formal" | "test";
  combatGeneratedAt?: string;
  registrationCapturedAt?: string;
}

function weekStartKey(value: unknown): string {
  return String(value ?? "").trim().slice(0, 10);
}

export interface LifeAssignmentPickInput {
  expectedWeekStartAt?: string;
  /** Prefer the assignment that members actually see (published report generatedAt). */
  preferGeneratedAt?: string;
  formal?: { weekStartAt?: string; assignment?: Json | null } | null;
  test?: { weekStartAt?: string; assignment?: Json | null } | null;
}

export interface LifeAssignmentPick {
  assignment: Json | null;
  weekStartAt?: string;
  source?: "formal" | "test";
}

function lifeEnvelopeAssignment(
  envelope: { weekStartAt?: string; assignment?: Json | null } | null | undefined,
): { assignment: Json | null; weekStartAt?: string } {
  const assignment = envelope?.assignment ?? null;
  const weekStartAt = envelope?.weekStartAt ??
    (typeof assignment?.weekStartAt === "string" ? assignment.weekStartAt : undefined);
  return { assignment, weekStartAt };
}

function assignmentGeneratedAt(assignment: Json | null): string {
  return typeof assignment?.generatedAt === "string" ? assignment.generatedAt : "";
}

function compareLifeAssignmentCandidates(
  left: LifeAssignmentPick & { week: string },
  right: LifeAssignmentPick & { week: string },
  weekFirst: boolean,
): number {
  if (weekFirst) {
    const weekCmp = right.week.localeCompare(left.week);
    if (weekCmp) return weekCmp;
  }
  const timeCmp = assignmentGeneratedAt(right.assignment).localeCompare(
    assignmentGeneratedAt(left.assignment),
  );
  if (timeCmp) return timeCmp;
  if (left.source !== right.source) return left.source === "test" ? -1 : 1;
  return 0;
}

/** Prefer this guild week's newest life assignment (test or formal). */
export function pickLifeAssignmentForWeek(
  input: LifeAssignmentPickInput,
): LifeAssignmentPick {
  const expected = weekStartKey(input.expectedWeekStartAt);
  const candidates: Array<LifeAssignmentPick & { week: string }> = [];
  const test = lifeEnvelopeAssignment(input.test);
  if (test.assignment) {
    candidates.push({
      assignment: test.assignment,
      weekStartAt: test.weekStartAt,
      source: "test",
      week: weekStartKey(test.weekStartAt),
    });
  }
  const formal = lifeEnvelopeAssignment(input.formal);
  if (formal.assignment) {
    candidates.push({
      assignment: formal.assignment,
      weekStartAt: formal.weekStartAt,
      source: "formal",
      week: weekStartKey(formal.weekStartAt),
    });
  }
  const inWeek = expected
    ? candidates.filter((row) => row.week === expected)
    : [];
  const preferred = String(input.preferGeneratedAt ?? "").trim();
  if (preferred) {
    const match = (inWeek.length ? inWeek : candidates).find((row) =>
      assignmentGeneratedAt(row.assignment) === preferred
    ) ?? candidates.find((row) => assignmentGeneratedAt(row.assignment) === preferred);
    if (match) {
      return {
        assignment: match.assignment,
        weekStartAt: match.weekStartAt,
        source: match.source,
      };
    }
  }
  const pool = (inWeek.length ? inWeek : candidates).slice().sort((left, right) =>
    compareLifeAssignmentCandidates(left, right, !inWeek.length)
  );
  const newest = pool[0];
  return newest
    ? {
        assignment: newest.assignment,
        weekStartAt: newest.weekStartAt,
        source: newest.source,
      }
    : { assignment: null };
}

/**
 * Keep registration snapshots that belong to the active guild week / catalog.
 * `/trial-registrations/current` returns latest-per-hrid and can include bosses
 * from previous weeks (e.g. badger/hedgehog) which must not pollute the check.
 */
export function filterActiveRegistrationTrials(
  trials: readonly Json[],
  options: {
    weekStartAt?: string;
    activeTrialHrids?: readonly string[];
  } = {},
): Json[] {
  const weekKey = weekStartKey(options.weekStartAt);
  const allowed = new Set(
    (options.activeTrialHrids ?? [])
      .map((hrid) => String(hrid ?? "").trim())
      .filter(Boolean),
  );
  return asRows(trials).filter((trial) => {
    const hrid = String(trial.trialHrid ?? "").trim();
    if (allowed.size && (!hrid || !allowed.has(hrid))) return false;
    if (!weekKey) return true;
    const trialWeek = weekStartKey(trial.weekStartAt);
    // Some rows only carry week on the API envelope; accept missing week when
    // hrid already passed the active-catalog filter.
    if (!trialWeek) return allowed.size > 0;
    return trialWeek === weekKey;
  });
}

/**
 * Compare actual in-game life/combat trial signups with the latest simulated
 * assignment rosters and list every mismatched member.
 */
export function formatSignupAssignmentMismatches(
  input: SignupAssignmentMismatchInput,
): string {
  const weekStartAt = input.weekStartAt ?? input.lifeWeekStartAt;
  const allTrials = filterActiveRegistrationTrials(input.registrationTrials, {
    weekStartAt,
    activeTrialHrids: input.activeTrialHrids,
  });
  const lifeRegs = skillingRegistrationTrials(allTrials);
  const combatRegs = combatRegistrationTrials(allTrials);

  const displayByKey = new Map<string, string>();
  const remember = (id: string) => {
    const key = memberKey(id);
    if (!displayByKey.has(key)) displayByKey.set(key, id);
  };
  for (const trial of allTrials) {
    for (const entry of asRows(trial.members)) {
      const id = String(entry.memberId ?? "").trim();
      if (id) remember(id);
    }
  }
  for (const id of collectLifeAssignmentNames(input.lifeAssignment)) remember(id);
  for (const id of collectCombatAssignmentNames(input.combatAssignment)) {
    remember(id);
  }

  const lifeAssigned = collectLifeAssignmentSlots(input.lifeAssignment);
  const combatAssigned = collectCombatAssignmentSlots(input.combatAssignment);
  const lifeRegistered = collectRegistrationSlots(lifeRegs);
  const combatRegistered = collectRegistrationSlots(combatRegs);

  const lifeMismatches = collectSignupMismatches(
    lifeAssigned,
    lifeRegistered,
    displayByKey,
  );
  const combatMismatches = collectSignupMismatches(
    combatAssigned,
    combatRegistered,
    displayByKey,
  );

  const lifeWeek = formatBeijingDate(
    weekStartAt ?? input.lifeAssignment?.weekStartAt,
  );
  const lifeAt = formatBeijingTimestamp(
    input.lifeGeneratedAt ??
      (typeof input.lifeAssignment?.generatedAt === "string"
        ? input.lifeAssignment.generatedAt
        : ""),
  );
  const lifeSourceLabel = input.lifeSource === "test"
    ? "测试方案"
    : input.lifeSource === "formal"
      ? "正式方案"
      : "";
  const combatAt = formatBeijingTimestamp(
    input.combatGeneratedAt ?? input.combatAssignment?.generatedAt ?? "",
  );
  const regAt = formatBeijingTimestamp(input.registrationCapturedAt ?? "");
  const combatSourceMode = String(
    (input.combatAssignment?.source as Json | undefined)?.mode ?? "",
  );
  const combatIgnoresSignup =
    combatSourceMode.includes("reassigned") ||
    combatSourceMode.includes("available");

  const lines = [
    "报名检查（实际报名 vs 最新模拟分工）",
    "规则：只对照本周公会试炼；分配场次与报名场次不同、只分配未报名、只报名未分配，都算不一致。",
    `生活：分工 ${lifeAssigned.size}｜报名 ${lifeRegistered.size}｜不一致 ${lifeMismatches.length}`,
    `战斗：分工 ${combatAssigned.size}｜报名 ${combatRegistered.size}｜不一致 ${combatMismatches.length}`,
  ];
  if (lifeWeek) lines.push(`本周起点：${lifeWeek}`);
  if (lifeSourceLabel) lines.push(`生活分工来源：${lifeSourceLabel}`);
  if (lifeAt) lines.push(`生活分工生成：${lifeAt}`);
  if (combatAt) lines.push(`战斗分工生成：${combatAt}`);
  if (regAt) lines.push(`报名同步：${regAt}`);
  if (combatIgnoresSignup) {
    lines.push(
      "说明：当前战斗方案是「可用人员重排」（不按报名），场次对不上会偏多，属预期。",
    );
  }

  if (!lifeAssigned.size && !combatAssigned.size && !allTrials.length) {
    lines.push("还没有报名或模拟分工数据。请先同步试炼报名，并生成生活/战斗分工。");
    return lines.join("\n");
  }
  if (!allTrials.length) {
    lines.push("⚠️ 尚无试炼报名快照；请让 adudu 打开“公会 → 试炼”等待插件同步。");
  }
  if (!lifeAssigned.size) {
    lines.push("⚠️ 尚无生活模拟分工；生活侧无法完整对照。");
  }
  if (!combatAssigned.size) {
    lines.push("⚠️ 尚无战斗模拟分工；战斗侧无法完整对照。");
  }

  appendMismatchSection(lines, "生活试炼不一致：", lifeMismatches);
  appendMismatchSection(lines, "战斗试炼不一致：", combatMismatches);

  if (!lifeMismatches.length && !combatMismatches.length) {
    lines.push("");
    lines.push("生活与战斗报名均与最新模拟分工一致。");
  }
  return lines.join("\n");
}
