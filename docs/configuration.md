# 配置参考

本文是 Gateway 配置字段的唯一参考。首次填写按[使用指南](user-guide.md#4-安装并填写配置)完成；可复制[最小配置示例](../examples/config.yaml)。配置支持 YAML 或 JSON。

## 路径与加载规则

| 规则 | 行为 |
|---|---|
| 默认配置 | `~/.config/feishu-agent-gateway/config.yaml` |
| 指定配置 | 每条 CLI 命令使用 `--config /path/config.yaml` |
| 解析基准 | 配置中的相对路径都相对配置文件目录；支持开头的 `~/` |
| 工作区覆盖 | `--workspace DIR` 优先于配置 `workspace` |
| 环境变量 | 下表列出的变量会覆盖对应配置；不自动读取 `.env`，不展开 YAML 内的 `$变量` |
| 生效时间 | 启动时加载。修改配置或启动环境后重启；飞书 `/model` 仅改变当前运行实例的选择 |

## 必填配置

| 字段 | 填什么 | 来源 / 示例 |
|---|---|---|
| `runtime` | 固定 `claude-sdk` | 当前只实现这一种 Agent 底座 |
| `workspace` | 已存在的工作目录 | `~/agent-work`；工具在这里执行 |
| `model` | 默认模型的完整 ID | CPA `/v1/models` 的 `data[].id` |
| `provider.type` | 固定 `cpa` | 当前只实现 CPA 连接方式 |
| `provider.base_url` | CPA 模型服务根地址 | `http://127.0.0.1:8317`；末尾 `/v1` 会被规范化，仅接受 HTTP(S)，不允许 URL 内嵌账号密码、查询参数或片段；不能填完整消息或管理接口路径 |
| `provider.credentials_file` | JSON 文件路径；若设置 `CPA_API_KEY` 则可省略 | `./cpa.json`，包含 `api_key` |
| `feishu` | 飞书配置对象 | 指定下方凭据来源；纯环境变量方式也要保留 `feishu: {}` |
| `feishu.credentials_file` | JSON 文件路径；所需飞书值全部由环境/配置提供时可省略 | `./feishu.json`，包含 `app_id`、`app_secret`、`allowed_open_id` |

`runtime` 与 `provider.type` 是配置契约，目前不能靠改这两个值切换到 Codex SDK 或其他服务商。切换模型使用 `model/models`。

## 可选配置

| 字段 | 默认值 | 用途与限制 |
|---|---|---|
| `data_dir` | `~/.local/share/feishu-agent-gateway/<配置绝对路径的哈希>` | 会话索引、附件、日志与进程状态；多实例必须分开 |
| `models` | 仅 `model` | 飞书允许选择的模型列表；`model` 自动加入。建议使用完整 ID；不自动从 CPA 同步 |
| `effort` | `high` | SDK 接受 `low/medium/high/xhigh/max`；CPA/具体模型未必支持每档，改变模型后需实测 |
| `claude_command` | SDK 安装的对应平台运行时 | Claude 可执行文件绝对路径，如 `/home/me/.local/bin/claude`；不是带参数的 shell 命令 |
| `feishu.allowed_open_id` | 从凭据文件读取 | 覆盖凭据文件中的单个操作者 ID；不支持用户数组或通配 |
| `feishu.allowed_chat_ids` | `[]`，允许该操作者所在的可接收聊天 | 额外限制聊天 ID；例如 `[oc_xxx]`。即使在列表中，也仍需匹配操作者 |
| `control_port` | 从 `data_dir` 确定一个固定端口 | `1024..65535`；仅监听 `127.0.0.1`，冲突时显式指定 |
| `pass_env` | `[]` | 额外传给 Claude 工具的宿主环境变量名，如 `[MY_SERVICE_TOKEN]`；值对工具可见 |
| `listener_channels` | `{}` | 高级用法：随 Gateway 启动/停止外部进程，见后文 |

→ 默认模型只决定新实例没有当前会话时的选择。重启恢复当前会话保存的模型；该模型被移出 `models` 时清空当前指针，下次使用默认模型新建会话。

## 环境变量覆盖

| 环境变量 | 覆盖项 |
|---|---|
| `CPA_BASE_URL` | `provider.base_url` |
| `CPA_API_KEY` | CPA 凭据文件中的 `api_key` |
| `FEISHU_APP_ID` | 飞书凭据文件中的 `app_id` |
| `FEISHU_APP_SECRET` | 飞书凭据文件中的 `app_secret` |
| `FEISHU_ALLOWED_OPEN_ID` | `feishu.allowed_open_id`，然后才是凭据文件中的值 |
| `CLAUDE_CODE_PATH` | `claude_command`；使用绝对路径 |

优先级是：**对应环境变量 → 配置字段 → 凭据文件 / 默认值**。只有 CPA Key 或飞书必需字段已经齐全时，对应凭据文件才无需读取；不要留下失效路径再期望部分环境覆盖能跳过它。

Gateway 自动给 Claude 子进程设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`，不需要改全局 `~/.claude/settings.json`。直接设置这些 `ANTHROPIC_*` 变量不会覆盖 Gateway 配置。[CPA 的 Claude 接入约定](https://help.router-for.me/agent-client/claude-code)。

`pass_env` 用于额外工具变量；系统路径、代理、证书、宿主安全运行环境已有必要透传。Anthropic/Claude/CPA/Feishu 的路由及认证变量不能通过此项覆盖。项目设置或工作区文件仍可能影响工具行为，这不是完整操作系统隔离。

## 外部进程：listener_channels

普通飞书聊天不需要此项；Gateway 不自带微信通道实现。

```yaml
listener_channels:
  my_listener:
    enabled: true
    command: [/absolute/path/to/program, --config, /private/listener.json]
    env:
      LISTENER_MODE: personal
```

| 字段 | 规则 |
|---|---|
| 名称 | 字母、数字、`_`、`-` |
| `enabled` | 默认不启用，需明确设为 `true` |
| `command` | 非空字符串数组；按 argv 启动，不经 shell 展开 |
| `env` | 覆盖外部进程的环境；它继承 Gateway 启动环境，不使用 Claude 的 `pass_env` 过滤 |
| 运行目录 / 日志 | `workspace` / `data_dir/logs/listener-<名称>.log` |
| 生命周期 | Gateway 退出时 SIGTERM 子进程组；子进程退出只记日志，不自动重启 |

→ 这里只托管你信任的程序，外部 listener 不受 Claude Bash 沙箱保护。
