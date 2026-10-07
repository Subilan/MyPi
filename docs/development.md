# 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run tauri dev` | 完整开发：打包 sidecar、起 Vite、开窗口 |
| `npm run dev` | 只起 Vite，在浏览器里调 UI（agent 桥接不可用） |
| `npm run tauri build` | 出安装包，产物在 `src-tauri/target/release/bundle` |
| `npm run sidecar:build` | 只重新打包 sidecar |
| `npm run sidecar:dev` | 打完包后直接用 node 跑 sidecar |
| `npm run typecheck` | 前端与 sidecar 两套 tsconfig 一起查 |

## 构建钩子

`predev` 与 `prebuild` 会先跑 `sidecar:build`，所以改完 sidecar 代码重启 `tauri dev` 即可生效。

生成的 `src-tauri/resources/agent/index.mjs` 是构建产物，不进版本库。

## 注意

不要用直接 `cargo build` 出来的裸二进制当运行方式，嵌入的前端资源可能不是最新的。用 `npm run tauri dev` 或 `tauri build` 的产物。
