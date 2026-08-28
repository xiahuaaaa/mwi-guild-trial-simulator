type Json = Record<string, unknown>;

export const UNIQUE_AURAS = Object.freeze([
  { hrid: "/abilities/speed_aura", name: "速度光环" },
  { hrid: "/abilities/guardian_aura", name: "守护光环" },
  { hrid: "/abilities/fierce_aura", name: "物理光环" },
  { hrid: "/abilities/critical_aura", name: "暴击光环" },
  { hrid: "/abilities/mystic_aura", name: "元素光环" },
]);

interface AuraCandidate {
  memberId: string;
  level: number;
  roleHrid: string;
}

interface AuraChoice extends AuraCandidate {
  auraHrid: string;
  auraName: string;
}

interface TrialRegistration {
  trialHrid?: unknown;
  trialName?: unknown;
  weekStartAt?: unknown;
  capturedAt?: unknown;
  registeredCount?: unknown;
  members?: unknown;
}

function asRows(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Json =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    )
    : [];
}

function currentGuildWeekStart(now: Date): number {
  const date = new Date(now);
  const daysSinceFriday = (date.getUTCDay() + 2) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceFriday);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function rolePriority(roleHrid: string): number {
  if (roleHrid === "support" || roleHrid.endsWith("/support")) return 0;
  if (roleHrid === "tank" || roleHrid.endsWith("/tank")) return 1;
  if (!roleHrid) return 2;
  return 3;
}

function roleName(roleHrid: string): string {
  if (roleHrid === "support" || roleHrid.endsWith("/support")) {
    return "辅助";
  }
  if (roleHrid === "tank" || roleHrid.endsWith("/tank")) return "坦克";
  if (
    roleHrid === "damage_dealer" ||
    roleHrid.endsWith("/damage_dealer")
  ) {
    return "输出";
  }
  return roleHrid ? "已定位" : "未选择定位";
}

function compareCandidates(left: AuraCandidate, right: AuraCandidate): number {
  return right.level - left.level ||
    rolePriority(left.roleHrid) - rolePriority(right.roleHrid) ||
    left.memberId.localeCompare(right.memberId);
}

function score(choices: Array<AuraChoice | null>): {
  covered: number;
  total: number;
  minimum: number;
  tie: string;
} {
  const selected = choices.filter((choice): choice is AuraChoice =>
    choice != null
  );
  return {
    covered: selected.length,
    total: selected.reduce((sum, choice) => sum + choice.level, 0),
    minimum: selected.length
      ? Math.min(...selected.map((choice) => choice.level))
      : 0,
    tie: choices.map((choice) =>
      choice ? `${choice.auraHrid}:${choice.memberId}` : "~"
    ).join("|"),
  };
}

function optimisticBound(
  auraOrder: ReadonlyArray<{ hrid: string }>,
  index: number,
  usedMembers: Set<string>,
  partial: Array<AuraChoice | null>,
  candidatesByAura: Map<string, AuraCandidate[]>,
): { covered: number; total: number } {
  let covered = partial.filter(Boolean).length;
  let total = partial.reduce((sum, choice) => sum + (choice?.level ?? 0), 0);
  for (let auraIndex = index; auraIndex < auraOrder.length; auraIndex++) {
    const aura = auraOrder[auraIndex];
    const candidates = candidatesByAura.get(aura.hrid) ?? [];
    let best = 0;
    for (const candidate of candidates) {
      const key = candidate.memberId.toLocaleLowerCase("en-US");
      if (usedMembers.has(key)) continue;
      if (candidate.level > best) best = candidate.level;
    }
    if (best > 0) {
      covered++;
      total += best;
    }
  }
  return { covered, total };
}

function isBetter(
  candidate: Array<AuraChoice | null>,
  current: Array<AuraChoice | null> | null,
): boolean {
  if (!current) return true;
  const left = score(candidate);
  const right = score(current);
  return left.covered > right.covered ||
    (left.covered === right.covered && left.total > right.total) ||
    (left.covered === right.covered && left.total === right.total &&
      left.minimum > right.minimum) ||
    (left.covered === right.covered && left.total === right.total &&
      left.minimum === right.minimum && left.tie < right.tie);
}

