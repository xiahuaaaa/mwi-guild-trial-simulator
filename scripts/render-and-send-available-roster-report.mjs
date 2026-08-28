import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputPath =
  process.env.MWI_AVAILABLE_REPORT_JSON ??
  path.join(
    projectDirectory,
    ".local/tmd-available-roster-composition-lab.json",
  );
const outputDirectory =
  process.env.MWI_TEST_REPORT_DIR ??
  path.join(projectDirectory, "artifacts/test-report");
const groupId = Number(process.env.MWI_QQ_TMD_GROUP_ID ?? "532133273");
const oneBotBase = (
  process.env.MWI_ONEBOT_API_BASE ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const shouldSend = process.env.MWI_REPORT_SEND === "1";
const shouldPublishAssignment = process.env.MWI_REPORT_PUBLISH_ASSIGNMENT === "1";
const shouldPublishAssets = process.env.MWI_REPORT_PUBLISH_ASSETS === "1";
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net"
).replace(/\/$/, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY ?? "";
const rawLegacyFirstBossSlug = process.env.MWI_REPORT_LEGACY_FIRST_BOSS_SLUG;
const legacyFirstBossSlug =
  !rawLegacyFirstBossSlug || rawLegacyFirstBossSlug === "0"
    ? null
    : rawLegacyFirstBossSlug;

const CHROME_CANDIDATES = [
  process.env.MWI_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const DEBUFF_ABILITY_HRIDS = new Set([
  "/abilities/entangle",
  "/abilities/smoke_burst",
  "/abilities/pestilent_shot",
  "/abilities/toxic_pollen",
  "/abilities/natures_veil",
  "/abilities/flame_blast",
  "/abilities/fireball",
  "/abilities/frost_surge",
  "/abilities/water_strike",
  "/abilities/maim",
  "/abilities/crippling_slash",
  "/abilities/puncture",
  "/abilities/penetrating_shot",
  "/abilities/penetrating_strike",
]);

const BOSS_NAME_EN = {
  badger: "Trial Badger",
  hedgehog: "Trial Hedgehog",
  chameleon: "Trial Chameleon",
  swarm: "Trial Swarm",
  试炼獾: "Trial Badger",
  试炼刺猬: "Trial Hedgehog",
  试炼变色龙: "Trial Chameleon",
  试炼虫群: "Trial Swarm",
};

const COMBAT_TYPE_EN = {
  弓: "Bow",
  弩: "Crossbow",
  火: "Fire",
  水: "Water",
  自: "Nature",
  盾: "Shield",
  枪: "Spear",
  剑: "Sword",
  锤: "Hammer",
};

const AURA_NAME_EN = {
  速度: "Speed",
  守护: "Guardian",
  物理: "Fierce",
  暴击: "Critical",
  元素: "Mystic",
};

function bossDisplayName(boss, locale = "zh") {
  if (locale === "zh") return boss.bossName;
  const key = boss.bossKey ?? boss.bossId?.split("/").at(-1);
  return BOSS_NAME_EN[key] ?? BOSS_NAME_EN[boss.bossName] ?? boss.bossName;
}

function combatTypeName(value, locale = "zh") {
  if (locale === "zh") return value;
  return COMBAT_TYPE_EN[value] ?? value;
}

function auraName(value, locale = "zh") {
  if (!value) return value;
  if (locale === "zh") return value;
  return AURA_NAME_EN[value] ?? value;
}

function hridToAbilityName(hrid) {
  if (!hrid) return null;
  const slug = String(hrid).split("/").at(-1);
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function abilityLabel(ability, abilityHrid, locale = "zh") {
  if (locale === "zh") return ability;
  const text = String(ability ?? "");
  const levelMatch = text.match(/Lv(\d+)/i);
  const level = levelMatch ? levelMatch[1] : null;
  const fromHrid = hridToAbilityName(abilityHrid);
  if (fromHrid) {
    return level ? `${fromHrid} Lv${level}` : fromHrid;
  }
  return text.replace(/Lv(\d+)/i, " Lv$1");
}

function listJoin(items, locale = "zh") {
  return items.join(locale === "zh" ? "、" : ", ");
}

function summarizeDebuffContribution(stats, locale = "zh") {
  if (!stats) return "<span class='muted'>—</span>";
  const abilities = (stats.topAbilities ?? []).filter(
    (ability) =>
      DEBUFF_ABILITY_HRIDS.has(ability.abilityHrid) ||
      /缠绕|烟|疫病|剧毒|菌幕|碎裂|致残|穿刺|贯穿/.test(
        String(ability.nameZh ?? ""),
      ),
  );
  if (!abilities.length) return "<span class='muted'>—</span>";
  const totalDps = abilities.reduce(
    (sum, ability) => sum + Number(ability.averageDps ?? 0),
    0,
  );
  const detail = abilities
    .slice(0, 3)
    .map((ability) =>
      locale === "zh"
        ? `${escapeHtml(ability.nameZh)} ${escapeHtml(String(ability.averageDps))}`
        : `${escapeHtml(hridToAbilityName(ability.abilityHrid) ?? ability.nameZh)} ${escapeHtml(String(ability.averageDps))}`,
    )
    .join(locale === "zh" ? "、" : ", ");
  return `<b>${totalDps.toFixed(1)} dps</b><small>${detail}</small>`;
}

function summarizeBuffContribution(member, aura, locale = "zh") {
  if (aura) {
    const auraLabel = auraName(aura.auraNameZh, locale);
    if (locale === "zh") {
      const survival = aura.survivalNotes?.length
        ? `；生存 ${escapeHtml(aura.survivalNotes.join("、"))}`
        : "";
      return `<b>${escapeHtml(auraLabel)}</b><small>名义团队 DPS +${escapeHtml(String(aura.estimatedTeamDpsGain))}（${escapeHtml(String(aura.estimatedTeamDpsGainPercent))}%）${survival}</small>`;
    }
    const survival = aura.survivalNotes?.length
      ? `; survival ${escapeHtml(aura.survivalNotes.join(", "))}`
      : "";
    return `<b>${escapeHtml(auraLabel)}</b><small>nominal team DPS +${escapeHtml(String(aura.estimatedTeamDpsGain))} (${escapeHtml(String(aura.estimatedTeamDpsGainPercent))}%)${survival}</small>`;
  }
  const special = String(member.special ?? "");
  if (special.includes("疯狂") || special.includes("insanity")) {
    return locale === "zh"
      ? `<b>疯狂</b><small>自我增伤 / 攻速 buff（非团队光环）</small>`
      : `<b>Insanity</b><small>self damage / attack-speed buff (not a team aura)</small>`;
  }
  if (special.includes("复活")) {
    return locale === "zh"
      ? `<b>复活</b><small>团队续航（抬血计入治疗列）</small>`
      : `<b>Revive</b><small>team sustain (healing counted in heal column)</small>`;
  }
  if (special.includes("无敌")) {
    return locale === "zh"
      ? `<b>无敌</b><small>坦克减伤 / 生存 buff</small>`
      : `<b>Invincible</b><small>tank mitigation / survival buff</small>`;
  }
  return "<span class='muted'>—</span>";
}

const assignment = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(assignment.bosses) || assignment.bosses.length === 0) {
  throw new Error(`No bosses in report JSON: ${inputPath}`);
}

const chromePath = await resolveChromePath();
await mkdir(outputDirectory, { recursive: true });

const images = [];
const zhImages = [];
for (const [index, boss] of assignment.bosses.entries()) {
  const slug = String(boss.bossId ?? boss.bossKey ?? `boss-${index + 1}`)
    .split("/")
    .at(-1)
    .replace(/[^a-z0-9-]+/gi, "-")
    .toLowerCase();
  const fileSlug =
    index === 0 && legacyFirstBossSlug ? legacyFirstBossSlug : slug;
  const roster = Array.isArray(boss.roster) ? boss.roster : [];
  const pages = [
    {
      kind: "summary",
      titleZh: `${boss.bossName} · 阵容与技能`,
      titleEn: `${bossDisplayName(boss, "en")} · Roster & Skills`,
      height: Math.max(14000, 5500 + roster.length * 160),
      render: (locale) => renderSummaryHtml(assignment, boss, locale),
    },
    {
      kind: "members",
      titleZh: `${boss.bossName} · ${roster.length} 人贡献明细`,
      titleEn: `${bossDisplayName(boss, "en")} · ${roster.length} Member Breakdown`,
      height: Math.max(7000, 1800 + roster.length * 100),
      render: (locale) => renderMembersHtml(assignment, boss, locale),
    },
  ];
  for (const page of pages) {
    for (const locale of ["zh", "en"]) {
      const suffix = locale === "en" ? ".en" : "";
      const title = locale === "zh" ? page.titleZh : page.titleEn;
      const htmlPath = path.join(
        outputDirectory,
        `${index + 1}-${fileSlug}-${page.kind}${suffix}.html`,
      );
      const pngPath = path.join(
        outputDirectory,
        `${index + 1}-${fileSlug}-${page.kind}${suffix}.png`,
      );
      await writeFile(htmlPath, page.render(locale), "utf8");
      await execFileAsync(
        chromePath,
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--hide-scrollbars",
          "--font-render-hinting=none",
          "--force-device-scale-factor=1",
          "--run-all-compositor-stages-before-draw",
          "--virtual-time-budget=3000",
          `--window-size=1600,${page.height}`,
          `--screenshot=${pngPath}`,
          pathToFileURL(htmlPath).href,
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const info = await stat(pngPath);
      if (info.size < 20_000) {
        throw new Error(`Rendered report is unexpectedly small: ${pngPath}`);
      }
      const image = {
        bossName: boss.bossName,
        title: locale === "en" ? `${title} (EN)` : title,
        pngPath,
        locale,
      };
      images.push(image);
      if (locale === "zh") zhImages.push(image);
    }
  }
}

const manifest = {
  schemaVersion: 1,
  assignmentGeneratedAt: assignment.generatedAt,
  assignmentKind: assignment.kind,
  generatedAt: new Date().toISOString(),
  files: zhImages.map((image) => ({
    title: image.title,
    fileName: path.basename(image.pngPath),
  })),
  englishFiles: images
    .filter((image) => image.locale === "en")
    .map((image) => ({
      title: image.title.replace(/ \(EN\)$/, ""),
      fileName: path.basename(image.pngPath),
    })),
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

let published = null;
let publishedAssets = null;
if (shouldPublishAssignment) {
  if (!adminKey) {
    throw new Error("MWI_REPORT_PUBLISH_ASSIGNMENT=1 requires MWI_GUILD_API_ADMIN_KEY");
  }
  const guildId = assignment.guildId ?? "TMD";
  const response = await fetch(
    `${apiBase}/api/admin/guilds/${encodeURIComponent(guildId)}/assignments/test`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ assignment, locked: false }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Failed to publish test assignment: ${JSON.stringify(payload).slice(0, 1000)}`,
    );
  }
  published = { id: payload.id, createdAt: payload.createdAt };
}

if (shouldPublishAssets) {
  if (!adminKey) {
    throw new Error("MWI_REPORT_PUBLISH_ASSETS=1 requires MWI_GUILD_API_ADMIN_KEY");
  }
  const guildId = assignment.guildId ?? "TMD";
  const files = [];
  for (const image of images) {
    files.push({
      title: image.title,
      fileName: path.basename(image.pngPath),
      base64: await readFile(image.pngPath, "base64"),
    });
  }
  const response = await fetch(
    `${apiBase}/api/guilds/${encodeURIComponent(guildId)}/test-report-assets`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({
        assignmentGeneratedAt: assignment.generatedAt,
        files,
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Failed to publish test report assets: ${JSON.stringify(payload).slice(0, 1000)}`,
    );
  }
  publishedAssets = payload;
}

if (shouldSend) {
  await oneBot("send_group_msg", {
    group_id: groupId,
    message: [
      {
        type: "text",
        data: {
          text:
            `${assignment.summaryText}\n\n` +
            "随后 4 张图依次为两个 Boss 的阵容/技能方案与成员技能明细。" +
            "开发校准结果，不可转正。",
        },
      },
    ],
  });
  for (const image of images) {
    const base64 = await readFile(image.pngPath, "base64");
    await oneBot("send_group_msg", {
      group_id: groupId,
      message: [
        { type: "text", data: { text: `${image.title}\n` } },
        { type: "image", data: { file: `base64://${base64}` } },
      ],
    });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      sent: shouldSend,
      published,
      publishedAssets,
      groupId,
      outputDirectory,
      manifest,
      images: images.map((image) => ({
        title: image.title,
        pngPath: image.pngPath,
      })),
    },
    null,
    2,
  )}\n`,
);

function renderSummaryHtml(root, boss, locale = "zh") {
  const runs = Array.isArray(boss.runs) ? boss.runs : [];
  const roster = Array.isArray(boss.roster) ? boss.roster : [];
  const teamSize = boss.participantCount ?? boss.team?.size ?? roster.length;
  const enemies = boss.enemiesPerEncounter ?? 1;
  const averageDps = average(runs.map((run) => Number(run.teamDps ?? 0)));
  const averageProgress = average(
    runs.map((run) => Number(run.finalProgressPercent ?? 0)),
  );
  const auraRows = roster
    .filter((row) => row.aura)
    .map(
      (row) =>
        `<div class="aura"><b>${escapeHtml(auraName(row.aura, locale))}</b><span>${escapeHtml(row.memberId)}｜${escapeHtml(combatTypeName(row.combatType, locale))}｜${roleName(row.duty, locale)}</span></div>`,
    )
    .join("");
  const runRows = runs
    .map((run, index) => {
      if (locale === "zh") {
        return `<tr>
    <td>Seed ${index + 1}</td><td>${run.wavesCleared} 层</td>
    <td>末层 ${Number(run.finalProgressPercent ?? 0).toFixed(1)}%</td>
    <td>${Math.round(Number(run.teamDps ?? 0))}</td><td>${run.totalDeaths}</td>
    <td>${run.oomMembers ?? "—"}</td>
  </tr>`;
      }
      return `<tr>
    <td>Seed ${index + 1}</td><td>${run.wavesCleared} waves</td>
    <td>Final ${Number(run.finalProgressPercent ?? 0).toFixed(1)}%</td>
    <td>${Math.round(Number(run.teamDps ?? 0))}</td><td>${run.totalDeaths}</td>
    <td>${run.oomMembers ?? "—"}</td>
  </tr>`;
    })
    .join("");
  const templateRows = [...roster]
    .sort(compareRoster)
    .map((row) => {
      const hrids = row.abilityHrids ?? [];
      const skills = (row.abilities ?? [])
        .map(
          (ability, index) =>
            `<span class="skill ${index === 0 ? "special" : ""}">${index + 1}. ${escapeHtml(abilityLabel(ability, hrids[index], locale))}</span>`,
        )
        .join("");
      const auraSuffix = row.aura
        ? `｜${escapeHtml(auraName(row.aura, locale))}`
        : "";
      return `<tr>
      <td><b>${escapeHtml(row.memberId)}</b><small>${escapeHtml(combatTypeName(row.combatType, locale))}｜${roleName(row.duty, locale)}${auraSuffix}</small></td>
      <td>${skills}</td>
    </tr>`;
    })
    .join("");
  const unavailable = (root.source?.unavailable ?? [])
    .map(
      (row) =>
        `${escapeHtml(row.memberId)}(${escapeHtml(combatTypeName(row.combatType, locale))}): ${escapeHtml(row.reason)}`,
    )
    .join(locale === "zh" ? "；" : "; ");
  const wavesRange = runs.length
    ? `${Math.min(...runs.map((row) => row.wavesCleared))}–${Math.max(...runs.map((row) => row.wavesCleared))}`
    : "—";
  const deathsRange = runs.length
    ? `${Math.min(...runs.map((row) => row.totalDeaths))}–${Math.max(...runs.map((row) => row.totalDeaths))}`
    : "—";
  if (locale === "zh") {
    return documentHtml(
      `
    <header><h1>${escapeHtml(boss.bossName)} · TMD ${teamSize} 人可用重排</h1>
    <div class="sub">${escapeHtml(boss.selectedCandidate ?? "")}｜完整事件引擎｜${escapeHtml(root.generatedAt)}｜分区 ${escapeHtml(root.selectedPartition ?? "")}</div>
    <div class="warning">开发校准结果 / 不可转正：不按报名，可用 QQ 绑定成员互斥重排；无复制人；缺普通技能默认 Lv40；光环/无敌/复活/疯狂自动最优</div></header>
    <section class="metrics">
      ${metric(wavesRange, "三次通过层数", locale)}
      ${metric(`${averageProgress.toFixed(1)}%`, "末层平均进度", locale)}
      ${metric(String(Math.round(averageDps)), "团队平均 DPS", locale)}
      ${metric(deathsRange, "单场死亡", locale)}
    </section>
    <section class="card"><h2>职业与职责</h2>
      <div class="pills">${pills(boss.team?.roles, locale)}${pills(boss.team?.duties, locale)}</div>
      <div class="meta">每层敌人 ${enemies} 只｜技能包 ${escapeHtml(boss.selectedCandidate ?? "—")}｜上限 ${escapeHtml(String(root.rules?.teamCap ?? 48))}</div>
    </section>
    <h2>五种光环 · 自动最优覆盖</h2><section class="auras">${auraRows || "<div class='card'>本场未记录光环承担者</div>"}</section>
    <h2>三次完整 1 小时</h2>${table("运行,通过,末层,团队 DPS,死亡,曾缺蓝", runRows, "", locale)}
    ${renderSupportSection(boss, locale)}
    <h2>成员 / 五技能</h2>${table("成员与职责,技能（第 1 格为光环/特殊）", templateRows, "", locale)}
    <div class="foot"><b>已计入：</b>武器与装备被动、技能触发器、Buff/Debuff、治疗/复活、仇恨、死亡、CD/MP、换层 HP/MP 补满、Boss HP 按人数缩放、HP/MP 回复率各 +3%、每次受击最多 5 次格挡判定。<br>
    <b>不可用：</b>${unavailable || "无"}<br>
    <b>说明：</b>${escapeHtml(root.source?.note ?? "")}</div>
  `,
      locale,
    );
  }
  return documentHtml(
    `
    <header><h1>${escapeHtml(bossDisplayName(boss, locale))} · TMD ${teamSize} Available Roster</h1>
    <div class="sub">${escapeHtml(boss.selectedCandidate ?? "")} | Full event engine | ${escapeHtml(root.generatedAt)} | partition ${escapeHtml(root.selectedPartition ?? "")}</div>
    <div class="warning">Dev calibration / not for production: ignores sign-ups; re-rolls bound QQ members with mutual exclusion; no clones; missing common skills default to Lv40; auras / Invincible / Revive / Insanity auto-optimized</div></header>
    <section class="metrics">
      ${metric(wavesRange, "Waves cleared (3 runs)", locale)}
      ${metric(`${averageProgress.toFixed(1)}%`, "Avg final progress", locale)}
      ${metric(String(Math.round(averageDps)), "Team avg DPS", locale)}
      ${metric(deathsRange, "Deaths per run", locale)}
    </section>
    <section class="card"><h2>Roles & duties</h2>
      <div class="pills">${pills(boss.team?.roles, locale)}${pills(boss.team?.duties, locale)}</div>
      <div class="meta">Enemies per wave: ${enemies} | skill package ${escapeHtml(boss.selectedCandidate ?? "—")} | cap ${escapeHtml(String(root.rules?.teamCap ?? 48))}</div>
    </section>
    <h2>Five auras · auto coverage</h2><section class="auras">${auraRows || "<div class='card'>No aura carriers recorded for this run</div>"}</section>
    <h2>Three full 1-hour runs</h2>${table("Run,Waves,Final %,Team DPS,Deaths,OOM", runRows, "", locale)}
    ${renderSupportSection(boss, locale)}
    <h2>Members / five skills</h2>${table("Member & duty,Skills (slot 1 = aura/special)", templateRows, "", locale)}
    <div class="foot"><b>Included:</b> weapon & gear passives, ability triggers, buffs/debuffs, heals/revives, threat, deaths, CD/MP, full HP/MP refill between waves, boss HP scaled by roster size, +3% HP/MP regen, up to 5 block rolls per hit.<br>
    <b>Unavailable:</b>${unavailable || "none"}<br>
    <b>Note:</b>${escapeHtml(root.source?.note ?? "")}</div>
  `,
    locale,
  );
}

function renderSupportSection(boss, locale = "zh") {
  const support = boss.supportContributions;
  if (!support) return "";
  const auraRows = (support.auras ?? [])
    .map((row) => {
      const effects = (row.effects ?? [])
        .map(
          (effect) =>
            `${effect.typeZh} ${effect.ratioPercent ? `+${effect.ratioPercent}%` : ""}${effect.flatPercent ? ` flat ${effect.flatPercent}%` : ""}`,
        )
        .join(locale === "zh" ? "；" : "; ");
      if (locale === "zh") {
        return `<tr>
      <td><b>${escapeHtml(auraName(row.auraNameZh, locale))}</b><small>${escapeHtml(row.memberId)}｜Lv.${row.level}</small></td>
      <td class="number"><b>+${escapeHtml(String(row.estimatedTeamDpsGain))}</b><small>约 ${escapeHtml(String(row.estimatedTeamDpsGainPercent))}% 团队 DPS</small></td>
      <td>${escapeHtml(listJoin(row.survivalNotes ?? [], locale) || "—")}<small>${effects}</small></td>
    </tr>`;
      }
      return `<tr>
      <td><b>${escapeHtml(auraName(row.auraNameZh, locale))}</b><small>${escapeHtml(row.memberId)} | Lv.${row.level}</small></td>
      <td class="number"><b>+${escapeHtml(String(row.estimatedTeamDpsGain))}</b><small>~${escapeHtml(String(row.estimatedTeamDpsGainPercent))}% team DPS</small></td>
      <td>${escapeHtml(listJoin(row.survivalNotes ?? [], locale) || "—")}<small>${effects}</small></td>
    </tr>`;
    })
    .join("");
  const healRows = (support.healers ?? [])
    .map((row) => {
      if (locale === "zh") {
        return `<tr>
      <td><b>${escapeHtml(row.memberId)}</b><small>${escapeHtml(combatTypeName(row.combatType, locale))}</small></td>
      <td class="number"><b>${formatNumber(row.averageHealingDone, locale)}</b><small>HPS ${escapeHtml(String(row.averageHps))}｜占比 ${escapeHtml(String(row.teamHealingSharePercent))}%</small></td>
      <td class="number">${formatNumber(row.averageDamageTaken, locale)}<small>死亡 ${escapeHtml(String(row.deaths))}</small></td>
    </tr>`;
      }
      return `<tr>
      <td><b>${escapeHtml(row.memberId)}</b><small>${escapeHtml(combatTypeName(row.combatType, locale))}</small></td>
      <td class="number"><b>${formatNumber(row.averageHealingDone, locale)}</b><small>HPS ${escapeHtml(String(row.averageHps))} | share ${escapeHtml(String(row.teamHealingSharePercent))}%</small></td>
      <td class="number">${formatNumber(row.averageDamageTaken, locale)}<small>deaths ${escapeHtml(String(row.deaths))}</small></td>
    </tr>`;
    })
    .join("");
  if (locale === "zh") {
    return `
    <h2>辅助对 DPS / 生存的贡献</h2>
    <section class="card compact">团队平均 DPS ${escapeHtml(String(support.averageTeamDps))}｜全队平均治疗量 ${formatNumber(support.totalAverageHealingDone, locale)}（技能抬血，不含被动回血/吸血）</section>
    ${auraRows ? `<h3 style="margin:18px 0 10px;font-size:22px">光环名义贡献</h3>${table("光环承担者,预估团队 DPS 增益,生存相关增益", auraRows, "", locale)}` : ""}
    ${healRows ? `<h3 style="margin:18px 0 10px;font-size:22px">治疗量统计</h3>${table("治疗成员,平均治疗量,承伤 / 死亡", healRows, "", locale)}` : ""}
    <div class="foot" style="margin-top:12px">光环增益按技能面板常驻覆盖做名义换算，不是关掉光环重跑的消融精确值；治疗量为技能/复活实际抬血。</div>
  `;
  }
  return `
    <h2>Support impact on DPS / survival</h2>
    <section class="card compact">Team avg DPS ${escapeHtml(String(support.averageTeamDps))} | team avg healing ${formatNumber(support.totalAverageHealingDone, locale)} (ability heals only, excludes passive regen/lifesteal)</section>
    ${auraRows ? `<h3 style="margin:18px 0 10px;font-size:22px">Nominal aura contribution</h3>${table("Aura carrier,Est. team DPS gain,Survival-related gains", auraRows, "", locale)}` : ""}
    ${healRows ? `<h3 style="margin:18px 0 10px;font-size:22px">Healing totals</h3>${table("Healer,Avg healing,Taken / deaths", healRows, "", locale)}` : ""}
    <div class="foot" style="margin-top:12px">Aura gains are nominal panel-based estimates, not ablation reruns with auras disabled; healing counts ability/revive throughput only.</div>
  `;
}

function renderMembersHtml(root, boss, locale = "zh") {
  const roster = Array.isArray(boss.roster) ? boss.roster : [];
  const averages = Array.isArray(boss.memberAverages) ? boss.memberAverages : [];
  const byId = new Map(averages.map((row) => [row.memberId, row]));
  const teamSize = boss.participantCount ?? boss.team?.size ?? roster.length;
  const support = boss.supportContributions;
  const auraById = new Map(
    (support?.auras ?? []).map((row) => [row.memberId, row]),
  );
  const ranked = [...roster]
    .map((member) => ({
      ...member,
      stats: byId.get(member.memberId) ?? null,
    }))
    .sort((left, right) => {
      const leftDps = left.stats?.averageDps ?? -1;
      const rightDps = right.stats?.averageDps ?? -1;
      return (
        rightDps - leftDps ||
        (right.stats?.averageHealingDone ?? 0) -
          (left.stats?.averageHealingDone ?? 0) ||
        compareRoster(left, right)
      );
    });
  const rows = ranked
    .map((member, index) => {
      const stats = member.stats;
      const healDone = stats?.averageHealingDone ?? 0;
      const healShare =
        support?.totalAverageHealingDone > 0
          ? ((healDone / support.totalAverageHealingDone) * 100).toFixed(1)
          : "0.0";
      const debuff = summarizeDebuffContribution(stats, locale);
      const buff = summarizeBuffContribution(
        member,
        auraById.get(member.memberId),
        locale,
      );
      if (locale === "zh") {
        return `<tr>
        <td class="rank">${index + 1}</td>
        <td><b>${escapeHtml(member.memberId)}</b><small>${escapeHtml(combatTypeName(member.combatType, locale))}｜${roleName(member.duty, locale)}</small></td>
        <td class="number"><b>${stats ? stats.averageDps.toFixed(1) : "—"}</b><small>承伤 ${stats ? formatNumber(stats.averageDamageTaken, locale) : "—"}｜死亡 ${stats ? stats.deaths : "—"}</small></td>
        <td class="number"><b>${stats ? formatNumber(healDone, locale) : "—"}</b><small>${healDone > 0 ? `占比 ${escapeHtml(healShare)}%｜HPS ${(healDone / 3600).toFixed(1)}` : "无治疗输出"}</small></td>
        <td>${debuff}</td>
        <td>${buff}</td>
      </tr>`;
      }
      return `<tr>
        <td class="rank">${index + 1}</td>
        <td><b>${escapeHtml(member.memberId)}</b><small>${escapeHtml(combatTypeName(member.combatType, locale))} | ${roleName(member.duty, locale)}</small></td>
        <td class="number"><b>${stats ? stats.averageDps.toFixed(1) : "—"}</b><small>taken ${stats ? formatNumber(stats.averageDamageTaken, locale) : "—"} | deaths ${stats ? stats.deaths : "—"}</small></td>
        <td class="number"><b>${stats ? formatNumber(healDone, locale) : "—"}</b><small>${healDone > 0 ? `share ${escapeHtml(healShare)}% | HPS ${(healDone / 3600).toFixed(1)}` : "no healing"}</small></td>
        <td>${debuff}</td>
        <td>${buff}</td>
      </tr>`;
    })
    .join("");
  if (locale === "zh") {
    return documentHtml(
      `
    <header><h1>${escapeHtml(boss.bossName)} · ${teamSize} 人贡献明细</h1>
    <div class="sub">按三次平均 DPS 排序｜不含携带技能列表｜Debuff/Buff 为技能伤害与光环名义贡献</div>
    <div class="warning">DPS = 1 小时总伤害 ÷ 3600；治疗 = 技能/复活抬血；Buff 光环为面板常驻估算，非消融实验</div></header>
    <section class="card compact"><b>职业：</b>${escapeHtml(formatCounts(boss.team?.roles, locale))}　
      <b>职责：</b>${escapeHtml(formatCounts(boss.team?.duties, locale))}<br>
      <b>方案：</b>${escapeHtml(boss.selectedCandidate ?? "")}　
      <b>团队 DPS：</b>${support ? escapeHtml(String(support.averageTeamDps)) : "—"}　
      <b>全队治疗：</b>${support ? formatNumber(support.totalAverageHealingDone, locale) : "—"}</section>
    <h2>成员 DPS / 治疗 / Debuff / Buff</h2>
    ${table("#,成员 / 职业 / 职责,DPS,治疗,Debuff 贡献,Buff 贡献", rows, "member-table", locale)}
    <div class="foot">Debuff 贡献：减益类技能的直接伤害 DPS（缠绕、疫病、剧毒、烟雾等）。Buff 贡献：五光环名义团队 DPS 增益与生存增益。开发校准结果，不可转正。生成时间 ${escapeHtml(root.generatedAt)}</div>
  `,
      locale,
    );
  }
  return documentHtml(
    `
    <header><h1>${escapeHtml(bossDisplayName(boss, locale))} · ${teamSize} Member Breakdown</h1>
    <div class="sub">Sorted by 3-run avg DPS | loadout skills omitted | Debuff/Buff = ability damage & nominal aura contribution</div>
    <div class="warning">DPS = total 1h damage ÷ 3600; healing = ability/revive throughput; buff auras are panel estimates, not ablation</div></header>
    <section class="card compact"><b>Roles:</b> ${escapeHtml(formatCounts(boss.team?.roles, locale))}
      <b>Duties:</b> ${escapeHtml(formatCounts(boss.team?.duties, locale))}<br>
      <b>Package:</b> ${escapeHtml(boss.selectedCandidate ?? "")}
      <b>Team DPS:</b> ${support ? escapeHtml(String(support.averageTeamDps)) : "—"}
      <b>Team healing:</b> ${support ? formatNumber(support.totalAverageHealingDone, locale) : "—"}</section>
    <h2>Member DPS / healing / debuff / buff</h2>
    ${table("#,Member / role / duty,DPS,Healing,Debuff,Buff", rows, "member-table", locale)}
    <div class="foot">Debuff: direct damage DPS from debuff abilities (entangle, pestilent, toxic, smoke, etc.). Buff: nominal team DPS & survival from five auras. Dev calibration — not for production. Generated ${escapeHtml(root.generatedAt)}</div>
  `,
    locale,
  );
}

function documentHtml(content, locale = "zh") {
  const lang = locale === "en" ? "en" : "zh-CN";
  const fontFamily =
    locale === "en"
      ? '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
      : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#edf3fc;color:#172033;font-family:${fontFamily}}
.page{width:1600px;min-height:100vh;padding:54px 64px;background:linear-gradient(145deg,#f8faff 0%,#edf5ff 52%,#f7f4ff 100%)}
header{background:#17233d;color:#fff;border-radius:28px;padding:34px 42px;box-shadow:0 18px 45px #334a7a33}
h1{font-size:48px;margin:0 0 12px}.sub{font-size:21px;color:#c9d7f5}.warning{margin-top:15px;color:#ffd77a;font-size:19px;font-weight:700}
h2{font-size:28px;margin:28px 0 14px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:26px 0}
.metric,.card{background:#fff;border:1px solid #dfe7f5;border-radius:20px;padding:22px 25px;box-shadow:0 8px 24px #36507a14}
.metric b{display:block;color:#3659c7;font-size:34px}.metric span{color:#68738a;font-size:17px}.compact{font-size:20px;line-height:1.7}
.meta{margin-top:14px;color:#5b6780;font-size:18px}
.pills{display:flex;flex-wrap:wrap;gap:10px}.pill{padding:9px 15px;border-radius:999px;background:#e5edff;color:#304da9;font-size:18px;font-weight:700}
.auras{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.aura{background:#fff2cb;border:1px solid #efd17b;border-radius:16px;padding:16px}
.aura b,.aura span{display:block}.aura b{font-size:17px}.aura span{font-size:14px;color:#6b5c3d;margin-top:7px}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #dfe7f5;border-radius:18px;overflow:hidden}
th{background:#e8effd;text-align:left;font-size:17px;padding:14px}td{border-top:1px solid #e8edf5;padding:12px 14px;vertical-align:top;font-size:15px}
td small{display:block;color:#788297;margin-top:4px}.skill{display:inline-block;background:#f0f3f8;border-radius:8px;margin:2px 5px 3px 0;padding:6px 8px;white-space:nowrap}
.skill.special{background:#fff0bd;border:1px solid #ebce70}.skill i{font-style:normal;color:#66718a;font-size:12px}
.member-table td{padding-top:10px;padding-bottom:10px}.member-table .rank{width:44px;font-size:19px;color:#60708c}.number{white-space:nowrap;font-size:18px}
.muted{color:#9aa3b5}.foot{margin-top:24px;padding:20px 24px;border-radius:16px;background:#fff5d8;color:#725817;font-size:17px;line-height:1.6}
</style></head><body><main class="page">${content}</main></body></html>`;
}

