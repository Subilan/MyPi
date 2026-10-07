# 系统提示词

## 文件

系统提示词存成一个文件：`~/.agent-runbook/system-prompt.md`（`AGENT_RUNBOOK_SYSTEM_PROMPT` 可改路径）。

- sidecar 启动时文件不存在就用 settings.toml 里的 `system_prompt` 或内置默认值生成一份，之后以文件为准。
- 保存时 sidecar 会带上已有对话重建 Agent，新提示词从下一次请求开始生效，历史消息不丢。

## 查看与编辑

| 指令 | 作用 |
| --- | --- |
| `/system` | 以 `SYSTEM PROMPT` 为标题，正文先列文件路径，再把 sidecar 读回来的文件内容原样铺在聊天记录里，只读 |
| `/system edit` | 用编辑器打开该文件，子命令支持前缀缩略 |

编辑器本身见 [editor.md](editor.md)；工作目录变更也会追加到提示词末尾，见 [workdir.md](workdir.md)。
