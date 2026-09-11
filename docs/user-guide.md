# 使用指南

面向第一次安装的人：准备依赖、接通 CPA、配置飞书，再从手机给自己的工作目录发任务。

## 1. 准备什么

| 依赖 | 你需要做什么 |
|---|---|
| macOS 或 Linux；Windows 使用 WSL2 | Gateway 与工具在这台机器执行；原生 Windows 未纳入本项目运行验证 |
| Node.js 20+、npm | `node --version` 与 `npm --version` 能执行；本项目本地验证使用 Node 22 |
| Claude Agent SDK 和 Claude Code 运行时 | `npm ci` 自动安装 SDK 及对应平台运行时；通常不用另外安装 Claude CLI，不要省略 optional dependencies |
| Linux / WSL2 沙箱依赖 | Ubuntu/Debian 执行 `sudo apt-get install bubblewrap socat`；其他发行版见下方官方说明 |
| 一个可用的 CPA 服务 | 已连接你的上游账号或 API Key，并能实际调用目标模型 |
| 飞书企业自建应用 | 能创建机器人、申请消息权限并发布给自己使用 |
| 一个工作目录 | Agent 处理文件和运行命令的位置，例如 `~/agent-work`；可以是空目录 |

不需要 GPU、Python、Docker、Redis 或数据库。Git 仅在获取源码、开发或运行端到端验证脚本时需要。运行任务所需的 Python、浏览器等由你按工作内容另装。

