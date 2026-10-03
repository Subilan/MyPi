# agent-runbook

基于 Tauri v2 的跨平台桌面应用骨架，agent 部分由 `@earendil-works/pi-agent-core` 驱动。UI 目前只是一个用来验证链路的最小页面。

## 架构

三层，两个进程边界：

```
React (WebView)  ←→  Rust 宿主 (Tauri)  ←→  sidecar (用户机器上的 Node 22)
   UI / 状态            窗口、生命周期、          Agent 循环、模型调用、工具执行
                        找 node、启停子进程、
                        协议转发
```

前端不直接碰模型、文件系统或网络。一次请求的路径是：前端 `invoke("agent_request", { payload })` → Rust 写进子进程 stdin → sidecar 处理 → 逐行写到 stdout → Rust 转成 `agent://record` 事件 → 前端。协议类型定义在 `shared/protocol.ts`，前端与 sidecar 共用一份。

sidecar 的代码用 esbuild 打成一个平台无关的 `index.mjs`（约 480KB），作为 Tauri 的 resource 随应用分发，运行时由用户机器上的 Node 执行，不打包任何运行时。三平台共用同一个产物，交叉编译、按平台分包这类事情都不用管了。

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
shared/protocol.ts         前端与 sidecar 共用的 JSONL 协议类型
sidecar/src/index.ts       stdin/stdout 上的 JSONL 主循环
sidecar/src/agent-host.ts  pi-agent-core 接线处，换真实模型的入口
src/lib/agent/client.ts    前端客户端：请求 id 关联、事件分发、断线处理
src-tauri/src/agent.rs     找 node、启停 sidecar、转发记录
scripts/build-sidecar.mjs  用 esbuild 打包 sidecar
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

# 或者一次性喂进去
npm run sidecar:build
printf '{"id":"1","type":"hello","name":"su"}\n{"id":"2","type":"prompt","text":"hi"}\n' | node src-tauri/resources/agent/index.mjs
```

桥接过程看不见，排查时用 `AGENT_RUNBOOK_DEBUG=1 npm run tauri dev`，Rust 侧会把找到的 node、产物路径、每条命令和每条记录打到 stderr。

## 接真实模型

现在用 pi-ai 的 `fauxProvider`，不需要凭证，回复是脚本化的，只为验证链路。界面上的 Badge 会标明 demo provider。换成真实模型改 `sidecar/src/agent-host.ts`：用 `@earendil-works/pi-ai/providers/*` 里的 provider 替换 faux，把 API key 的来源定下来（环境变量、系统密钥串、或设置界面），并把 `demo` 置为 false。密钥还没定方案，这是下一步要拍板的事。

## 还没做的

聊天界面的组件与交互是下一步重点。会话持久化、工具集（读写文件、执行命令）、模型与密钥的设置界面、sidecar 异常退出后的自动重启、以及 agent 的工作目录都还没有。sidecar 挂掉时前端会收到 `closed` 记录并显示原因，但不会自动重启。
