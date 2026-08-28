# 实现状态

更新时间：2026-07-28

## 真实环境验证

- 机器人已迁移至独立 Linux VPS：Linux QQ + NapCat、中央 API 和 QQ Bot 均由 systemd 常驻；
- 新机已完成真实 QQ 登录、群消息发送、事件回调和“帮助”命令的端到端验收；
- OneBot HTTP API、事件回调、中央 API 和 QQ 机器人链路均只监听 `127.0.0.1`；
- VPS SSH 已改为专用 ED25519 密钥登录，密码与交互式登录已关闭；
- VPS 已接管原有 Tailscale Funnel 公网地址；最终 SQLite 在线同步后，Mac 的 API 与 QQ Bot 服务已停止；
- `帮助`、`菜单`、`指令` 命令已加入主工作区。
- 成员插件 v0.6.8 会由 `adudu` 在登录后上传本周 4 个生活试炼、2 个战斗试炼和对应怪物基础面板；除压缩 `initClientData` 解码、React/Game Core 完整度评分和 document-start `MessageEvent` 观察外，snapshot builder 直接解析原生 `wearableMap`/`abilityMap`，并在装备未就绪时推迟自动上传，避免 `empty_loadout_catalog`。面板 UI 跟随游戏 `i18nextLng` 中英文切换（主 `@name` 保持中文以避免 Tampermonkey 误显示安装）；`payload()` 水合不会再次触发自动同步，避免成功后死循环。API 拒绝全部装备为空的配装快照；`公会boss` 优先读取完整实况，缺少怪物面板时回退静态 fixture。

## Wave 1 已完成

- `contracts`
  - 公会试炼场景、Boss、成员、策略和结果契约；
  - 未校准规则必须显式携带 `unknown` provenance；
  - 水母、刺猬 Lv.100 本期 fixture。
- `combat-core`
  - Mulberry32 可复现 RNG；
  - 稳定事件堆、priority/sequence 排序和 lazy cancel；
  - 3600 秒截止不执行越界事件；
  - 任意人数的流式成员统计。
- `guild-trial-core`
  - 一场连续 3600 秒；
  - Lv.100 起步，击杀后严格 `+10`；
  - 禁止消耗品；
  - 只有被动 HP/MP RegenTick 乘 4；
  - 三次 run 的原始结果和聚合。
- `mwi-adapter`
  - Wandering Earth、MWI 试炼同步、TYS Guild 三种 payload；
  - 来源、版本、freshness、confidence 和 fingerprint；
  - capability-only 数据不能冒充 simulation-ready；
  - 只有成员主动确认的完整候选配装能进入优化器。
- `optimizer`
  - 从本期 Boss fixture 生成优化输入；
  - 职业、伤害类型、光环与 effect coverage 标签；
  - 成员默认最多分配一个 Boss；
  - 坦克、治疗、关键 coverage 的约束感知初始解；
  - 明确标记静态分数只可用于候选剪枝。
- `apps/web` 与 `workers/simulator`
  - 双 Boss、均衡/稳健/冲层、coverage 和 unknown 警告的静态边界；
  - 当前未把占位结果表现为正式模拟。

## 验证结果

```text
npm test
155 tests passed

source-import --verify-only
Shykai source maps: 18 + 37 + 7 sourcesContent
all pinned SHA-256 values matched
MIT license matched
SoloSim reference hashes matched; source not copied
```

## Wave 2 已完成的工程边界

1. Shykai 普通攻击公式已建立精确 parity；未支持机制会在消耗 RNG 前失败。
2. 成员候选配装 userscript 支持成员确认最多 4 套完整配装、本地下载和本机 API 上传。
3. 中央 API 支持成员快照、正式/测试分工、QQ 绑定、光环和插件版本。
4. QQ 机器人已有完整指令核心、OneBot 11 传输和本地启动入口。
5. Worker 接入 contracts 验证、取消、三 seed 稳定调度；在生产公式未完成前继续返回 `unknown-rules`。

## 尚未完成，不能声称已有精确最优分工

- Boss 主动攻击和技能；
- 治疗、威胁、死亡/复活、光环和 debuff uptime；
- Lv.110/120 面板对成长公式的实测校准；
- 完整双 Boss × 三 seed 模拟内循环；
- 生活专业工作力、攻击门槛和真实页面字段的端到端采集校准；
- 成员插件与真实 MWI 页面的端到端验收；

当前代码是可验证的工程基线，不是已经校准完成的公会战结果。