Linux/WSL2 的用户命名空间、AppArmor、容器限制按 [Claude 沙箱安装说明](https://code.claude.com/docs/en/sandboxing#set-up-linux-and-wsl2)检查。本项目要求沙箱可用，缺依赖会失败，不会自动改成无沙箱运行。

## 2. 先确认 CPA 能用

### 已经有 CPA

你只需要提供三样东西：**服务根地址、客户端 API Key、模型 ID**。

| 项目 | 正确填写方式 | 常见误填 |
|---|---|---|
| 服务地址 | `http://127.0.0.1:8317`；远程实例填 Gateway 机器能访问的 HTTPS 地址 | 管理页面地址、`/v0/management`、`/v1/messages` |
| 客户端 API Key | CPA 配置 `api-keys` 中的一项，或面板创建的客户端 Key | 管理密码、上游账号 OAuth 文件、飞书 App Secret |
| 模型 ID | CPA `/v1/models` 返回的 `data[].id`，包含你的实际别名或前缀 | 从另一个应用界面抄下来的展示名称 |

CPA 的客户端 Key 与管理 Key 是不同用途；Gateway 只调用模型接口，不需要管理权限。[CPA 配置项](https://help.router-for.me/configuration/options)、[管理 API 鉴权](https://help.router-for.me/management/api)。

→ **CPA 必须提供 Anthropic Messages 接口和流式响应，并正确转换图片、`tool_use` / `tool_result`。** 只有 OpenAI Chat Completions 接口可用，还不足以支持本项目。

目前未声明最低 CPA 版本，按上述接口能力和第 5 节的实测结果验收。

→ 用 Gemini/GPT 时，底座仍是 Claude Agent SDK。上游账号登录、额度、模型路由由 CPA 管理；Gateway 不读取这些账号的 OAuth 文件。

→ `gemini-3.8-flash-high` 是本项目使用者环境中已验证的 CPA ID，不保证你的实例也有。`models` 列表只是允许选择的名称，不会替 CPA 创建模型。

在 CPA 面板查看模型列表，或替换下面的客户端 Key 后查询，使用响应里的 `data[].id`：

```bash
curl --fail --silent --show-error http://127.0.0.1:8317/v1/models \
  -H "Authorization: Bearer <CPA客户端Key>"
```

远程 CPA 将地址换成实际地址；稍后也可直接运行 `doctor --online` 验证配置的模型。

### 还没有 CPA

按 [CPA 官方安装说明](https://help.router-for.me/introduction/quick-start)安装，并按你使用的账号渠道完成登录或上游配置。已有 CPA 不用重装。

同机部署的 CPA 配置至少关注下面几项；**这是 CPA 自己的配置，不是 Gateway 配置**：

```yaml
host: "127.0.0.1"
port: 8317
api-keys:
  - "替换为你自己生成的客户端密钥"
```

这段只解决监听和客户端认证；还需要可调用模型的上游账号。字段以 [CPA 配置示例](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)为准。上游账号如何登录与续期由 CPA 文档负责。

### 两个服务放哪里

| 部署方式 | Gateway 中的 CPA 地址 |
|---|---|
| CPA 与 Gateway 在同一台电脑 | `http://127.0.0.1:8317` |
| CPA 在另一台服务器 | 可达的 HTTPS 地址，或通过你已有的私有隧道访问 |
| CPA 在 Docker，Gateway 在宿主机 | CPA 映射到宿主机的端口 |

手机只要能用飞书就能发任务；模型网络由 Gateway/CPA 所在机器负责。`127.0.0.1` 始终指当前进程所在机器或容器。

## 3. 配置飞书机器人

1. 在[飞书开放平台](https://open.feishu.cn/app)创建**企业自建应用**，添加机器人能力；记录 App ID 与 App Secret。
2. 在权限管理中申请下表权限，并把应用可见范围设为包含自己。
3. 获取你在**这个应用下**的 Open ID：打开[通过手机号或邮箱获取用户 ID](https://open.feishu.cn/document/server-docs/contact-v3/user/batch_get_id)的 API 调试台，选择该应用，`user_id_type=open_id`，填写自己的手机号或邮箱；结果的 `user_id` 就是要填的 Open ID。按接口页申请通讯录权限，授权范围要包含自己。
4. 按第 4 节填配置，用第 5 节 `start` 建立连接。然后在“事件与回调”选择**长连接**并订阅 `im.message.receive_v1`；控制台要求先建立连接时，保持 Gateway 运行再保存。
5. 创建并发布应用版本，使机器人、权限和可见范围生效。在飞书搜索并打开这个机器人，先使用单聊。

| 使用场景 | 在权限管理搜索 | 用途 |
|---|---|---|
| 单聊输入 | `im:message.p2p_msg:readonly` | 接收你发给机器人的消息 |
| 机器人回复 | `im:message:send_as_bot` | 发送文字和卡片 |
| 图片输入 | `im:resource` | 获取消息中的图片资源 |
| 首次查询自己的 Open ID | `contact:user.id:readonly` | 允许按手机号或邮箱查询 ID；应用授权范围需包含自己 |
| 可选群聊 | `im:message.group_at_msg:readonly` | 接收群里 @机器人的消息 |

权限与事件细节以[接收消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[发送消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)、[获取消息资源](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get)页面为准；不要把事件名当作权限名。

→ Open ID 通常以 `ou_` 开头，不是手机号、工号、App ID 或聊天 ID。不同应用的同一用户 Open ID 不能混用。没有允许操作的用户，Gateway 拒绝启动。

→ 同一机器人只运行一个 Gateway 进程，避免多条长连接争抢事件。

## 4. 安装并填写配置

在这份项目源码目录执行：

```bash
npm ci
npm run build
mkdir -p "$HOME/agent-work"
node dist/cli.js init --workspace "$HOME/agent-work"
```

默认生成 `~/.config/feishu-agent-gateway/config.yaml`。已存在时 `init` 不覆盖，直接编辑已有文件。

把配置改成下面这样；只保留 CPA 确实提供的模型：

```yaml
runtime: claude-sdk
workspace: ~/agent-work
data_dir: ~/.local/share/feishu-agent-gateway/data
model: REPLACE_WITH_CPA_MODEL_ID
models: [REPLACE_WITH_CPA_MODEL_ID]
effort: high
provider:
  type: cpa
  base_url: http://127.0.0.1:8317
  credentials_file: ./cpa.json
feishu:
  credentials_file: ./feishu.json
```

在**同一配置目录**创建 `cpa.json`：

```json
{"api_key": "填写 CPA 客户端 Key"}
```

再创建 `feishu.json`：

```json
{
  "app_id": "cli_填写应用ID",
  "app_secret": "填写应用Secret",
  "allowed_open_id": "ou_填写自己的OpenID"
}
```

```bash
chmod 700 "$HOME/.config/feishu-agent-gateway"
chmod 600 "$HOME/.config/feishu-agent-gateway/"*.json "$HOME/.config/feishu-agent-gateway/config.yaml"
```

→ `workspace` 必须已经存在；这是 Agent 运行工具的位置。`data_dir` 保存日志、附件和会话索引，程序会创建它。不要把密钥文件放进公开仓库。

→ 相对路径以配置文件目录为准，支持 `~`；不展开 YAML 中的 `$HOME` 或 `${变量}`。本项目不会自动加载 `.env`。

完整字段、环境变量覆盖和 `claude_command` 见[配置参考](configuration.md)。

### 使用安装包

如果拿到的是 `.tgz`，不需要源码构建工具；安装后用包里的可执行文件代替 `node dist/cli.js`：

```bash
FGW_APP_DIR="$HOME/.local/share/feishu-agent-gateway/app"
npm install --prefix "$FGW_APP_DIR" --omit=dev /absolute/path/to/package.tgz
FGW_BIN="$FGW_APP_DIR/node_modules/.bin/feishu-agent-gateway"
"$FGW_BIN" init --workspace "$HOME/agent-work"
"$FGW_BIN" doctor --online
"$FGW_BIN" start
```

`.tgz` 的构建方式见[技术设计](architecture.md#开发与打包)。配置格式与源码运行完全相同；不要用全局 `npx` 意外下载同名的其他包。

## 5. 启动并验收

在源码目录依次执行；自定义配置时，**每条命令都加** `--config /absolute/path/config.yaml`。

```bash
node dist/cli.js doctor
node dist/cli.js doctor --online
node dist/cli.js start
node dist/cli.js status
```

| 检查 | 通过时说明什么 | 还没覆盖什么 |
|---|---|---|
| `doctor` | 配置、工作目录、凭据字段可读取；显式 Claude 路径可执行 | 上游鉴权、飞书权限、Bash 沙箱 |
| `doctor --online` | 再检查 CPA `/v1/models` 返回成功且包含默认模型 | 真实生成、图片和工具调用 |
| `status` 中 `ready: true` | 飞书长连接已建立 | 消息权限和模型实际响应 |
| 飞书发送“只回复 OK” | 收发与模型调用可用 | 图片与工具 |
| 发图片，再问“刚才图里是什么” | 图片和会话续接可用 | 工具权限 |
| 发送“在当前工作目录写入 hello.txt，内容 hello” | 文件工具可用 | 工作区以外的额外权限 |

需要自动验证 CPA 图片、续聊和 Bash，可从源码执行 `npm run smoke -- /absolute/path/config.yaml`。它会调用模型、消耗 CPA 上游额度，在临时目录写测试文件；不会给飞书发消息。

## 6. 日常怎么用

| 飞书输入 | 结果 |
|---|---|
| 普通文字或图片 | 在当前会话继续；图片最多 4 张，每张 5 MiB，PNG/JPEG/GIF/WebP |
| `/new` | 下条消息开启新会话；已有历史保留 |
| `/model` | 查看当前模型和允许选择的 ID |
| `/model 完整模型ID` | 切换模型，下条消息开启新会话 |
| `/sessions` → `/switch 1` | 查看历史，恢复指定会话和该会话的模型 |
| `/pin 1`、`/unpin 1`、`/top` | 管理置顶会话 |
| `/stop` | 中断当前任务，下次消息开启新会话 |
| `/status`、`/help` | 查看状态与帮助 |

配置文件变更需要 `restart`；飞书 `/model` 不需要重启进程。重启会恢复已有当前会话对应的模型，因此修改默认 `model` 后要切换现有会话，请在飞书使用 `/model`。

→ 一个实例同时执行一个任务，执行中发来的其他普通消息会提示忙，不会排队。不同聊天共享当前会话；个人使用建议单聊，或配置 `allowed_chat_ids`。

```bash
node dist/cli.js restart   # 服务运行中，重新加载配置
node dist/cli.js stop
node dist/cli.js start     # 已停止时用 start
node dist/cli.js logs      # 输出后台日志路径
```

将 `logs` 输出的路径交给 `tail -f` 可以跟踪日志。`stop`/`status` 只依赖状态路径，即使 CPA 或飞书密钥过期仍可使用。

## 7. 常驻与权限

`start` 在后台运行，终端关闭后继续工作；机器休眠、关机或网络中断会影响服务。要开机自启，用 launchd/systemd 执行**前台 `run`**，不要再包一层 `start`。

Linux 用户级 systemd 示例，保存到 `~/.config/systemd/user/feishu-agent-gateway.service`；替换 Node、CLI 和配置的绝对路径：

```ini
[Unit]
Description=Feishu Agent Gateway
After=network-online.target
[Service]
ExecStart=/absolute/path/node /absolute/path/app/dist/cli.js run --config /private/path/config.yaml
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

若 Linux 服务需要在用户退出登录后或无人登录时运行，还需由管理员按服务器策略启用该用户的 lingering。

macOS launchd 设置 `ProgramArguments` 为 Node 绝对路径、CLI 绝对路径、`run`、`--config`、配置绝对路径，启用 `RunAtLoad` 与 `KeepAlive`。服务管理器通常不继承终端 PATH/代理，需要在服务环境中明确配置。

→ 由服务管理器托管时，使用 `systemctl` / `launchctl` 启停；直接执行 CLI `stop` 可能被自动拉起。

权限由飞书发送者白名单和 Claude 工具权限共同控制：允许工作区内自动编辑，Bash 强制沙箱；需要额外批准的工具调用会被拒绝。聊天里回复“同意”不会解除权限限制。管理员应在本机按实际需求配置工作区的 Claude 项目权限，再重试任务。

CPA Key、飞书 Secret、聊天正文、成功附件和 Claude 会话都应按私人数据管理。控制接口仅监听 `127.0.0.1`，用本地令牌认证；项目不提供多人隔离或远程审批页面。

## 8. 常见问题

| 现象 | 先做这一步 |
|---|---|
| `Missing ...` / `Cannot read credentials file` | 对照配置参考；确认文件路径以配置目录为基准、JSON 无尾逗号 |
| CPA 401/403 | 确认填的是客户端 Key，且 `base_url` 是模型服务根地址 |
| `Configured model is not listed` | 查询当前 CPA 模型列表，把实际 ID 填到 `model` 与 `models` |
| `ready=true` 但飞书无回复 | 检查应用发布、消息事件、消息权限；日志若显示 `non-allowlisted sender`，核对本应用下的 Open ID |
| 文字可用，图片或工具失败 | 分别检查飞书 `im:resource` 权限和 CPA 上游能力；用 `npm run smoke` 区分模型链路与飞书链路 |
| `bwrap` / sandbox 错误 | 按依赖章节和官方沙箱指南检查当前操作系统环境 |
| `Gateway data directory is owned by live PID` | 已有实例占用该数据目录；先确认它的配置和归属，再正常停止 |
| `Gateway is not running (no control record)` | 先 `start`；用自定义配置启动的，查询也要带相同 `--config` |
