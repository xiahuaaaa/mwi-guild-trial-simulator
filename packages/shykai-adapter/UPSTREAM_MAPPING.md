# Upstream mapping

## Module inventory

| Upstream module | Adapter module | Wave 2 status |
| --- | --- | --- |
| `combatUtilities.js` | `combat-utilities.ts` | Basic auto-attack formula ported with parity; thorns/retaliation/leech and abilities fail closed |
| `player.js` | `player.ts` | DTO validation and field-preserving normalization; equipment-to-stat calculation pending data maps |
| `monster.js` | `monster.ts` | Difficulty and `roomLevel / 100` scaling ported; full CombatUnit stat recomputation pending |
| `ability.js` | `ability.ts` | Level interpolation and trigger DTO mapping ported; current ability data map is injected |
| `buff.js` | `buff.ts` | Complete constructor interpolation ported |
| `trigger.js` | `trigger.ts` | Comparator and common HP/MP/unit-count conditions ported; full buff-condition catalog pending |
| `combatUnit.js` | typed views in `combat-utilities.ts` | Minimal formula view only; full mutable runtime pending |
| `consumable.js` | guard in `player.ts` | Forbidden for guild trial; never constructed by the adapter |

All listed upstream module source hashes are recorded in
`tools/source-import/sources.json` and verified against the pinned worker source
map.

## Player DTO mapping

`sanitizeGuildTrialPlayerDto` preserves:

- stable `hrid`, which callers must replace with the canonical member ID;
- stamina, intelligence, attack, melee, defense, ranged and magic levels;
- equipment slot DTOs without interpreting item data;
- five ability slots, levels and trigger DTOs;
- house-room levels, achievements and level-gap debuff.

It always replaces `food` and `drinks` with empty arrays and reports how many
non-null entries were removed. An assertion guard rejects any later
reintroduction before runtime construction.

Equipment, Ability, Monster and Buff definitions are dependencies of the
adapter. They must come from a versioned current-game data snapshot; the
2026-05-05 embedded maps are not silently used for trial monsters.

## Deterministic RNG injection

The original `CombatUtilities.processAttack` directly calls `Math.random()` at:

1. critical roll;
2. fractional-tail decision inside `randomInt`;
3. damage roll inside `randomInt`;
4. hit roll;
5. thorns and retaliation subpaths.

`processUpstreamBasicAttack` and `upstreamRandomInt` accept a `FloatRandomSource`
and consume values in exactly the original order. Unsupported later random
paths fail before consuming RNG.

## Guild-trial consumable guards

The upstream path is:

```text
Player.createFromDTO(food/drinks)
  -> Trigger.shouldTrigger
  -> CombatSimulator.checkTriggersForUnit
  -> tryUseConsumable
  -> ConsumableTickEvent / buff expiration
```

The adapter blocks it at two boundaries:

1. `sanitizeGuildTrialPlayerDto` clears `food` and `drinks`;
2. `assertGuildTrialPlayerHasNoConsumables` fails closed before constructing a
   runtime Player.

The trial engine must retain its independent `consumables=disabled` runtime
policy as defense in depth.
