import { CommandHandler } from "./core/command-handler.ts";
import type { CommandContext } from "./core/types.ts";
import type {
  BotReply as OneBotReply,
  TransportContext,
  TransportHandler,
} from "./onebot/types.ts";

/**
 * Adapts verified OneBot transport events to the transport-neutral command
 * core. Administrator identity comes from the deployment allowlist, plus
 * OneBot owner/admin roles in explicitly trusted groups.
 *
 * When `fetchGroupMembers` is provided and the command needs group cross-
 * referencing, the transport layer fetches from the TMD guild group
 * (crossReferenceGroupId) regardless of which group the command was sent from.
 * This ensures the "未上传名单" fuzzy matching always runs against the full
 * TMD guild group member list, not the current chat's member list.
 */
export function createOneBotCommandHandler(
  commandHandler: CommandHandler,
  adminUserIds: ReadonlySet<string>,
  roleAdminGroupIds: ReadonlySet<string> = new Set(),
  resolveRoleAdmin?: (event: TransportContext) => Promise<boolean>,
  fetchGroupMembers?: (groupId: string) => Promise<string[]>,
  crossReferenceGroupId?: string,
): TransportHandler {
  // Commands that benefit from group member cross-referencing.
  const GROUP_AWARE_COMMANDS = new Set(["未上传名单"]);

  return async (event: TransportContext): Promise<OneBotReply | void> => {
    const trustedEventRole =
      event.conversation === "group" &&
      event.groupId !== undefined &&
      roleAdminGroupIds.has(event.groupId) &&
      (event.groupRole === "owner" || event.groupRole === "admin");
    const isAdmin =
      adminUserIds.has(event.userId) ||
      trustedEventRole ||
      (resolveRoleAdmin !== undefined && await resolveRoleAdmin(event));

    let groupMemberNames: string[] | undefined;
    if (
      fetchGroupMembers &&
      crossReferenceGroupId &&
      event.conversation === "group" &&
      GROUP_AWARE_COMMANDS.has(event.text)
    ) {
      try {
        groupMemberNames = await fetchGroupMembers(crossReferenceGroupId);
        console.error(`[group-aware] fetched ${groupMemberNames.length} group members from group ${crossReferenceGroupId} for command "${event.text}"`);
      } catch (err) {
        console.error(`[group-aware] fetch failed for group ${crossReferenceGroupId}:`, (err as Error).message ?? err);
        groupMemberNames = undefined;
      }
    }

    const context: CommandContext = {
      source: "onebot",
      chatKind: event.conversation,
      userId: event.userId,
      groupId: event.groupId,
      isAdmin,
      text: event.text,
      groupMemberNames,
    };
    return (await commandHandler.handle(context)) ?? undefined;
  };
}
