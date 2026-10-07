# agent-runbook

基于 Tauri v2 的跨平台桌面应用骨架，agent 由 `@earendil-works/pi-agent-core` 驱动。界面是一个聊天页：中间是从上往下滚动的聊天记录，底部是固定吸附的输入框；用户消息用整行灰底承载，agent 的消息没有背景、逐字流式出现，思考阶段只显示 `Thinking...` 和已耗时，不展示思考内容；每条消息悬停时在右上角显示到秒的时间戳。默认接 DeepSeek。界面有 Regular 与 Deliver 两种模式，用 `/mode` 切换，详见下面的模式一节。会话内部按消息树组织，`/jump` 可以回溯到任意一条消息并从这里分叉，详见下面的跳转与分支一节。顶部没有状态栏，模型、模式、工作目录这类运行信息用 `/info` 在聊天记录里查看。输入框里按 `ArrowUp` / `ArrowDown` 在本次会话已发送的消息里前后翻阅，往下越过最新一条会回到翻阅前的草稿；`Esc` 清空输入框，焦点不在输入框时按 `i` 可直接聚焦。

## 架构

三层，两个进程边界：

```
React (WebView)  ←→  Rust 宿主 (Tauri)  ←→  sidecar (用户机器上的 Node 22)
   UI / 状态            窗口、生命周期、          Agent 循环、模型调用、工具执行
                        找 node、启停子进程、
                        协议转发
```

前端不直接碰模型、文件系统或网络。一次请求的路径是：前端 `invoke("agent_request", { payload })` → Rust 写进子进程 stdin → sidecar 处理 → 逐行写到 stdout → Rust 转成 `agent://record` 事件 → 前端。协议类型定义在 `shared/protocol.ts`，前端与 sidecar 共用一份。

sidecar 的代码用 esbuild 打成一个平台无关的 `index.mjs`（约 1.4MB），作为 Tauri 的 resource 随应用分发，运行时由用户机器上的 Node 执行，不打包任何运行时。三平台共用同一个产物，交叉编译、按平台分包这类事情都不用管了。

之前试过把 sidecar 编译成自包含二进制，因此踩到 bun 1.1.7 的一个坑：`process.stdin` 收不到 Rust（或 Tauri 官方 shell 插件）创建并作为子进程 fd 0 的管道数据，`Bun.stdin.stream()` 同样收不到，只有阻塞 `readSync(0, ...)` 能读到，而阻塞读会饿死事件循环，worker 线程在 `--compile` 产物里又解析不到模块。换成 Node 之后这个问题不存在，`node` 从 Rust 建的管道读 stdin 完全正常，所以传输层就用了最朴素的 stdin/stdout。回退到 bun 之前，建议先确认这一点。

## Node 的查找与版本要求

要求 Node ≥ 22（22 LTS 是测试目标，更高的主版本也能跑）。Rust 侧按顺序探测候选：`AGENT_RUNBOOK_NODE` 指定的路径、`PATH`、Volta / fnm / asdf / mise / nvm / scoop / Homebrew / 系统目录等常见位置，逐个执行 `node --version`，取第一个主版本 ≥ 22 的。之所以要扫目录，是因为 macOS 上从 Finder 启动的 GUI 应用拿不到登录 shell 的 `PATH`，nvm 装的 node 不在默认路径里。

找不到或版本过低时不会崩，应用照常启动，界面上会显示一条可读的错误（例如"node 22 or newer is required, found only v20.17.0 /usr/local/bin/node"）。前端轮询 `agent_status`，Rust 把错误放在 `error` 字段里返回，所以即使错误发生在窗口加载之前也不会丢。

两个环境变量可以覆盖默认行为：

| 变量 | 作用 |
| --- | --- |
| `AGENT_RUNBOOK_NODE` | 指定用哪个 node 二进制 |
| `AGENT_RUNBOOK_AGENT_SCRIPT` | 指定跑哪个 agent 产物，调试用 |

