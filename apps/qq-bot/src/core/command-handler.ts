import {
  parseCommand,
  type ParsedCommand,
} from "./parser.ts";
import type {
  CommandServicePort,
  ServiceContent,
  ServiceResult,
} from "./service-port.ts";
import {
  reply,
  type BotReply,
  type CommandContext,
} from "./types.ts";

const ADMIN_COMMANDS = new Set<ParsedCommand["kind"]>([
  "help-admin",
  "help-admin-advanced",
  "guild-report",
  "start-assignment",
  "assignment-progress",
  "stop-assignment",
  "simulate-current-assignment",
  "optimization-audit",
  "unavailable-roster",
  "equipment-check",
  "skill-recommendation",
  "start-test-assignment",
  "current-test-assets",
  "promote-test-assignment",
  "missing-uploads",
  "expired-uploads",
  "upload-latest-plugin",
  "unbind-combat",
  "rebind-combat",
  // Life write / debug: member help no longer advertises these; old names stay
  // parseable but admin-gated so accidental group spam cannot rebuild schemes.
  "generate-life-assignment",
  "simulate-life-trial",
]);

export class CommandHandler {
  readonly #services: CommandServicePort;
  readonly #tmdGuildGroupId: string;

  constructor(
    services: CommandServicePort,
    options: { tmdGuildGroupId?: string } = {},
  ) {
    this.#services = services;
    this.#tmdGuildGroupId = options.tmdGuildGroupId ?? "532133273";
  }

