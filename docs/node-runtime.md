# Node 的查找与版本要求

## 版本要求

要求 Node ≥ 22，22 LTS 是测试目标，更高的主版本也能跑。

## 查找顺序

Rust 侧按顺序探测候选，逐个执行 `node --version`，取第一个主版本 ≥ 22 的：

1. `MYPI_NODE` 指定的路径
2. `PATH`
3. 常见安装位置：Volta / fnm / asdf / mise / nvm / scoop / Homebrew / 系统目录等

之所以要扫目录，是因为 macOS 上从 Finder 启动的 GUI 应用拿不到登录 shell 的 `PATH`，nvm 装的 node 不在默认路径里。

## 失败处理

找不到或版本过低时不崩，应用照常启动，界面上显示一条可读错误，例如 `node 22 or newer is required, found only v20.17.0 /usr/local/bin/node`。

前端轮询 `agent_status`，Rust 把错误放在 `error` 字段里返回，所以即使错误发生在窗口加载之前也不会丢。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `MYPI_NODE` | 指定用哪个 node 二进制 |
| `MYPI_AGENT_SCRIPT` | 指定跑哪个 agent 产物，调试用 |

Windows 下启动子进程会带 `CREATE_NO_WINDOW`，避免弹出控制台窗口。