Windows 下启动子进程会带 `CREATE_NO_WINDOW`，避免弹出控制台窗口。

## 目录

```
shared/protocol.ts            前端与 sidecar 共用的 JSONL 协议类型
sidecar/src/index.ts          stdin/stdout 上的 JSONL 主循环
sidecar/src/settings.ts       读取 ~/.agent-runbook/settings.toml
sidecar/src/prompt.ts        系统提示词文件的读写
sidecar/src/session.ts        会话记录的落盘、列表与读取
sidecar/src/workdir.ts        工作目录的状态、路径解析与 ~ 展开
sidecar/src/tools.ts          Read / Edit / Write / Bash 四个工具的实现
sidecar/src/agent-host.ts     pi-agent-core 接线处，provider 与模型在这里定
src/lib/agent/client.ts       前端客户端：请求 id 关联、事件分发、断线处理
src/hooks/use-agent-chat.ts   聊天状态机：消息列表、事件归并、发送与中断
src/hooks/use-editor-document.ts  编辑器文档状态（打开、改动、已存、关闭）
src/lib/chat/                 指令注册与参数解析
src/lib/time.ts               dayjs 的初始化与全部时间格式化（时钟、相对时间、耗时）
src/components/chat/          聊天页组件：记录、markdown、思考指示、输入框
src/components/editor/        编辑器模块：CodeMirror 接线与顶部栏外壳
src-tauri/src/agent.rs        找 node、启停 sidecar、转发记录
src-tauri/src/menu.rs         macOS 菜单，去掉会截走 Cmd+W 的 Close Window
scripts/build-sidecar.mjs     用 esbuild 打包 sidecar
```

## 前置依赖

Node ≥ 22（用户的机器上也要求有）、npm、rustup 管理的 rustc ≥ 1.90（Tauri 2.12 的要求）。Linux 还要 WebKitGTK 相关包，Windows 要 MSVC 工具链与 WebView2，见 Tauri 官方前置依赖说明。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run tauri dev` | 完整开发：打包 sidecar、起 Vite、开窗口 |
| `npm run dev` | 只起 Vite，在浏览器里调 UI（agent 桥接不可用） |
| `npm run tauri build` | 出安装包，产物在 `src-tauri/target/release/bundle` |
| `npm run sidecar:build` | 只重新打包 sidecar |
| `npm run sidecar:dev` | 打完包后直接用 node 跑 sidecar |
| `npm run typecheck` | 前端与 sidecar 两套 tsconfig 一起查 |

`predev` 与 `prebuild` 钩子会先跑 `sidecar:build`，所以改完 sidecar 代码重启 `tauri dev` 即可生效。生成的 `src-tauri/resources/agent/index.mjs` 是构建产物，不进版本库。

不要用直接 `cargo build` 出来的裸二进制当运行方式，嵌入的前端资源可能不是最新的；用 `npm run tauri dev` 或 `tauri build` 的产物。

## 手动调试

不给别的条件时 sidecar 就是 stdin/stdout 模式，可以直接对着它说协议，方便不开窗口调 agent 逻辑：

```bash
# 交互式，逐行输入 JSON 请求，Ctrl-D 退出
npm run sidecar:dev

# 或者一次性喂进去，进程会等这一轮跑完再退出
npm run sidecar:build
printf '{"id":"1","type":"hello","name":"su"}\n{"id":"2","type":"prompt","text":"hi"}\n' | DEEPSEEK_API_KEY=... node src-tauri/resources/agent/index.mjs
```

`AGENT_RUNBOOK_SETTINGS` 可以指向另一份配置文件，方便用临时配置调 sidecar。

桥接过程看不见，排查时用 `AGENT_RUNBOOK_DEBUG=1 npm run tauri dev`，Rust 侧会把找到的 node、产物路径、每条命令和每条记录打到 stderr。

## 配置与模型

配置读 `~/.agent-runbook/settings.toml`（`AGENT_RUNBOOK_SETTINGS` 可改路径）。文件不存在时 sidecar 会生成一份默认的，权限 0600：

```toml
provider = "deepseek"
model = "deepseek-flash"
api_key = ""

