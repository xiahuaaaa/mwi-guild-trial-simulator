# 公会战斗试炼校准插件 — 实施计划

> 状态：Phase 0A 本周公会战斗试炼实况已采完；协议未冻结，待 0B fixture + review  
> 更新时间：2026-08-04（Asia/Shanghai）  
> 工作区：`/Users/xhy/Downloads/mwi/guild-trial-simulator`

本文档描述独立于现有「成员资料上传插件」的 **公会战斗试炼校准插件** 的设计与实施步骤。批准前不编写实现代码；批准后按 **Phase 0 → Phase 1–4** 顺序执行，并另建 `GUILD_COMBAT_TRIAL_CALIBRATOR.md` 作为安装/使用/导出说明。

**修订记录**：

- 2026-08-03：吸收 `GUILD_COMBAT_TRIAL_CALIBRATOR_PLAN_REVIEW.md`（见 §14）
- 2026-08-04：实况确认试炼卡片 `Lv.X` = 已完成层，实际房间 = `X+10`（与生活相同）；详见 `TRIAL_RULES.md` / `PROTOCOL.md` §0
- 2026-08-04：吸收第二轮 review — Phase 0 门禁、去重协议、`pMap` 人数、`new_guild_battle` 基线、`completeFromTrialStart` 判据（见 §15）
- 2026-08-04：本周试炼结束态核对 — 獾 `Lv.240 / 3392点 / 52人`、刺猬 `Lv.210 / 2756点 / 47人` 与 `combatBase×1.06` 精确吻合；`players[]` 非全员花名册；生活卡片点相对公式仍偏低 14～16；详见 `PROTOCOL.md` 结束态表与 `TRIAL_RULES.md` 点数节

---

## 1. 目标

为 TMD 公会战斗试炼提供 **只读、本地、匿名** 的团队推进数据采集工具，用于：

- 校准模拟器对 Boss HP、换层、双怪獾、3600 秒预算等规则的假设；
- 在真实试炼中导出可回放的匿名 JSON，供离线分析与 fixture 固化；
- **不**上传成员配装、**不**推断个人 DPS、**不**接入中央 API 或 QQ 机器人。

### 1.1 成功标准

| 项 | 标准 |
|----|------|
| 协议门禁 | **Phase 0** 完成并冻结 fixture 后，才实现 Core 与回放测试（§10） |
| 隔离 | 零修改、零 import、零依赖 `member-candidate-loadout-exporter.user.js` |
| 单源 core | Node 测试与 Tampermonkey 安装产物执行 **同一份** 聚合实现（§4.1） |
| 网络 | 无 `fetch` / `XHR` / `WebSocket.send` / 自动上传 |
| 数据 | 导出匿名 JSON，含层统计 + 可信度字段；不完整时明确标记；`calibrationDps` 仅完整记录产出 |
| 共存 | 与成员上传插件及其他观察脚本任意加载顺序共存；同一原始 frame 只归约一次（§5.3） |
| 持久化 | 一小时试炼可经页面刷新恢复裁剪后状态（§5.4） |
| 真页验收 | 至少 **一场从 Lv.100 开始到试炼结束的完整试炼** 与导出 JSON 对齐（§9） |
| 范围 | 不改 API/DB/部署、`simulationEngine` 状态；不发布 Greasy Fork |

---

## 2. 背景与参考

### 2.1 已读文档

- `/Users/xhy/Downloads/mwi/AGENTS.md`
- `guild-trial-simulator/CLAUDE_CODE_HANDOFF.md`
- `knowledge-base/12-debugging.md`
- `guild-trial-simulator/docs/GUILD_COMBAT_TRIAL_CALIBRATOR_PLAN_REVIEW.md`

### 2.2 战斗试炼规则（摘要）

来源：`TRIAL_RULES.md`、`CLAUDE_CODE_HANDOFF.md` §4.3。

- 全场共享 **3600 秒** 活跃预算（非每层 1 小时）。
- 首层 Lv.100，每层 +10，最高 Lv.300。
- 默认每层 1 只 Boss；**试炼獾** 每层 2 只同级獾，均死后换层。
- 每名参与者使每只怪物 HP +1%：`scaledHp = floor(baseHp × (1 + n × 0.01))`。
- 换层时所有参与者 HP/MP 补满。

