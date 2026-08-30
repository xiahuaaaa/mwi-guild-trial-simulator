# 公会战斗模拟：对照 will-shy 后的落地方案

更新时间：2026-08-30（Asia/Shanghai）
状态：**方案已修订，尚未改代码。** 对照结论可实施前，须先满足本文契约与验收门槛。
权威：对照结论、实现边界、部署顺序以本文为准；实现后再回写 [`CLAUDE_CODE_HANDOFF.md`](../CLAUDE_CODE_HANDOFF.md) §4.3 / §6.3 / §11.1。

本文吸收内部 review（Request changes）。未关闭项只有 **个人自动复活**（§1.3），实施前必须再拍板，本文不擅自二选一。

---

## 0. 背景

TMD 公会战斗试炼模拟跑在本仓库的 Shykai 事件引擎上：

- 源码：2026-07-24 从 `shykai.github.io/MWICombatSimulatorTest` source map 恢复，物化在 `packages/shykai-full-runtime/`
- 公会包装：[`packages/shykai-full-runtime/src/guild-trial-runner.mjs`](../packages/shykai-full-runtime/src/guild-trial-runner.mjs)
- 每周 Boss 面板：`fixtures/monsters/guild-trial-YYYY-MM-DD-*.json`
- 流水线：成员插件快照 → 组合实验室 → 疯狂/奶转输出 A/B → GitHub Pages 本周分工
- 发布脚本实名：[`scripts/run-and-publish-combat-assignment.mjs`](../scripts/run-and-publish-combat-assignment.mjs)（`--skip-sim` 只检查 lab JSON 的 `generatedAt`）

2026-08-30 对照了别人的公会组队模拟器（同一 Shykai 内核的另一分叉）。对方多了组队战页、`GroupBattleMonster`、Skill Lab。两边 **不是** 两套独立战斗公式；分叉在狂暴、团灭、换层、房屋神龛、多只怪统计。

对照目的：查漏补缺，**不整仓替换**，不解除 `simulationEngine: unavailable`。

### 0.1 上游溯源（固定 commit，不用浮动分支当权威）

本次核对钉死的 upstream commit：

```text
will-shy/MWICombatSimulatorTest
48d8c14f52c05c720c13ba3df59ca942dd87e12f
date: 2026-08-28T08:07:39Z
```

`testing` 分支链接只作浏览参考，实现与 SHA 必须以该 commit 为准。

组队战规则原文（该 commit 上的路径）：

- 组队战说明：<https://github.com/will-shy/MWICombatSimulatorTest/blob/48d8c14f52c05c720c13ba3df59ca942dd87e12f/docs/group_battle.md>
- 事件引擎：<https://github.com/will-shy/MWICombatSimulatorTest/blob/48d8c14f52c05c720c13ba3df59ca942dd87e12f/src/combatsimulator/combatSimulator.js>
- 组队战：无食物饮料；人数缩放；**无玩家复活**；Trial Mode 团灭/超时停场；每层独立 `simulateBattle`

拟复制文件的 SHA256（对该 commit 的 raw 内容计算）：

| 路径 | SHA256 | 用途 |
|---|---|---|
| `src/combatsimulator/shrine.js` | `34642e7975df60b4c52f7f13b9eceda40bc35f35e4a6fb72667e65c4357dcdb4` | 移植神龛 Buff |
| `src/combatsimulator/data/shrineDetailMap.json` | `5b5c598d2032d12ac2f84e1ed5805a2a2b8e8727a9aac88035f175beab2ab194` | 四种神龛数据 |
| `src/combatsimulator/groupBattleMonster.js` | `d6bf1b6a4e366fd0b5d3df01ee9c5a033089e03e7beb2be335f5cf54a962640a` | uniqueHrid + 人数缩放参考，不整文件替换我方 fixture 路径 |
| `src/combatsimulator/data/groupBattleScaling.js` | `2a5008020b29f07a06914fa2af54af00cf00be44ecccaf31d356fd613d6d202e` | 人数缩放常数对照（我方已对齐，不换 HP 公式） |
| `src/combatsimulator/data/groupBattleBuffs.js` | `75f2301628c6eddfd7c487bd90a0e592cb2833260dfd96ed6177149b21317ea0` | +3pp 回复对照（我方用 `passiveRegenFlatBonus`） |