[agent]
thinking = "high"
# system_prompt = "自定义系统提示词"
```

`api_key` 留空时回退到环境变量 `DEEPSEEK_API_KEY`；两者都没有时应用照常启动，界面上会显示一条可读的错误，说明该往哪里填。`thinking` 取 `off / minimal / low / medium / high / xhigh / max`，实际生效的档位由模型的 thinking 能力决定。`system_prompt` 只是首次生成系统提示词文件的种子，之后就由 `~/.agent-runbook/system-prompt.md` 说了算，详见下面的编辑器一节。

sidecar 启动时读一次配置，改完要重启应用。provider 的白名单在 `sidecar/src/agent-host.ts` 的 `PROVIDERS` 里，加一个 provider 需要工厂函数和它的环境变量名，模型 id 从 pi-ai 的目录里查。密钥现在只落在本地文件或环境变量里，还没有系统密钥串和设置界面。

## 界面行为

聊天记录是一个 `AgentMessage` 列表，前端直接跟 agent-core 的消息生命周期走，不做 delta 累加。pi-agent-core 在 `message_update` 里带的是这条 assistant 消息的完整快照（`event.message`），sidecar 只把其中的文本投影成 `assistant_text`，前端每条都整体替换气泡文本；`message_start` 开一条新的 assistant 气泡并置为思考态，`message_end` 用最终消息收尾，文本为空又没有报错的气泡会被丢掉（工具调用轮就是靠这一条丢掉的，工具本身在 `tool_execution_start` 时单独成行）。这样既不会把一段文本拆成两个气泡，也没有拼错或漏拼的可能。思考阶段前端只拿到 `message_start` 的思考态，`thinking_delta` 在 sidecar 里就被丢掉了，所以思考内容不会离开 sidecar 进程。模型报错时 `message_end` 带 `stopReason: "error"` 和 `errorMessage`，显示在气泡里；sidecar 自己启动失败这类问题走 `run_error` 事件。指令执行失败（比如 `/cd` 指向一个不存在的目录）和用户主动中止都渲染成一条独立的 `error` 行，浅红底，不挂在用户消息内部；中止那条的文本是「已中止」。

输入框关掉了 WebView 在 macOS 上自带的文本辅助：`spellCheck` / `autocorrect` / `autocapitalize` / `autocomplete` / `writingsuggestions` 全部关闭，避免自动更正、拼写提示与行内补全；长按字母弹出的标音变体是 AppKit 的 press-and-hold 行为，在 Rust 侧把 `ApplePressAndHoldEnabled` 写进 app 的 `NSUserDefaults` 关掉。输入法组合期间的 Enter 交给输入法：keydown 先看原生事件的 `isComposing`，再看自己维护的 composition 状态，`keyCode === 229` 也跳过；组合结束后的 100ms 内按 Enter 不提交，补上 WebKit 上确认组合那次 Enter 的 `isComposing` 为 false 的差异。

agent 的回复走 `src/components/chat/markdown.tsx`，用 react-markdown 渲染，带 remark-gfm（表格、删除线、任务列表、脚注）、remark-math + rehype-katex（`$...$` 行内公式与 `$$...$$` 块级公式，样式来自 katex 自带的 CSS）。GFM 的扩展自动链接是在 micromark 词法阶段做的，会把 URL 后面紧贴的内容一路吞进链接（规范如此，GitHub 同样这么渲染），`**https://iina.io**（实测可正常打开）` 于是渲染成字面量 `**` 加一条包住后半句的链接；`src/lib/chat/remark-gfm-autolink.ts` 用 micromark 的 `disable` 关掉 `wwwAutolink` / `protocolAutolink` / `emailAutolink` 三个 construct，链接改由 remark-gfm 自带的 mdast transform 在 emphasis 之后补出来，再把 URL 里第一个中文标点之后的部分还给正文：`https://a.com，后面` 不会把整句吞掉，`.../wiki/中文条目` 这种自带中文的路径和 `(software)` 的括号平衡不受影响。中文标点紧贴 `**` / `~~` 时 CommonMark 与 GFM 自己也不认（commonmark-spec#650），`**该星号…直接显示。**这是因为…` 会原样输出，所以又挂了 `remark-cjk-friendly` 和 `remark-cjk-friendly-gfm-strikethrough`（都走 `/parseOnly` 入口，只用它们的解析扩展，不引入反向序列化）。正文里的单换行按 CommonMark 折叠成空格，不产生断行；段落靠空行（`\n\n`）划分。之前用过 remark-breaks 把单换行渲染成 `<br>`，但实测 deepseek-flash 会把 `\n` 当排版手段频繁输出（20 轮里 106 个单换行，其中 9 个落在正文句中），全渲染成硬换行后看起来像 bug，所以去掉了。标题、列表、引用、代码块、表格的样式用主题变量写在 `components` 映射里，没有引入 typography 插件；代码块只有底色，没有语法高亮。块级公式在 `index.css` 里补了横向滚动，长公式不会把聊天撑宽。流式输出时每来一段就重新解析一次，光标用 `::after` 挂在最后一个块级元素尾部，不会多出一行。链接不靠 WebView 自己跳转，而是 preventDefault 后交给 `tauri-plugin-opener` 用系统浏览器打开。用户自己发的话不做 markdown 解析，保持原样显示。