### 2.3 现有成员上传插件观察模式

`userscripts/member-candidate-loadout-exporter.user.js` 采用 **只读** 三层观察（`@run-at document-start`）：

1. **沙箱侧** `observePageMessages(page, onPacket)`：包装 `MessageEvent.prototype.data` getter，原样返回 payload。
2. **页面注入** `pageBridgeMain`：在真实 page context 再次包装 `MessageEvent.data`，并通过 `postMessage` 转发。
3. **WebSocket 子类** `AduduObservedWebSocket extends NativeWebSocket`：监听 `message` 事件，不调用 `send`。

**校准插件差异**：链式 hook、独立标志、跨路径 **原始 `data` 字符串 hash 去重**（§5.3）、MWI WS URL 过滤。

### 2.4 公会战斗 WS 事件（Phase 0 前为假设）

以下命名与字段 **在 Phase 0 完成前不得写入 Core 或冻结 fixture**：

| 假设事件 | Phase 0 须确认 |
|----------|----------------|
| `init_character_data.guildCombatBattle` | 是否与进行中试炼同构；是否含完整怪物 HP |
| `new_guild_battle` | 是层切换标记还是 HP 快照；怪物字段名与完整性 |
| `guild_battle_updated` | `mMap` / `pMap` 语义；是否有 server `seq` |
| `guild_updated` | 试炼层数、计时、结束、`participantCount` 权威字段 |

常规战斗（非公会）参考：`new_battle` / `battle_updated` 的 `mMap.cHP` / `mHP` 模式。

---

## 3. 约束与边界

### 3.1 必须遵守

- 被动接收 MWI WebSocket 消息；禁止主动发包或上传。
- 只保留经白名单裁剪的公会试炼字段。
- 不读取或导出：Cookie、Token、登录凭据、完整成员快照、`pMap` 槽位内容、无关 WS 字段。
- **不得** 用 `pMap` key 数量作为 `participantCount` 或触发人数冲突（§7.1）。
- 不输出或推断 **个人 DPS**。
- `totalEffectiveDamage` 只由同一怪物基线、连续两次已知 `cHP` 观测的差值累计（§6.3）。
- 怪物 HP 基线 **仅** 在观测到完整 current + max HP 时建立（§6.2.2）。
- 数据不完整时 `dataComplete: false`，`calibrationDps: null`。

### 3.2 明确不做

- 修改 `member-candidate-loadout-exporter.user.js` 及其测试。
- 新增 API 路由、SQLite 表、QQ 命令、生产部署。
- 在 Phase 0 完成前编写 Core、userscript 聚合逻辑或「猜测协议」的 fixture。
- 解除 `simulationEngine: unavailable`。
- 批准后默认不 commit/push（除非用户另行要求）。

---

## 4. 文件结构（拟新增）

```text
guild-trial-simulator/
├── docs/
│   ├── GUILD_COMBAT_TRIAL_CALIBRATOR_PLAN.md
│   ├── GUILD_COMBAT_TRIAL_CALIBRATOR_PLAN_REVIEW.md
│   ├── GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md      # Phase 0 产出：已确认字段映射
│   └── GUILD_COMBAT_TRIAL_CALIBRATOR.md               # Phase 4：安装/使用/导出
├── fixtures/
│   └── guild-combat-trial-ws/                         # Phase 0 冻结后入库（脱敏）
│       ├── README.md                                  # 采集来源、日期、试炼类型
│       ├── manifest.json                              # 帧列表 + 协议版本
│       └── frames/*.json                              # 单帧或短序列（已裁剪）
├── scripts/
│   ├── capture-guild-combat-trial-frames.mjs          # Phase 0：真页只读采集助手
│   └── build-guild-combat-trial-calibrator.mjs        # Phase 2+：单文件 userscript 构建
├── userscripts/
│   ├── guild-combat-trial-calibrator-core.js          # Phase 2：聚合逻辑（单一真源）
│   ├── guild-combat-trial-calibrator.user.js          # 构建产物（generated）
│   └── guild-combat-trial-calibrator.user.src.js      # Phase 3：观察壳 + UI
└── tests/userscripts/
    ├── guild-combat-trial-calibrator-core.test.mjs    # Phase 2：仅回放已冻结 fixture
    ├── guild-combat-trial-calibrator-source.test.mjs
    └── guild-combat-trial-calibrator-build.test.mjs
```

