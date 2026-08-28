# Milky Way Idle 公会 QQ 机器人

实现分为三层：

- `src/core`：传输无关的中文命令解析、权限和正式/测试状态语义；
- `src/onebot`：OneBot 11 HTTP 事件、群聊/私聊、多图与私聊补发；
- `src/api-client.ts`：只通过中央公会 API 读写，不直接访问 SQLite；
- `server.mjs`：可供 NapCat 上报事件的本地 HTTP 入口。

管理员权限来自 `MWI_QQ_ADMIN_IDS` 白名单；也可通过
`MWI_QQ_ROLE_ADMIN_GROUP_IDS` 指定可信群，在这些群内接受 NapCat
上报的 `sender.role=owner|admin`。不会信任通用的 `is_admin` 字段，
群身份不会扩散到私聊或其他群。QQ ID 全程以字符串处理。

群聊每日回复上限（默认 500，按 Asia/Shanghai 自然日、按群计数）：

```text
MWI_QQ_GROUP_DAILY_REPLY_LIMIT=500   # 0 表示关闭
MWI_QQ_GROUP_QUOTA_PATH=/var/lib/mwi-guild-server/qq-group-daily-quota.json
```

完整启动方式和当前能力边界见项目根目录
`TESTING_AND_DEPLOYMENT.md`。
