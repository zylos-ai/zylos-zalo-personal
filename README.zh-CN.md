<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-zalo-personal</h1>

<p align="center">
  <a href="https://github.com/zylos-ai/zylos-core">Zylos</a> 智能体的 Zalo 个人账号通讯组件。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://discord.gg/GS2J39EGff"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/ZylosAI"><img src="https://img.shields.io/badge/X-follow-000000?logo=x&logoColor=white" alt="X"></a>
  <a href="https://zylos.ai"><img src="https://img.shields.io/badge/website-zylos.ai-blue" alt="Website"></a>
  <a href="https://coco.xyz"><img src="https://img.shields.io/badge/Built%20by-Coco-orange" alt="Built by Coco"></a>
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

- **Zalo 对话** — 你的 AI 智能体使用真实 Zalo 账号，支持私聊和群聊
- **丰富媒体** — 收发图片、文件、贴纸、表情回应和输入状态指示
- **智能群组监控** — 自动关注指定群组的所有讨论，无需 @
- **零配置启动** — 第一条消息自动绑定为管理员，无需繁琐设置
- **二维码登录** — 用 Zalo 手机端扫码一次，会话跨重启保持

> **注意:** 本组件使用 [zca-js](https://github.com/nicejom/zca-js)（非官方的 Zalo Web 逆向工程客户端），而非官方 Bot Platform API。详见[重要注意事项](#重要注意事项)。

## 快速开始

告诉你的 Zylos 智能体：

> "安装 zalo-personal 组件"

或使用 CLI：

```bash
zylos add zylos-ai/zylos-zalo-personal
```

首次启动时，服务会生成一个二维码。用 Zalo 手机端扫描即可完成认证。连接成功后，在 Zalo 上给该账号发消息 — 第一个交互的用户自动成为管理员。

## 管理机器人

直接告诉你的 Zylos 智能体：

| 操作 | 示例 |
|------|------|
| 添加白名单用户 | "把用户 xxx 加入 zalo-personal 白名单" |
| 启用智能群组 | "把这个群在 zalo-personal 中设为 smart 模式" |
| 修改 DM 策略 | "把 zalo-personal DM 策略设为 open" |
| 查看状态 | "看下 zalo-personal 状态" |
| 重启机器人 | "重启 zalo-personal" |
| 升级组件 | "升级 zalo-personal 组件" |
| 卸载组件 | "卸载 zalo-personal 组件" |

或通过 CLI 管理：

```bash
zylos upgrade zalo-personal
zylos uninstall zalo-personal
```

## 群聊行为

| 场景 | 机器人响应 |
|------|-----------|
| 私聊（管理员/白名单） | 通过 Claude 回复 |
| 智能群组消息 | 接收所有消息 |
| 在允许的群里 @机器人 | 带上下文回复 |
| 管理员在未注册群 @机器人 | 自动注册群组 |
| `groupPolicy: disabled` | 所有群消息屏蔽 |
| 未知用户 | 忽略 |

## 重要注意事项

> **使用风险自负。** 本组件使用非官方 API，可能导致你的 Zalo 账号被限制或永久封禁。我们不对 Zalo 采取的任何账号处理措施负责。

- **非官方 API** — zca-js 是 Zalo Web 的逆向工程无头客户端。Zalo 可以随时修改内部 API，导致此通道中断。
- **账号封禁风险** — 使用非官方自动化违反 Zalo 服务条款。你的账号可能在无预警的情况下被临时限制或永久封禁。建议使用备用账号 — 不要拿主账号冒险。
- **单一网页会话** — 同时只能有一个 Zalo Web 会话。运行此服务会断开浏览器中的 Zalo Web。

## 文档

- [SKILL.md](./SKILL.md) — 组件规格说明
- [DESIGN.md](./DESIGN.md) — 架构与设计
- [CHANGELOG.md](./CHANGELOG.md) — 版本历史

## 参与贡献

请查看[贡献指南](https://github.com/zylos-ai/.github/blob/main/CONTRIBUTING.md)。

## 由 Coco 构建

Zylos 是 [Coco](https://coco.xyz/)（AI 员工平台）的开源核心基础设施。

我们构建 Zylos 是因为我们自己需要它：可靠的基础设施，让 AI 智能体 24/7 稳定运行。每个组件都在 Coco 生产环境中经过实战检验，服务于每天依赖 AI 员工的团队。

想要开箱即用？[Coco](https://coco.xyz/) 提供即开即用的 AI 员工——持久记忆、多渠道沟通、技能包——5 分钟完成部署。

## 许可证

[MIT](./LICENSE)