### 4.1 单一真源：core 进入可安装 userscript

Tampermonkey **只安装** `.user.js`。`guild-combat-trial-calibrator-core.js` 为聚合 **唯一源**；`build-guild-combat-trial-calibrator.mjs` 内联生成 `.user.js`；构建产物带 `@core-sha256`。详见 Phase 2。

---

## 5. 架构

```text
MWI 游戏 WebSocket（URL 白名单）
    │
    ├─ 路径 A：沙箱 MessageEvent.data getter（链式）
    ├─ 路径 B：页面 getter → postMessage（新 MessageEvent，无共享 WeakMap）
    └─ 路径 C：WebSocket message listener → postMessage
            │
            ▼
    对原始 event.data 字符串计算 frameHash（§5.3）
    + trialId 作用域 + 短窗口去重
            │
            ▼
    白名单裁剪 → reduceGuildCombatPacket（core）
            │
            ├─ 节流持久化（§5.4）
            ├─ UI
            └─ 手动导出匿名 JSON
```

### 5.1 独立命名空间（与成员插件隔离）

| 维度 | 成员上传插件 | 校准插件 |
|------|-------------|----------|
| 全局标志 | `__ADUDU_GUILD_TRIAL_*` | `__MWI_GUILD_COMBAT_CALIBRATOR_*` |
| DOM 根 | `#adudu-guild-sync` | `#mwi-guild-combat-calibrator` |
| postMessage channel | `adudu-mwi-guild-snapshot-v1` | `mwi-guild-combat-calibrator-v1` |
| storage | 成员专用 | `mwiGuildCombatCalibrator.*` |
| 网络 | API 上传 | **无** |

### 5.2 观察层实现要点

- `@run-at document-start`；`@grant` 仅 UI 与活动状态持久化；**无** `@connect`。
- 链式 `MessageEvent.data` getter；MWI WebSocket URL 白名单过滤。
- 消息字符串预筛：`guildCombatBattle`、`new_guild_battle`、`guild_battle_updated`、试炼相关 `guild_updated`。
- 断线：`reconnectCount++`；恢复逻辑见 §6.5。

### 5.3 唯一投递与跨路径去重（修订）

**问题（已承认）**：`postMessage` 会创建新的 `MessageEvent`；沙箱与页面 **不能** 共享 `WeakMap<MessageEvent, frameId>`。每次 `new_guild_battle` 分配新 `sessionNonce` 会让同一原始帧在去重前获得不同 key。

**协议**：

1. **统一 frameHash**：三条路径均在拿到 **原始 WebSocket 文本** `rawData`（`typeof === "string"`）后，用 **同一函数** 计算：
   ```text
   frameHash = SHA-256(rawData) 的前 16 字节 hex（或等效稳定 hash）
   ```
   - 沙箱 getter：`originalGet.call(this)` 的返回值；
   - 页面 getter：同上；
   - WS listener：`event.data` 字符串；
   - postMessage 转发时携带 `rawData` 或预计算的 `frameHash`，**不**依赖新 `MessageEvent` 实例。

2. **trialId 与 stageId 分离**：
   - **`trialId`**：一场试炼实例的唯一 ID。在 **试炼开始** 时创建 **一次**（见 §6.5 判据），整场不变；刷新/重连恢复同一试炼时复用持久化中的 `trialId`。
   - **`stageId`**：当前层/遭遇。每次可靠换层（`new_guild_battle` 或 §6.2.1 的 mHP 不连续 + level 证据）递增；**不** 用于去重键的全局轮换。

3. **去重键**：
   ```text
   dedupeKey = `${trialId}:${frameHash}`
   ```
   - 若 Phase 0 确认 payload 含 **稳定 server 序号** `seq`，可升级为
     `${trialId}:${packetType}:${seq}`（优先于 content hash）。

