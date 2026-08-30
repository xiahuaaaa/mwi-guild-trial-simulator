# 公会战斗模拟：对照 will-shy 后的落地方案

更新时间：2026-08-30（Asia/Shanghai）  
状态：已拍板，本文只写方案，**尚未改代码**  
权威：对照结论与实现边界以本文为准；实现后再回写 [`CLAUDE_CODE_HANDOFF.md`](../CLAUDE_CODE_HANDOFF.md) §4.3 / §6.3。

---

## 0. 背景

TMD 公会战斗试炼模拟跑在本仓库的 Shykai 事件引擎上：

- 源码：2026-07-24 从 `shykai.github.io/MWICombatSimulatorTest` source map 恢复，物化在 `packages/shykai-full-runtime/`
- 公会包装：[`packages/shykai-full-runtime/src/guild-trial-runner.mjs`](../packages/shykai-full-runtime/src/guild-trial-runner.mjs)
- 每周 Boss 面板：`fixtures/monsters/guild-trial-YYYY-MM-DD-*.json`
- 流水线：成员插件快照 → 组合实验室 → 疯狂/奶转输出 A/B → GitHub Pages 本周分工

2026-08-30 对照了别人的公会组队模拟器：

[will-shy/MWICombatSimulatorTest `testing`](https://github.com/will-shy/MWICombatSimulatorTest/tree/testing)

对方是同一套 Shykai 内核的另一分叉，多了组队战页（`group-battle.html`）、`GroupBattleMonster`、Skill Lab。两边 **不是** 两套独立战斗公式。对方组队战和我方试炼包装在「狂暴、团灭、换层、房屋神龛、多只怪统计」上已经分叉。

对照目的：查漏补缺，**不整仓替换**，不解除 `simulationEngine: unavailable`。

---

## 1. 两边现在各做什么

### 1.1 已经对齐、保持不动

| 规则 | 说明 |
|---|---|
| 无食物/饮料 | 双方禁用；用 HP/MP 每 10 秒 +3 个百分点补偿 |
| 人数缩放 | 每人 +1% Boss 最大生命、+2% 攻速、+2% 施法、+2 急速；**不缩放 MP** |
| 遭遇宽度 | 獾×2、虫群 4 只异种、其余 1 只 |
| 格挡 | 我方单次攻击最多 5 次格挡判定；对方只 roll 1 次。**我方正确，不改** |
| 高层 HP/MP | 我方用实况校准 `floor(level100Pool × (level + 10) / 110)`。对方用迷宫 `level/100`，会高估。**沿用我方** |
| 怪物数据来源 | 继续每周游戏面板 fixture + 反推写入 `combatMonsterDetailMap`，不改走对方的 `/monsters/trial_*` 游戏表 |

### 1.2 对照时发现的分叉（已拍板）

| 项 | 我方现状 | 对方 | 决定 |
|---|---|---|---|
| 狂暴 | `enrageTime` 写成 24 小时，等于关掉 | 600 秒一层，最多 10 层，每层 +10% 伤害/命中 | **采用对方** |
| 全灭 | Boss 留场，玩家 150 秒复活继续打 | Trial Mode：团灭/超时整场结束 | **采用对方** |
| 换层 | 只补满 HP/MP，CD/Buff 保留 | 每层新建 Player，CD/Buff 清空 | **采用对方** |
| 房屋/成就/神龛 | `createPlayer` 故意传空 | 组队战 `start_battle` 也不套神龛；单人挂机才套 | **公会试炼确定吃这三项，要算进去** |
| 多只同 hrid Boss 统计 | 两只獾在 `SimResult` 里并成一行 | `uniqueHrid` 拆开 | **采用对方** |
| 变色龙防御伤害 | fixture 有 `damage.defensive`，反推没写入 | 游戏表驱动 | **变色龙不吃防御伤害，不必为它补映射** |

---

## 2. 用户拍板（2026-08-30）

1. 怪物数据来源和高层 HP 公式：**不改**。
2. 狂暴：**采用 will-shy**。
3. 全灭与换层重置：**采用 will-shy**。
4. 格挡 5 次：**我方正确**。
5. 房屋 / 成就 / 神龛：**确定公会试炼吃这三项**；TMD/WI 插件要采集；模拟要算。
6. 变色龙不吃防御伤害：不为变色龙补 `defensiveDamage`。
7. 獾这种多只同名 Boss：统计拆开，和对方一样。
8. 先写本文，再改代码。

中优先级里唯一值得另开任务的是装备/技能表是否过期（`itemDetailMap` 停在 2026-07-24）。**不在本次范围**。Skill Lab、施放次数报表、ceil 血蓝取整都不做。

---

## 3. 要改什么（实现范围）

分四块，建议按依赖顺序做：引擎规则 → 多只怪统计 → 房屋/神龛/成就进模拟 → 插件采集并发布。

### 3.1 狂暴

现有 `processEnrageTickEvent` 已经是对方公式：

```text
stack = min(10, floor(encounterTime / enrageTime))
每层 +10% 伤害、+10% 命中，最多 10 层
```

缺口只是安装 Boss 时把 `enrageTime` 写成 24 小时。

落地：

- 试炼怪 `enrageTime = 600s`（10 分钟加一层）。
- **每换一层把狂暴计时归零**。对方每层是一次独立 `simulateBattle`；我方若一次跑 3600 秒却不重置，10 分钟后所有高层都会带着狂暴，比对方狠、也和正式服「每层一条新怪」不符。
- 批量模拟关掉狂暴 `console.log`。

引擎文件：[`combatSimulator.js`](../packages/shykai-full-runtime/generated/src/combatsimulator/combatSimulator.js)、[`guild-trial-runner.mjs`](../packages/shykai-full-runtime/src/guild-trial-runner.mjs) 的 `installMonsterDefinition`。

### 3.2 全灭停场、换层重置

对方 Trial Mode：一层打完才进下一层；团灭或超时结束整场；通关后用同一 DTO 新建 Player。

落地：

- **全员阵亡 → 停止本场**，记录停在哪一层、剩余 Boss HP。不再让全灭后的 150 秒复活把同一层磨完。
- 单人死亡、仍有队友存活：仍走现有个人复活（150 秒）和复活技能。只有全灭才停。
- 击杀换层：所有玩家满 HP/MP，并 **重置 CD / 战斗 Buff / 控制**（等价对方新建 DTO）。狂暴计时归零（§3.1）。
- 超时 3600 秒：仍结束，语义与现在相同。

这会让「快团灭但还能磨」的方案变差，层数可能下降。

### 3.3 房屋 / 成就 / 神龛进模拟

**正式服公会试炼吃这三项**（2026-08-30 确认）。引擎侧风险不大：房屋和成就早已在 `Player.createFromDTO` → `generatePermanentBuffs` 里，只是 `createPlayer` 传了空对象。

落地：

- `createPlayer` 从 `member.snapshot` 读取 `houseRooms`、`achievements`、`shrines`；缺省空对象，行为与现在相同。
- 未知房屋 hrid 或等级 ≤ 0：**跳过**，不要让 `HouseRoom` 构造 throw。
- 神龛：本仓库没有 `shrine.js` / `shrineDetailMap`。从 will-shy 移植（MIT），经 `extraBuffs` 叠在现有回复 +3pp 上。四种神龛：Force 伤害、Tempo 攻速/施法、Spirit 最大生命/魔力比例、Scholar 经验（试炼无经验，可算可忽略）。
- Spirit 需要 `combatUnit.updateCombatDetails` 把 `/buff_types/max_hitpoints`、`max_manapoints` 的 ratio 加进池子。我方现在没有这条钩子。
- **不要**把全局血蓝从 `Math.floor` 改成 `Math.ceil`。那是另一处取整，和房屋无关。

快照没有这三项时必须能跑通，不能把实验室打挂。

快照模型 [`MemberCapabilitySnapshotV2`](../packages/mwi-adapter/src/model.ts) 已有可选 `houseRooms`、`achievements`；需补 `shrines?: Record<string, number>`。

### 3.4 插件采集这三项（TMD + WI）

当前 TMD/WI 插件（工作区 `@version` 0.6.23）从 `init_character_data` / 游戏 React 状态读角色、技能、已学技能、配装、公会试炼，**不读房屋/成就/神龛**。引擎打开后，在插件补上之前等于没加。

必须 **同时** 更新 TMD 和 WI，三个安装地址一起发（油叉 / Gitee / GitHub）。入口：

```bash
cd guild-trial-simulator
node scripts/publish-guild-plugins.mjs --notes "快照增加房屋、成就、神龛"
```

采集原则：

- 只读 `init_character_data`、`initClientData`、当前角色 React 状态里 **已经存在** 的地图；不猜、不发包。
- 实现前在真实已登录页列出候选 key（例如 `characterHouseRoomMap`、`characterAchievementMap`、`characterShrineMap` 或同等命名），对上再写。字段名以实况为准，本文不冻结错误名字。
- 房屋：`{ "/house_rooms/dojo": 8, ... }` 等级表；0 与缺失等价。
- 成就：完成与否的 map。上游 `Achievement` 要的是「该档全部成就为真才给档位 buff」；战斗有意义的主要是 Elite 档 +2% 伤害。布尔或 0/1 都要能进模拟。
- 神龛：`{ "/shrines/force": 12, ... }` 等级 0–20。
- 不上传 Cookie、Token、登录凭据。
- 空 map 不得覆盖服务器上已有的非空三项（与空 `loadoutCatalog` 不覆盖配装同一纪律）。
- 旧快照没有这三项：模拟当空，不报错。

发布后还要：bump `@version`、跑相关 userscript 测试、校验六个 raw 源的 `@version`、更新 API `plugin_versions`、更新交接文档 §11.1。

### 3.5 多只 Boss 统计拆开

试炼獾一层两只，hrid 都是 `/guild_combat/badger`。模拟里是两个对象、两份血，**击杀逻辑是对的**。`SimResult` 按 `unit.hrid` 汇总伤害/死亡，报告会像一只獾吃了双倍伤。

对方做法：`dataHrid` 用来查游戏表，`hrid` 改成带序号的唯一值（`… #1` / `… #2`），`updateCombatDetails` 期间临时换回 `dataHrid`。

落地：

- 同一层多只怪（獾×2；若将来出现两只同 hrid）给 `uniqueHrid`。
- 虫群四只异种 hrid 已经不同，本来就不会并；仍可用稳定序号，报表更清晰。
- 换层补满、人数缩放仍按 `dataHrid` 查定义。
- 汇总/报告按唯一 hrid 分行；对外展示名仍用中文 Boss 名 + 序号。

变色龙防御伤害：本周及同类单体 **不吃** 这条词条，不为它补 `combatStats.defensiveDamage`。盾墙玩家仍走装备表，与本条无关。

---

## 4. 明确不做

- 用迷宫 `level/100` 覆盖已校准的 HP/MP。
- 改走对方 `/monsters/trial_*` 游戏表作为 Boss 主数据源。
- 格挡改回只判定 1 次。
- 全局 `maxHitpoints` `floor` → `ceil`。
- 解除 `/health.simulationEngine: unavailable`。
- Skill Lab 页面、施放次数/疯狂自伤报表。
- 刷新整份 `itemDetailMap`（另开任务，若近期战斗装改过数值再做）。
- 用开发库覆盖线上 `qq-test.sqlite`。

---

## 5. 验收

引擎（`guild-trial-simulator` 下 `npm test`，至少补这些断言）：

- 狂暴：`enrageTime` 为 600s；换层后 stack 从 0 再计；一层内满 10 分钟出现 +10% 伤害 buff。
- 全灭：全员阵亡后 `wavesCleared` 不再增加，本场结束。
- 换层：通关后玩家满血蓝，技能 `lastUsed` 相当于可用（CD 重置）。
- 房屋空 map 不崩；有道场时攻击等级或攻速高于空房屋对照。
- 两只獾的承伤/伤害行数 ≥ 2，不再并成一个 hrid。

插件：

- 真实页同步一份快照，JSON 里能看到房屋等级、成就、神龛（至少当前登录角色有数据的那些 key）。
- 六个安装源（TMD/WI × 油叉/Gitee/GitHub）的 `@version` 与工作区一致。

正式服口径：房屋/神龛/成就已确认为试炼生效；狂暴与团灭停场按 will-shy 组队战语义落地。若以后校准插件证明团灭后仍继续，再单开回退任务，不在本文里留「两套都对」。

---

## 6. 实现时改哪些文件（备忘，尚未动）

| 区域 | 文件 |
|---|---|
| 试炼包装 | `packages/shykai-full-runtime/src/guild-trial-runner.mjs` |
| 事件引擎 | `packages/shykai-full-runtime/generated/src/combatsimulator/combatSimulator.js`、`combatUnit.js` |
| 神龛 | 新增 `shrine.js` + `data/shrineDetailMap.json.js`（从 will-shy MIT 源移植，保留来源） |
| 快照 | `packages/mwi-adapter/src/model.ts`、payload builder、API 存取若有白名单字段 |
| 插件 | `userscripts/member-candidate-loadout-exporter.user.js` + payload builder；WI 由发布脚本生成 |
| 测试 | `tests/core/guild-trial-runtime-rules.test.mjs`、userscript 快照测试 |
| 交接 | 实现完成后改 `CLAUDE_CODE_HANDOFF.md` §4.3、§6.3、§11.1 |

---

## 7. 对照来源

- 对方组队战说明：<https://github.com/will-shy/MWICombatSimulatorTest/blob/testing/docs/group_battle.md>
- 对方人数缩放：`src/combatsimulator/data/groupBattleScaling.js`
- 对方狂暴：`combatSimulator.js` `processEnrageTickEvent`（与我方同结构）
- 对方多只怪：`src/combatsimulator/groupBattleMonster.js`
- 我方规则与已知风险：[`CLAUDE_CODE_HANDOFF.md`](../CLAUDE_CODE_HANDOFF.md) §4.3、§6.3
