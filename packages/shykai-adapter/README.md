# Shykai adapter

Audited adapter boundary around the source-map-recovered Shykai combat kernel.

Implemented in Wave 2:

- Player DTO validation and guild-trial consumable stripping;
- exact upstream Buff and Ability level interpolation;
- exact upstream labyrinth monster level/stat scaling subset;
- exact upstream trigger comparison and common dependency conditions;
- deterministic basic-attack hit, critical, damage-roll, penetration and
  mitigation formulas with an injected random source;
- a pinned ordinary-combat parity fixture generated against the unmodified
  recovered `CombatUtilities.processAttack`.

The adapter fails closed for thorns, retaliation, lifesteal, mana leech and
ability damage. Those paths remain pending rather than silently approximated.

See [UPSTREAM_MAPPING.md](./UPSTREAM_MAPPING.md) for module status, DTO fields,
RNG injection points and consumable guards.