4. **短窗口去重（无 server seq 时）**：
   - 维护 `Map<dedupeKey, lastSeenAt>`；
   - 在窗口 `DEDUPE_WINDOW_MS`（默认 **500ms**，可配置）内重复 `dedupeKey` → 丢弃（视为三路径重复投递）；
   - 窗口外相同 `frameHash` → **允许再次处理**（合法的内容相同但时间不同的帧，如同步心跳或重发）；
   - **禁止** 整场试炼对相同 hash 永久丢弃。

5. **core 假定**：进入 `reduceGuildCombatPacket` 的输入已由观察层去重；core 不再做路径级去重。

### 5.4 活动会话持久化

持久化 **裁剪后** session（非原始 WS）；节流 + `pagehide` flush；恢复时校验 `schemaVersion`、插件版本、`trialId`、试炼身份。见 §6.5 对 `completeFromTrialStart` 的影响。

---

## 6. 聚合核心

> **门禁**：§6 逻辑在 Phase 0 协议文档与 fixture 冻结后方可实现。字段名以 `GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md` 为准。

### 6.1 API 形状（拟）

```javascript
createCalibratorSession(options?) → session
reduceGuildCombatPacket(session, packet, meta?) → session
serializeCalibratorSession(session) → PersistedSnapshot
restoreCalibratorSession(snapshot) → { session, warnings[] }
buildCalibratorExport(session) → ExportPayload
resetCalibratorSession(session) → session
```

### 6.2 状态机

| 事件 | 行为 |
|------|------|
| `new_guild_battle` | 见 **§6.2.2**（不默认写入怪物 HP） |
| `init_character_data` + `guildCombatBattle` | 若含完整怪物 HP → 可建基线；否则 incomplete；见 §6.5 |
| `guild_battle_updated` | 处理 `mMap`；**忽略** `pMap` 内容；不读 `pMap` key 数作人数 |
| `guild_updated` | 试炼元数据、`participantCount`（仅已确认来源）、结束标记 |
| Boss 回血 | `cHP > prevHp`：不计入有效伤害 |
| `mHP` 不连续 | §6.2.1：不跨基线计伤害；`stageId++` 若有 level 证据 |
| 双怪獾 | 多 `mMap` index；层通关 = 全部 `remainingHp === 0` |
| 缺基线 | §6.3 |
| 重复帧 | 观察层去重（§5.3） |

#### 6.2.1 `mHP` / `maxHp` 不连续

`mHP !== baselineMaxHp` 时：不计 HP delta；重置基线；有 level/stage 升高 → 关闭层并 `stageId++`；否则 `monster-max-hp-discontinuity`。

#### 6.2.2 `new_guild_battle` 与怪物基线（修订）

**不得假设** `new_guild_battle` 一定携带完整怪物 HP 快照。

| 条件 | 行为 |
|------|------|
| payload 含 **每只** 怪物的 **current HP + max HP**（字段名以 Phase 0 为准） | 建立该层怪物基线；`stageId++`；结算上一层 |
| payload **仅** 表示层切换/遭遇开始，**无** 完整 HP | **仅** 作层切换标记：`stageId++`、开启空层槽位、`incompleteReasons` 含 `awaiting-monster-hp-snapshot`；**不** 写入 `initialHp`/`maxHp` |
| 后续 `guild_battle_updated` / snapshot 含完整 HP | 在该层 **首次** 建立基线；此前收到的 update 不计伤害 |

层在获得完整基线之前：`unobservedDamage` 风险、`dataComplete` 不可能为 true。

### 6.3 算法口径

#### 团队有效伤害

仅当：有 `prevHp`、同槽位 `baselineMaxHp` 未变、连续观测时，累计 `max(0, prevHp - cHP)`。禁止未知/下界并入 `totalEffectiveDamage`。

#### 缺基线

`missingBaselineUpdates`、`missingBaselineMonsters`、`unobservedDamage`；可选 `minimumUnobservedDamage`（下界，不并入 total）。

#### 校准 DPS

```text
dataComplete === true  → calibrationDps = totalEffectiveDamage / 3600
dataComplete === false → calibrationDps = null
```

不完整时输出 `observedEffectiveDamage`、`observedDurationMs`、可选 `minimumTrialDamage`（下界）。

### 6.4 可信度字段

