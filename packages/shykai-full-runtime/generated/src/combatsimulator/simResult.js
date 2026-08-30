import combatStyleDetailMap from "./data/combatStyleDetailMap.json.js"

class SimResult {
    constructor(zone, labyrinth, numberOfPlayers) {
        this.deaths = {};
        this.experienceGained = {};
        this.encounters = 0;
        this.attacks = {};
        this.consumablesUsed = {};
        this.hitpointsGained = {};
        this.healingDone = {};
        this.manapointsGained = {};
        this.debuffOnLevelGap = {};
        this.dropRateMultiplier = {};
        this.rareFindMultiplier = {};
        this.combatDropQuantity = {};
        this.playerRanOutOfMana = {
            "player1": false,
            "player2": false,
            "player3": false,
            "player4": false,
            "player5": false
        };
        this.playerRanOutOfManaTime = {};
        this.manaUsed = {};
        this.timeSpentAlive = [];
        this.bossSpawns = [];
        this.hitpointsSpent = {};
        this.zoneName = zone?.hrid;
        this.difficultyTier = zone?.difficultyTier;
        this.labyrinthName = labyrinth?.monsterHrid;
        this.roomLevel = labyrinth?.roomLevel;
        this.isDungeon = false;
        this.isLabyrinth = labyrinth ? true : false;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.maxWaveReached = 0;
        this.numberOfPlayers = numberOfPlayers;
        this.maxEnrageStack = 0;
        this.minDungenonTime = 0;
        this.maxDungenonTime = 0;
        this.lastDungeonFinishTime = 0;
        this.lastEncounterFinishTime = 0;
        this.labyAttemptCount = 0;
        this.stopReason = null;
        this.endedAt = null;
        this.simulatedTime = 0;
        this.finalMonsterLevel = null;
        this.livingEnemies = [];

        this.wipeEvents = [];
        
        // 时间序列数据用于图表显示
        this.timeSeriesData = {
            timestamps: [],
            players: {}
        };
    }

    addWipeEvent(logs, simulationTime, wave) {
        this.wipeEvents.push({
            simulationTime: simulationTime,
            logs: logs,
            wave: wave,
            timestamp: new Date().toISOString()
        });
    }
    
    addDeath(unit) {
        const hrid = unitHrid(unit);
        if (!this.deaths[hrid]) {
            this.deaths[hrid] = 0;
        }

        this.deaths[hrid] += 1;
    }

