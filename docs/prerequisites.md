# 前置依赖

| 依赖 | 版本 |
| --- | --- |
| Node | ≥ 22（开发机与用户机器都要求有） |
| npm | 随 Node 提供 |
| rustc | ≥ 1.90，由 rustup 管理（Tauri 2.12 的要求） |

平台额外要求：

- Linux：WebKitGTK 相关包。
- Windows：MSVC 工具链与 WebView2。

详见 Tauri 官方前置依赖说明。运行时的 Node 查找逻辑见 [node-runtime.md](node-runtime.md)。