export function allocateUniqueAuras(
  registeredMembers: Json[],
  directoryMembers: Json[],
): {
  choices: Array<AuraChoice | null>;
  missingSnapshots: string[];
  unknownMembers: string[];
} {
  const directory = new Map(directoryMembers.map((member) => [
    String(member.memberId ?? member.displayName ?? "").toLocaleLowerCase(
      "en-US",
    ),
    member,
  ]));
  const candidatesByAura = new Map<string, AuraCandidate[]>(
    UNIQUE_AURAS.map((aura) => [aura.hrid, []]),
  );
  const missingSnapshots: string[] = [];
  const unknownMembers: string[] = [];

  for (const registration of registeredMembers) {
    const memberId = String(registration.memberId ?? "").trim();
    if (!memberId) continue;
    const member = directory.get(memberId.toLocaleLowerCase("en-US"));
    if (!member) {
      unknownMembers.push(memberId);
      continue;
    }
    const snapshot = member.latestSnapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      missingSnapshots.push(memberId);
      continue;
    }
    const auraLevels = (
      snapshot.auras && typeof snapshot.auras === "object" &&
        !Array.isArray(snapshot.auras)
        ? snapshot.auras
        : {}
    ) as Json;
    for (const aura of UNIQUE_AURAS) {
      const level = Number(auraLevels[aura.hrid] ?? 0);
      if (!Number.isFinite(level) || level <= 0) continue;
      candidatesByAura.get(aura.hrid)!.push({
        memberId: String(member.displayName ?? member.memberId ?? memberId),
        level: Math.trunc(level),
        roleHrid: String(registration.roleHrid ?? ""),
      });
    }
  }
  for (const rows of candidatesByAura.values()) rows.sort(compareCandidates);

  const auraOrder = [...UNIQUE_AURAS].sort((left, right) =>
    candidatesByAura.get(left.hrid)!.length -
      candidatesByAura.get(right.hrid)!.length ||
    left.hrid.localeCompare(right.hrid)
  );
  let best: Array<AuraChoice | null> | null = null;
  const chosenByHrid = new Map<string, AuraChoice | null>();
  const auraIndexByHrid = new Map(
    UNIQUE_AURAS.map((aura, index) => [aura.hrid, index]),
  );
  const partialChoices = UNIQUE_AURAS.map(() => null as AuraChoice | null);

  function setPartial(auraHrid: string, choice: AuraChoice | null) {
    partialChoices[auraIndexByHrid.get(auraHrid)!] = choice;
  }

  function visit(index: number, usedMembers: Set<string>) {
    if (best) {
      const bound = optimisticBound(
        auraOrder,
        index,
        usedMembers,
        partialChoices,
        candidatesByAura,
      );
      const bestScore = score(best);
      if (
        bound.covered < bestScore.covered ||
        (bound.covered === bestScore.covered && bound.total < bestScore.total)
      ) {
        return;
      }
    }
    if (index === auraOrder.length) {
      const choices = UNIQUE_AURAS.map((aura) =>
        chosenByHrid.get(aura.hrid) ?? null,
      );
      if (isBetter(choices, best)) best = choices;
      return;
    }
    const aura = auraOrder[index];
    const candidates = candidatesByAura.get(aura.hrid) ?? [];
    chosenByHrid.set(aura.hrid, null);
    setPartial(aura.hrid, null);
    visit(index + 1, usedMembers);
    for (const candidate of candidates) {
      const key = candidate.memberId.toLocaleLowerCase("en-US");
      if (usedMembers.has(key)) continue;
      usedMembers.add(key);
      const choice = {
        ...candidate,
        auraHrid: aura.hrid,
        auraName: aura.name,
      };
      chosenByHrid.set(aura.hrid, choice);
      setPartial(aura.hrid, choice);
      visit(index + 1, usedMembers);
      chosenByHrid.set(aura.hrid, null);
      setPartial(aura.hrid, null);
      usedMembers.delete(key);
    }
    chosenByHrid.delete(aura.hrid);
  }

  visit(0, new Set());
  return {
    choices: best ?? UNIQUE_AURAS.map(() => null),
    missingSnapshots: [...new Set(missingSnapshots)].sort(),
    unknownMembers: [...new Set(unknownMembers)].sort(),
  };
}

export function formatAuraAssignments(
  trials: TrialRegistration[],
  directoryMembers: Json[],
  now = new Date(),
): string {
  if (!trials.length) {
    return "还没有本周战斗试炼报名数据。请让 adudu 打开“公会 → 试炼”，等待插件完成自动同步后再发送“光环分配”。";
  }
  const currentWeek = currentGuildWeekStart(now);
  const sections = trials.map((trial) => {
    const members = asRows(trial.members);
    const result = allocateUniqueAuras(members, directoryMembers);
    const trialName = String(trial.trialName ?? trial.trialHrid ?? "战斗试炼");
    const count = Number(trial.registeredCount ?? members.length);
    const weekTimestamp = Date.parse(String(trial.weekStartAt ?? ""));
    const stale = !Number.isFinite(weekTimestamp) ||
      weekTimestamp !== currentWeek;
    const lines = [
      `${trialName}（报名 ${count} 人${stale ? "，⚠️ 非本周数据" : ""}）`,
      ...result.choices.map((choice, index) =>
        choice
          ? `${UNIQUE_AURAS[index].name}：${choice.memberId} Lv.${choice.level}（${roleName(choice.roleHrid)}）`
          : `${UNIQUE_AURAS[index].name}：缺少可用成员`
      ),
    ];
    if (result.missingSnapshots.length) {
      lines.push(
        `未上传技能 ${result.missingSnapshots.length} 人：${result.missingSnapshots.slice(0, 12).join("、")}${result.missingSnapshots.length > 12 ? "…" : ""}`,
      );
    }
    if (result.unknownMembers.length) {
      lines.push(
        `名单未匹配 ${result.unknownMembers.length} 人：${result.unknownMembers.slice(0, 12).join("、")}${result.unknownMembers.length > 12 ? "…" : ""}`,
      );
    }
    return lines.join("\n");
  });
  return [
    "本周唯一光环分配",
    ...sections,
    "规则：每队五种唯一光环各 1 人；优先覆盖全部光环，再在“每人最多一种”的约束下使技能等级总和最高；同等级优先辅助/坦克。",
  ].join("\n\n");
}
