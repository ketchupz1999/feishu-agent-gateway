# v2 迁移

v2 独立安装，宿主不再复制源码。

| v1 | v2 |
|---|---|
| Python/Node Gateway 多份源码 | 固定版本应用包 |
| 从源码目录猜 workspace | `workspace` 或 `--workspace` |
| `gateway_mode` | `runtime: claude-sdk` |
| `codex_model` / `gateway_model` | `model` |
| `codex_reasoning_effort` | `effort` |
| 业务命令、Daemon、Skills | 留在宿主工作区 |

已使用 Claude SDK 的实例可以继续指定原 `data_dir`，保留 `.gateway_claude_sessions.json`。原生会话内容仍由 Claude Code 保存，工作目录保持不变。其他运行时的 thread ID 不作为 Claude session 使用。

宿主只维护版本号/校验和、私有配置和部署脚本。先验证独立安装，停旧实例并启动新包，确认连接正常后再移除旧源码。借用旧 Gateway `node_modules` 的业务 runner 必须先安装自己的 SDK 依赖。

`listener_channels` 仍可托管宿主的外部通道，命令用 argv 数组。v2 不附带微信实现，服务退出时会向自己启动的通道进程组发出终止信号。
