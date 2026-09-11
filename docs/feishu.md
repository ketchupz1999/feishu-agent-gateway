# 飞书 Bot 配置

消息通过主动建立的长连接接收，本机无需公网 IP。

1. 在[飞书开放平台](https://open.feishu.cn/app)创建企业自建应用，启用机器人。
2. 将 App ID、App Secret 放入私有文件或环境变量。
3. 按接口要求开通读取发给机器人的消息、机器人发送消息、获取消息资源等权限。
4. 事件与回调选择长连接，订阅 `im.message.receive_v1`。这是事件名称，不是权限标识。
5. 发布应用版本，让机器人、权限和可见范围对目标用户生效。
6. 配置操作者 Open ID 白名单；为空时 Gateway 拒绝启动。

验证顺序：`doctor --online` → `start` → `status.ready=true` → 文字 → 图片与追问。

截图使用[获取消息中的资源文件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get)接口，机器人必须能访问原消息。下载用户图片不能使用仅允许下载机器人自行上传图片的接口。

具体权限标识以开放平台接口页为准；企业租户的发布、审批、可见范围可能需要管理员配置。
