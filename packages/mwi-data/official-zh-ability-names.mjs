/**
 * Official Simplified Chinese ability names extracted from the current MWI
 * client locale bundle.
 *
 * Source:
 * https://www.milkywayidle.com/static/js/10.9ca748e8.chunk.js
 * SHA-256:
 * 11ba3f8b2eb454c383d3d8d1df7f0be58f42d5b1dcb3bf08cf0bbfb3adfe7381
 * Captured: 2026-07-24
 */
export const OFFICIAL_ZH_ABILITY_NAMES = Object.freeze({
  "/abilities/poke": "破胆之刺",
  "/abilities/impale": "透骨之刺",
  "/abilities/puncture": "破甲之刺",
  "/abilities/penetrating_strike": "贯心之刺",
  "/abilities/scratch": "爪影斩",
  "/abilities/cleave": "分裂斩",
  "/abilities/maim": "血刃斩",
  "/abilities/crippling_slash": "致残斩",
  "/abilities/smack": "重碾",
  "/abilities/sweep": "重扫",
  "/abilities/stunning_blow": "重锤",
  "/abilities/fracturing_impact": "碎裂冲击",
  "/abilities/shield_bash": "盾击",
  "/abilities/quick_shot": "快速射击",
  "/abilities/aqua_arrow": "流水箭",
  "/abilities/flame_arrow": "烈焰箭",
  "/abilities/rain_of_arrows": "箭雨",
  "/abilities/silencing_shot": "沉默之箭",
  "/abilities/steady_shot": "稳定射击",
  "/abilities/pestilent_shot": "疫病射击",
  "/abilities/penetrating_shot": "贯穿射击",
  "/abilities/water_strike": "流水冲击",
  "/abilities/ice_spear": "冰枪术",
  "/abilities/frost_surge": "冰霜爆裂",
  "/abilities/mana_spring": "法力喷泉",
  "/abilities/entangle": "缠绕",
  "/abilities/toxic_pollen": "剧毒粉尘",
  "/abilities/natures_veil": "自然菌幕",
  "/abilities/life_drain": "生命吸取",
  "/abilities/fireball": "火球",
  "/abilities/flame_blast": "熔岩爆裂",
  "/abilities/firestorm": "火焰风暴",
  "/abilities/smoke_burst": "烟爆灭影",
  "/abilities/minor_heal": "初级自愈术",
  "/abilities/heal": "自愈术",
  "/abilities/quick_aid": "快速治疗术",
  "/abilities/rejuvenate": "群体治疗术",
  "/abilities/taunt": "嘲讽",
  "/abilities/provoke": "挑衅",
  "/abilities/toughness": "坚韧",
  "/abilities/elusiveness": "闪避",
  "/abilities/precision": "精确",
  "/abilities/berserk": "狂暴",
  "/abilities/frenzy": "狂速",
  "/abilities/elemental_affinity": "元素增幅",
  "/abilities/spike_shell": "尖刺防护",
  "/abilities/retribution": "惩戒",
  "/abilities/vampirism": "吸血",
  "/abilities/revive": "复活",
  "/abilities/insanity": "疯狂",
  "/abilities/invincible": "无敌",
  "/abilities/speed_aura": "速度光环",
  "/abilities/guardian_aura": "守护光环",
  "/abilities/fierce_aura": "物理光环",
  "/abilities/critical_aura": "暴击光环",
  "/abilities/mystic_aura": "元素光环",
  "/abilities/promote": "晋升",
});

export function officialAbilityNameZh(hrid) {
  return OFFICIAL_ZH_ABILITY_NAMES[hrid] ?? null;
}