## 指令

一条消息只有在整条内容都能解析成一条已注册指令时才是指令，其它情况都按普通消息发给模型；`/clear 随便搜一下` 因为 `/clear` 不接受参数而落回普通消息，`/system edti` 这种拼错的子命令同样如此。指令注册在 `src/lib/chat/commands.ts`，每条指令自己声明名字、别名、用法和参数解析方式。命中的指令在消息列表和输入框里都用主题色加粗显示。

| 指令 | 作用 |
| --- | --- |
| `/clear`、`/new` | 结束当前会话，开一个新的：清空模型上下文与界面上的聊天记录，旧会话留在磁盘上 |
| `/sessions` | 打开独立的会话列表页，用 ↑ / ↓ 选择、Enter 或鼠标单击切换，Esc 返回 |
| `/sessions <序号\|id>` | 切换到某个历史会话，接着往下聊 |
| `/system` | 在聊天记录里展示当前系统提示词 |
| `/system edit` | 打开编辑器修改系统提示词，子命令支持前缀缩略（`e` / `ed` / `edi` / `edit`） |
| `/cd` | 在聊天记录里显示当前工作目录 |
| `/cd <path>` | 切换工作目录，支持 `~`、相对路径与引号包裹的含空格路径 |
| `/info` | 在聊天记录里显示模型、模式、运行状态、工作目录等运行信息 |
| `/mode` | 在聊天记录里显示当前模式 |
| `/mode <regular\|deliver>` | 切换模式，模式名支持前缀缩略（`r` / `reg` / `d` / `del`） |
| `/jump` | 进入跳转视图，在当前会话的消息树里回溯或切换分支 |

`/clear` 调 sidecar 的 `agent.reset()` 重置模型侧的消息，并开一个新的会话，成功后前端整个消息列表也一起清掉，屏幕回到空状态。`/system` 以 `SYSTEM PROMPT` 为标题，正文先列文件路径，再把 sidecar 读回来的文件内容原样铺在聊天记录里，只读，要改就走 `/system edit`。

## 会话