```json
"confidence": {
  "baselineSource": "new_guild_battle | init_character_data | guild_battle_updated | mixed | unknown",
  "trialStartProvenance": "none | weak | verified",
  "reconnectCount": 0,
  "missingBaselineUpdates": 0,
  "missingBaselineMonsters": [],
  "unobservedDamage": false,
  "receivedUpdateCount": 0,
  "completeFromTrialStart": false,
  "completeUntilTrialEnd": false,
  "dataComplete": false,
  "incompleteReasons": [],
  "timingApproximate": false,
  "warnings": []
}
```

```text
dataComplete =
  completeFromTrialStart
  && completeUntilTrialEnd
  && missingBaselineUpdates === 0
  && unobservedDamage === false
  && trialStartProvenance === "verified"
  && !hasBlockingIncompleteReason(...)
```

### 6.5 `completeFromTrialStart` 可执行判据（修订）

**定义**：插件能证明在 **本场试炼 Lv.100 首层、首只怪物满 HP 基线建立之后**，连续观测直至导出/结束，且中间无不可解释的数据缺口。

#### `trialStartProvenance` 三级

| 值 | 含义 |
|----|------|
| `none` | 中途安装、刷新后无法核对起点、或首层基线来自不完整快照 |
| `weak` | 有 `guild_updated` 等元数据暗示 Lv.100 起点，但 **未** 观测到 Lv.100 完整怪物基线建立过程 |
| `verified` | 同时满足下方 **verified 条件** |

#### `verified` 条件（须全部满足）

1. **试炼身份锁定**：`trialId` 已创建且与持久化/元数据一致（`trialHrid` + 公会周/实例 id，字段以 Phase 0 为准）。
2. **首层等级**：观测到的第一个完整怪物基线所在层 `level === 100`（或 Phase 0 确认的等价字段）。
3. **首层满血基线**：该层首帧完整 HP 快照中，每只怪物 `currentHp === maxHp`（换层后满血规则在 Lv.100 首层同样适用）。
4. **起点事件序列**（其一，以 Phase 0 冻结为准）：
   - **序列 A**：`new_guild_battle`(Lv.100, 完整 HP) → 后续 updates；或
   - **序列 B**：试炼开始前插件已运行 + `new_guild_battle`(Lv.100, 完整 HP) 为 **本场第一个** guild 战斗帧；或
   - **序列 C**：`init_character_data.guildCombatBattle` 含 Lv.100 完整 HP，且 `confidence` 无 `joined-mid-trial`，且该 init 为插件启用后 **本场试炼的第一条** 战斗相关快照。
5. **无阻断缺口**：自 verified 起点至当前，无未解决的 `awaiting-monster-hp-snapshot`、`monster-max-hp-discontinuity`（除非已在同层补全基线后连续观测）。

#### `completeFromTrialStart` 赋值

```text
completeFromTrialStart = (trialStartProvenance === "verified")
```

**以下情况强制 `trialStartProvenance !== "verified"`**：

- 插件在试炼已开始后 **首次安装/启用**；
- **页面刷新** 后恢复缓存，但缓存中无 `trialStartProvenance: "verified"` 标记；
- **断线重连** 后首包为进行中快照且无法与刷新前 verified 状态链接；
- 第一条战斗相关帧层等级 **> 100**；
- 首层基线来自 **不完整** `new_guild_battle`（§6.2.2）；
- 收到 **重复** `new_guild_battle` 导致层边界不确定（须测试覆盖）。

#### `completeUntilTrialEnd`

须观测到 Phase 0 确认的 **试炼结束** 信号（如 `guild_updated` 结束标志或等价），且结束时当前层已闭合或标记为失败/超时。

#### 测试要求（Phase 2 fixture）

| 场景 | 期望 |
|------|------|
| 刷新后续录 | `completeFromTrialStart === false`（除非缓存携带 verified 且链完整） |
| 断线重连 | 不自动升为 verified；`reconnectCount++` |
| 半途安装 | `trialStartProvenance === "none"` |
| 重复 `new_guild_battle` | 不切双层；incomplete 或 stage 边界明确 |
| 完整一场（冻结 fixture 全长） | `verified` + `completeUntilTrialEnd` → `dataComplete` 可能为 true |

---

## 7. 导出数据契约（匿名 JSON）

