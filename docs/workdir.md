# 工作目录

## 状态

sidecar 持有一个工作目录。

- 默认是用户主目录。
- 启动时可用 `AGENT_RUNBOOK_WORKDIR` 覆盖，给出不可用的路径时回退到主目录并打一条 warn。
- 运行期用 `/cd` 查看、`/cd <path>` 切换。

路径支持 `~` 展开，相对路径按当前工作目录解析，含空格的路径用引号包住。切换成功后前端记录的 runtime 与聊天里的通知一起更新。

## 与系统提示词的关系

每次切换工作目录或保存系统提示词，sidecar 都会带着已有历史重建 Agent，并把 `Current working directory: ...` 追加到系统提示词末尾，让模型知道自己站在哪里。历史消息不丢，新目录从下一次请求开始生效。

工具如何使用该目录见 [tools.md](tools.md)，系统提示词文件见 [system-prompt.md](system-prompt.md)。
