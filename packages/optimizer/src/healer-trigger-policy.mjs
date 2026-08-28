const HEALER_WEAPON_POLICIES = Object.freeze([
  {
    stat: "bloom",
    triggerAbility: "entangle",
    reason: "Blooming Trident: use a zero-cooldown nature cast to roll Bloom frequently",
  },
  {
    stat: "ripple",
    triggerAbility: "water_strike",
    reason: "Rippling Trident: use a zero-cooldown water cast to roll Ripple frequently",
  },
]);

export function healerWeaponPolicy(build, equipmentLookup) {
  for (const equipped of build?.equipment ?? []) {
    const item = equipmentLookup(equipped.itemHrid);
    const type = item?.equipmentDetail?.type;
    if (
      type !== "/equipment_types/main_hand" &&
      type !== "/equipment_types/two_hand"
    ) {
      continue;
    }
    const stats = item.equipmentDetail.combatStats ?? {};
    const policy = HEALER_WEAPON_POLICIES.find(
      (candidate) => Number(stats[candidate.stat] ?? 0) > 0,
    );
    if (policy) {
      return {
        ...policy,
        itemHrid: item.hrid,
        procChance: Number(stats[policy.stat]),
      };
    }
  }
  return null;
}

export function healerAbilityNames(build, specialAbility, equipmentLookup) {
  const policy = healerWeaponPolicy(build, equipmentLookup);
  if (!policy) {
    throw new Error(
      `Healer build ${build?.name ?? "(unnamed)"} has no supported Bloom/Ripple weapon`,
    );
  }
  return [
    specialAbility,
    "rejuvenate",
    "quick_aid",
    "mana_spring",
    policy.triggerAbility,
  ];
}
