# Feishu Agent Gateway（已停止维护）

> [!WARNING]
> 本项目是一个早期个人实验，现已停止维护，**不建议用于新部署或生产环境**。

这个仓库不会删除：源码、提交历史和原有文档都会继续保留，供回顾和参考。原 README 已备份为 [README.old](README.old)。

## 为什么不再推荐

这个项目验证了“通过飞书远程驱动本地 Agent”的思路，但作为长期使用的通用项目，它在稳定性、兼容性、安全边界和持续维护方面都不够成熟。现在已经有维护更积极、能力更完整的现成方案，没有必要继续在这个实验项目上投入部署和排障成本。

## 推荐替代方案

### 1. [cc-connect](https://github.com/chenhg5/cc-connect)

如果你的主要需求是把 **Claude Code 等编码 Agent 接入飞书**，建议优先使用 cc-connect。它面向多消息平台与多 Agent 的连接场景，安装和维护成本更低。

### 2. [Hermes Agent](https://github.com/NousResearch/hermes-agent)

如果你希望使用一个带有 **消息网关、工具和插件体系** 的完整 Agent，建议使用 Hermes Agent。Hermes 已提供飞书 / Lark 接入能力：

- [Feishu / Lark 配置文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu)
- [Hermes 插件体系](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)

## 关于本仓库

- 不再新增功能，也不保证与后续 Claude Code、飞书 API 或第三方模型服务兼容。
- 现有代码和文档仅作为历史实现参考，不代表推荐的部署方式。
- 如果仍要运行，请自行审查权限、凭据存储和本地命令执行风险，并使用最小权限与访问白名单。

MIT License © 2026 KetchupZ
