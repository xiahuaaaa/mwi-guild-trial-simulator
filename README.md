# MWI 公会试炼模拟器

公开仓库只含模拟器与机器人**源码**。下列内容不会出现在本仓库：

- API Key、OneBot Token、`.env`、SQLite、`.local/` 运行时数据
- 公会成员快照、QQ 绑定、灾难恢复包（`backups/`）
- 生成的分工报告与图片（`artifacts/`）

密钥一律从环境变量读取，源码里没有默认凭据。

当前目录是公会试炼模拟器工程。完整设计与已确认的本期 Boss 面板在私有工作区的 `plans/guild-trial-simulator/`。

目前已经具备：

- 版本化规则契约和水母/刺猬 Lv.100 fixture；
- Wandering Earth、MWI 试炼同步和 TYS Guild 三类成员数据适配器；
- 只接受成员主动确认配装的候选生成器；
- 双 Boss 不重复分人的约束感知初始分队；
- 战斗 Worker 与管理页面的静态边界。

## 部署状态

API、QQ Bot 与 NapCat 仅监听本机回环。生产密钥、运行副本路径和验收记录留在私有工作区，不随本仓库发布。

初始分队中的分数只用于候选剪枝，不是最终模拟结论。正式推荐仍必须完成两个 Boss × 三 seed × 3600 秒模拟，并验证治疗、威胁、死亡、空蓝以及光环/Debuff uptime。

## 静态 UI 预览

无需安装依赖：直接在浏览器打开 `apps/web/index.html` 即可查看水母/刺猬双 Boss 界面。页面会明确保留尚未实测的规则为 `unknown`，不会把占位结果表现成模拟结论。

## Worker 边界

`workers/simulator/src/protocol.ts` 提供 Web UI 与未来战斗 Worker 之间的 request/response 协议。核心战斗内核未接入前，它只返回 `unknown-rules`，且包含待校准警告。

## Smoke test

```sh
npm test
```
