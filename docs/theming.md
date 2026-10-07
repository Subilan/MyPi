# 主题

## 基本机制

主题就是一份 CSS 文件，默认在 `~/.agent-runbook/theme.css`（`AGENT_RUNBOOK_THEME` 可改路径），文件不存在时 sidecar 生成一份带说明的模板。

- 注入到内置样式之后，写的是普通 CSS，选择器、伪类、媒体查询都能用。
- 同名样式以文件里的为准，保存后立即生效，不需要重启。
- 文件权限 0600，sidecar 启动时不存在就生成一份。
- 改主题只影响界面，与模型上下文无关，也不进会话记录。

## 可定制的 class

| class | 元素 |
| --- | --- |
| `.ar-background` | 窗口背景，挂在 `body` 上，聊天、会话列表、跳转、编辑器全部共用 |
| `.ar-message-user` | 用户消息 |
| `.ar-message-assistant` | 助手消息 |
| `.ar-message-tool` | 工具消息，配 `[data-status="running\|ok\|error"]` |
| `.ar-message-system` | 系统消息，配 `[data-tone="info\|success\|warning\|critical\|neutral"]` |
| `.ar-composer` | 输入框外壳 |
| `.ar-composer-input` | 输入框本体 |
| `.ar-session-row` | 会话列表行，选中态配 `[data-selected="true"]`，默认是主题色 13% 的淡底 |

系统消息涵盖通知、错误、确认卡、交付卡与选择题卡。工具状态与系统语气用属性选择器区分，不另外暴露变量。

## 可定制的变量

只有不便于用 class 逐元素设置的才暴露成变量：

| 变量 | 作用 |
| --- | --- |
| `--ar-font-general` | 正文与界面字体 |
| `--ar-font-mono` | 代码块与编辑器字体 |
| `--ar-foreground` | 正文色 |
| `--ar-muted`、`--ar-muted-foreground` | 次级底色与次级文字色 |
| `--ar-border`、`--ar-input` | 边框与输入框边框 |
| `--ar-primary`、`--ar-primary-foreground`、`--ar-ring` | 主题色、主题色上的文字色、聚焦环 |
| `--ar-destructive` | 错误色 |

## 示例

```css
:root { --ar-primary: #d97757; }
.ar-background { background-color: #faf9f5; }
.ar-message-user { background-color: #f0eee6; }
.ar-message-tool[data-status="ok"] { background-color: #e7efe6; color: #2f6b4f; }
.ar-session-row[data-selected="true"] { background-color: #f0eee6; }
```

## /ui 指令

| 指令 | 作用 |
| --- | --- |
| `/ui` | 把当前主题的文件路径与内容列到聊天记录里 |
| `/ui list` | 列出内置预设 |
| `/ui apply <name>` | 用预设的 CSS 覆盖整个文件 |
| `/ui apply default` | 写回模板 |
| `/ui edit` | 用编辑器打开 `theme.css` |

`/ui` 是保留的命名空间：缺名字或子命令写错时只打印用法并列出预设，不会把这条消息发给模型，子命令与预设名都支持唯一前缀。`/ui apply` 成功后只提示预设的 Label（默认模板则提示默认主题），不回显文件路径与内容。

预设 `claude-code-work` 是 Claude Code 那种暖色纸感风格，模型输出（`.ar-message-assistant`）用衬线字体，代码块保持等宽。应用后就是一份普通 theme.css，可以接着在里面改。

## 内置预设

内置预设放在 `sidecar/presets/`，一个预设一个 `.css` 文件，文件名即预设名。文件头的 `/** */` 块是元信息，逐行 `key: value`，字段固定为 `name`、`label`、`description`、`author`、`license`、`version`，缺一个都会在 sidecar 启动时报错。`name` 必须与文件名一致。

```css
/**
 * name: claude-code-work
 * label: Claude Code Work
 * description: Claude 品牌的暖色纸感配色
 * author: Subilan
 * license: MIT
 * version: 1.0.0
 */
```

构建时 `scripts/build-sidecar.mjs` 把整个目录拷到 `src-tauri/resources/agent/presets/`，运行时代码从与 `index.mjs` 同级的 `presets/` 读取，所以改预设后要重跑 `npm run sidecar:build`。
