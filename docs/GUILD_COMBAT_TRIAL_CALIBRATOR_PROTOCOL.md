# Guild Combat Trial Calibrator — Protocol (draft)

> **Status:** Phase 0A live pass complete for this week’s combat trials — not frozen.  
> **Whitelist version:** `draft-0` / projector `provisional-unreviewed`  
> **Last updated:** 2026-08-04（Asia/Shanghai）

Phase 0A **memory-only** schema discovery is required before any Phase 0B write-to-disk capture of raw frames. Do not implement Core until sample set A–D is captured, desensitized, and reviewed.

### End-of-trial UI check (2026-08-04, TMD, Builders Hall +6%)

| Trial | Card | Points | Roster | Formula check |
|-------|------|--------|--------|---------------|
| 试炼獾 | `Lv.240` 已完成 | `3,392` | `52/52` | `combatBase` clears 100…240 = `3200`；`3200×1.06=3392` ✓ |
| 试炼刺猬 | `Lv.210` 已完成 | `2,756` | `47/52` | clears 100…210 = `2600`；`2600×1.06=2756` ✓ |

刺猬中途私聊截图（管理员 QQ → 机器人 QQ，2026-08-04）HP/MP 阶梯，`n=47`、`level100Pool=440000`：

| 房间 Lv | maxHP | maxMP | 公式 |
|---------|-------|-------|------|
| 180 | `1117200` | `760000` | `floor(760000×1.47)` / unscaled pool ✓ |
| 190 | `1176000` | `800000` | ✓ |
| 200 | `1234800` | `840000` | ✓ |
| 210 | `1293600` | `880000` | ✓ |
| 220 | `1352400` | `920000` | 进层满血可见；**未通关**（结束卡片仍停在 210）✓ |

本周公会点数 UI `11,070` = 四场生活卡片点 + 两场战斗卡片点（含生活侧已知的 −14～−16 展示偏差）。

Probe session totals (memory): `new_guild_battle` ×16，`guild_battle_updated` ×~131k，`guild_updated` ×164；`players[]` max index 11（非全员花名册）。

---

## 0. Guild card level vs combat room (CONFIRMED 2026-08-04)

Same rule as life trials:

| UI | Meaning |
|----|---------|
| Trial card `Lv.X` | **Highest completed** floor |
| Actual combat room | `X + 10` |
| HP / MP / ability formulas | Use **room level**, not card `X` |

Evidence (试炼獾, TMD, 52/52, Builders Hall +6%):

| Observation | Value |
|-------------|-------|
| Card | `Lv.160，1,696 点`，已报名 52/52 |
| Monster tooltip | `试炼獾 - Lv.170` |
| Live bars | HP `*/820800`，MP `*/540000` |
| Pool check | `floor(330000 × (170+10)/110) = 540000` |
| HP scale | `floor(540000 × 1.52) = 820800`（UI「820K」） |
| Points check | `combatBase` through clears 100…160 = `1600`；`1600 × 1.06 = 1696` |

Earlier misread (treat card level as formula level, or `formula = UI − 10`) is **withdrawn**.

At trial start with nothing cleared, card may show `Lv.100` while room is also `100`. After first clear, card stays on completed `100` while room becomes `110` (e.g. early bars `547200` / MP `360000` with card still `Lv.100`).

---

## 1. Scope

**In scope events (live-seen):**

| Event | Status |
|-------|--------|
| `init_character_data.guildCombatBattle` | `unknown`（本场未观察到嵌套快照） |
| `new_guild_battle` | **seen** — layer open |
| `guild_battle_updated` | **seen** — HP ticks via `mMap` |
| `guild_updated` (trial-related subset) | **seen** — buildings / weekly set / points |

---

## 2. Event envelopes

### 2.1 `new_guild_battle` (provisional)

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `type` | string | confirmed | `new_guild_battle` |
| `battleId` | number | seen | e.g. `1` |
| `combatStartTime` | string | seen | ISO-like |
| `tier` | number | seen | 1, 2, 3… per layer open |
| `wave` | number | seen | often `1` |
| `players` | array | seen | **~12 detailed units only** — not full roster |
| `monsters` | array | seen | Badger: length 2 |
| `monsters[i].currentHitpoints` / `maxHitpoints` | number | seen | Scaled HP |
| `monsters[i].currentManapoints` / `maxManapoints` | number | seen | Unscaled pool |
| `monsters[i].hrid` | string | seen | redact in exports |

