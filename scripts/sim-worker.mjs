import { parentPort } from "node:worker_threads";
import { runGuildTrial } from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";

parentPort.on("message", async (task) => {
  try {
    const run = await runGuildTrial({
      snapshot: task.snapshot,
      boss: task.boss,
      members: task.members,
      seed: task.seed,
      durationSeconds: task.durationSeconds,
    });
    const includeMembers = task.includeMembers !== false;
    parentPort.postMessage({
      ok: true,
      id: task.id,
      run: {
        seed: run.seed,
        wavesCleared: run.wavesCleared,
        finalMonsterHp: run.finalMonsterHp,
        finalMonsterMaxHp: run.finalMonsterMaxHp,
        finalProgressPercent:
          run.finalMonsterMaxHp > 0
            ? Number(
                (
                  100 *
                  (1 - run.finalMonsterHp / run.finalMonsterMaxHp)
                ).toFixed(2),
              )
            : 0,
        teamDps: run.teamDps,
        totalDeaths: run.totalDeaths,
        oomMembers: run.oomMembers,
        ...(includeMembers
          ? {
              members: (run.members ?? []).map((member) => ({
                memberId: member.memberId,
                label: member.label,
                role: member.role,
                damageDone: member.damageDone,
                dps: member.dps,
                damageTaken: member.damageTaken,
                healing: member.healing,
                healingReceived: member.healingReceived ?? member.healing,
                healingDone: member.healingDone ?? 0,
                abilityDamage: member.abilityDamage ?? {},
                deaths: member.deaths,
                ranOutOfMana: member.ranOutOfMana,
                oomDurationSeconds: member.oomDurationSeconds,
                manaSpent: member.manaSpent,
                manaRestored: member.manaRestored,
                passiveManaRegen: member.passiveManaRegen,
                maxMp: member.maxMp,
              })),
            }
          : {}),
      },
    });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      id: task.id,
      error: error?.stack || String(error),
    });
  }
});