  async handle(context: CommandContext): Promise<BotReply | null> {
    const parsed = parseCommand(context.text);
    if (!parsed.ok) {
      return "ignored" in parsed ? null : reply(parsed.error);
    }
    const command = parsed.command;
    if (ADMIN_COMMANDS.has(command.kind) && !context.isAdmin) {
      return reply("权限不足：该命令仅公会管理员可用。");
    }
    if (
      command.kind === "skill-recommendation" &&
      context.chatKind !== "private"
    ) {
      return reply("技能推荐仅支持私聊，请私聊机器人发送“技能推荐”。");
    }

    switch (command.kind) {
      case "help":
        return reply(HELP_TEXT);
      case "help-admin":
        return reply(ADMIN_HELP_TEXT);
      case "help-admin-advanced":
        return reply(ADMIN_ADVANCED_HELP_TEXT);
      case "guild-bottleneck":
        return fromService(await this.#services.getGuildBottleneck());
      case "profession-distribution":
        return fromService(await this.#services.getProfessionDistribution());
      case "guild-roster":
        return fromService(await this.#services.getGuildRoster());
      case "unregistered-trial-members":
        return fromService(await this.#services.getUnregisteredTrialMembers());
      case "signup-assignment-mismatches":
        return fromService(await this.#services.getSignupAssignmentMismatches());
      case "aura-assignment":
        return fromService(await this.#services.getAuraAssignment());
      case "guild-bosses":
        return fromService(await this.#services.getGuildBosses());
      case "life-trials":
        return fromService(await this.#services.getLifeTrials());
      case "generate-life-assignment":
        return fromService(await this.#services.generateLifeAssignment());
      case "latest-life-assignment":
        return fromService(await this.#services.getLatestLifeAssignment());
      case "simulate-life-trial":
        return fromService(
          await this.#services.simulateLifeTrial({
            trialToken: command.trialToken,
            memberIds: command.memberIds,
          }),
        );
      case "guild-plugin":
        return fromService(await this.#services.getPluginInstallInfo());
      case "missing-uploads":
        return fromService(await this.#services.getMissingUploads(
          context.groupMemberNames,
        ));
      case "expired-uploads":
        return fromService(await this.#services.getExpiredUploads());
      case "upload-latest-plugin":
        return await this.#uploadLatestPlugin();
      case "guild-report":
        return fromService(await this.#services.getGuildProfessionReport());
      case "assignment-progress":
        return fromService(await this.#services.getAssignmentProgress());
      case "stop-assignment":
        return fromService(
          await this.#services.stopActiveAssignment({
            requestedBy: context.userId,
          }),
        );
      case "optimization-audit":
        return fromService(await this.#services.getOptimizationAudit());
      case "unavailable-roster":
        return fromService(await this.#services.getUnavailableRoster());
      case "equipment-check":
        return fromService(await this.#services.getEquipmentCheck());
      case "skill-recommendation":
        return fromService(
          await this.#services.getSkillRecommendation(context.userId),
        );
      case "start-assignment":
        return await this.#startOfficial(context, command.exhaustive);
      case "simulate-current-assignment":
        return await this.#simulateOfficial(context);
      case "start-test-assignment":
        return await this.#startTest(context);
      case "latest-combat-assignment":
        return fromService(await this.#services.getLatestCombatAssignment());
      case "current-test-assets":
        return forcePrivate(
          context,
          await this.#services.getLatestCombatAssignment(),
          "本周分工资料已发送到你的私聊。",
        );
      case "promote-test-assignment":
        return reply(
          "已取消转正。每次「战斗模拟」发布到公网页后即为正式方案，请用「本周分工」查看。",
        );
      case "bind-combat":
        return await this.#bindCombat(context, command);
      case "unbind-combat":
        return await this.#forCurrentMember(
          command.characterName,
          async (canonicalName) =>
            this.#services.unbindCombat({
              requestedBy: context.userId,
              characterName: canonicalName,
            }),
        );
      case "rebind-combat":
        return await this.#forCurrentMember(
          command.characterName,
          async (canonicalName) =>
            this.#services.rebindCombat({
              requestedBy: context.userId,
              characterName: canonicalName,
              qqUserId: command.qqUserId,
              combatType: command.combatType,
            }),
        );
      case "set-aura":
        return await this.#setAura(context, command);
    }
  }

  async #startOfficial(
    context: CommandContext,
    exhaustive: boolean,
  ): Promise<BotReply> {
    const availability =
      await this.#services.getProductionSimulationAvailability();
    if (!availability.available) {
      return productionUnavailable(availability.reason);
    }
    return fromService(
      await this.#services.startOfficialAssignment({
        requestedBy: context.userId,
        exhaustive,
      }),
    );
  }

  async #simulateOfficial(context: CommandContext): Promise<BotReply> {
    const availability =
      await this.#services.getProductionSimulationAvailability();
    if (!availability.available) {
      return productionUnavailable(availability.reason);
    }
    return fromService(
      await this.#services.simulateLockedOfficialAssignment({
        requestedBy: context.userId,
        runsPerBoss: 3,
      }),
    );
  }

  async #startTest(context: CommandContext): Promise<BotReply> {
    const availability = await this.#services.getTestSimulationAvailability();
    if (!availability.available) {
      return reply(
        `战斗模拟当前不可用，未启动。${
          availability.reason ? ` 原因：${availability.reason}` : ""
        }`,
      );
    }
    return fromService(
      await this.#services.startTestAssignment({
        requestedBy: context.userId,
        excludedCharacterNames: [],
        chatKind: context.chatKind,
        groupId: context.groupId,
      }),
    );
  }

  async #bindCombat(
    context: CommandContext,
    command: Extract<ParsedCommand, { kind: "bind-combat" }>,
  ): Promise<BotReply> {
    const qqUserId = command.qqUserId ?? context.userId;
    if (qqUserId !== context.userId && !context.isAdmin) {
      return reply(
        "权限不足：为他人绑定请使用管理员代绑格式“#战斗绑定 角色名 QQ号 类型”。",
      );
    }
    return this.#forCurrentMember(command.characterName, async (canonicalName) =>
      this.#services.bindCombat({
        requestedBy: context.userId,
        characterName: canonicalName,
        qqUserId,
        combatType: command.combatType,
      })
    );
  }

  async #setAura(
    context: CommandContext,
    command: Extract<ParsedCommand, { kind: "set-aura" }>,
  ): Promise<BotReply> {
    let characterName = command.characterName;
    if (!characterName) {
      const bindingsResult = await this.#services.getCombatBindingsForUser(
        context.userId,
      );
      if (!bindingsResult.ok) return fromService(bindingsResult);
      if (bindingsResult.value.length === 0) {
        return reply("尚未绑定角色，请先使用“#战斗绑定 角色名 类型”。");
      }
      if (bindingsResult.value.length > 1) {
        return reply(
          "你绑定了多个角色，请使用“#光环 角色名 类型 等级”明确角色。",
        );
      }
      characterName = bindingsResult.value[0].characterName;
    } else if (!context.isAdmin) {
      const bindingsResult = await this.#services.getCombatBindingsForUser(
        context.userId,
      );
      if (!bindingsResult.ok) return fromService(bindingsResult);
      if (
        !bindingsResult.value.some((binding) =>
          binding.characterName === characterName
        )
      ) {
        return reply("只能更新当前 QQ 已绑定角色的光环。");
      }
    }

    return this.#forCurrentMember(characterName, async (canonicalName) =>
      this.#services.setAura({
        requestedBy: context.userId,
        characterName: canonicalName,
        auraType: command.auraType,
        level: command.level,
      })
    );
  }

  async #forCurrentMember(
    characterName: string,
    operation: (
      canonicalName: string,
    ) => Promise<ServiceResult<ServiceContent>>,
  ): Promise<BotReply> {
    const member = await this.#services.isCurrentGuildMember(characterName);
    if (!member.ok) return fromService(member);
    if (!member.value.current) {
      return reply(`角色“${characterName}”不在当前公会成员名单中，未做更改。`);
    }
    return fromService(await operation(member.value.canonicalName));
  }

  async #uploadLatestPlugin(): Promise<BotReply> {
    const result = await this.#services.getLatestPluginArtifact();
    if (!result.ok) return fromService(result);
    const artifact = result.value;
    return reply(
      [
        `公会插件 v${artifact.version}`,
        `Greasy Fork：${artifact.installUrl}`,
        "正在上传到 TMD 群文件…",
      ].join("\n"),
      {
        groupFileUploads: [{
          groupId: this.#tmdGuildGroupId,
          fileName: artifact.fileName,
          file: artifact.file,
        }],
      },
    );
  }
}

