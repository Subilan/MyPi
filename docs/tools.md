# 工具

## 工具集

agent 在 Regular 模式下有四个工具，实现在 `sidecar/src/tools.ts`。

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `Read` | `path`、可选的 `offset` / `limit` | 读取文本文件，拒绝二进制；单次读取超过 20 万字符会截断并提示用 offset/limit 续读。图片按魔数识别（png / jpeg / gif / webp / bmp），以图像内容返回给多模态模型 |
| `Edit` | `path`、`oldText`、`newText` | 精确替换文件中唯一出现的一段原文，匹配 0 处或多处都会报错 |
| `Write` | `path`、`content` | 覆盖写入，父目录不存在时递归创建 |
| `Bash` | `command`、可选的 `timeout` | 在工作目录下跑 shell（POSIX 走 `$SHELL -lc`，Windows 走 `cmd /c`），返回退出码、stdout、stderr；默认超时 120 秒，可调到 600 秒，超时或中断时终止整个进程组 |

Deliver 模式下再额外挂上三个交付工具，实现在 `sidecar/src/deliver.ts`，见 [deliver-mode.md](deliver-mode.md)。

## 路径与失败

- 相对路径一律按当前工作目录解析，绝对路径直接用。
- 工具失败时以 `isError` 结果返回给模型，而不是抛出中断整个 run。

## 沙箱

这些工具不设沙箱，以当前用户的权限读写文件、执行命令。换目录前请确认目标目录是可以放手的。

## 图片

`Read` 遇到图片时按魔数判断格式，读成 base64 以 `ImageContent` 返回，由 pi-ai 的 openai-completions 层拼成 `data:` URL 随 tool result 发给模型。

是否支持图片、图片上限多少都取自模型的 `input` 与 `inputLimits`：当前模型不支持图片时返回一条可读的失败提示，图片字节数超上限时同样拒绝并提示先压缩，不会发出注定被 API 拒掉的大请求。

工具行在界面上的渲染见 [chat-messages.md](chat-messages.md)。