function metric(value, label, locale = "zh") {
  return `<div class="metric"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

function formatNumber(value, locale = "zh") {
  return Math.round(Number(value ?? 0)).toLocaleString(
    locale === "en" ? "en-US" : "zh-CN",
  );
}

function table(headers, rows, className = "", locale = "zh") {
  return `<table class="${className}"><thead><tr>${headers
    .split(",")
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function pillLabel(key, locale = "zh") {
  if (COMBAT_TYPE_EN[key]) return combatTypeName(key, locale);
  return roleName(key, locale);
}

function pills(row, locale = "zh") {
  if (!row || typeof row !== "object") return "";
  return Object.entries(row)
    .map(
      ([key, value]) =>
        `<span class="pill">${escapeHtml(pillLabel(key, locale))} × ${value}</span>`,
    )
    .join("");
}

function roleName(value, locale = "zh") {
  if (locale === "en") {
    return (
      {
        tank: "Tank",
        healer: "Healer",
        debuffer: "Debuffer",
        dps: "DPS",
      }[value] ?? value
    );
  }
  return (
    {
      tank: "坦克",
      healer: "治疗",
      debuffer: "减益",
      dps: "输出",
    }[value] ?? value
  );
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatCounts(row, locale = "zh") {
  if (!row || typeof row !== "object") return "—";
  return Object.entries(row)
    .map(([key, value]) => `${pillLabel(key, locale)}×${value}`)
    .join(locale === "zh" ? "、" : ", ");
}

function compareRoster(left, right) {
  const dutyRank = { tank: 0, healer: 1, debuffer: 2, dps: 3 };
  return (
    (dutyRank[left.duty] ?? 9) - (dutyRank[right.duty] ?? 9) ||
    String(left.combatType ?? "").localeCompare(String(right.combatType ?? ""), "zh") ||
    String(left.memberId ?? "").localeCompare(String(right.memberId ?? ""), "zh")
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function resolveChromePath() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "未找到可用的 Chrome/Chromium。请安装浏览器或设置 MWI_CHROME_PATH。",
  );
}

async function oneBot(action, body) {
  const response = await fetch(`${oneBotBase}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.status !== "ok" || payload.retcode !== 0) {
    throw new Error(
      `OneBot ${action} failed: ${JSON.stringify(payload).slice(0, 1000)}`,
    );
  }
  return payload;
}
