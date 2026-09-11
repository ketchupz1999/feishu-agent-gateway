# 部署与升级

面向独立安装者；工作区无需特定目录、Makefile 或脚手架。

## 安装与配置

按 [README](../README.md#快速开始) 构建并安装 tarball，运行 `init --config /private/path/config.yaml --workspace /your/workspace`。参数见[完整示例](../examples/config.yaml)。相对路径以配置文件目录为准。

| 来源 | 内容 |
|---|---|
| `provider.credentials_file` | JSON：`api_key`，使用 CPA 客户端 Key |
| `feishu.credentials_file` | JSON：`app_id`、`app_secret`、`allowed_open_id` |
| 环境覆盖 | `CPA_API_KEY`、`CPA_BASE_URL`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_ALLOWED_OPEN_ID` |

凭据文件设为 `0600`，父目录设为 `0700`。`runtime` 选执行底座，`provider` 选 API，`model` 选模型；`models` 是飞书允许选择的模型列表。

```bash
feishu-agent-gateway doctor --config /private/path/config.yaml --online
feishu-agent-gateway start --config /private/path/config.yaml
feishu-agent-gateway status --config /private/path/config.yaml
feishu-agent-gateway stop --config /private/path/config.yaml
```

`status`/`stop` 不要求模型或飞书凭据仍有效。没有控制记录时不会直接杀 PID；旧版本实例应先用旧入口正常停止。

## Mac / Linux 常驻

`start` 是普通后台运行；Mac 睡眠后不能保证继续工作。服务管理器应执行前台 `run`，不要包装 `start`。

Linux/WSL2 使用非 root 服务账户，安装 `bubblewrap` 和 `socat`；AppArmor、容器和 WSL2 配置按 [Claude 官方沙箱指南](https://code.claude.com/docs/en/sandboxing#set-up-linux-and-wsl2)。

systemd 用户服务示例，替换绝对路径后启用：

```ini
[Unit]
Description=Feishu Agent Gateway
After=network-online.target
[Service]
ExecStart=/absolute/path/to/node /absolute/path/to/app/node_modules/feishu-agent-gateway/dist/cli.js run --config /private/path/config.yaml
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077
[Install]
WantedBy=default.target
```

macOS launchd 的 `ProgramArguments` 依次为 Node 绝对路径、包的 `dist/cli.js`、`run`、`--config`、配置绝对路径；设置 `RunAtLoad`、`KeepAlive` 和私有 stdout/stderr 日志路径。服务不会自动继承终端的 PATH/代理，按需在服务环境配置。

## 升级与回滚

1. 记录版本，备份配置、凭据、`data_dir` 及 Claude 用户数据目录中的原生会话。
2. 新包安装到新的版本目录，校验版本与 SHA-512，执行 `doctor`。
3. 停止旧实例，使用新版本启动；确认 `status.ready=true`。
4. 失败则用上一个安装目录重新启动；若有数据格式迁移，按对应发布说明恢复备份。

不要覆盖运行中的安装目录，也不要在升级时重写工作区或密钥。

## 权限与数据

- 一个实例共享当前会话；不同聊天需要隔离时使用独立数据目录，或限制 `feishu.allowed_chat_ids`。
- 成功附件暂不自动过期，应随数据目录管理与备份。
- Bash 沙箱开启且禁止静默降级；其他工具仍受 Claude 权限与项目设置约束。这不是多租户虚拟机隔离。
- Claude 子进程默认只继承系统路径、代理、证书与宿主安全运行环境，不继承任意应用凭据。工具确实需要的额外变量可用 `pass_env: [MY_SERVICE_TOKEN]` 显式指定；这些值对 Claude 工具可见。配置中的 CPA/飞书路由和认证变量不能通过此项覆盖。工作区文件权限仍由运行用户与 Claude sandbox 控制。
- 控制接口仅监听 `127.0.0.1`；令牌在 `data_dir/gateway-control.json`，无需开放公网端口。

## 排障

| 现象 | 检查 |
|---|---|
| 配置/模型错误 | `doctor` / `doctor --online` |
| 飞书不收消息 | [Bot 设置](feishu.md)、应用发布、长连接、发送者白名单 |
| 图片失败 | 消息资源权限、格式、大小限制 |
| 端口冲突 | 每实例独立 data_dir，必要时指定不同 control_port |
| 旧 PID 阻止启动 | 检查旧实例归属，确认不是存活 Gateway 后人工清理陈旧记录；不要盲目 kill |

`logs` 打印后台 stdout 路径；结构化日志在 `data_dir/logs/YYYY-MM-DD-gateway.log`。