该 fork 在该 commit **没有** 根目录 `LICENSE`。本仓库已有的 Shykai MIT 来源记录：

- [`packages/combat-core/third_party/shykai/recovered/provenance.json`](../packages/combat-core/third_party/shykai/recovered/provenance.json)
- 上游 LICENSE（shykai/MWICombatSimulatorTest `main`）：SHA256 `6821d0c99790a16a45ca4004f4938d833aaab82c5926f97225c17cfa4d8d9ca6`

移植 `shrine.js` / 神龛数据时必须：保留 MIT 声明、写入 `THIRD_PARTY_NOTICES` 或同等 provenance（commit、路径、SHA256），不得假装是本仓库原创。

---

## 1. 两边现在各做什么

### 1.1 已经对齐、保持不动

| 规则 | 说明 |
|---|---|
| 无食物/饮料 | 双方禁用；用 HP/MP 每 10 秒 +3 个百分点补偿 |
| 人数缩放 | 每人 +1% Boss 最大生命、+2% 攻速、+2% 施法、+2 急速；**不缩放 MP** |
| 遭遇宽度 | 獾×2、虫群 4 只异种、其余 1 只 |
| 格挡 | 我方单次攻击最多 5 次格挡判定；对方只 roll 1 次。**我方正确，不改** |
| 高层 HP/MP | 我方用实况校准 `floor(level100Pool × (level + 10) / 110)`。对方迷宫 `level/100` 会高估。**沿用我方** |
| 怪物数据来源 | 继续每周游戏面板 fixture + 反推写入 `combatMonsterDetailMap`，不改走 `/monsters/trial_*` 游戏表 |
| 全局血蓝取整 | 保持 `Math.floor`，不改 `ceil` |
| `itemDetailMap` | 不在本次刷新 |
| `/health.simulationEngine` | 保持 `unavailable` |
| 数据库 | 不覆盖线上 `qq-test.sqlite`；快照表仍 append-only，只扩清洗/合并语义 |

### 1.2 对照分叉与拍板

| 项 | 我方现状 | 对方（钉死 commit） | 决定 |
|---|---|---|---|
| 狂暴 | `enrageTime` 写成 24 小时 | 600 秒一层，最多 10 层，每层 +10% 伤害 **和命中** | **采用对方**；换层必须重置狂暴时钟 |
| 全灭 | 非地下城只清部分攻击事件，`simulate` 仍跑到时间上限；玩家 150 秒复活 | Trial Mode：团灭/超时停场 | **团灭为显式终止态**（§2.2） |
| 换层 | `refillPlayersOnEnemyRespawn` 只补 HP/MP；DOT 用 `sourceRef`，来源死亡后仍 tick | 每层独立 battle，队列不跨层 | **显式 encounter reset**（§2.1），不是「约等于新建 DTO」 |
| 个人复活 | 非地下城 `PlayerRespawnEvent` + 150s | group battle **no respawns** | **实施前待确认**（§1.3） |
| 房屋/成就/神龛 | `createPlayer` 传空 | 组队战 `start_battle` 也不套神龛 | **试炼吃这三项**；必须走 API 灰度，覆盖率未达标前周五组合 **不得** 启用永久加成 |
| 多只同 hrid Boss | `SimResult` 按 hrid 合并 | uniqueHrid | **拆开**；展示「中文名 #1 / #2」 |
| 变色龙防御伤害 | fixture 有字段未写入 | 游戏表驱动 | **变色龙不吃，不补映射** |

