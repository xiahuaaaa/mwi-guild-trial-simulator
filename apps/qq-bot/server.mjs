import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GuildApiCommandService } from "./src/api-client.ts";
import { CommandHandler } from "./src/core/command-handler.ts";
import {
  createGroupDailyQuotaStore,
  parseGroupDailyReplyLimit,
} from "./src/group-daily-quota.ts";
import { createOneBotCommandHandler } from "./src/integration.ts";
import { createOneBot11Webhook, OneBot11Client, deliverReplies } from "./src/onebot/index.ts";
import {
  defaultSimulatorRoot,
  formatCombatTestRunFinished,
} from "./src/combat-test-run.ts";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
/** Prefer reading report PNGs from the repo checkout; override with MWI_TEST_REPORT_DIR. */
const DEFAULT_TEST_REPORT_DIR = path.join(
  PROJECT_ROOT,
  "artifacts/test-report",
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export async function createQqBotServer(options = {}) {
  const config = {
    baseUrl: options.guildApiBaseUrl ?? process.env.MWI_GUILD_API_BASE ?? "http://127.0.0.1:8787",
    adminKey: options.guildApiAdminKey ?? required("MWI_GUILD_API_ADMIN_KEY"),
    guildId: options.guildId ?? required("MWI_GUILD_ID"),
    testReportDirectory:
      options.testReportDirectory ??
      process.env.MWI_TEST_REPORT_DIR ??
      DEFAULT_TEST_REPORT_DIR,
    memberPluginPath:
      options.memberPluginPath ?? process.env.MWI_MEMBER_PLUGIN_PATH,
    simulatorRoot:
      options.simulatorRoot ?? defaultSimulatorRoot(PROJECT_ROOT),
  };
  const adminSource = options.adminUserIds ?? process.env.MWI_QQ_ADMIN_IDS ?? "";
  const admins = new Set(
    (Array.isArray(adminSource) ? adminSource : String(adminSource).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const roleAdminGroupSource = options.roleAdminGroupIds
    ?? process.env.MWI_QQ_ROLE_ADMIN_GROUP_IDS
    ?? "";
  const roleAdminGroups = new Set(
    (Array.isArray(roleAdminGroupSource)
      ? roleAdminGroupSource
      : String(roleAdminGroupSource).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const services = new GuildApiCommandService(config);
  const CROSS_REFERENCE_GROUP_ID =
    options.tmdGuildGroupId ??
    process.env.MWI_QQ_GUILD_GROUP_ID ??
    "532133273";
  const commandHandler = new CommandHandler(services, {
    tmdGuildGroupId: CROSS_REFERENCE_GROUP_ID,
  });
  const oneBotApiBaseUrl =
    options.oneBotApiBaseUrl ?? required("MWI_ONEBOT_API_BASE");
  const oneBotApiToken =
    options.oneBotApiToken ??
    process.env.MWI_ONEBOT_API_TOKEN ??
    options.oneBotAccessToken ??
    process.env.MWI_ONEBOT_ACCESS_TOKEN;
  const resolveRoleAdmin = createOneBotRoleAdminResolver({
    apiBaseUrl: oneBotApiBaseUrl,
    apiToken: oneBotApiToken,
    groupIds: roleAdminGroups,
  });
  const groupDailyReplyLimit = parseGroupDailyReplyLimit(
    options.groupDailyReplyLimit !== undefined
      ? String(options.groupDailyReplyLimit)
      : process.env.MWI_QQ_GROUP_DAILY_REPLY_LIMIT,
    500,
  );
  const groupQuotaPath =
    options.groupDailyQuotaPath ??
    process.env.MWI_QQ_GROUP_QUOTA_PATH ??
    "/var/lib/mwi-guild-server/qq-group-daily-quota.json";
  const groupDailyQuota = createGroupDailyQuotaStore({
    limit: groupDailyReplyLimit,
    statePath: groupQuotaPath,
  });
  if (groupDailyReplyLimit > 0) {
    console.error(
      `[quota] group daily reply limit=${groupDailyReplyLimit} state=${groupQuotaPath}`,
    );
  } else {
    console.error("[quota] group daily reply limit disabled");
  }

  const oneBotConfig = {
    accessToken: options.oneBotAccessToken ?? process.env.MWI_ONEBOT_ACCESS_TOKEN,
    eventKey: options.oneBotEventKey ?? process.env.MWI_ONEBOT_EVENT_KEY,
    apiBaseUrl: oneBotApiBaseUrl,
    apiToken: oneBotApiToken,
    botId: options.botId ?? process.env.MWI_QQ_BOT_ID,
    commandPrefixes: ["#","/"],
    groupDailyQuota,
  };
  // TMD guild group ID for cross-referencing (e.g., "未上传名单" fuzzy match).
  // Always uses the main guild group regardless of which group the command is sent from.

  const oneBotClient = new OneBot11Client(oneBotConfig);
  const webhook = createOneBot11Webhook(oneBotConfig, createOneBotCommandHandler(
    commandHandler,
    admins,
    roleAdminGroups,
    resolveRoleAdmin,
    (groupId) => oneBotClient.getGroupMemberList(groupId),
    CROSS_REFERENCE_GROUP_ID,
  ));

  const stopCombatTestPoller = services.watchCombatTestRun(async (state) => {
    const targetId = state.notify.chatKind === "group"
      ? state.notify.groupId
      : state.notify.userId;
    if (!targetId) {
      console.error("[combat-test-run] missing notify target");
      return;
    }
    let reply = { text: formatCombatTestRunFinished(state) };
    if (state.status === "succeeded") {
      const result = await services.getLatestCombatAssignment();
      if (result.ok) {
        reply = {
          text: `${formatCombatTestRunFinished(state)}\n\n${result.value.text}`,
          images: result.value.images,
        };
      } else {
        reply = {
          text:
            `${formatCombatTestRunFinished(state)}\n` +
            `读取结果图失败：${result.message}\n可发送「本周分工」查看。`,
        };
      }
    }
    await deliverReplies(
      {
        platform: "qq",
        protocol: "onebot-11",
        conversation: state.notify.chatKind,
        userId: state.notify.userId,
        groupId: state.notify.groupId,
        text: "",
        mentionedBot: false,
      },
      reply,
      oneBotClient,
      groupDailyQuota,
    );
  });

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "mwi-guild-qq-bot" }));
      return;
    }
    if (request.url !== "/onebot/event") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readBody(request);
      const fetchRequest = new Request("http://local/onebot/event", {
        method: request.method,
        headers: request.headers,
        body: request.method === "POST" ? body : undefined,
      });
      const result = await webhook(fetchRequest);
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(400).end();
    }
  });
  server.on("close", stopCombatTestPoller);
  return server;
}

