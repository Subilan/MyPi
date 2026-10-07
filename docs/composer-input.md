# 输入框

## 文本辅助

输入框关掉了 WebView 在 macOS 上自带的文本辅助：`spellCheck` / `autocorrect` / `autocapitalize` / `autocomplete` / `writingsuggestions` 全部关闭，避免自动更正、拼写提示与行内补全。

长按字母弹出的标音变体是 AppKit 的 press-and-hold 行为，在 Rust 侧把 `ApplePressAndHoldEnabled` 写进 app 的 `NSUserDefaults` 关掉。

## 输入法与 Enter

输入法组合期间的 Enter 交给输入法：

- keydown 先看原生事件的 `isComposing`，再看自己维护的 composition 状态。
- `keyCode === 229` 也跳过。
- 组合结束后的 100ms 内按 Enter 不提交，补上 WebKit 上确认组合那次 Enter 的 `isComposing` 为 false 的差异。

## 编辑快捷键

| 按键 | 行为 |
| --- | --- |
| `ArrowUp` / `ArrowDown` | 在本次会话已发送的消息里前后翻阅，往下越过最新一条会回到翻阅前的草稿 |
| `Esc` | 清空输入框 |
| `i` | 焦点不在输入框时聚焦输入框 |

## 输入框本体

用 shadcn 的 `Textarea`（`src/components/ui/textarea.tsx`），聚焦环、边框色、placeholder、disabled 这些样子都由组件提供，聚焦环的淡入来自组件自带的 `transition-[color,box-shadow]`。`ar-composer-input` 上只留布局覆盖：`min-h-9`、`px-3 py-1.5`、`text-[15px] leading-6`（字号跟聊天正文一致，另配 `md:text-[15px]` 压掉组件的 `md:text-sm`）、`resize-none`、`field-sizing-fixed`（高度归 JS 管，压掉组件的 `field-sizing-content`）。主题里覆盖 `.ar-composer-input` 能改这些。

## 拖入文件

把外部文件拖进窗口，会在输入框光标处补上它的绝对路径：

- 多个文件用空格分隔，路径原样插入、不加引号，方便直接交给四个工具使用。
- 拖进输入框区域时边线高亮提示，在其他位置松手同样会插入。
- Tauri 默认开启了 `dragDropEnabled`，走 `getCurrentWebview().onDragDropEvent`，位置按 `devicePixelRatio` 换算成 CSS 像素后与输入框边界比较，只用来控制高亮。
- 在浏览器里跑 `npm run dev` 时拿不到绝对路径，走 HTML5 drop 回退，只能插入文件名。
