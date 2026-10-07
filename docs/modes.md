# 模式

## 状态

模式是 session 级的状态，切在内存里。

- 切换会话时会恢复该会话记录里的模式，重启应用则回到 Regular。
- sidecar 是模式的唯一来源，前端连上后会从 `hello` 返回的 runtime 里对齐一次，每次切换会话也会用返回的会话摘要对齐，所以刷新 WebView 不会让两边错位。
- 当前模式可以用 `/mode` 或 `/info` 查看。

## 两种模式

Regular 就是原来的行为：思考阶段只显示 `Thinking...` 与已耗时，工具调用渲染成一行，正文照常流式渲染。

Deliver 面向「让 agent 交活」的场景：思考内容、工具调用过程与模型的自由正文都不展示，任务必须以交付工具收尾。细节见 [deliver-mode.md](deliver-mode.md)。

交付类工具不限模式地走卡片：`report_success` / `report_failure` / `request_user_decision` 在 regular 模式下也渲染成交付卡或选择题卡，不会被铺成「工具名 + JSON 参数」的行。只有工作目录相关的 Read / Edit / Write / Bash 才用那种通用行。

## 切换流程

1. 前端先弹出一张 CONFIRMATION 卡，待回答时黄底，是按钮带 Enter 快捷键、否按钮带 Backspace 快捷键，待确认期间输入框锁住。
2. 用户确认后才发 sidecar 的 `mode_set` 请求。
3. 回答后卡片整体换色换文案：确认变绿底 `CONFIRMED` 加「已切换为 Deliver 模式」，取消变灰底 `CANCELLED` 加「取消切换到 Deliver 模式」。
4. 切换请求失败时卡片退回待回答状态并附一条错误。

## sidecar 收到的处理

- 带上已有对话重建 Agent，换成对应的系统提示词与工具集。
- 把不属于新工具集的 tool call 与 tool result 从模型历史里剔除（assistant 消息只去掉 `toolCall` 部分，只剩工具调用的整条丢弃），避免模型在 regular 模式下模仿历史里的 `report_success` 去调已经不存在的工具。
- 聊天记录本身不动。

`finishTurn` 钩子在 deliver 模式下保证任务以 `report_success` / `report_failure` 结束；如果模型只输出了正文而没有调用工具，会被连续追发几次请求逼它交付，最多三次后放行，避免死循环。
