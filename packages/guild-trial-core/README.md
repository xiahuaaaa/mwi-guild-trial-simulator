# Guild Trial Core

Scenario orchestration for the confirmed guild-trial invariants:

- one shared, continuous 3,600-second deadline;
- first monster at level 100;
- every kill advances the next monster by 10 levels;
- combat consumables are disabled at both input and policy boundaries;
- only passive 10-second HP/MP regeneration is multiplied by four;
- all member metrics use stable, dynamic member IDs.

The current `MemberCombatPort` is an explicit boundary for the recovered
Shykai combat formula implementation. The included `StaticDamageCombatPort`
is a deterministic test harness, not a claim of MWI formula parity.

Unconfirmed transition behavior is supplied through `GuildTrialRules` and is
reported in `assumptionWarnings`; the runner does not silently infer it.