### 1.3 用户已拍板（2026-08-30）与未拍板

已拍板：

1. 高层 HP 公式与 fixture 数据源不改。
2. 狂暴采用 will-shy（600s、伤害+命中、cap 10、换层重置时钟）。
3. 全灭结束本场、换层要重置遭遇（具体队列契约见 §2.1 / §2.2）。
4. 格挡 5 次不改。
5. 房屋/成就/神龛试炼生效；插件采集；模拟要算——但 **启用时机** 受 §3.4 覆盖率门禁约束。
6. 变色龙不补 `defensiveDamage`。
7. 多只同名 Boss 统计拆开。

未拍板（实施前必须确认，二选一）：

- **A. 完全 no auto-respawn**：个人死亡不排队 150 秒复活；存活队友继续打；全灭立即 `party_wipe`。这才与 will-shy group battle 一致。
- **B. 混合规则**：个人仍 150 秒自动复活 + 复活技能；**仅当同一时刻没有存活玩家** 才 `party_wipe`。若选 B，文档与交接 **不得** 宣称与 will-shy 完全一致。

在未确认前不得开始实现复活相关分支。引擎团灭终止态、encounter reset、狂暴、uniqueHrid、API 字段仍可按本文其余章节设计。

---

## 2. 引擎契约

### 2.1 换层：显式 encounter reset

现状缺口：

- `refillPlayersForNextEncounter` 只补 HP/MP、清 `PlayerRespawnEvent`、清 OOM 计数。
- `DamageOverTimeEvent` 故意用 `sourceRef`，「Calling it `source` would wrongly clear Damage Over Time when the source dies」。来源死亡或换层后 DOT **仍会打下一层目标**。
- 击杀换层目前只 `clearEventsOfType(AutoAttackEvent)`（`AbilityCastEndEvent` 还被注释掉）。队列里仍可能有：DOT、`AwaitCooldownEvent`、`CheckBuffExpirationEvent`、`CooldownReadyEvent`、控制到期（stun/blind/silence/curse/weaken/fury）、`RegenTickEvent`、`EnrageTickEvent`、`ConsumableTickEvent`、`EnemyRespawnEvent`、待施法 `AbilityCastEndEvent`。

换层不得写成「等价 fresh DTO」。必须定义函数级 **encounter reset**（名称实现自定，语义如下）。

**清空全部遭遇级事件**（`eventQueue.clear()` 或显式列出并全部移除，禁止只清攻击）：

- `AutoAttackEvent`、`AbilityCastEndEvent`、`AwaitCooldownEvent`、`CooldownReadyEvent`
- `DamageOverTimeEvent`
- `CheckBuffExpirationEvent`
- `StunExpirationEvent`、`BlindExpirationEvent`、`SilenceExpirationEvent`、`CurseExpirationEvent`、`WeakenExpirationEvent`、`FuryExpirationEvent`
- `RegenTickEvent`、`EnrageTickEvent`、`ConsumableTickEvent`
- `EnemyRespawnEvent`、`PlayerRespawnEvent`
- 任何仍挂在堆上的 `CombatStartEvent`

**单位状态重置（全体玩家，再刷下一层怪）：**

- HP/MP 补满；`current = max`
- OOM 状态与 OOM 计时清零（沿用现有 `addRanOutOfManaCount(..., false, now)` 口径）
- 技能 CD：`lastUsed` 回到可立即判定的状态（与新建 Player 一致）
- 临时战斗 Buff / 控制清掉；**永久加成**（房屋/成就/神龛/回复 +3pp）在 `generatePermanentBuffs` 之后仍在
- regen 时钟：下一层第一个 `RegenTickEvent` 必须是 `now + REGEN_TICK_INTERVAL`，不得沿用上一层剩余间隔
- 狂暴时钟：`enrageBeginTime = now`（或等价 encounterTime=0）；下一层 stack 从 0 计

随后为下一层重新调度：刷怪（人数缩放 + uniqueHrid）、`startAttacks`、regen tick、enrage tick。