const HELP_TEXT = `🐮 TMD's MWI 公会台

看本周
  本周分工          生活 + 战斗结果图（公网可打开）
  本周生活分工      生活分工结果图（公网可打开）
  光环分配
  报名检查          实际报名 vs 模拟分工不一致
  未覆盖名单        生活+战斗分工都没排上的人
  公会名单｜公会短板｜职业分布
  公会boss｜生活试炼｜公会插件

我的设置
  #战斗绑定 角色名 类型
  #光环 类型 等级
  #光环 角色名 类型 等级
  职业：弓 弩 火 水 自 盾 枪 剑 锤

管理员发送：管理`;

const ADMIN_HELP_TEXT = `🐮 管理控制台

分工（会改方案）
  生活模拟          用最新快照重算并发布生活分工
  战斗模拟          后台模拟战斗，发布后即为正式方案
  分工进度          查看战斗模拟是否还在跑
  终止分工          取消进行中的战斗模拟

体检与名单
  数据体检          未绑定/未上传/攻击不足等
  不可用名单        战斗模拟不可用（攻击/装备/快照）
  装备检查          可用人员主武器强化低于★+12（不含+12）
  未上传名单｜上传过期名单
  未覆盖名单｜未报名名单     生活+战斗分工都没排上的人
  报名检查                   实际报名 vs 模拟分工不一致
  生活top20         生活技能图

运维
  上传最新插件
  #战斗解绑 角色名
  #战斗改绑 角色名 QQ号 类型

进阶（少用）发：管理进阶`;

const ADMIN_ADVANCED_HELP_TEXT = `🐮 管理进阶（少用 / 暂不可用）

生产引擎（开始正式分工仍阻断）
  开始正式分工｜完全搜索分工
  模拟正式

调试
  生活模拟 1
  生活模拟 挤奶 #角色1,角色2
  私聊本周分工      强制私聊发送本周结果图
  技能推荐          仅私聊

旧名仍可用（不展示）：重算生活、试跑战斗、测试分工、优化 等`;

function productionUnavailable(reason?: string): BotReply {
  return reply(
    `生产模拟当前不可用，命令已阻断，正式分工未变更。${
      reason ? ` 原因：${reason}` : ""
    }`,
  );
}

function fromService<T extends ServiceContent>(
  result: ServiceResult<T>,
): BotReply {
  if (!result.ok) {
    const prefix = result.code === "unavailable" ? "服务当前不可用：" : "";
    return reply(`${prefix}${result.message}`);
  }
  return reply(result.value.text, { images: result.value.images });
}

function forcePrivate(
  context: CommandContext,
  result: ServiceResult<ServiceContent>,
  groupAcknowledgement: string,
): BotReply {
  if (!result.ok) return fromService(result);
  const content = result.value;
  const images = [
    ...(content.images ?? []),
    ...(content.skillDetailImages ?? []),
  ];
  if (context.chatKind === "private") {
    return reply(content.text, { images });
  }
  return reply(groupAcknowledgement, {
    privateFollowups: [{
      userId: context.userId,
      text: content.text,
      images,
    }],
  });
}