export function createOneBotRoleAdminResolver({
  apiBaseUrl,
  apiToken,
  groupIds,
  timeoutMs = 3_000,
}) {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  return async (event) => {
    // Group events already carry sender.role. The API fallback is primarily
    // for private commands, where OneBot has no group role in the event.
    if (event.conversation === "group") {
      return (
        event.groupId !== undefined &&
        groupIds.has(event.groupId) &&
        (event.groupRole === "owner" || event.groupRole === "admin")
      );
    }
    for (const groupId of groupIds) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${baseUrl}/get_group_member_info`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(apiToken
                ? { authorization: `Bearer ${apiToken}` }
                : {}),
            },
            body: JSON.stringify({
              group_id: groupId,
              user_id: event.userId,
              no_cache: true,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (
          payload?.status === "ok" &&
          payload?.retcode === 0 &&
          (payload?.data?.role === "owner" ||
            payload?.data?.role === "admin")
        ) {
          return true;
        }
      } catch {
        // A failed role lookup grants no permissions.
      } finally {
        clearTimeout(timer);
      }
    }
    return false;
  };
}

export async function listenFromEnvironment() {
  const server = await createQqBotServer();
  const host = process.env.MWI_QQ_BOT_HOST ?? "127.0.0.1";
  const port = Number(process.env.MWI_QQ_BOT_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MWI_QQ_BOT_PORT must be a TCP port");
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, host, resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  listenFromEnvironment()
    .then(() => console.log("MWI guild QQ bot listening on local interface"))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