会话由 sidecar 记录，一个会话一个 JSONL 文件，存在 `~/.agent-runbook/sessions/`（`AGENT_RUNBOOK_SESSIONS` 可改目录）。文件名就是会话 id，形如 `20260205-102231-a1b2c3d`，前缀是本地时间，末尾七位随机十六进制（与 git short SHA 同宽）避免同一秒重名；里面的时间戳是 epoch 毫秒，所以 `/sessions` 里的顺序按 id 倒序排。每个文件的第一行是会话头，记下 id、开始时间、模式、工作目录、provider 与 model。之后每行一条记录，存的是 agent 侧真实的消息对象：用户消息、assistant 消息（去掉 thinking 部分）、tool result，另有运行错误与模式、工作目录的变更。tool 记录额外带一个 `durationMs`，从 `tool_execution_start` 到 `tool_execution_end` 计时，供前端回看时显示工具耗时；早期写入的旧记录没有这个字段，回看时不显示耗时。assistant 的思考内容不落盘，文件权限 0600。

每条会话的聊天记录与模型上下文都从这份文件重建，所以会话之间完全独立：在 A 里聊到一半切到 B，A 的文件不动；切回 A 时历史照旧，接着发消息就追加在 A 的同一份文件里。切换时 sidecar 按消息里的 `toolCall` / `toolResult` 配对校验历史，把当前模式不支持的工具调用、以及缺少配对结果的残缺调用剔掉，再把工具集与系统提示词按当前配置重建，避免模型看到不存在的工具或悬空的工具结果；会话记录的模式会跟着恢复，但系统提示词与工作目录仍用当前配置。

每次 `/clear` 或 `/new` 结束当前会话并开一个新的；应用重启也算新会话，不会自动恢复上一次的上下文。没有产生任何记录的会话不建文件，也不出现在列表里。`/sessions` 不在聊天记录里输出列表，而是切到一个独立页面，左上角是 `SESSIONS` 标题，下面列出最近的 50 个会话，每行是会话 id、是否当前会话、右侧的相对时间（悬停可见确切时间戳）与首条用户消息的摘要，没有额外的顶栏与底栏。键盘 ↑ / ↓ 移动选中行、Enter 切换，鼠标单击某一行也直接切换，Esc 返回聊天页。切换后聊天记录换成该会话，并追加一条 `SESSION` 提示说明接下来会写进哪个会话。`/sessions <序号>` 或 `/sessions <id 前缀>` 仍可直接在当前页切换，不必先打开列表页。

这份记录同时也是排查模型输出的依据：原始 JSONL 里的转义换行就是模型当时返回的文本。

## 跳转与分支

每条会话记录除了消息本身，还带 `id` 与 `parent` 两个字段，把同一会话里的消息串成一棵树。没有回溯过的会话就是一条直链；从某个位置分叉后，同一父节点下面会出现多个子消息。旧文件里没有这两个字段，读取时按行号补成线性链，所以以前的会话照常打开、照常继续。

`/jump` 不接受参数，执行后进入跳转视图。视图把每个节点压成一行，按角色保留底色（用户灰、工具按状态蓝/绿/红、系统通知浅蓝、错误浅红），超出的内容用省略号收起；可以用 ↑ / ↓ 在消息之间移动，当前选中的那一行整行变明黄底黑字并弹跳一下；Enter 跳转，Esc 取消。视图底部是一行按键提示。

有多个子消息的消息是分叉点，左右两侧各显示一个箭头，← / → 在它的各个分支之间切换。当前位置停在某个中间消息上时（比如刚跳转过去、还没有发新消息），视图会先展开它最近的一个分支，光标停在原地，箭头用来换到其它分支。如果分叉发生在会话最开始（编辑了第一条用户消息，父节点为空），没有可依附的分叉消息，箭头会显示在根层消息上。

跳转的语义分成两类：

- 跳到一个工具调用或助手消息，就是回到该消息刚刚返回的那一刻，聊天记录到它为止，下一条消息从它继续，成为它的子节点。
- 跳到一条用户消息，就是回到它的编辑态：聊天记录退到它之前，原文填进输入框并聚焦。重新发送后，新消息与原来的用户消息成为兄弟分支，原消息连同它后面的整条分支都保留在树里，随时可以再 `/jump` 回去。