### 2.2 `guild_battle_updated` (provisional)

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `type` | string | confirmed | `guild_battle_updated` |
| `battleId` | number | seen | |
| `tier` | number | seen | |
| `mMap` | object | seen | Keys `0`, `1`, … |
| `mMap.N.cHP` / `mHP` | number | seen | Damage = drops in `cHP` vs prior; never cross `mHP` baseline |
| `mMap.N.cMP` / `mMP` | number | seen | |
| `pMap` | object | seen | **Values never exported**; not for `participantCount` |

### 2.3 `guild_updated` (trial-related)

| Field | Status | Notes |
|-------|--------|-------|
| `guildWeeklyTrialSet` | seen | combat/skill hrids |
| `guildBuildingLevelMap` | seen | builders_hall 2→3 observed |
| `guild.guildPoints` / `lifetimeGuildPoints` | seen | |
| `guild.currentTrialsData` | seen | string blob — parse TBD |
| Participant count field | **not found** in battle packets | Use registration UI / future proven field |

---

## 3. Monster HP / MP

| Concept | Field | Status |
|---------|-------|--------|
| Current HP (updates) | `mMap.N.cHP` | provisional |
| Max HP (updates) | `mMap.N.mHP` | provisional |
| Open-layer HP | `monsters[i].currentHitpoints` / `maxHitpoints` | provisional |
| Dual badger | `mMap.0` + `mMap.1` | confirmed this week |
| HP formula | `floor(floor(level100Pool×(roomLevel+10)/110)×(1+n×0.01))` | confirmed vs 52-player badger |
| MP formula | same unscaled pool; **no** participant multiplier | confirmed |

Badger `level100Pool` (fixture): HP/MP `330000`.

---

## 4. Stage / level identifiers

| Field | Status | Notes |
|-------|--------|-------|
| Guild card `Lv.X` | confirmed semantic | Completed floor only（§0） |
| Room level | confirmed | `X+10` while in progress |
| `tier` on battle events | seen | Increments with layers; map to room level TBD |
| Server `seq` | unknown | |

---

## 5. Participant count and HP scaling

| Source | Drives `participantCount`? | Notes |
|--------|---------------------------|-------|
| Card `已报名 n/max` | **provisional yes for HP check** | Badger 52 matched `×1.52` |
| `players.length` | **No** | ~12 detailed entries |
| DOM `MiniUnit` count | diagnostic | After full load ≈ `n−1` + self large card ≈ `n` |
| `maxParticipants` | **No** | Capacity only |
| `pMap` key count | **No** | Diagnostic only |
| Dedicated WS field with value `52` | **not found** | Keep `participantCountSource` cautious |

---

## 6. Server active budget and timing

| Field | Status |
|-------|--------|
| Authoritative server budget fields | `unknown` |
| UI `时间: Mm Ss` | client remaining display only |

---

## 7. Whitelist projection (fail-closed)

| Item | Status |
|------|--------|
| Whitelist version | `draft-0` / `provisional-unreviewed` |
| `projectGuildCombatPacket()` | scaffold exists; not frozen |
| Unknown fields | **Drop** |
| `pMap` values | **Never export** |
| Raw WebSocket text | **Never persist** |

---

## 8. Sample coverage (fixtures)

| Sample | Purpose | Status |
|--------|---------|--------|
| **A** | Full trial Lv.100 → end | **UI end-state seen**（獾→240 / 刺猬→210）；raw projected frames still `missing` |
| **B** | Mid-trial refresh | `missing` |
| **C** | Mid-install `init_character_data` | `missing` |
| **D** | Dual-monster layer（獾） | **live-seen**；projected fixtures not frozen |

Schema summaries (no raw WS): `fixtures/guild-combat-trial-ws/phase0a/`.

---

## 9. Phase gate checklist

- [x] Phase 0A probe on live combat；partial schema reviewed
- [x] Card vs room level semantics confirmed
- [x] Badger HP/MP + dual `mMap` confirmed for n=52
- [ ] Fail-closed whitelist locked
- [ ] Phase 0B projected samples A–D on disk
- [ ] `manifest.json` protocol freeze
- [ ] **Then** Phase 2 Core permitted

---

## 10. References

- `docs/GUILD_COMBAT_TRIAL_CALIBRATOR_PLAN.md`
- `TRIAL_RULES.md`（界面等级语义 + 战斗点数）
- Probe: `userscripts/guild-combat-trial-protocol-probe.user.js`
