# 目录

```
shared/protocol.ts            前端与 sidecar 共用的 JSONL 协议类型
sidecar/src/index.ts          stdin/stdout 上的 JSONL 主循环
sidecar/src/settings.ts       读取 ~/.mypi/settings.toml
sidecar/src/theme.ts          theme.css 的读写与模板
sidecar/src/presets.ts        内置预设的读取与元信息解析
sidecar/presets/*.css         内置界面预设，文件头 /** 写名称、介绍、作者、协议、版本
sidecar/src/prompt.ts         系统提示词文件的读写
sidecar/src/session.ts        会话记录的落盘、列表与读取
sidecar/src/workdir.ts        工作目录的状态、路径解析与 ~ 展开
sidecar/src/tools.ts          Read / Edit / Write / Bash 四个工具的实现
sidecar/src/deliver.ts        Deliver 模式的交付工具
sidecar/src/agent-host.ts     pi-agent-core 接线处，provider 与模型在这里定
src/lib/agent/client.ts       前端客户端：请求 id 关联、事件分发、断线处理
src/lib/theme.ts              把 theme.css 注入页面
src/hooks/use-agent-chat.ts   组合层：把 connection / transcript / clock / session-browser 拼成对外的分组 API
src/hooks/use-agent-connection.ts  client 订阅、hello、runtime 与 bridgeError
src/hooks/use-agent-transcript.ts  消息列表与 agent 事件到消息的归并
src/hooks/use-run-clock.ts    运行计时与等待用户时的暂停累计
src/hooks/use-session-browser.ts   会话列表页的数据与开关
src/hooks/use-latest-ref.ts   在渲染之外读取最新值的 ref
src/hooks/use-editor-document.ts  编辑器文档状态（打开、改动、已存、关闭）
src/lib/chat/                 指令注册与参数解析、消息树、展示辅助、命令分发
src/lib/time.ts               dayjs 的初始化与全部时间格式化（时钟、相对时间、耗时）
src/components/chat/          聊天页组件：记录、markdown、思考指示、输入框
src/components/editor/        编辑器模块：CodeMirror 接线与顶部栏外壳
src-tauri/src/agent.rs        找 node、启停 sidecar、转发记录
src-tauri/src/menu.rs         macOS 菜单，去掉会截走 Cmd+W 的 Close Window
scripts/build-sidecar.mjs     用 esbuild 打包 sidecar
eslint.config.js              ESLint 扁平配置
vitest.config.ts              单测配置（node 环境，别名同 vite）
```