### 7.1 顶层字段（节选）

| 字段 | 说明 |
|------|------|
| `participantCount` | 仅来自 **已确认** 元数据来源 |
| `participantCountSource` | 见下表 |
| `pMapDiagnostic` | **可选弱诊断**：如「本帧见到的 pMap key 数」；**不**作人数权威；**不**触发冲突 |
| `participantCountConflict` | 仅当两个 **权威来源** 不一致（见下） |
| `calibrationDps` | 仅 `dataComplete` 时非 null |
| `confidence.trialStartProvenance` | §6.5 |

**`participantCountSource` 枚举（修订）**：

| 值 | 说明 |
|----|------|
| `guild-trial-metadata` | `guild_updated` / 试炼元数据中的报名或上限字段（Phase 0 确认） |
| `battle-snapshot-players` | `new_guild_battle` 内 **完整** 玩家数组长度（若 Phase 0 证明该数组为全场 roster） |
| `unknown` | 未确认 |

**已删除**：~~`pmap-slot-count`~~ — `pMap` 更可能是 **增量更新帧**，不是完整 roster；不得作为 `participantCount` 来源，不得与 `participantCount` 比较触发 `participantCountConflict`。

**`pMapDiagnostic`（可选）**：

```json
"pMapDiagnostic": {
  "lastFrameKeyCount": 3,
  "note": "incremental-update-only-not-roster"
}
```

仅写入 `confidence.warnings` 作弱提示，不参与 `dataComplete` 判定。

**冲突规则**：仅当两个 **非 unknown 的权威来源**（如 metadata vs battle-snapshot-players）均存在且数值不同时，设 `participantCountConflict: true`。

### 7.2–7.3

层明细、排除项同前版；`layers[].monsters[]` 含 `baselineEstablished: boolean`。

---

## 8. 测试计划

### 8.0 门禁

- Phase 0 前：**禁止** 提交 `guild-combat-trial-calibrator-core.js` 及依赖猜测协议的测试。
- Phase 2 起：core 测试 **只** 回放 `fixtures/guild-combat-trial-ws/` 中 **已冻结** 帧；新增场景须先补采集再改 fixture。

### 8.1 Core 回放测试（Phase 2+）

基于冻结 fixture，覆盖：

| # | 场景 |
|---|------|
| 1–3 | 单 Boss、双怪獾、回血 |
| 4 | mHP 不连续 / 无 new_guild_battle 换层 |
| 5–6 | 断线、缺基线 |
| 7 | 空 `pMap`（伤害仍只靠 mMap） |
| 8 | 同 rawData 三路径只归约一次（观察层单测） |
| 9 | calibrationDps 门控 |
| 10 | 持久化 round-trip |
| 11 | **`new_guild_battle` 无 HP：仅 stage 标记 + incomplete** |
| 12 | **completeFromTrialStart：刷新/半途/重复开层/完整一场** |
| 13 | 短窗口去重：500ms 内重复 hash 丢弃、窗外相同 hash 保留 |

### 8.2 Source / build 测试（Phase 3+）

边界、构建 hash、MWI WS 过滤、三路径 `rawData` hash 一致性。

### 8.3 验收命令（Phase 4）

```bash
cd guild-trial-simulator
node scripts/build-guild-combat-trial-calibrator.mjs
node --test tests/userscripts/guild-combat-trial-calibrator-*.test.mjs
npm test
```

---

## 9. 真实页面验证

### 9.1 Phase 0：采集与协议冻结（**必须先于 Core**）

1. 使用 `scripts/capture-guild-combat-trial-frames.mjs` 或等价 **只读** 探针（可临时 userscript，**不**算正式插件）；按 `knowledge-base/12-debugging.md` 连接 Edge/CDP。
2. 采集 **至少一场完整战斗试炼**（从可在 WS 上识别的试炼起点到结束），优先獾双怪场。
3. **脱敏**：剔除角色名、ID、Token、`pMap` 槽位内容；保留类型、层数、HP 数字、时间序。
4. 产出 `GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md`：三类事件结构表、`trialId`/`stageId` 字段、`participantCount` 权威来源、结束信号、`seq` 有无。
5. 审核通过后，将帧写入 `fixtures/guild-combat-trial-ws/` 并 `manifest.json` 标记 `protocolVersion`。
6. **冻结门禁**：协议文档 + fixture 合并 review 通过 → 才进入 Phase 2。

