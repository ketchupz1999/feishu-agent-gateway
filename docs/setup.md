# 安装与首次使用

从零到飞书发出第一条消息。

## 你需要准备什么

| 依赖 | 说明 |
|---|---|
| macOS 或 Linux（Windows 用 WSL2） | Gateway 和工具在这台机器执行 |
| Node.js 20+、npm | 本项目验证使用 Node 22 |
| 一个可用的 CPA 服务 | 已连接上游账号，能实际调用目标模型 |
| 飞书企业自建应用 | 能创建机器人并发布给自己使用 |
| 一个工作目录 | Agent 运行命令和处理文件的位置，例如 `~/agent-work` |

不需要 GPU、Python、Docker 或数据库。

→ Linux/WSL2 需要 `bubblewrap` 和 `socat`（`sudo apt-get install bubblewrap socat`），以及用户命名空间等沙箱条件。详见 [Claude 沙箱安装说明](https://code.claude.com/docs/en/sandboxing#set-up-linux-and-wsl2)。

→ SDK 自带对应平台的 Claude 运行时，通常不用另装 Claude CLI。`npm ci` 时不要跳过 optional dependencies。

## 最小配置

Gateway 需要三个文件，默认都在 `~/.config/feishu-agent-gateway/` 下。

**config.yaml** — 主配置：

```yaml
runtime: claude-sdk
workspace: ~/agent-work
model: REPLACE_WITH_CPA_MODEL_ID
models: [REPLACE_WITH_CPA_MODEL_ID]
provider:
  type: cpa
  base_url: http://127.0.0.1:8317
  credentials_file: ./cpa.json
feishu:
  credentials_file: ./feishu.json
```

**cpa.json** — CPA 客户端凭据：

```json
{"api_key": "填写 CPA 客户端 Key"}
```

**feishu.json** — 飞书应用凭据：

```json
{
  "app_id": "cli_填写应用ID",
  "app_secret": "填写应用Secret",
  "allowed_open_id": "ou_填写自己的OpenID"
}
```

下面逐字段说明每个值从哪来。

### config.yaml 字段说明

| 字段 | 填什么 | 从哪来 |
|---|---|---|
| `runtime` | 固定 `claude-sdk` | 当前唯一实现 |
| `workspace` | 已存在的目录 | 你自己创建，如 `~/agent-work` |
| `model` | CPA 中的模型 ID | 查询 CPA `/v1/models`，用 `data[].id`（见下文） |
| `models` | 允许切换的模型列表 | 同上；`model` 会自动加入 |
| `provider.type` | 固定 `cpa` | 当前唯一实现 |
| `provider.base_url` | CPA 服务根地址 | 同机默认 `http://127.0.0.1:8317` |
| `provider.credentials_file` | CPA 凭据 JSON 路径 | 相对于配置文件目录 |
| `feishu.credentials_file` | 飞书凭据 JSON 路径 | 相对于配置文件目录 |

→ 相对路径以配置文件目录为基准，支持 `~/`。不展开 `$HOME` 或 `${变量}`，不自动加载 `.env`。

→ 完整字段、可选配置和环境变量覆盖见[配置参考](configuration.md)。

### 模型 ID 怎么拿

替换你的客户端 Key 后执行：

```bash
curl --fail -s http://127.0.0.1:8317/v1/models \
  -H "Authorization: Bearer <CPA客户端Key>"
```

用响应里 `data[].id` 的值填写 `model` 和 `models`。不要填应用界面的展示名称。

### CPA 凭据说明

`api_key` 是 CPA 的**客户端 Key**（用于调模型），不是管理 Key。Gateway 只调用模型接口，不需要管理权限。

→ CPA 必须提供 **Anthropic Messages 接口和流式响应**，并正确转换图片和 `tool_use`/`tool_result`。只有 OpenAI Chat Completions 可用还不够。

→ 用 Gemini/GPT 时底座仍是 Claude Agent SDK。上游账号由 CPA 管理，Gateway 不读上游 OAuth 文件。

### 飞书凭据说明

| 字段 | 从哪来 |
|---|---|
| `app_id` | 飞书开放平台 → 你的应用 → 基本信息 |
| `app_secret` | 同上 |
| `allowed_open_id` | 该应用下你自己的 Open ID（以 `ou_` 开头），获取方式见下节 |

→ Open ID 不是手机号、工号或 App ID。不同应用的同一用户 Open ID 不同。

## 还没有 CPA？

按 [CPA 官方安装说明](https://help.router-for-me/introduction/quick-start)安装。同机部署至少关注这几项（**这是 CPA 自己的配置，不是 Gateway 配置**）：

```yaml
host: "127.0.0.1"
port: 8317
api-keys:
  - "替换为你自己生成的客户端密钥"
```

还需要上游账号才能调用模型。字段以 [CPA 配置示例](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)为准。

| Gateway 与 CPA 的位置 | `base_url` 填什么 |
|---|---|
| 同一台机器 | `http://127.0.0.1:8317` |
| CPA 在远程服务器 | 该机器可达的 HTTPS 地址 |
| CPA 在 Docker | 映射到宿主机的端口 |

## 配置飞书机器人

1. 在[飞书开放平台](https://open.feishu.cn/app)创建**企业自建应用**，添加机器人能力。记录 App ID 与 App Secret。
2. 权限管理中申请以下权限，应用可见范围设为包含自己：

| 权限 | 用途 |
|---|---|
| `im:message.p2p_msg:readonly` | 接收单聊消息 |
| `im:message:send_as_bot` | 发送回复 |
| `im:resource` | 获取图片资源 |
| `contact:user.id:readonly` | 首次查询自己的 Open ID（授权范围需包含自己） |
| `im:message.group_at_msg:readonly` | 可选：接收群聊 @机器人消息 |

3. 获取你的 **Open ID**：打开[通过手机号或邮箱获取用户 ID](https://open.feishu.cn/document/server-docs/contact-v3/user/batch_get_id) 的 API 调试台，选择该应用，`user_id_type=open_id`，填写手机号或邮箱。结果中 `user_id` 就是你要填的值。

4. 在"事件与回调"选择**长连接**，订阅 `im.message.receive_v1`。如果控制台要求先建立连接，保持 Gateway 运行再保存。

5. 创建并发布应用版本，使权限和可见范围生效。

→ 同一机器人只运行一个 Gateway 进程，避免多条长连接争抢事件。

→ 权限细节以[接收消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[发送消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)、[获取消息资源](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get)页面为准。

## 安装与启动

### 从源码

```bash
npm ci
npm run build
mkdir -p ~/agent-work
node dist/cli.js init --workspace ~/agent-work
```

`init` 在 `~/.config/feishu-agent-gateway/` 生成模板配置。已存在时不覆盖，直接编辑。

按上面的最小配置填好三个文件后：

```bash
chmod 700 ~/.config/feishu-agent-gateway
chmod 600 ~/.config/feishu-agent-gateway/*.json ~/.config/feishu-agent-gateway/config.yaml
node dist/cli.js doctor
node dist/cli.js doctor --online
node dist/cli.js start
```

### 从 .tgz 安装包

```bash
FGW_APP="$HOME/.local/share/feishu-agent-gateway/app"
npm install --prefix "$FGW_APP" --omit=dev /path/to/package.tgz
FGW="$FGW_APP/node_modules/.bin/feishu-agent-gateway"
"$FGW" init --workspace ~/agent-work
# 填好配置后：
"$FGW" doctor --online
"$FGW" start
```

后续命令用 `$FGW` 代替 `node dist/cli.js`。不要用全局 `npx` 意外下载同名包。

## 验收：确认能用

按顺序验证，每一步通过后再进下一步：

| 步骤 | 命令或操作 | 通过说明 | 还没覆盖 |
|---|---|---|---|
| 1 | `doctor` | 配置、凭据、工作目录可读取 | 上游鉴权、飞书权限 |
| 2 | `doctor --online` | CPA 认证成功，默认模型存在 | 真实推理、图片和工具 |
| 3 | `start` → `status` 显示 `ready: true` | 飞书长连接已建立 | 消息权限和模型响应 |
| 4 | 飞书发送"只回复 OK" | 收发和模型调用可用 | 图片和工具 |
| 5 | 发图片，再问"刚才图里是什么" | 图片和会话续接可用 | 工具权限 |
| 6 | "在当前工作目录写入 hello.txt，内容 hello" | 文件工具可用 | — |

→ 自动验证 CPA 图片、续聊和 Bash：`npm run smoke -- /path/config.yaml`（消耗上游额度，不发飞书消息）。

## 日常使用

### 飞书命令

| 输入 | 效果 |
|---|---|
| 普通文字或图片 | 当前会话继续对话。图片最多 4 张，每张 5 MiB |
| `/new` | 下条消息开启新会话，历史保留 |
| `/model` | 查看当前模型和可选列表 |
| `/model <ID或别名>` | 切换模型，开启新会话。配置了 `model_aliases` 时可用短名 |
| `/sessions` → `/switch <序号>` | 查看历史，恢复指定会话及其模型 |
| `/pin`、`/unpin`、`/top` | 管理置顶会话 |
| `/stop` | 中断当前任务 |
| `/status`、`/help` | 状态与帮助 |

→ 一个实例同时只执行一个任务。执行中发来的消息会提示忙，不会排队。

→ 飞书 `/model` 不需要重启进程。配置文件变更需要 `restart`。

### CLI 管理

```bash
node dist/cli.js status     # 查看运行状态
node dist/cli.js restart    # 重新加载配置
node dist/cli.js stop       # 停止
node dist/cli.js logs       # 输出日志路径，配合 tail -f 使用
```

### 常驻运行

`start` 在后台运行，终端关闭后继续工作。机器休眠或网络中断会影响服务。

开机自启用 launchd（macOS）或 systemd（Linux）执行前台 `run` 命令，不要再包一层 `start`。

<details>
<summary>Linux systemd 示例</summary>

保存到 `~/.config/systemd/user/feishu-agent-gateway.service`，替换实际路径：

```ini
[Unit]
Description=Feishu Agent Gateway
After=network-online.target
[Service]
ExecStart=/absolute/path/node /absolute/path/cli.js run --config /private/path/config.yaml
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077
[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now feishu-agent-gateway
journalctl --user -u feishu-agent-gateway -f
```

退出登录后仍需运行时，由管理员启用该用户的 lingering。

</details>

<details>
<summary>macOS launchd 提示</summary>

`ProgramArguments` 填 Node 绝对路径、CLI 绝对路径、`run`、`--config`、配置绝对路径。启用 `RunAtLoad` 与 `KeepAlive`。服务管理器通常不继承终端 PATH 和代理环境，需要在服务配置中显式指定。

</details>

→ 托管后用 `systemctl` / `launchctl` 启停，直接 CLI `stop` 可能被自动拉起。

## 常见问题

| 现象 | 排查 |
|---|---|
| `Missing ...` / `Cannot read credentials file` | 检查文件路径（相对于配置目录）、JSON 无尾逗号 |
| CPA 401/403 | 确认是客户端 Key，`base_url` 是模型服务根地址（不是管理地址） |
| `Configured model is not listed` | 查 CPA 模型列表，填实际 ID 到 `model` 和 `models` |
| `ready=true` 但飞书无回复 | 检查应用发布状态、消息事件和权限。日志 `non-allowlisted sender` → 核对 Open ID |
| 文字可用，图片或工具失败 | 飞书侧检查 `im:resource` 权限；CPA 侧检查上游模型能力 |
| `bwrap` / sandbox 错误 | 按沙箱安装说明检查操作系统环境 |
| `Gateway data directory is owned by live PID` | 已有实例占用该数据目录；先确认后正常停止 |
| `Gateway is not running` | 先 `start`；自定义配置要带 `--config` |
