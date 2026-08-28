import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  process.env.MWI_BOUND_REPORT_JSON ??
  path.join(projectDirectory, ".local/tmd-bound-roster-full-engine-lab.json");
const outputDirectory = path.join(projectDirectory, ".local/bound-roster-report");
const groupId = Number(process.env.MWI_QQ_TMD_GROUP_ID ?? "532133273");
const oneBotBase = (
  process.env.MWI_ONEBOT_API_BASE ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const shouldSend = process.env.MWI_REPORT_SEND !== "0";
const CHROME_CANDIDATES = [
  process.env.MWI_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);
const assignment = JSON.parse(await readFile(inputPath, "utf8"));
const chromePath = await resolveChromePath();

await mkdir(outputDirectory, { recursive: true });
const images = [];
for (const [index, boss] of assignment.bosses.entries()) {
  const slug = boss.bossId.split("/").at(-1);
  const pages = [
    {
      kind: "summary",
      title: `${boss.bossName} · 阵容与技能`,
      height: 4300,
      render: () => renderSummaryHtml(assignment, boss),
    },
    {
      kind: "members",
      title: `${boss.bossName} · 40 人 DPS 明细`,
      height: 5600,
      render: () => renderMembersHtml(assignment, boss),
    },
  ];
  for (const page of pages) {
    const htmlPath = path.join(
      outputDirectory,
      `${index + 1}-${slug}-${page.kind}.html`,
    );
    const pngPath = path.join(
      outputDirectory,
      `${index + 1}-${slug}-${page.kind}.png`,
    );
    await writeFile(htmlPath, page.render(), "utf8");
    await execFileAsync(
      chromePath,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=1200",
        `--window-size=1600,${page.height}`,
        `--screenshot=${pngPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const info = await stat(pngPath);
    if (info.size < 20_000) {
      throw new Error(`Rendered report is unexpectedly small: ${pngPath}`);
    }
    images.push({ bossName: boss.bossName, title: page.title, pngPath });
  }
}
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    assignmentGeneratedAt: assignment.generatedAt,
    assignmentKind: assignment.kind,
    generatedAt: new Date().toISOString(),
    files: images.map((image) => ({
      title: image.title,
      fileName: path.basename(image.pngPath),
    })),
  }, null, 2)}\n`,
  "utf8",
);

if (shouldSend) {
  await oneBot("send_group_msg", {
    group_id: groupId,
    message: [
      {
        type: "text",
        data: {
          text:
            `${assignment.summaryText}\n\n` +
            "随后 4 张图依次为两个 Boss 的阵容/技能方案与 40 个位置的三次平均 DPS 明细。复制编号表示由该已绑定成员的同一快照生成。",
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
  `${JSON.stringify({ ok: true, sent: shouldSend, groupId, images }, null, 2)}\n`,
);

function renderSummaryHtml(root, boss) {
  const runs = boss.runs;
  const averageDps = average(runs.map((run) => run.teamDps));
  const averageProgress = average(
    runs.map((run) => run.finalProgressPercent),
  );
  const auraRows = [
    "/abilities/speed_aura",
    "/abilities/guardian_aura",
    "/abilities/fierce_aura",
    "/abilities/critical_aura",
    "/abilities/mystic_aura",
  ].map((hrid) => {
    const template = boss.team.templates.find((row) =>
      row.abilities.some((ability) => ability.hrid === hrid),
    );
    const ability = template?.abilities.find((row) => row.hrid === hrid);
    return `<div class="aura"><b>${abilityName(hrid)} Lv.${ability?.level ?? "?"}</b><span>${escapeHtml(template?.label ?? "未覆盖")}｜${escapeHtml(template?.buildName ?? "")}</span></div>`;
  }).join("");
  const runRows = runs.map((run, index) => `<tr>
    <td>Seed ${index + 1}</td><td>${run.wavesCleared} 层</td>
    <td>Lv.${run.finalMonsterLevel}｜${run.finalProgressPercent}%</td>
    <td>${Math.round(run.teamDps)}</td><td>${run.totalDeaths}</td>
    <td>${run.oomMembers}</td>
  </tr>`).join("");
  const debuffRows = boss.debuffPlan
    .filter((row) => row.casters > 0)
    .map((row) => `<tr>
      <td><b>${escapeHtml(row.nameZh ?? abilityName(row.abilityHrid))}</b></td>
      <td>${row.casters}</td><td>${row.durationSeconds}s / ${row.cooldownSeconds}s</td>
      <td>${row.nominalSingleCasterCoveragePercent}%</td>
    </tr>`).join("");
  const templateRows = boss.team.templates.map((template) => `<tr>
    <td><b>${escapeHtml(template.label)}</b><small>${escapeHtml(template.combatType)}｜${roleName(template.role)}｜${escapeHtml(template.buildName)}</small></td>
    <td>${template.abilities.map((ability, index) =>
      `<span class="skill ${index === 0 ? "special" : ""}">${index + 1}. ${abilityName(ability.hrid)} <i>Lv.${ability.level}</i></span>`
    ).join("")}</td>
  </tr>`).join("");
  return documentHtml(`
    <header><h1>${escapeHtml(boss.bossName)} · TMD 40 人职业模板</h1>
    <div class="sub">${escapeHtml(boss.selectedCandidate)}｜完整事件引擎｜${escapeHtml(root.generatedAt)}</div>
    <div class="warning">开发校准结果 / 不可转正：真实来源跨 Boss 不重复；复制编号为未收齐成员的职业模板占位</div></header>
    <section class="metrics">
      ${metric(`${Math.min(...runs.map((row) => row.wavesCleared))}–${Math.max(...runs.map((row) => row.wavesCleared))}`, "三次通过层数")}
      ${metric(`${averageProgress.toFixed(1)}%`, "末层平均进度")}
      ${metric(Math.round(averageDps), "团队平均 DPS")}
      ${metric(`${Math.min(...runs.map((row) => row.totalDeaths))}–${Math.max(...runs.map((row) => row.totalDeaths))}`, "单场死亡")}
    </section>
    <section class="card"><h2>职业与职责</h2>
      <div class="pills">${pills(boss.team.roles)}${pills(boss.team.duties)}</div>
    </section>
    <h2>五种光环 · 每种仅一名最高等级可选成员</h2><section class="auras">${auraRows}</section>
    <h2>三次完整 1 小时</h2>${table("运行,通过,末层,团队 DPS,死亡,曾缺蓝", runRows)}
    <h2>减益覆盖配置</h2>${table("技能,施法者,持续 / 冷却,单人理论上限", debuffRows)}
    <h2>成员来源 / 装备 / 五技能</h2>${table("成员与配装,技能（第 1 格为光环类）", templateRows)}
    <div class="foot"><b>已计入：</b>武器与装备被动、技能触发器、Buff/Debuff、治疗/复活、仇恨、死亡、CD/MP、换层 HP/MP 补满、40 人 Boss HP×1.40、HP/MP 回复率各 +3%、每次受击最多 5 次格挡判定。<br><b>待校准：</b>Lv.110+ 成长、换层时除 HP/MP 外的状态、公会神殿与正式服死亡细节。</div>
  `);
}

function renderMembersHtml(root, boss) {
  const templateByLabel = new Map(
    boss.team.templates.map((template) => [template.label, template]),
  );
  const rows = [...boss.memberAverages]
    .sort(
      (left, right) =>
        right.averageDps - left.averageDps ||
        left.memberId.localeCompare(right.memberId),
    )
    .map((member, index) => {
      const template = templateByLabel.get(member.label);
      const skillText = (template?.abilities ?? []).map(
        (ability, skillIndex) =>
          `<span class="skill ${skillIndex === 0 ? "special" : ""}">${skillIndex + 1}. ${abilityName(ability.hrid)} <i>Lv.${ability.level}</i></span>`,
      ).join("");
      return `<tr>
        <td class="rank">${index + 1}</td>
        <td><b>${escapeHtml(member.label)}</b><small>${escapeHtml(template?.combatType ?? "")}｜${roleName(member.role)}｜${escapeHtml(template?.buildName ?? "")}</small></td>
        <td class="number"><b>${member.averageDps.toFixed(1)}</b><small>治疗 ${formatNumber(member.averageHealing)}<br>承伤 ${formatNumber(member.averageDamageTaken)}</small></td>
        <td class="number">${member.deaths}<small>3 次累计<br>曾缺蓝 ${member.oomRuns}/3<br>平均缺蓝 ${Number(member.averageOomDurationSeconds ?? 0).toFixed(1)} 秒</small></td>
        <td>${skillText}</td>
      </tr>`;
    }).join("");
  return documentHtml(`
    <header><h1>${escapeHtml(boss.bossName)} · 40 个位置明细</h1>
    <div class="sub">按三次平均 DPS 排序｜复制编号 #2/#3… 使用同一来源成员的装备与等级快照</div>
    <div class="warning">DPS 为完整 1 小时总伤害 ÷ 3600 秒；死亡列为 3 次累计</div></header>
    <section class="card compact"><b>职业：</b>${escapeHtml(formatCounts(boss.team.roles))}<br>
      <b>方案：</b>${escapeHtml(boss.selectedCandidate)}　
      <b>规则：</b>40 人 HP×1.40｜回复 +3%｜换层 HP/MP 补满｜最多 5 次格挡</section>
    <h2>成员 DPS / 生存 / 技能与光环</h2>
    ${table("#,来源成员 / 职业 / 配装,平均 DPS,死亡 / 曾缺蓝,五技能", rows, "member-table")}
    <div class="foot">“曾缺蓝”表示至少一次技能因 MP 不足未释放，不等于整场 MP 为 0；平均缺蓝秒数按三次完整运行取平均。技能名称使用当前游戏官方简体中文文本。第 1 格黄色技能为光环类技能（五光环、疯狂或复活）；精确属于普通技能，因此可与疯狂/复活同时携带。</div>
  `);
}

function documentHtml(content) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#edf3fc;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.page{width:1600px;min-height:100vh;padding:54px 64px;background:linear-gradient(145deg,#f8faff 0%,#edf5ff 52%,#f7f4ff 100%)}
header{background:#17233d;color:#fff;border-radius:28px;padding:34px 42px;box-shadow:0 18px 45px #334a7a33}
h1{font-size:48px;margin:0 0 12px}.sub{font-size:21px;color:#c9d7f5}.warning{margin-top:15px;color:#ffd77a;font-size:19px;font-weight:700}
h2{font-size:28px;margin:28px 0 14px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:26px 0}
.metric,.card{background:#fff;border:1px solid #dfe7f5;border-radius:20px;padding:22px 25px;box-shadow:0 8px 24px #36507a14}
.metric b{display:block;color:#3659c7;font-size:34px}.metric span{color:#68738a;font-size:17px}.compact{font-size:20px;line-height:1.7}
.pills{display:flex;flex-wrap:wrap;gap:10px}.pill{padding:9px 15px;border-radius:999px;background:#e5edff;color:#304da9;font-size:18px;font-weight:700}
.auras{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.aura{background:#fff2cb;border:1px solid #efd17b;border-radius:16px;padding:16px}
.aura b,.aura span{display:block}.aura b{font-size:17px}.aura span{font-size:14px;color:#6b5c3d;margin-top:7px}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #dfe7f5;border-radius:18px;overflow:hidden}
th{background:#e8effd;text-align:left;font-size:17px;padding:14px}td{border-top:1px solid #e8edf5;padding:12px 14px;vertical-align:top;font-size:15px}
td small{display:block;color:#788297;margin-top:4px}.skill{display:inline-block;background:#f0f3f8;border-radius:8px;margin:2px 5px 3px 0;padding:6px 8px;white-space:nowrap}
.skill.special{background:#fff0bd;border:1px solid #ebce70}.skill i{font-style:normal;color:#66718a;font-size:12px}
.member-table td{padding-top:10px;padding-bottom:10px}.member-table .rank{width:44px;font-size:19px;color:#60708c}.number{white-space:nowrap;font-size:18px}
.foot{margin-top:24px;padding:20px 24px;border-radius:16px;background:#fff5d8;color:#725817;font-size:17px;line-height:1.6}
</style></head><body><main class="page">${content}</main></body></html>`;
}

function metric(value, label) {
  return `<div class="metric"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
}

function table(headers, rows, className = "") {
  return `<table class="${className}"><thead><tr>${headers.split(",").map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function pills(row) {
  return Object.entries(row)
    .map(([key, value]) => `<span class="pill">${escapeHtml(key)} × ${value}</span>`)
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

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatCounts(row) {
  return Object.entries(row)
    .map(([key, value]) => `${key}×${value}`)
    .join("、");
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