    updateTimeSpentAlive(name, alive, time) {
        const i = this.timeSpentAlive.findIndex(e => e.name === name);
        if (alive) {
            if (i !== -1) {
                this.timeSpentAlive[i].alive = true;
                this.timeSpentAlive[i].spawnedAt = time;
            } else {
                this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });
            }
        } else {
            const timeAlive = time - this.timeSpentAlive[i].spawnedAt;
            this.timeSpentAlive[i].alive = false;
            this.timeSpentAlive[i].timeSpentAlive += timeAlive;
            this.timeSpentAlive[i].count += 1;
        }
    }

    updateDungenonFinish(beginFlag, finishTime) {
        const i = this.timeSpentAlive.findIndex(e => e.name === beginFlag); 
        if (i == -1) {
            return;
        }

        const currentDungenonTime = finishTime - this.timeSpentAlive[i].spawnedAt;

        if (this.minDungenonTime == 0 || this.minDungenonTime > currentDungenonTime) {
            this.minDungenonTime = currentDungenonTime;
        }

        if (this.maxDungenonTime < currentDungenonTime) {
            this.maxDungenonTime = currentDungenonTime;
        }
    }

    addExperienceGain(unit, experience) {
        if (!unit.isPlayer) {
            return;
        }

        const hrid = unitHrid(unit);
        if (!this.experienceGained[hrid]) {
            this.experienceGained[hrid] = {
                stamina: 0,
                intelligence: 0,
                attack: 0,
                melee: 0,
                defense: 0,
                ranged: 0,
                magic: 0,
            };
        }

        let experienceGainedRate = {
            "stamina": 0,
            "intelligence": 0,
            "attack": 0,
            "melee": 0,
            "defense": 0,
            "ranged": 0,
            "magic": 0,
        };

        const primaryTraining = unit.combatDetails.combatStats.primaryTraining;
        experienceGainedRate[primaryTraining.split("/")[2]] = .3;

        const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;
        const skillExpMapLength = Object.keys(skillExpMap).length;

        const focusTraining = unit.combatDetails.combatStats.focusTraining;
        if (focusTraining && skillExpMap[focusTraining]) {
            experienceGainedRate[focusTraining.split("/")[2]] += .7;
        } else {
            Object.keys(skillExpMap).forEach(skillHrid => {
                experienceGainedRate[skillHrid.split("/")[2]] += .7 / skillExpMapLength;
            });
        }

        for (const [type, rate] of Object.entries(experienceGainedRate)) {
            if (rate <= 0) continue;

            const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + "Experience"]);

            this.experienceGained[hrid][type] += (
                experience
                * (1 + unit.combatDetails.combatStats.combatExperience)
                * skillExperience
                * (1 + unit.debuffOnLevelGap)

            );
        }
    }

    addEncounterEnd() {
        this.encounters++;
    }

    addAttack(source, target, ability, hit) {
        const sourceHrid = unitHrid(source);
        const targetHrid = unitHrid(target);
        if (!this.attacks[sourceHrid]) {
            this.attacks[sourceHrid] = {};
        }
        if (!this.attacks[sourceHrid][targetHrid]) {
            this.attacks[sourceHrid][targetHrid] = {};
        }
        if (!this.attacks[sourceHrid][targetHrid][ability]) {
            this.attacks[sourceHrid][targetHrid][ability] = {};
        }

        if (!this.attacks[sourceHrid][targetHrid][ability][hit]) {
            this.attacks[sourceHrid][targetHrid][ability][hit] = 0;
        }

        this.attacks[sourceHrid][targetHrid][ability][hit] += 1;
    }

    addConsumableUse(unit, consumable) {
        const hrid = unitHrid(unit);
        if (!this.consumablesUsed[hrid]) {
            this.consumablesUsed[hrid] = {};
        }
        if (!this.consumablesUsed[hrid][consumable.hrid]) {
            this.consumablesUsed[hrid][consumable.hrid] = 0;
        }

        this.consumablesUsed[hrid][consumable.hrid] += 1;
    }

    addHitpointsGained(unit, source, amount) {
        const hrid = unitHrid(unit);
        if (!this.hitpointsGained[hrid]) {
            this.hitpointsGained[hrid] = {};
        }
        if (!this.hitpointsGained[hrid][source]) {
            this.hitpointsGained[hrid][source] = 0;
        }

        this.hitpointsGained[hrid][source] += amount;
    }

    addHealingDone(unit, abilityHrid, amount) {
        const hrid = unitHrid(unit);
        if (!this.healingDone[hrid]) {
            this.healingDone[hrid] = {};
        }
        if (!this.healingDone[hrid][abilityHrid]) {
            this.healingDone[hrid][abilityHrid] = 0;
        }
        this.healingDone[hrid][abilityHrid] += amount;
    }

    addManapointsGained(unit, source, amount) {
        const hrid = unitHrid(unit);
        if (!this.manapointsGained[hrid]) {
            this.manapointsGained[hrid] = {};
        }
        if (!this.manapointsGained[hrid][source]) {
            this.manapointsGained[hrid][source] = 0;
        }

        this.manapointsGained[hrid][source] += amount;
    }

    setDropRateMultipliers(unit) {
        const hrid = unitHrid(unit);
        if (!this.dropRateMultiplier[hrid]) {
            this.dropRateMultiplier[hrid] = {};
        }
        this.dropRateMultiplier[hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;

        if (!this.rareFindMultiplier[hrid]) {
            this.rareFindMultiplier[hrid] = {};
        }
        this.rareFindMultiplier[hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;

        if (!this.combatDropQuantity[hrid]) {
            this.combatDropQuantity[hrid] = {};
        }
        this.combatDropQuantity[hrid] = unit.combatDetails.combatStats.combatDropQuantity;

        if (!this.debuffOnLevelGap[hrid]) {
            this.debuffOnLevelGap[hrid] = {};
        }
        this.debuffOnLevelGap[hrid] = unit.debuffOnLevelGap;
    }

    setManaUsed(unit) {
        const hrid = unitHrid(unit);
        this.manaUsed[hrid] = {};
        for (let [key, value] of unit.abilityManaCosts.entries()) {
            this.manaUsed[hrid][key] = value;
        }
    }

    addHitpointsSpent(unit, source, amount) {
        const hrid = unitHrid(unit);
        if (!this.hitpointsSpent[hrid]) {
            this.hitpointsSpent[hrid] = {};
        }
        if (!this.hitpointsSpent[hrid][source]) {
            this.hitpointsSpent[hrid][source] = 0;
        }

        this.hitpointsSpent[hrid][source] += amount;
    }

    addRanOutOfManaCount(unit, isOutOfMana, time) {
        const hrid = unitHrid(unit);
        if (isOutOfMana) this.playerRanOutOfMana[hrid] = true;

        if (!this.playerRanOutOfManaTime[hrid]) {
            this.playerRanOutOfManaTime[hrid] = {isOutOfMana: false, startTimeForOutOfMana:0, totalTimeForOutOfMana:0};
        }

        if (isOutOfMana) {
            if (!this.playerRanOutOfManaTime[hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[hrid].isOutOfMana = true;
                this.playerRanOutOfManaTime[hrid].startTimeForOutOfMana = time;
            }
        } else {
            if (this.playerRanOutOfManaTime[hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[hrid].isOutOfMana = false;
                this.playerRanOutOfManaTime[hrid].totalTimeForOutOfMana += time - this.playerRanOutOfManaTime[hrid].startTimeForOutOfMana;
            }
        }
    }

    // 添加时间序列数据点
    addTimeSeriesSnapshot(time, players) {
        this.timeSeriesData.timestamps.push(time);
        
        players.forEach(player => {
            if (!this.timeSeriesData.players[player.hrid]) {
                this.timeSeriesData.players[player.hrid] = {
                    hp: [],
                    mp: [],
                    maxHp: [],
                    maxMp: []
                };
            }
            
            const playerData = this.timeSeriesData.players[player.hrid];
            playerData.hp.push(player.combatDetails.currentHitpoints);
            playerData.mp.push(player.combatDetails.currentManapoints);
            playerData.maxHp.push(player.combatDetails.maxHitpoints);
            playerData.maxMp.push(player.combatDetails.maxManapoints);
        });
    }
}

function unitHrid(unit) {
    return unit?.uniqueHrid ?? unit?.hrid;
}

export default SimResult;