回归（必须，不能只看满血）：

- 上一层 DOT 不得对下一层单位造成伤害
- 上一层未完成的 `AbilityCastEndEvent` 不得在下一层结算
- 上一层 CD/Buff 到期事件不得在下一层改单位状态
- 换层后第一次被动回复发生在完整 10 秒间隔之后，而不是「上一层还剩 2 秒就 tick」

### 2.2 团灭：显式终止态

现状缺口：

- `simulate()` 主循环是 `while (this.simulationTime < simulationTimeLimit)`。队列空或下一事件超过上限时会把 `simulationTime` **推到 limit**。
- 非地下城全灭只清 `AutoAttackEvent` / `AbilityCastEndEvent`，**留下 regen 等**；循环会继续处理回血/复活直到 3600s。

落地：

- 全员 `currentHitpoints <= 0` 的那一拍：设 `stopReason = "party_wipe"`，`endedAt = simulationTime`（真实团灭时刻，ns），记录当前层（已生成但未通关的 `roomLevel`）、每只存活 Boss 的 `uniqueHrid` + `currentHitpoints` / `maxHitpoints`。
- **主循环必须在该时刻退出**，禁止再 `getNextEvent`，禁止把时间推到 `durationSeconds`。
- 团灭后队列必须空：无 regen、无 `PlayerRespawnEvent`、无攻击/DOT/施法。
- 超时：`stopReason = "time_cap"`，`endedAt` 为上限；通关 300：`stopReason = "complete"`。

结果对象（runner `summarizeRun` 及 lab JSON）必须带：`stopReason`、`endedAt`（秒或 ns 需在实现里统一并写测试）、`finalMonsterLevel`、`livingEnemies[]`。

测试断言（不能只断言 `wavesCleared` 不变）：

- `simulatedTime === 团灭事件时间`（允许文档规定的 1 tick 容差，但不得等于 3600s 除非团灭恰好在上限）
- 团灭之后无 regen tick、无复活、无新的 auto-attack / ability
- 最终 Boss HP 与团灭瞬间一致
- `stopReason === "party_wipe"`

超时路径：`stopReason === "time_cap"`，`simulatedTime` 为上限。

### 2.3 狂暴

`processEnrageTickEvent` 公式保留：

```text
stack = min(10, floor(encounterTime / enrageTime))
ratioBoost = stack * 0.1  → /buff_types/damage 与 /buff_types/accuracy
```

- `enrageTime = 600s`，不要 24 小时。
- 每层 encounter reset 后 stack 从 0；10 分钟 → +10% 伤害 **且** +10% 命中；100 分钟 cap 10（+100%/+100%）。
- 批量模拟去掉狂暴 `console.log`。

### 2.4 多只 Boss 统计

獾×2 共用 data hrid 时：`dataHrid` 查定义与缩放；`hrid` 为 unique（稳定序号）。`updateCombatDetails` 查表期间切回 `dataHrid`。

展示：**中文名 #1**、**中文名 #2**（例如 `试炼獾 #1`）。虫群异种 hrid 已不同，仍给稳定序号以免报表歧义。

变色龙不吃防御伤害：不为它写 `combatStats.defensiveDamage`。

---

## 3. 快照、校验与灰度

### 3.1 为什么不能先发插件

[`sanitizeMemberSnapshot`](../apps/api/server.mjs) 对 snapshot **严格白名单** `ensureKeys`。当前允许键不含 `houseRooms` / `achievements` / `shrines`。新插件先上传 → `unknown_field` 整包被拒，成员配装同步中断。

快照表 `INSERT` 后读取 `ORDER BY id DESC LIMIT 1`。旧客户端在新客户端之后再传一份 **缺字段或空 map 的全量行**，会盖掉刚采到的房屋/神龛。空 `loadoutCatalog` 已有「不覆盖」纪律；这三项必须有 **服务端 carry-forward**，不能只靠插件自觉。

