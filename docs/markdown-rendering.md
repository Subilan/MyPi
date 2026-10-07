# Markdown 渲染

agent 的回复走 `src/components/chat/markdown.tsx`，用 react-markdown 渲染。

## 启用的插件

| 插件 | 作用 |
| --- | --- |
| remark-gfm | 表格、删除线、任务列表、脚注 |
| remark-math + rehype-katex | `$...$` 行内公式与 `$$...$$` 块级公式，样式来自 katex 自带 CSS |
| remark-cjk-friendly | 中文标点紧贴 `**` 等标记时的解析修正 |
| remark-cjk-friendly-gfm-strikethrough | 同上，针对 GFM 删除线 |

remark-cjk-friendly 两个插件都走 `/parseOnly` 入口，只用它们的解析扩展，不引入反向序列化。

## 自动链接的修正

GFM 的扩展自动链接在 micromark 词法阶段完成，会把 URL 后面紧贴的内容一路吞进链接（规范如此，GitHub 同样这么渲染）。`**https://iina.io**（实测可正常打开）` 因此渲染成字面量 `**` 加一条包住后半句的链接。

`src/lib/chat/remark-gfm-autolink.ts` 用 micromark 的 `disable` 关掉 `wwwAutolink` / `protocolAutolink` / `emailAutolink` 三个 construct，链接改由 remark-gfm 自带的 mdast transform 在 emphasis 之后补出来，再把 URL 里第一个中文标点之后的部分还给正文。效果：

- `https://a.com，后面` 不会把整句吞掉。
- `.../wiki/中文条目` 这种自带中文的路径和 `(software)` 的括号平衡不受影响。

中文标点紧贴 `**` / `~~` 时 CommonMark 与 GFM 自己也不认（commonmark-spec#650），`**该星号…直接显示。**这是因为…` 会原样输出，所以挂了上面两个 cjk-friendly 插件。

## 换行

正文里的单换行按 CommonMark 折叠成空格，不产生断行；段落靠空行（`\n\n`）划分。

之前用过 remark-breaks 把单换行渲染成 `<br>`，但实测 deepseek-flash 会把 `\n` 当排版手段频繁输出（20 轮里 106 个单换行，其中 9 个落在正文句中），全渲染成硬换行后看起来像 bug，所以去掉了。

## 样式

标题、列表、引用、代码块、表格的样式用主题变量写在 `components` 映射里，没有引入 typography 插件；代码块只有底色，没有语法高亮。

- 块级公式在 `index.css` 里补了横向滚动，长公式不会把聊天撑宽。
- 流式输出时每来一段就重新解析一次，光标用 `::after` 挂在最后一个块级元素尾部，不会多出一行。
- 链接不靠 WebView 自己跳转，而是 preventDefault 后交给 `tauri-plugin-opener` 用系统浏览器打开。
- 用户自己发的话不做 markdown 解析，保持原样显示。
