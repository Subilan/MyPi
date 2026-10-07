# 指令

## 解析规则

一条消息只有在整条内容都能解析成一条已注册指令时才是指令，其它情况都按普通消息发给模型：

- `/clear 随便搜一下` 因为 `/clear` 不接受参数而落回普通消息。
- `/system edti` 这种拼错的子命令同样落回普通消息。

指令注册在 `src/lib/chat/commands.ts`，每条指令自己声明名字、别名、用法和参数解析方式。命中的指令在消息列表和输入框里都用主题色加粗显示。

## 指令表

| 指令 | 作用 |
| --- | --- |
| `/clear`、`/new` | 结束当前会话，开一个新的：清空模型上下文与界面上的聊天记录，旧会话留在磁盘上 |
| `/sessions` | 打开独立的会话列表页，输入关键词按 id 或内容过滤，↑ / ↓ 选择、Enter 或鼠标单击切换，Esc 返回 |
| `/sessions <序号\|id>` | 切换到某个历史会话，接着往下聊 |
| `/system` | 在聊天记录里展示当前系统提示词 |
| `/system edit` | 打开编辑器修改系统提示词，子命令支持前缀缩略（`e` / `ed` / `edi` / `edit`） |
| `/cd` | 在聊天记录里显示当前工作目录 |
| `/cd <path>` | 切换工作目录，支持 `~`、相对路径与引号包裹的含空格路径 |
| `/info` | 在聊天记录里显示模型、模式、运行状态、工作目录等运行信息 |
| `/mode` | 在聊天记录里显示当前模式 |
| `/mode <regular\|deliver>` | 切换模式，模式名支持前缀缩略（`r` / `reg` / `d` / `del`） |
| `/jump` | 进入跳转视图，在当前会话的消息树里回溯或切换分支 |
| `/ui` | 查看当前主题；`/ui list` 列出预设，`/ui apply <name\|default>` 用预设覆盖 theme.css，`/ui edit` 编辑 CSS |

## 补充说明

- `/clear` 调 sidecar 的 `agent.reset()` 重置模型侧的消息，并开一个新的会话，成功后前端整个消息列表也一起清掉，屏幕回到空状态。
- `/system` 以 `SYSTEM PROMPT` 为标题，正文先列文件路径，再把 sidecar 读回来的文件内容原样铺在聊天记录里，只读，要改就走 `/system edit`。

相关文档：[sessions.md](sessions.md)、[jump-and-branching.md](jump-and-branching.md)、[modes.md](modes.md)、[theming.md](theming.md)、[system-prompt.md](system-prompt.md)、[workdir.md](workdir.md)。
