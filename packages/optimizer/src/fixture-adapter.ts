import type {
  CurrentWeekMonsterFixture,
} from "../../contracts/src/index.ts";
import type { OptimizerBoss } from "./model.ts";

export function optimizerBossesFromFixture(
  fixture: CurrentWeekMonsterFixture,
): OptimizerBoss[] {
  return fixture.bosses.map((boss) => ({
    hrid: boss.hrid,
    name: boss.nameZh,
    evasion: { ...boss.evasion },
    armor: boss.armor,
    resistance: { ...boss.resistance },
    capacity: fixture.rules.observedTeamCapacity,
  }));
}