### 3.2 数据契约

能力标记（名称实现自定，必须可区分新旧客户端），例如：

- `permanentBuffsCaptured: true`（新插件只要成功读过游戏房屋/成就/神龛地图就为 true，即使全 0）
- 或提高 `sourceSchemaVersion` 到带 `permanent-buffs-v1` 的常量

**神龛** `shrines`：对象。允许的 key **恰好** 这四个，不得多：

```text
/shrines/force
/shrines/tempo
/shrines/spirit
/shrines/scholar
```

值：整数 `0..maxLevel`（该 commit 四种 `maxLevel` 均为 **20**）。缺 key 视为 0。小数、负数、`21`、`1e9`、字符串数字以外的类型 → 400。

**房屋** `houseRooms`：key 必须是当前 `houseRoomDetailMap` 的 17 个 HRID；未知 key → 400。等级整数 `0..maxLevel`，当前各房 `upgradeCostsMap` 最高为 **8**。不得走 `levelMap(..., 0, 10000)`。

已知房屋 HRID：`archery_range`、`armory`、`brewery`、`dairy_barn`、`dining_room`、`dojo`、`forge`、`garden`、`gym`、`kitchen`、`laboratory`、`library`、`log_shed`、`mystical_study`、`observatory`、`sewing_parlor`、`workshop`（均 `/house_rooms/` 前缀）。

**成就** `achievements`：key 必须落在 `achievementDetailMap`；值只能是 `true`/`false` 或整数 `0`/`1`。其它数字、`"yes"`、越界 → 400。

API **与** `createPlayer` 运行时都要验证。未知 HRID：**拒绝该快照或拒绝该字段**（API 400）；运行时不得静默 clamp 成 10000。恶意放大必须在测试里出现并失败。

### 3.3 Carry-forward / merge

读上一份最新 `payload_json`，写入前合并：

| 新上传 | 上一份 | 结果 |
|---|---|---|
| 新客户端 `permanentBuffsCaptured=true`，三项均在且通过校验（可全 0） | 任意 | 用新值（空 map = 全 0，合法） |
| 缺 `houseRooms`/`achievements`/`shrines`（旧客户端） | 有合法三项 | **沿用上一份** 对应字段 |
| 缺三项 | 也没有 | 视为未采集；模拟侧不得当「全 0 已确认」 |
| 新客户端字段非法 | — | 400，不写库 |

「空 map 保留语义」：新客户端显式 `{}` 表示已采集且全 0；旧客户端省略字段不得把上一份非空冲掉。

测试：新客户端上传有效神龛后，旧客户端再传无这三项的快照 → 读取最新仍是神龛值；API round-trip 往返 JSON 一致。

### 3.4 覆盖率门禁与周五组合

采集期实验室可以跑（永久加成 **关闭**，与今日行为一致）。

周五正式组合（`run-available-roster-composition-lab` 及随后 A/B、`--skip-sim` 发布）**启用永久加成前** 必须：

- 本周该场拟上场成员（攻击≥110 且会进 lab 的名单）中，`permanentBuffsCaptured=true` 且三项通过校验的比例 ≥ 门槛（建议默认 **100% 上场名单**；若需放宽，实施前写死百分比，禁止含糊「差不多」）
- 未达标：lab 拒绝 `permanentBuffsEnabled=true`，或直接失败并提示缺谁
- 混合新旧快照不得一部分人吃满级道场、另一部分当 0——未达标就全员关闭永久加成

Feature flag：`permanentBuffsEnabled` 写入 lab JSON，与 `combatRulesVersion` 一起校验。

### 3.5 部署顺序（强制，禁止颠倒）

