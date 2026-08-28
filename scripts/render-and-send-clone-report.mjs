import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  officialAbilityNameZh,
} from "../packages/mwi-data/official-zh-ability-names.mjs";

const execFileAsync = promisify(execFile);
const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputPath =
  process.env.MWI_CLONE_REPORT_JSON ??
  path.join(projectDirectory, ".local/adudu-full-engine-lab.json");
const outputDirectory = path.join(projectDirectory, ".local/clone-report");
const groupId = Number(process.env.MWI_QQ_TEST_GROUP_ID ?? "795668512");
const oneBotBase = (
  process.env.MWI_ONEBOT_API_BASE ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const assignment = JSON.parse(await readFile(inputPath, "utf8"));

await mkdir(outputDirectory, { recursive: true });
const images = [];
for (const [index, boss] of assignment.bosses.entries()) {
  const slug = boss.bossId.split("/").at(-1);
  const htmlPath = path.join(outputDirectory, `${index + 1}-${slug}.html`);
  const pngPath = path.join(outputDirectory, `${index + 1}-${slug}.png`);
  await writeFile(
    htmlPath,
    renderBossHtml(assignment, boss),
    "utf8",
  );
  await execFileAsync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1000",
      "--window-size=1400,3000",
      `--screenshot=${pngPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const info = await stat(pngPath);
  if (info.size < 10_000) {
    throw new Error(`Rendered report is unexpectedly small: ${pngPath}`);
  }
  images.push({ bossName: boss.bossName, pngPath });
}

const message = [
  {
    type: "text",
    data: {
      text:
        `${assignment.summaryText}\n\n` +
        "下面两张图包含完整职业/配装/光环/技能模板。此结果仍为不可转正的校准测试。",
    },
  },
];
await oneBot("send_group_msg", { group_id: groupId, message });
for (const image of images) {
  const base64 = await readFile(image.pngPath, "base64");
  await oneBot("send_group_msg", {
    group_id: groupId,
    message: [
      {
        type: "text",
        data: { text: `${image.bossName} · 详细模拟方案\n` },
      },
      {
        type: "image",
        data: { file: `base64://${base64}` },
      },
    ],
  });
}

process.stdout.write(
  `${JSON.stringify({ ok: true, groupId, images }, null, 2)}\n`,
);

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

