# 架构

## 分层

三层，两个进程边界：

```
React (WebView)  ←→  Rust 宿主 (Tauri)  ←→  sidecar (用户机器上的 Node 22)
   UI / 状态            窗口、生命周期、          Agent 循环、模型调用、工具执行
                        找 node、启停子进程、
                        协议转发
```

前端不直接碰模型、文件系统或网络。

## 请求路径

1. 前端 `invoke("agent_request", { payload })`
2. Rust 写进子进程 stdin
3. sidecar 处理
4. 逐行写到 stdout
5. Rust 转成 `agent://record` 事件
6. 前端消费

协议类型定义在 `shared/protocol.ts`，前端与 sidecar 共用一份。传输层用最朴素的 stdin/stdout，每行一条 JSON。

前端发出请求后会按 id 等对应的响应；30 秒内没有等到就以超时错误拒绝，避免 sidecar 卡住时调用方永久挂起。

## sidecar 打包

- 用 esbuild 打成一个平台无关的 `index.mjs`（约 1.4MB），作为 Tauri 的 resource 随应用分发。
- 运行时由用户机器上的 Node 执行，不打包任何运行时。
- 三平台共用同一个产物，不需要交叉编译或按平台分包。

### 为什么不用 bun

之前试过把 sidecar 编译成自包含二进制，踩到 bun 1.1.7 的坑：`process.stdin` 收不到 Rust（或 Tauri 官方 shell 插件）创建并作为子进程 fd 0 的管道数据，`Bun.stdin.stream()` 同样收不到，只有阻塞 `readSync(0, ...)` 能读到，而阻塞读会饿死事件循环，worker 线程在 `--compile` 产物里又解析不到模块。

换成 Node 后问题不存在，`node` 从 Rust 建的管道读 stdin 完全正常。回退到 bun 之前建议先确认这一点。