跳转会立即回退模型上下文：sidecar 按跳转点取出从根到该点的历史重建 Agent，下一条请求只会看到这条路径上的消息。跳转视图只列出落盘的会话记录（用户、助手、工具、错误、模式与工作目录变更），`/info`、`/system` 这类只出现在界面上的瞬时提示不参与跳转；提交跳转后聊天记录会按当前分支重新生成，这些瞬时提示随之消失。模式是会话级状态，不随分支回退：跳到模式切换之前的位置，当前模式仍是切换后的模式。

## 模式

模式是 session 级的状态，切在内存里；切换会话时会恢复该会话记录里的模式，重启应用则回到 Regular。sidecar 是模式的唯一来源，前端连上后会从 `hello` 返回的 runtime 里对齐一次，每次切换会话也会用返回的会话摘要对齐，所以刷新 WebView 不会让两边错位。当前模式可以用 `/mode` 或 `/info` 查看。

Regular 就是原来的行为：思考阶段只显示 `Thinking...` 与已耗时，工具调用渲染成一行，正文照常流式渲染。

Deliver 面向“让 agent 交活”的场景：

- 思考内容、工具调用过程、模型的自由正文都不展示，运行期间只在记录末尾显示 `Working...` 和已耗时；卡在 `request_user_decision` 上等用户作答时不显示这一行，那段时间也不计入耗时，用户交卷后从原来的读数继续。
- 每次任务必须以一个交付工具的调用收尾，普通的 Read / Edit / Write / Bash 仍照常执行，只是界面上看不到。
- 交付结果以结构化块呈现：`report_success` 显示完成描述、交付产物与建议的下一步，`report_failure` 显示失败原因与调整建议。
- `request_user_decision` 在聊天记录里渲染成选择题块，支持是否题、单选题、多选题，可一次问多个问题；工具会阻塞当前 run，等用户在卡片上作答后把答案作为工具结果交回模型，同一轮继续。是否题用按钮，单选题用 radio group，多选题用 checkbox group；选项的 `label` 只放内容本身，`description` 作为介绍在鼠标悬停的 tooltip 里展示；每个问题可以带 `show_other_choice`，默认展示一个「其它」项，用户选中后可以自己输入；这一项由界面统一追加，工具描述里也明确要求模型不要自行创建其它选项，否则会出现两个「其它」。

系统通知、确认、选择题、交付结果跟用户消息用同一套版式（整宽、相同的内边距与 `15px/行高`，标题一行、正文 `mt-1`），只用底色区分：系统通知与选择题是浅蓝，确认待回答时浅黄、确认后浅绿、取消后灰色，交付成功是浅绿，交付失败是浅红。

交付类工具不限模式地走卡片：`report_success` / `report_failure` / `request_user_decision` 在 regular 模式下也渲染成交付卡或选择题卡，不会被铺成「工具名 + JSON 参数」的行；只有工作目录相关的 Read / Edit / Write / Bash 才用那种通用行。

`report_success` 的 `artifacts` 是交付产物路径列表，可以是网页链接（`http://` / `https://`）或本地绝对路径。前端在「交付产物」下逐条列出，点击网页链接交给系统浏览器打开，点击本地路径用系统默认应用打开。本地路径的打开权限限制在 `$HOME` / `$TEMP` / `$DOWNLOAD` / `$DOCUMENT` / `$DESKTOP` 与 `/tmp` 这些目录下（见 `src-tauri/capabilities/default.json` 里 `opener:allow-open-path` 的 scope），scope 之外的路径会提示打不开。