1. **API**：白名单加入三字段 + 严格校验 + carry-forward；开发测 round-trip。
2. **同步运行副本** `/Users/xhy/.local/share/mwi-guild-server`，重启 LaunchAgent，对本机 API 做往返验证。不得用开发 sqlite 覆盖线上库。
3. **再发布** TMD+WI 插件采集（`publish-guild-plugins.mjs`，六个源 `@version` 一致）。
4. 覆盖率检查（QQ/脚本列出未采集成员）。
5. 门槛达标后，才允许模拟器 `permanentBuffsEnabled=true`。
6. 用新 `combatRulesVersion` **从组合实验室重跑**，禁止复用旧 `.local` JSON。

插件发布前若 API 未上，新字段会被拒。模拟器先消费未采集数据会造成不公平，禁止。

---

## 4. `combatRulesVersion` 与旧实验产物

现状：lab JSON 只有 `engine: "shykai-full-event-runtime"`；[`run-and-publish-combat-assignment.mjs --skip-sim`](../scripts/run-and-publish-combat-assignment.mjs) 只要求 `generatedAt`。A/B 脚本改 `generatedAt` 后仍像「新产物」。

必须增加 **`combatRulesVersion`**（或等价 engine fingerprint 字符串），覆盖：

- 狂暴 600s + 换层重置时钟 + 伤害和命中 + cap 10
- `party_wipe` 终止态（真实时刻退出）
- 显式 encounter reset（队列全清 + regen/狂暴时钟）
- uniqueHrid 统计
- 永久加成是否启用（flag 本身也进 fingerprint 或并列字段）

建议常量（实现时可微调，但旧值必须失效）：

```text
combatRulesVersion: "guild-trial-rules-2026-08-30.1"
```

[`run-and-publish-combat-assignment.mjs --skip-sim`](../scripts/run-and-publish-combat-assignment.mjs) 与所有 `scripts/ab-*.mjs`：版本不匹配或缺字段 → **拒绝退出非 0**。实现本方案后，**必须重新跑组合实验室**；不得把现有 `.local/*lab*.json` 拿来 `--skip-sim`。

---

## 5. 房屋 / 成就 / 神龛（模拟侧，受门禁）

正式服试炼吃这三项。引擎：房屋/成就已在 `Player.createFromDTO`；神龛按 §0.1 SHA 移植 `shrine.js` + `shrineDetailMap` 的 **Buff 公式**（`boost + (N-1)*boostLevelBonus`），并给 `combatUnit` 加上 max HP/MP **ratio** 钩子。全局仍 `floor`。

**不得照搬** 上游 `Shrine.buffsFromLevels` 的「未知 HRID / 非正等级静默忽略」。API 已 400；运行时若仍收到非法 map，必须失败而不是跳过（避免静默少算或被放大）。

`extraBuffs`：试炼回复 +3pp 与神龛并存。

缺字段：未 `permanentBuffsCaptured` 时，即使 flag 误开也应视为未启用并告警/失败。

Scholar：只加 wisdom，试炼无经验；断言战斗伤害/攻速/血蓝与未装备 Scholar 对照相同。

Spirit：HP/MP 按 ratio 增加后 **仍 floor**（不 ceil）。

---

## 6. 插件采集

当前 TMD/WI `@version` 0.6.23 不采集这三项。必须两边公会、三个渠道一起发。

- 只读已有 `init_character_data` / `initClientData` / 当前角色状态；不发包。
- 游戏字段名以实况为准，实现前在已登录页确认。
- 新插件设置 `permanentBuffsCaptured: true`。
- 不上传凭据。空 map + captured=true 表示已采集全 0。
- TMD 源与 WI 生成源版本一致（发布脚本一次构建）。

---

## 7. 验收矩阵

引擎：

- encounter reset：上一层 DOT、待施法、CD/Buff 到期不影响下一层；regen 从新层完整间隔开始；狂暴 stack 归零。
- 团灭：`stopReason`、`endedAt`、`simulatedTime` 等于团灭时刻、之后无 regen/复活/攻击、Boss HP 冻结。
- 超时 / 通关 300 的 `stopReason`。
- 狂暴：10 分钟伤害 **和** 命中各 +10%；stack 不超过 10。
- uniqueHrid：两只獾两行；展示 `试炼獾 #1` / `试炼獾 #2`。
- 复活：按最终拍板的 A 或 B 各写测试（未拍板前测试可 skip 该分支）。

