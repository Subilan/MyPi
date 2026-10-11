# 配置与模型

## 配置文件

配置读 `~/.mypi/settings.toml`（`MYPI_SETTINGS` 可改路径）。文件不存在时 sidecar 会生成一份默认的，权限 0600：

```toml
provider = "deepseek"
model = "deepseek-flash"
api_key = ""

[agent]
thinking = "high"
# system_prompt = "自定义系统提示词"
```

## 字段说明

| 字段 | 说明 |
| --- | --- |
| `provider` | provider 名，白名单在 `sidecar/src/agent-host.ts` 的 `PROVIDERS` 里 |
| `model` | 模型 id，从 pi-ai 的目录里查 |
| `api_key` | 留空时回退到环境变量，例如 `DEEPSEEK_API_KEY` |
| `agent.thinking` | `off / minimal / low / medium / high / xhigh / max`，实际生效档位由模型的 thinking 能力决定 |
| `agent.system_prompt` | 只是首次生成系统提示词文件的种子，之后由 `~/.mypi/system-prompt.md` 决定 |

## 行为约定

- sidecar 启动时读一次配置，改完要重启应用。
- 配置问题分两级：缺 provider / model、TOML 解析失败、没有可用的 key 属于致命错误，agent 停用并在界面提示；首次生成默认配置、`thinking` 拼错而回退到默认档属于提示，照常运行，只把提示显示出来。
- 加一个 provider 需要工厂函数和它的环境变量名。
- 密钥现在只落在本地文件或环境变量里，还没有系统密钥串与设置界面。
- 界面样式不在 settings.toml 里，见 [theming.md](theming.md)。
- `api_key` 与对应环境变量都没有时应用照常启动，界面上显示一条可读错误，说明该往哪里填。

系统提示词文件详见 [system-prompt.md](system-prompt.md)。
