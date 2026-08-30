# 每周战斗试炼筛选流程

更新时间：2026-08-30（Asia/Shanghai）  
权威位置：本文。组合实验室、疯狂人数、自然奶转输出、发布脚本的默认行为以代码为准；改流程先改脚本再改本文。

每周五 `00:00 UTC` 公会周重置后，用户说「做本周战斗模拟」时走这条流水线。  
**不要**直接 QQ「战斗模拟」或裸跑 `run-and-publish-combat-assignment.mjs`（那会重跑组合实验室，冲掉后续 A/B）。

战斗周永远是 **1 个单体 Boss + 试炼虫群**。内部分区键仍把单体侧叫 `chameleon`（历史兼容）；对外 `bossKey` 是真实 id（`chameleon` / `badger` / `hedgehog` / …）。

---

## 0. 顺序（不可颠倒）

```text
确认技能包（有疑问先问用户，不要猜）
  → 拉本周 weekly-trials，生成 monster fixture
  → 按 Boss 对选用分区策略
  → 组合实验室（奶比 + 技能包 + 3600s×3 seed 终验）
  → 前 x 输出/减益 复活→疯狂（筛 1800s，前三再 3600s×3）
  → --apply 写回 lab JSON
  → 前 x 自然奶 → 自然输出（基线必须已含疯狂）
  → --apply 写回 lab JSON
  → 发布：run-and-publish-combat-assignment.mjs --skip-sim
```

产物始终是开发实验：`promotable=false`。发布到 GitHub Pages 后成员看到的是「本周分工」，**不要**再写入 `assignments/formal`。不要覆盖线上 `qq-test.sqlite`。

---

## 1. 门禁

- 开发目录 `guild-trial-simulator/` 与运行副本 `/Users/xhy/.local/share/mwi-guild-server` 相互独立。
- 密钥从 LaunchAgent 的 `api.env` 注入，**不要打印、复制、提交**。`api.env` 第 5 行有一处未加引号的路径，source 时可能警告 `qrcode.png`，忽略即可，key 仍会加载。
- `npm test` **不要**先 source `api.env`：会泄漏 `MWI_TMD_ROSTER_REPORTERS` / NapCat token，弄挂 API 测试。
- 默认排除不参加的人：TMD `xlsx,LBDYS,sh1ro`（`MWI_GUILD_EXCLUDE_MEMBERS`）；WI 默认不排除。
- 攻击等级 `<110`、缺对应职业装备的人实验室会标不可用。
- **WI 额外门槛（TMD 不变）**：绑定职业主属性 `<125` 不能进模拟（弓/弩=远程，枪/剑/锤=近战，火/水/自=魔法，盾=防御）；必须拥有该职业的 T95 或精炼★T95 武器；两边各只带 2 盾，按防御从高到低留 4 人、去掉其余盾。WI 默认每场上限 48。
- 不解除 `simulationEngine: unavailable`，不用复制人冒充正式方案。

本地跑筛选时：

```bash
set -a
source /Users/xhy/.local/share/mwi-guild-server/config/api.env
set +a
export MWI_GUILD_API_BASE="${MWI_GUILD_API_BASE:-http://127.0.0.1:8787}"
cd /Users/xhy/Downloads/mwi/guild-trial-simulator
# WI：MWI_GUILD_ID=WI（默认上限 48、主属性≥125、T95 武器、每边 2 盾）
```

---

## 2. 技能包：先确认再模拟

技能写在 `packages/optimizer/src/combat-ability-templates.mjs`。  
**虫群用 AOE 包，单体用 ST 包。** 同一对 Boss 再出现时直接复用，不要重新发明。

有疑问（新 Boss、用户改口、模板和口头不一致）时，**先列出拟用技能问用户，得到确认再跑实验室**。不要用木桩 DPS 预筛覆盖位。

### 2.1 覆盖（两边各至少 2 个不同职业座位）

烟爆 / 法力喷泉 / 冰霜爆裂 / 粉尘 / 疫病 / 破甲 / 碎裂 / 致残 / 血刃。

覆盖位按 **主技能等级 ×100 + 武器强化** 从低到高排，弱 DPS 先扛覆盖（疫病射击、烟爆等），不是预模拟。

### 2.2 虫群（AOE，已确认 2026-08-28）