模式切换通过 sidecar 的 `mode_set` 请求完成：前端先弹出一张 CONFIRMATION 卡（待回答时黄底，是按钮带 Enter 快捷键、否按钮带 Backspace 快捷键，待确认期间输入框锁住），用户确认后才发请求；回答后卡片整体换色换文案，确认变绿底 `CONFIRMED` 加「已切换为 Deliver 模式」，取消变灰底 `CANCELLED` 加「取消切换到 Deliver 模式」，切换请求失败时卡片退回待回答状态并附一条错误。sidecar 收到后带上已有对话重建 Agent，换成对应的系统提示词与工具集，并把不属于新工具集的 tool call 与 tool result 从模型历史里剔除（assistant 消息只去掉 `toolCall` 部分，只剩工具调用的整条丢弃），避免模型在 regular 模式下模仿历史里的 `report_success` 去调已经不存在的工具；聊天记录本身不动。`finishTurn` 钩子在 deliver 模式下保证任务以 `report_success` / `report_failure` 结束；如果模型只输出了正文而没有调用工具，会被连续追发几次请求逼它交付，最多三次后放行，避免死循环。

## 系统提示词与编辑器

系统提示词存成一个文件：`~/.agent-runbook/system-prompt.md`（`AGENT_RUNBOOK_SYSTEM_PROMPT` 可改路径）。sidecar 启动时文件不存在就用 settings.toml 里的 `system_prompt` 或内置默认值生成一份，之后以文件为准。保存时 sidecar 会带上已有对话重建 Agent，新提示词从下一次请求开始生效，历史消息不丢。

编辑器是一个独立模块，和系统提示词没有耦合：

- `src/components/editor/code-editor.tsx` 只做 CodeMirror 6 的接线（`basicSetup` 加一套跟随主题变量的 theme），对外只有 `value` / `onChange`。
- `src/components/editor/editor-pane.tsx` 是外壳：顶部栏（文件名、未保存 badge、关闭按钮）、错误条、编辑器本体，`Cmd+S` / `Cmd+W` 的监听也在这一层。
- `src/hooks/use-editor-document.ts` 提供通用的文档状态：打开一份文档、改动、标记已保存、关闭。

编辑期间编辑器占满窗口、替换聊天界面，也没有输入框，关掉就回到聊天。有行号、当前行高亮和 `Cmd+F` 查找，没有语法高亮，也没有 vim 键位，是个普通的多行文本编辑器。关闭按钮只在有未保存修改时弹 popover，给“保存并关闭”和“放弃并关闭”两个选择；已保存则直接关闭。`Cmd+W` 在已保存时直接关闭，有未保存修改时先弹 popover，popover 开着时再按一次等同于“保存并关闭”，“放弃并关闭”不绑快捷键。

编辑器代码用动态 import 拆成单独的 chunk，不开编辑器就不加载（约 386KB，都是 CodeMirror）。

macOS 的系统菜单默认把 `Cmd+W` 绑在 Close Window 上，快捷键会被菜单截走，所以 `src-tauri/src/menu.rs` 自己拼了一份不含 Close Window 的菜单（App / Edit / Window 三段），`Cmd+C` / `Cmd+V` 这些靠 Edit 里的预置项继续工作。

## 工作目录与工具

sidecar 持有一个工作目录，默认是用户主目录，启动时可用 `AGENT_RUNBOOK_WORKDIR` 覆盖（给出不可用的路径时回退到主目录并打一条 warn）。运行期用 `/cd` 查看、`/cd <path>` 切换；路径支持 `~` 展开，相对路径按当前工作目录解析，含空格的路径用引号包住。切换成功后前端记录的 runtime 与聊天里的通知一起更新。

每次切换工作目录或保存系统提示词，sidecar 都会带着已有历史重建 Agent，并把 `Current working directory: ...` 追加到系统提示词末尾，让模型知道自己站在哪里。历史消息不丢，新目录从下一次请求开始生效。