### 9.2 Phase 4：正式插件端到端验收

1. 构建安装正式 `.user.js`；与成员上传插件同页共存。
2. **完整一场试炼**：从 Lv.100 起点（插件已启用）到结束，导出 JSON。
3. 验证：`verified` 路径、`calibrationDps` 仅完整场非 null、层 HP 与游戏一致。
4. 子场景：刷新后续录（`completeFromTrialStart` 为 false）、半途安装、断线重连。
5. 与 Phase 0 fixture 交叉校验字段映射。

---

## 10. 实施阶段（批准后顺序）

```text
Phase 0  真页采集 → 脱敏 → 协议文档 → 冻结 fixture     [门禁]
   ↓
Phase 1  观察层脚手架（采集助手或 .user.src 仅日志/导出原始帧，无聚合）
   ↓
Phase 2  Core + 回放测试（仅冻结 fixture）+ build 脚本
   ↓
Phase 3  完整 userscript（去重 §5.3、持久化、UI、匿名导出）
   ↓
Phase 4  全量测试、完整试炼 E2E、GUILD_COMBAT_TRIAL_CALIBRATOR.md、交付 review
```

**禁止**：在 Phase 0 冻结前写 `reduceGuildCombatPacket` 业务逻辑或「臆造」`guild_battle_updated` 字段的 fixture。

---

## 11. 已确认决策（累计）

| # | 决定 |
|---|------|
| 1 | Phase 0 先于 Core；fixture 冻结后实现 |
| 2 | 三路径对 **原始 `rawData` 字符串** 同一 hash 去重；trialId 试炼一次创建；stageId 分层 |
| 3 | 无 server seq 时 **500ms 短窗口** 去重，非永久 hash 黑名单 |
| 4 | `new_guild_battle` 无完整 HP 时仅层标记，不建基线 |
| 5 | 不用 `pMap` 作 participantCount；`pMapDiagnostic` 仅弱诊断 |
| 6 | `completeFromTrialStart` = `trialStartProvenance === "verified"`（§6.5） |
| 7 | `calibrationDps` 仅 `dataComplete`；core 构建内联；其余同第一轮 review |

---

## 12. Review 检查清单（实施后）

- [ ] Phase 0 协议文档 + 冻结 fixture 已存在且先于 Core
- [ ] 三路径 `rawData` hash 去重；trialId/stageId 分离；短窗口去重
- [ ] `new_guild_battle` 无 HP 时不伪造基线
- [ ] 无 `pmap-slot-count`；无 pMap 人数冲突
- [ ] `completeFromTrialStart` 判据可测；含完整一场 + 刷新/半途/重复开层
- [ ] 完整试炼真页 E2E 通过
- [ ] 成员插件零修改；无 API/DB/部署变更
- [ ] `npm test` 全绿

---

## 13. 第一轮 plan review 处理索引

（P1-1–P1-4、P2-1–P2-2、数据契约 — 见 §4.1、§5.4、§6.2.1、§6.3–6.4、§7）

---

## 14. 第二轮 review 处理索引

| 意见 | 裁定 | 处理 |
|------|------|------|
| 实现顺序倒置 | **成立** | §10 Phase 0–4；§8.0 门禁；§9.1 先于 Core |
| 不能用 pMap 作人数 | **成立** | §7.1 删除 pmap-slot-count；`pMapDiagnostic` 弱诊断 only |
| 三路径去重不成立 | **成立** | §5.3 重写：rawData hash、trialId/stageId、短窗口 |
| new_guild_battle 基线未验证 | **成立** | §6.2.2 完整 HP 才建基线；否则 awaiting snapshot |
| completeFromTrialStart 缺判据 | **成立** | §6.5 verified 条件 + 测试表 §8.1 #12 |

---

## 附录 A：成员插件观察对照

`member-candidate-loadout-exporter.user.js` L796–1043；校准插件链式 hook + §5.3 去重。

## 附录 B：试炼规则

`TRIAL_RULES.md`；`CLAUDE_CODE_HANDOFF.md` §4.3、§16。