| 职业 | 技能 |
|---|---|
| 弓/弩 DPS | 狂暴 + 精确或狂速 + 贯穿射击 + 箭雨 |
| 弓/弩 减益 ×2 | 狂暴 + 精确 + 疫病射击 + 贯穿射击（最低 DPS 远程） |
| 剑 | 狂暴 + 精确 + 血刃斩 + 致残斩（不要分裂斩） |
| 枪 | 狂暴 + 精确 + 破甲之刺 + 贯心之刺 |
| 锤 | 狂暴 + 狂速 + 精确 + 碎裂冲击 |
| 火多数 | 元素增幅 + 火焰风暴 + 熔岩爆裂 + 火球；**DPS 最低的 2 名火**把熔岩换成烟爆 |
| 水 | 元素增幅 + 法力喷泉 + 冰霜爆裂 + 流水冲击 |
| 自治疗 | 群体治疗术 + 剧毒粉尘 + 自然菌幕 + 缠绕 |
| 盾 | 坚韧 + 尖刺防护 + 惩戒 + 挑衅（光环格另赋守护光环） |

实验室 AOE 技能包只扫：`aoe-precision-rain-smoke2` / `aoe-frenzy-rain-smoke2`（烟爆、疫病锁 2 人）。

### 2.3 变色龙等单体（ST，已确认 2026-08-28）

| 职业 | 技能 |
|---|---|
| 弓/弩 | 狂暴 + 精确 + 疫病/稳定/狂速（实验室扫包） |
| 剑 | 狂暴 + 精确 + 血刃斩 + 致残斩 |
| 枪 | 狂暴 + 精确 + 破甲之刺 + **狂速**（锁死，不要贯心） |
| 火 | 元素增幅 + 精确 + 烟爆灭影 + 火球（固定；`fireOptional` 扫包会打平） |
| 水支援 1–2 | 元素增幅 + 法力喷泉 + 冰霜爆裂 + 流水 |
| 水输出 | 元素增幅 + 精确或冰枪 + 冰霜爆裂 + 流水 |
| 自治疗 | 群体治疗术 + 元素增幅 + **生命吸取** + 缠绕（群疗仍是主治疗）。**DPS 最低的 3 名自然**改带粉尘：群疗 + 增幅 + 剧毒粉尘 + 缠绕 |
| 盾 | 同虫群 |

实验室 ST 技能包：`st-ranged-pestilent-smoke` / `st-ranged-pestilent-flameblast` / `st-ranged-steady-smoke` / `st-ranged-frenzy-pestilent`。

---

## 3. Fixture 与分区策略

### 3.1 生成本周 fixture

可信成员登录后插件会 POST weekly-trials。拉当前周：

```bash
# 不要把 Admin Key 打进终端历史以外的日志
curl -sS -H "Authorization: Bearer $MWI_GUILD_API_ADMIN_KEY" \
  "$MWI_GUILD_API_BASE/api/guilds/TMD/weekly-trials/current" \
  > /tmp/weekly-trials-current.json

node scripts/weekly-combat-fixture.mjs \
  /tmp/weekly-trials-current.json \
  fixtures/monsters/guild-trial-YYYY-MM-DD-<st>-swarm.json
```

也可用仓库备份 `backups/tmd/latest/weekly-trials-current.json`（可能滞后）。

把新路径设成下列脚本的默认 `MWI_GUILD_TRIAL_FIXTURE`（或环境变量）：

- `scripts/run-available-roster-composition-lab.mjs`
- `scripts/ab-insanity-top-dps.mjs`
- `scripts/ab-nature-healer-to-dps.mjs`

改完跑 `npm test`（干净环境）。相关测试：`tests/scripts/weekly-combat-partition.test.mjs`、`tests/scripts/weekly-combat-boss-pair.test.mjs`。

### 3.2 双 Boss 怎么分人

`scripts/weekly-combat-partition.mjs` → `pairStrategyForStKey(stKey)`。

| 单体 Boss | 物理多数 | 魔法多数 | 策略 id |
|---|---|---|---|
| **变色龙** `chameleon` | 变色龙 | 虫群 | `phys-chameleon-magic-swarm` |
| 獾 / 刺猬 / 其他单体 | 虫群 | 单体 | `phys-swarm-magic-<stKey>` |

固定规则（对所有 ST+虫群周）：

