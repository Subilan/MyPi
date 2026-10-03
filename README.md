# agent-runbook

基于 Tauri v2 的跨平台桌面应用骨架，agent 部分由 `@earendil-works/pi-agent-core` 驱动。UI 目前只是一个用来验证链路的最小页面。

## 架构

三层，两个进程边界：

```
React (WebView)  ←→  Rust 宿主 (Tauri)  ←→  sidecar (bun 编译的单文件二进制)
   UI / 状态            窗口、生命周期、         Agent 循环、模型调用、工具执行
                        sidecar 启停、协议转发
```

前端不直接碰模型、文件系统或网络。一次请求的路径是：前端 `invoke("agent_request", { payload })` → Rust 写进 sidecar 的 TCP 连接 → sidecar 处理 → 逐行吐回记录 → Rust 转发成 `agent://record` 事件 → 前端。协议类型定义在 `shared/protocol.ts`，前端与 sidecar 共用一份。

前端与 sidecar 之间是 127.0.0.1 上随机端口的一条 TCP 连接，不是 stdin/stdout。原因值得记下来：bun 1.1.7 的 `process.stdin` 收不到 Rust（或 Tauri 插件）创建并作为子进程 fd 0 的那个管道里的数据，`Bun.stdin.stream()` 同样收不到，只有阻塞的 `readSync(0, ...)` 能读到。阻塞读会饿死事件循环，而 worker 线程在 `bun build --compile` 的产物里又解析不到模块（`$bunfs` 找不到路径）。有趣的是 shell 下 `printf ... | sidecar` 一切正常，所以问题只在 Rust 建管道这一侧。换成 TCP 后三平台行为一致，代价是多了一个 30 行的握手。

握手过程：Rust `bind("127.0.0.1:0")` 拿到随机端口，生成随机 token，通过环境变量 `AGENT_RUNBOOK_PORT` 和 `AGENT_RUNBOOK_TOKEN` 传给子进程；sidecar 连回来后的第一条记录带 token，Rust 校验通过才把它剥掉并转发给前端。校验失败会直接杀掉 sidecar。

sidecar 用 `bun build --compile` 打成自包含二进制，通过 Tauri 的 `externalBin` 随应用分发，用户机器不需要装 Node 或 bun。代价是每个平台多出约 50 到 100MB。

## 目录

```
shared/protocol.ts         前端与 sidecar 共用的 JSONL 协议类型
sidecar/src/index.ts       传输层：TCP 或 stdio，JSONL 帧解析
sidecar/src/agent-host.ts  pi-agent-core 接线处，换真实模型的入口
src/lib/agent/client.ts    前端客户端：请求 id 关联、事件分发、断线处理
src-tauri/src/agent.rs     sidecar 的启动、握手、转发、退出清理
scripts/build-sidecar.mjs  按 target triple 交叉编译 sidecar
```

## 前置依赖

Node ≥ 22.19、bun、rustup 管理的 rustc ≥ 1.90（Tauri 2.12 的要求）。Linux 还要 WebKitGTK 相关包，Windows 要 MSVC 工具链与 WebView2，见 Tauri 官方前置依赖说明。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run tauri dev` | 完整开发：编译 sidecar、起 Vite、开窗口 |
| `npm run dev` | 只起 Vite，在浏览器里调 UI（agent 桥接不可用） |
| `npm run tauri build` | 出安装包，产物在 `src-tauri/target/release/bundle` |
| `npm run sidecar:build` | 只编译当前平台的 sidecar |
| `npm run sidecar:build:all` | 编译全部已知目标 |
| `npm run sidecar:dev` | 用 stdio 模式单独跑 sidecar |
| `npm run typecheck` | 前端与 sidecar 两套 tsconfig 一起查 |

`predev` 与 `prebuild` 钩子会先跑 `sidecar:build`，所以改完 sidecar 代码重启 `tauri dev` 即可生效，不会跑到旧二进制。

注意不要直接 `cargo build` 出来的裸二进制当作运行方式，嵌入的前端资源可能不是最新的；用 `npm run tauri dev` 或 `tauri build` 的产物。

## 手动调试 sidecar

不给 `AGENT_RUNBOOK_PORT` 时 sidecar 走 stdio 模式，可以直接对着它说协议，方便不开窗口调 agent 逻辑：

```bash
printf '{"id":"1","type":"hello","name":"su"}\n{"id":"2","type":"prompt","text":"hi"}\n' | npm run sidecar:dev
```

桥接本身看不见，排查时用 `AGENT_RUNBOOK_DEBUG=1 npm run tauri dev`，Rust 侧会把启动、握手、每条命令和每条记录打到 stderr。

## 跨平台构建

sidecar 的编译目标由 Rust target triple 决定，输出到 `src-tauri/binaries/agent-runbook-agent-<triple>`，文件名必须与 triple 对上，否则 Tauri 找不到。

```bash
npm run sidecar:build -- --target x86_64-pc-windows-msvc
npm run tauri build -- --target x86_64-pc-windows-msvc
```

triple 与 bun target 的映射表在 `scripts/build-sidecar.mjs`。本机用 bun 1.1.7 实测：macOS 双架构、Linux gnu 双架构、Windows x64 都能交叉编译成功，musl 两个目标和 Windows arm64 在 1.1.7 上不支持，`bun upgrade` 之后可用。Tauri 本体和最终打包一般还是要在目标系统上做，CI 按平台分别跑最省事。

## 接真实模型

现在用 pi-ai 的 `fauxProvider`，不需要凭证，回复是脚本化的，只为验证链路。界面上的 Badge 会标明 demo provider。换成真实模型改 `sidecar/src/agent-host.ts`：用 `@earendil-works/pi-ai/providers/*` 里的 provider 替换 faux，把 API key 的来源定下来（环境变量、系统密钥串、或设置界面），并把 `demo` 置为 false。

## 还没做的

聊天界面的组件与交互是下一步重点。会话持久化、工具集（读写文件、执行命令）、模型与密钥的设置界面、断线后的自动重连都还没有。sidecar 崩溃时前端会收到 `closed` 记录并显示错误，但不会自动重启。
