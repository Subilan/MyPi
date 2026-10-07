# 手动调试

不给别的条件时 sidecar 就是 stdin/stdout 模式，可以直接对着它说协议，方便不开窗口调 agent 逻辑。

```bash
# 交互式，逐行输入 JSON 请求，Ctrl-D 退出
npm run sidecar:dev

# 或者一次性喂进去，进程会等这一轮跑完再退出
npm run sidecar:build
printf '{"id":"1","type":"hello","name":"su"}\n{"id":"2","type":"prompt","text":"hi"}\n' | DEEPSEEK_API_KEY=... node src-tauri/resources/agent/index.mjs
```

## 相关环境变量

| 变量 | 作用 |
| --- | --- |
| `AGENT_RUNBOOK_SETTINGS` | 指向另一份配置文件，方便用临时配置调 sidecar |
| `AGENT_RUNBOOK_DEBUG=1` | 桥接调试。Rust 侧把找到的 node、产物路径、每条命令和每条记录打到 stderr |

```bash
AGENT_RUNBOOK_DEBUG=1 npm run tauri dev
```