- 两边各留 ≥2 个必要覆盖座位（人数不够时按 `coverageReserve` 降到至少 1）。
- 盾平均分配到两边（偶数下标跟 `shieldPrimary`：变色龙周在单体；獾周在虫群）。人数为偶数则各半。
- 每边只有守护光环等级最高的那名盾带守护光环，其余盾第 1 格复活。
- 神秘光环优先到 `mysticAuraSide`。
- 物理再平衡：高等级物理可换到 `physicalRebalanceSide`（变色龙周补单体）。
- 超人数一侧溢到未满一侧（`applyTeamCaps`）。
- 自然奶按 `NATURE_SWARM_RATIOS` = **0.4 / 0.5 / 0.6 / 0.3** 扫四个分区（`heal40` 等）。

变色龙+虫群再出现时**直接复用** `phys-chameleon-magic-swarm`，不要改成獾周那套。

---

## 4. 组合实验室

```bash
node scripts/run-available-roster-composition-lab.mjs 2>&1 \
  | tee .local/composition-lab-YYYY-MM-DD.log
```

输入：全体已绑定可用快照（**不按报名**）。  
输出：`.local/tmd-available-roster-composition-lab.json`（`kind=tmd-available-roster-composition-lab`，`promotable=false`）。

实验室内部顺序：

1. 四个奶比分区并行。
2. 每边选技能包：单体筛 **180s**；虫群 AOE 包筛 **3600s**（短筛分不清层数）。
3. 再扫水支援人数、自然治疗中槽等。
4. 基线：**自然全治疗；非光环默认复活**（疯狂人数在下一步扫，不要在实验室用 `MWI_GUILD_INSANITY_TOP_DPS` 抢跑，除非在复现旧结果）。
5. 筛分按 `jointScore` 取前 **2** 个分区（`MWI_GUILD_FULL_VALIDATE_PARTITIONS`）做 **3600s × 3 seeds** 终验。
6. 终验再按 `jointScore`、其次 `jointDeaths` 选赢家。

计分（实验室与两个 A/B 共用）：

```text
score = 通关层数 × 1_000_000 − 死亡次数 × 1_000 + 末层进度
```

**不要用 180s 单体筛的死亡数做决策**（几乎都是 0）。以 3600s×3 为准。筛分第一名也可能被终验翻盘（例如 2026-08-28：筛分 heal60 更高，终验因变色龙死亡选了 heal40）。

并行默认 `min(8, CPU)`。实验室大约数分钟。

---

## 5. 疯狂人数 A/B

**必须在实验室赢家 JSON 上跑**，基线是全复活。

```bash
node scripts/ab-insanity-top-dps.mjs 2>&1 \
  | tee .local/ab-insanity-YYYY-MM-DD.log
```

- 入围：输出 + 减益，非光环，第 1 格是复活或疯狂。锤技能在比较 DPS 前套固定包（狂暴/狂速/精确/碎裂）。
- 扫描 `0,2,4,…,32` 以及该边可改人数上限。
- 1800s 初筛 → 每边前 3 个 x 做 3600s×3。
- 光环位永不改疯狂。

出最优 x 后**立刻 apply**（会再跑一遍 3-seed 校验并写回 lab JSON）：

```bash
node scripts/ab-insanity-top-dps.mjs --apply=<stKey>:N,swarm:M
```

`<stKey>` 用实验室 JSON 里的 `bossKey`（变色龙周是 `chameleon`，不是内部分区名以外的别名）。  
**禁止**裸 `--apply`（脚本里残留的默认 `badger:16,swarm:20` 只适用于獾周）。

---

## 6. 自然奶转输出 A/B

**必须在疯狂已经 apply 之后**。脚本注释写明：基线 = 当前方案（已含疯狂）。

```bash
node scripts/ab-nature-healer-to-dps.mjs 2>&1 \
  | tee .local/ab-nature-healer-YYYY-MM-DD.log
```

- 按武器强化 → 精炼 → 魔法等级给奶排序，从强到弱改输出。
- 当前转换技能（两边同一套）：元素增幅 / 剧毒粉尘 / 自然菌幕 / 缠绕。  
  注意：变色龙 **治疗**不要菌幕；转成输出后脚本仍用这套 AOE 输出包（含菌幕）。若要改成 ST 输出包（增幅/吸血/缠绕），先改 `combat-nature-healer-to-dps.mjs` 再扫，不要口头换包。
- `MWI_GUILD_MAX_DEATHS` 默认 **0**：1800s 初筛优先 0 死的 x；若该边所有 x 都有死亡，则退回全体再取前三。变色龙经常已经有死亡，这边「最优」很可能是 **x=0（不转）**。
- 扫描 `0 … 该边奶人数`。

