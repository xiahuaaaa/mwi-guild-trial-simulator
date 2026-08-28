import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OFFICIAL_ZH_ABILITY_NAMES,
  officialAbilityNameZh,
} from "../../packages/mwi-data/official-zh-ability-names.mjs";

const projectRoot = new URL("../../", import.meta.url);

test("official locale keeps the exact in-game names that were previously mistranslated", () => {
  assert.equal(officialAbilityNameZh("/abilities/precision"), "精确");
  assert.equal(officialAbilityNameZh("/abilities/retribution"), "惩戒");
  assert.equal(officialAbilityNameZh("/abilities/rejuvenate"), "群体治疗术");
  assert.equal(officialAbilityNameZh("/abilities/quick_aid"), "快速治疗术");
  assert.equal(officialAbilityNameZh("/abilities/life_drain"), "生命吸取");
  assert.equal(officialAbilityNameZh("/abilities/frenzy"), "狂速");
  assert.equal(officialAbilityNameZh("/abilities/puncture"), "破甲之刺");
  assert.equal(officialAbilityNameZh("/abilities/penetrating_strike"), "贯心之刺");
  assert.equal(officialAbilityNameZh("/abilities/pestilent_shot"), "疫病射击");
  assert.equal(officialAbilityNameZh("/abilities/maim"), "血刃斩");
  assert.equal(officialAbilityNameZh("/abilities/natures_veil"), "自然菌幕");
  assert.equal(officialAbilityNameZh("/abilities/ice_spear"), "冰枪术");
  assert.equal(officialAbilityNameZh("/abilities/smoke_burst"), "烟爆灭影");
  assert.equal(officialAbilityNameZh("/abilities/flame_blast"), "熔岩爆裂");
});

test("every ability emitted by the latest 40-clone report has an official Chinese name", async () => {
  const result = JSON.parse(
    await readFile(
      new URL(".local/adudu-full-engine-lab.json", projectRoot),
      "utf8",
    ),
  );
  const used = new Set(
    result.bosses.flatMap((boss) =>
      boss.team.templates.flatMap((template) =>
        template.abilities.map((ability) => ability.hrid)
      )
    ),
  );
  const missing = [...used].filter((hrid) => !OFFICIAL_ZH_ABILITY_NAMES[hrid]);
  assert.deepEqual(missing, []);
});
