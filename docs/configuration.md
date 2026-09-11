# 配置参考

所有字段的完整说明。首次填写按[安装指南](setup.md#最小配置)完成。

## 加载规则

| 规则 | 行为 |
|---|---|
| 默认路径 | `~/.config/feishu-agent-gateway/config.yaml` |
| 指定路径 | 每条 CLI 命令加 `--config /path/config.yaml` |
| 相对路径 | 配置中的相对路径以**配置文件目录**为基准；支持 `~/` |
| 工作区覆盖 | `--workspace DIR` 优先于配置中的 `workspace` |
| 环境变量 | 见下表；不自动读取 `.env`，不展开 YAML 内 `$变量` |
| 生效 | 启动时加载。修改后需 `restart`；飞书 `/model` 不需要重启 |

## 必填字段

| 字段 | 值 | 说明 |
|---|---|---|
| `runtime` | `claude-sdk` | 当前唯一实现，不可省略 |
| `workspace` | 已存在的目录路径 | Agent 运行工具的位置 |
| `model` | CPA 模型 ID | `/v1/models` 返回的 `data[].id` |
| `provider.type` | `cpa` | 当前唯一实现 |
| `provider.base_url` | HTTP(S) 地址 | CPA 服务根地址。末尾 `/v1` 会被规范化；不允许内嵌账号密码、查询参数或片段 |
| `provider.credentials_file` | JSON 路径 | 包含 `api_key`；设了 `CPA_API_KEY` 环境变量则可省略 |
| `feishu` | 对象 | 指定飞书凭据来源；纯环境变量方式也要保留 `feishu: {}` |
| `feishu.credentials_file` | JSON 路径 | 包含 `app_id`、`app_secret`、`allowed_open_id`；全部由环境变量提供时可省略 |

## 可选字段

| 字段 | 默认值 | 说明 |
|---|---|---|
| `data_dir` | `~/.local/share/feishu-agent-gateway/<配置路径哈希>` | 会话索引、附件、日志与进程状态。多实例必须分开 |
| `models` | 仅含 `model` | 飞书可选模型列表；`model` 自动加入 |
| `model_aliases` | `{}` | 别名→真实 ID 映射；`model` 和 `models` 可以直接填别名 |
| `effort` | `high` | `low` / `medium` / `high` / `xhigh` / `max`；具体模型不一定支持每档 |
| `claude_command` | SDK 平台运行时 | Claude 可执行文件的绝对路径；不是 shell 命令 |
| `feishu.allowed_open_id` | 凭据文件中的值 | 覆盖凭据文件的操作者 ID；不支持数组或通配 |
| `feishu.allowed_chat_ids` | `[]`（不限制） | 额外限制聊天 ID 列表；仍需匹配操作者 |
| `control_port` | 由 `data_dir` 哈希确定 | `1024..65535`；仅监听 `127.0.0.1` |
| `pass_env` | `[]` | 额外传给 Claude 工具的宿主环境变量名 |
| `listener_channels` | `{}` | 外部进程托管，见下文 |

→ 默认模型决定新实例没有当前会话时的选择。重启恢复当前会话保存的模型；该模型被移出 `models` 时清空当前指针，下次使用默认模型。

### model_aliases

给长模型 ID 起短名，用户在飞书和配置中都可以用短名操作。

```yaml
model_aliases:
  g-gemini: gemini-3.8-flash-high
  g-sol: gpt-5.6-sol
  g-sonnet: claude-sonnet-4-6

model: g-gemini          # 直接用别名
models: [g-gemini, g-sol, g-sonnet]
```

- 别名在配置加载时解析为真实 ID，内部全部使用真实 ID
- 飞书 `/model` 列表和 `/status` 显示短名
- `/model g-sol` 和 `/model gpt-5.6-sol` 都能匹配
- 不允许链式别名（别名指向别名）
- 没有 `model_aliases` 时行为不变

## 环境变量覆盖

优先级：**环境变量 → 配置字段 → 凭据文件 / 默认值**。

| 环境变量 | 覆盖项 |
|---|---|
| `CPA_BASE_URL` | `provider.base_url` |
| `CPA_API_KEY` | 凭据文件中的 `api_key` |
| `FEISHU_APP_ID` | 凭据文件中的 `app_id` |
| `FEISHU_APP_SECRET` | 凭据文件中的 `app_secret` |
| `FEISHU_ALLOWED_OPEN_ID` | `feishu.allowed_open_id` → 凭据文件中的值 |
| `CLAUDE_CODE_PATH` | `claude_command` |

→ Gateway 自动给 Claude 子进程设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`，不需要改全局 `~/.claude/settings.json`。直接设 `ANTHROPIC_*` 变量不会覆盖 Gateway 配置。

→ 只有对应凭据字段已齐全时，凭据文件才可省略。不要留失效路径再期望环境变量能跳过它。

## 外部进程：listener_channels

普通飞书聊天不需要此项。用于随 Gateway 启停外部进程。

```yaml
listener_channels:
  my_listener:
    enabled: true
    command: [/absolute/path/to/program, --config, /path/listener.json]
    env:
      LISTENER_MODE: personal
```

| 字段 | 规则 |
|---|---|
| 名称 | 字母、数字、`_`、`-` |
| `enabled` | 默认不启用，需设为 `true` |
| `command` | 非空字符串数组；按 argv 启动，不经 shell 展开 |
| `env` | 覆盖外部进程环境；继承 Gateway 启动环境，不使用 `pass_env` |
| 运行目录 | `workspace` |
| 日志 | `data_dir/logs/listener-<名称>.log` |
| 生命周期 | Gateway 退出时 SIGTERM 子进程组；子进程退出只记日志，不自动重启 |

→ 外部 listener 由你信任的程序运行，不受 Claude Bash 沙箱保护。