```bash
node scripts/ab-nature-healer-to-dps.mjs --apply=<stKey>:X,swarm:Y
```

---

## 7. 发布（A/B 之后只能 skip-sim）

```bash
node scripts/run-and-publish-combat-assignment.mjs --skip-sim
```

- `--skip-sim`：用 `.local/tmd-available-roster-composition-lab.json`，**不再**跑组合实验室。
- 省略 `--skip-sim` 会按全复活基线重排，**丢掉**疯狂和奶转输出。
- 不要对 QQ「战斗模拟」做同样的事（同一条发布脚本，默认会重跑实验室）。
- `--skip-publish` 只渲染不推 helper 仓；`--dry-run` 连 API 入库也跳过。

本地图：`artifacts/test-report/`。  
公网：`https://xiahuaaaa.github.io/mwi-guild-trial-helper/reports/combat-assignment/`。

---

## 8. 代码入口

| 步骤 | 文件 |
|---|---|
| weekly-trials → fixture | `scripts/weekly-combat-fixture.mjs` |
| ST+虫群识别（内部键仍是 chameleon） | `scripts/weekly-combat-boss-pair.mjs` |
| 物理/魔法分区、奶比、覆盖预留 | `scripts/weekly-combat-partition.mjs` |
| 技能模板 | `packages/optimizer/src/combat-ability-templates.mjs` |
| 组合实验室 | `scripts/run-available-roster-composition-lab.mjs` |
| 疯狂人数 | `scripts/ab-insanity-top-dps.mjs` + `packages/optimizer/src/combat-insanity-top-dps.mjs` |
| 变色龙自然治疗（生命吸取 vs 3 粉尘） | `scripts/ab-chameleon-st-nature-healers.mjs` |
| 渲染+发布 | `scripts/run-and-publish-combat-assignment.mjs` |

常用环境变量：

| 变量 | 默认 | 含义 |
|---|---|---|
| `MWI_GUILD_TRIAL_FIXTURE` | 当前周 json | monster fixture |
| `MWI_GUILD_TEAM_CAP` | TMD 52 / WI 48 | 每场人数上限 |
| `MWI_GUILD_EXCLUDE_MEMBERS` | `xlsx,LBDYS,sh1ro` | 手动排除 |
| `MWI_GUILD_SCREEN_DURATION_SECONDS` | 180 | 单体技能包筛 |
| `MWI_GUILD_AOE_SCREEN_DURATION_SECONDS` | 实验室 AOE 包=3600；A/B=1800 | 短筛时长 |
| `MWI_GUILD_FINAL_DURATION_SECONDS` | 3600 | 终验 |
| `MWI_GUILD_FULL_VALIDATE_PARTITIONS` | 2 | 实验室终验几个奶比 |
| `MWI_GUILD_SIM_WORKERS` | `min(8, CPU)` | 并行 |
| `MWI_GUILD_MAX_DEATHS` | 0 | 奶转输出：初筛可接受死亡 |

---

## 9. 实例：2026-08-28 变色龙 + 虫群

生活试炼（本流程不覆盖）：奶酪锻造 2/26、挤奶 3/26、强化 1/26、缝纫 2/26。

1. 用户确认 §2 技能包后开实验室。
2. 可用 101 / 不可用 9。赢家 **`phys-chameleon-magic-swarm-heal40`**。
3. 变色龙 52：14 层，末层均 28.5%，死亡 7–30，包 `st-ranged-pestilent-flameblast`（与 smoke 包打平，因为 ST 火固定烟爆）。
4. 虫群 49：11 层，末层均 80.2%，死亡 0，包 `aoe-precision-rain-smoke2`。
5. 疯狂终验：**变色龙 32 / 虫群 35**。变色龙仍 14 层但末层 56.5%（死亡均 28）；虫群升到 12 层、0 死。
6. 自然奶转输出：变色龙 1（kogge）/ 虫群 3。变色龙末层 64.1%，死亡 26–32。
7. 变色龙自然再改：多数 **群疗/增幅/生命吸取/缠绕**，低 DPS 3 人（rain2way / xunyi / nytpdy）留粉尘；kogge 改回治疗。死亡 **16.7**（15/20/15），层数与末层几乎不变。以此为准发布。
8. 发布必须 `--skip-sim`。