永久加成（仅 `permanentBuffsEnabled=true` 且覆盖率达标夹具）：

- 成就 Elite 档（全套完成）伤害 ratio 生效；缺一成就不给该档。
- Force：伤害上升。
- Tempo：攻速与施法上升。
- Spirit：max HP/MP 上升且结果为 floor。
- Scholar：战斗数值无副作用。
- Dojo：攻击等级或攻速高于空房屋对照。
- 缺字段 / 空 map（captured=true）/ 未采集不得当满额。

API / 插件：

- 未知 HRID、负数、小数、越界、恶意放大 → 400。
- 新客户端后旧客户端上传的 carry-forward。
- 运行副本 round-trip。
- TMD/WI 生成脚本 `@version` 一致。
- 混合覆盖率：未达门槛时 lab 拒绝启用永久加成。

---

## 8. 明确不做

- 迷宫 `level/100` 覆盖校准 HP/MP；改用 `/monsters/trial_*` 作主数据源。
- 格挡改回 1 次；全局 `floor` → `ceil`；刷新整份 `itemDetailMap`。
- 解除 `simulationEngine: unavailable`。
- 覆盖线上 sqlite。
- Skill Lab 页面、施放次数报表。
- 在 API/运行副本未接受新字段前发布采集插件。
- 用旧 `.local` lab JSON `--skip-sim` 或当本周正式方案。
- 未拍板个人复活前实现并宣称与 will-shy 完全一致。

---

## 9. 实施顺序（契约满足后才写代码）

1. 拍板 §1.3 个人复活 A/B。
2. 引擎：encounter reset、`party_wipe` 真退出、狂暴、uniqueHrid；`combatRulesVersion`；永久加成默认关。
3. API 校验 + merge；测试；同步运行副本并往返验证。
4. 发布 TMD/WI 采集；查覆盖率。
5. 门槛达标后开 `permanentBuffsEnabled`，**重跑**组合实验室与 A/B，再 `--skip-sim` 发布。
6. 回写交接文档。

---

## 10. 实现时改哪些文件（备忘，尚未动）

| 区域 | 文件 |
|---|---|
| 试炼包装 | `packages/shykai-full-runtime/src/guild-trial-runner.mjs` |
| 事件引擎 | `generated/.../combatSimulator.js`、`combatUnit.js` |
| 神龛 | 新增 `shrine.js` + `shrineDetailMap.json.js`（§0.1 SHA + MIT/provenance） |
| 快照/API | `apps/api/server.mjs` `sanitizeMemberSnapshot`；`packages/mwi-adapter/src/model.ts`；payload builder |
| 版本门 | lab 写出与 `ab-*.mjs`、`run-and-publish-combat-assignment.mjs` |
| 插件 | `userscripts/member-candidate-loadout-exporter.user.js`；WI 由发布脚本生成 |
| 测试 | `tests/core/guild-trial-runtime-rules.test.mjs`、API sanitize 测试、userscript 测试 |
| 交接 | 实现完成后 `CLAUDE_CODE_HANDOFF.md` |

---

## 11. 对照来源

- 钉死 commit `48d8c14f52c05c720c13ba3df59ca942dd87e12f`（§0.1）
- 浏览用分支（非权威）：<https://github.com/will-shy/MWICombatSimulatorTest/tree/testing>
- 我方：[`CLAUDE_CODE_HANDOFF.md`](../CLAUDE_CODE_HANDOFF.md) §4.3、§6.3；API `ensureKeys` / `levelMap`；`combatSimulator.simulate` / `checkEncounterEnd`；`DamageOverTimeEvent.sourceRef`