function renderBossHtml(root, boss) {
  const runs = boss.runs;
  const averages = {
    progress:
      runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) /
      runs.length,
    dps: runs.reduce((sum, run) => sum + run.teamDps, 0) / runs.length,
  };
  const auraRows = [
    ["守护", "guardian_aura"],
    ["速度", "speed_aura"],
    ["物理", "fierce_aura"],
    ["暴击", "critical_aura"],
    ["元素", "mystic_aura"],
  ].map(([name, key]) => {
    const template = boss.team.templates.find((row) =>
      row.abilities.some(
        (ability) => ability.hrid === `/abilities/${key}`,
      ),
    );
    const ability = template?.abilities.find(
      (row) => row.hrid === `/abilities/${key}`,
    );
    return `<div class="aura"><b>${name}光环 Lv.${ability?.level ?? "?"}</b><span>${escapeHtml(template?.label ?? "未覆盖")} · ${escapeHtml(template?.buildName ?? "")}</span></div>`;
  }).join("");
  const templateRows = boss.team.templates
    .map(
      (template) => `<tr>
        <td><span class="role ${template.role}">${roleName(template.role)}</span></td>
        <td><b>${escapeHtml(template.label)}</b><small>${escapeHtml(template.buildName)}</small></td>
        <td>${template.abilities.map((ability, index) =>
          `<span class="skill ${index === 0 ? "special" : ""}">${index + 1}. ${abilityName(ability.hrid)} <i>Lv.${ability.level}</i></span>`
        ).join("")}</td>
      </tr>`,
    )
    .join("");
  const runRows = runs
    .map(
      (run, index) => `<tr>
        <td>Seed ${index + 1}</td>
        <td>${run.wavesCleared} 层</td>
        <td>Lv.${run.finalMonsterLevel} · ${run.finalProgressPercent}%</td>
        <td>${Math.round(run.teamDps)}</td>
        <td>${run.totalDeaths}</td>
        <td>${run.oomMembers}</td>
      </tr>`,
    )
    .join("");
  const debuffRows = (boss.debuffPlan ?? [])
    .map(
      (row) => `<tr>
        <td><b>${abilityName(row.abilityHrid)}</b></td>
        <td>${row.casters}</td>
        <td>${row.durationSeconds}s / ${row.cooldownSeconds}s</td>
        <td>${row.nominalSingleCasterCoveragePercent}%</td>
      </tr>`,
    )
    .join("");
  const alternativeRows = boss.searchCandidates
    .slice(0, 6)
    .map(
      (candidate, index) => `<tr>
        <td>${index + 1}</td>
        <td><b>${escapeHtml(candidate.name)}</b></td>
        <td>${candidate.run.wavesCleared} 层 · ${candidate.run.finalProgressPercent}%</td>
        <td>${Math.round(candidate.run.teamDps)}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#eef3fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.page{width:1400px;min-height:3000px;padding:54px 62px;background:linear-gradient(145deg,#f7f9ff 0%,#eef5ff 48%,#f6f4ff 100%)}
header{background:#17233d;color:white;border-radius:28px;padding:34px 40px;box-shadow:0 18px 45px #334a7a33}
h1{font-size:48px;margin:0 0 12px}.sub{font-size:22px;color:#c9d7f5}.warning{margin-top:18px;color:#ffd77a;font-weight:700}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:26px 0}
.metric,.card{background:#fff;border-radius:20px;padding:22px 24px;box-shadow:0 8px 24px #36507a14;border:1px solid #dfe7f5}
.metric b{display:block;font-size:34px;color:#3659c7}.metric span{font-size:18px;color:#68738a}
h2{font-size:28px;margin:28px 0 14px}.counts{display:flex;flex-wrap:wrap;gap:10px}
.pill{padding:10px 16px;background:#e7edff;border-radius:999px;color:#304da9;font-size:18px;font-weight:700}
.auras{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.aura{background:#fff3d6;border:1px solid #f3d388;border-radius:16px;padding:16px}
.aura b,.aura span{display:block}.aura b{font-size:18px}.aura span{font-size:14px;color:#6e6044;margin-top:7px}
table{width:100%;border-collapse:separate;border-spacing:0;background:white;border:1px solid #dfe7f5;border-radius:18px;overflow:hidden}
th{background:#e9effd;text-align:left;font-size:17px;padding:15px}td{border-top:1px solid #e9edf5;padding:13px 15px;vertical-align:top;font-size:16px}
td small{display:block;color:#778198;margin-top:4px}.role{display:inline-block;padding:6px 10px;border-radius:9px;background:#edf1f7;font-weight:700;white-space:nowrap}
.role.tank{background:#dce8ff;color:#315cab}.role.healer{background:#dcf7e9;color:#19764a}.role.debuffer{background:#f3e3ff;color:#75409b}.role.dps{background:#ffe4df;color:#aa3f2e}
.skill{display:inline-block;margin:2px 5px 3px 0;padding:6px 9px;border-radius:8px;background:#f0f3f8}.skill.special{background:#fff0bf;border:1px solid #efd071}.skill i{font-style:normal;color:#647089;font-size:13px}
.foot{margin-top:24px;padding:20px 24px;border-radius:16px;background:#fff6dc;color:#745a19;font-size:17px;line-height:1.6}
</style></head><body><main class="page">
<header><h1>${escapeHtml(boss.bossName)} · 40 复制人完整模拟</h1>
<div class="sub">${escapeHtml(boss.selectedCandidate)} · Shykai 完整事件引擎 · ${escapeHtml(root.generatedAt)}</div>
<div class="warning">测试预览 / 不可转正：仍需实测校准试炼成长、换层、死亡与神殿规则</div></header>
<section class="metrics">
<div class="metric"><b>${Math.min(...runs.map(r => r.wavesCleared))}–${Math.max(...runs.map(r => r.wavesCleared))}</b><span>三次通过层数</span></div>
<div class="metric"><b>${averages.progress.toFixed(1)}%</b><span>末层平均进度</span></div>
<div class="metric"><b>${Math.round(averages.dps)}</b><span>团队平均 DPS</span></div>
<div class="metric"><b>${Math.min(...runs.map(r => r.totalDeaths))}–${Math.max(...runs.map(r => r.totalDeaths))}</b><span>单次死亡 / 空蓝 ${Math.min(...runs.map(r => r.oomMembers))}–${Math.max(...runs.map(r => r.oomMembers))}</span></div>
</section>
<section class="card"><h2>职业与配装</h2>
<div class="counts">${pills(boss.team.roles)}${pills(boss.team.builds)}</div></section>
<h2>五种光环 · 每种恰好一名最高等级携带者</h2><section class="auras">${auraRows}</section>
<h2>三次完整 1 小时结果</h2><table><thead><tr><th>运行</th><th>通过</th><th>末层</th><th>DPS</th><th>死亡</th><th>空蓝</th></tr></thead><tbody>${runRows}</tbody></table>
<h2>减益覆盖计划</h2><table><thead><tr><th>减益技能</th><th>施法者</th><th>持续 / 冷却</th><th>单人理论上限</th></tr></thead><tbody>${debuffRows}</tbody></table>
<div class="foot">覆盖率列只展示不计命中、死亡和施法冲突的单人理论上限；最终取舍由完整事件模拟的实际挂载、断档和团队推进共同评分。</div>
<h2>带拐 / 带输出搜索前 6</h2><table><thead><tr><th>#</th><th>候选</th><th>推进</th><th>DPS</th></tr></thead><tbody>${alternativeRows}</tbody></table>
<h2>职业 / 配装 / 技能模板</h2><table><thead><tr><th>职责</th><th>模板 / 配装</th><th>技能（1 为特殊槽）</th></tr></thead><tbody>${templateRows}</tbody></table>
<div class="foot"><b>已计入：</b>武器与装备被动、技能/触发器、Buff/Debuff、五种光环、治疗/复活、挑衅/仇恨、Boss 攻击、承伤/死亡、CD/MP/空蓝、每 10 秒 HP/MP 回复率各 +3%、每名参与者使 Boss HP +1%、禁用消耗品。<br><b>待校准：</b>Lv.110/120 面板成长、换层状态、试炼死亡/复活规则、公会神殿修正。</div>
</main></body></html>`;
}

function pills(row) {
  return Object.entries(row)
    .map(([key, value]) => `<span class="pill">${escapeHtml(roleName(key))} × ${value}</span>`)
    .join("");
}

function roleName(value) {
  return {
    tank: "坦克",
    healer: "治疗",
    debuffer: "减益",
    dps: "输出",
  }[value] ?? value;
}

function abilityName(hrid) {
  return officialAbilityNameZh(hrid) ?? `[未收录] ${hrid}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