agent 在 Regular 模式下有四个工具，实现在 `sidecar/src/tools.ts`；Deliver 模式下再额外挂上三个交付工具，实现在 `sidecar/src/deliver.ts`（见上面的模式一节）：

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `Read` | `path`、可选的 `offset` / `limit` | 读取文本文件，拒绝二进制；单次读取超过 20 万字符会截断并提示用 offset/limit 续读。图片按魔数识别（png / jpeg / gif / webp / bmp），以图像内容返回给多模态模型 |
| `Edit` | `path`、`oldText`、`newText` | 精确替换文件中唯一出现的一段原文，匹配 0 处或多处都会报错 |
| `Write` | `path`、`content` | 覆盖写入，父目录不存在时递归创建 |
| `Bash` | `command`、可选的 `timeout` | 在工作目录下跑 shell（POSIX 走 `$SHELL -lc`，Windows 走 `cmd /c`），返回退出码、stdout、stderr；默认超时 120 秒，可调到 600 秒，超时或中断时终止整个进程组，不留给子进程继续占着管道把结束时间拖后 |

相对路径一律按当前工作目录解析，绝对路径直接用。工具失败时以 `isError` 结果返回给模型，而不是抛出中断整个 run。这些工具不设沙箱，以当前用户的权限读写文件、执行命令，换目录前请确认目标目录是可以放手的。

`Read` 遇到图片时按魔数判断格式，读成 base64 以 `ImageContent` 返回，由 pi-ai 的 openai-completions 层拼成 `data:` URL 随 tool result 发给模型。是否支持图片、图片上限多少都取自模型的 `input` 与 `inputLimits`：当前模型不支持图片时返回一条可读的失败提示，图片字节数超上限时同样拒绝并提示先压缩，不会发出注定被 API 拒掉的大请求。

工具调用在聊天记录里占一条整宽底色，行内左侧是加粗的工具名与主要参数，右侧右对齐一个实时耗时，基底样式仍是同样的 `px-4 py-3`、字体与 15px/行高：运行中浅蓝底、成功浅绿底、失败浅红底。Bash 显示 `耗时/超时`（超时取工具参数，缺省 120 秒），Read 在有 `offset` / `limit` 时把参数拼成 `path:起-止`，Edit 只显示路径，Write 在路径后附内容字节数；未知工具回退成工具名加紧凑 JSON 参数（最多 400 字符）。耗时在 1 秒以内每 0.1 秒刷新、超过 1 秒后每 1 秒刷新，工具结束时定格在最终值。切换会话回看历史时，工具行用会话记录里的 `durationMs` 显示同样的定点耗时，旧会话没记时长则不显示。工具失败时在那行下面再追加一块整宽的浅红错误详情，展示 sidecar 返回的完整输出，超时也走同一块（sidecar 在输出里附了 `[已超时 ...ms 并终止进程]`）。前端的流式更新通道（`tool_execution_update`）已经就绪，但当前四个工具都不上报中间结果，所以只有耗时是活的，输出只在失败时展示。以前工具轮次会留下一个空白气泡，现在这种没有正文又没报错的 assistant 气泡会被移除，不会再有空的占位。

把外部文件拖进窗口，会在输入框光标处补上它的绝对路径（多个文件用空格分隔，路径原样插入、不加引号，方便直接交给四个工具使用）；拖进输入框区域时边线会高亮提示，在其他位置松手同样会插入。Tauri 默认开启了 `dragDropEnabled`，这个能力走 `getCurrentWebview().onDragDropEvent`，位置按 `devicePixelRatio` 换算成 CSS 像素后与输入框边界比较，只用来控制高亮。在浏览器里跑 `npm run dev` 时拿不到绝对路径，走 HTML5 drop 回退，只能插入文件名。

## 还没做的

模型与密钥的设置界面、sidecar 异常退出后的自动重启、图片的客户端缩放（现在只在超限时拒绝），以及把工具限制在一个可审批的权限模型下都还没有。会话已经可以切换着继续聊，但重开应用不会自动回到上次的会话。sidecar 挂掉时前端会收到 `closed` 记录并显示原因，但不会自动重启。代码块暂时没有语法高亮，也没有 markdown 里的图片缓存、mermaid 这类扩展。编辑器目前只服务于系统提示词，以后接文件读写时可以直接复用。
