# 编辑器

## 模块结构

编辑器是一个独立模块，和具体文档没有耦合，目前系统提示词（`/system edit`）与主题 CSS（`/ui edit`）共用它：

| 文件 | 职责 |
| --- | --- |
| `src/components/editor/code-editor.tsx` | 只做 CodeMirror 6 的接线（`basicSetup` 加一套跟随主题变量的 theme），对外只有 `value` / `onChange` |
| `src/components/editor/editor-pane.tsx` | 外壳：顶部栏（文件名、未保存 badge、关闭按钮）、错误条、编辑器本体，`Cmd+S` / `Cmd+W` 的监听也在这一层 |
| `src/hooks/use-editor-document.ts` | 通用的文档状态：打开一份文档、改动、标记已保存、关闭 |

## 交互

- 编辑期间编辑器占满窗口、替换聊天界面，也没有输入框，关掉就回到聊天。
- 有行号、当前行高亮和 `Cmd+F` 查找，没有语法高亮，也没有 vim 键位，是个普通的多行文本编辑器。
- 关闭按钮只在有未保存修改时弹 popover，给「保存并关闭」和「放弃并关闭」两个选择；已保存则直接关闭。
- `Cmd+W` 在已保存时直接关闭，有未保存修改时先弹 popover，popover 开着时再按一次等同于「保存并关闭」，「放弃并关闭」不绑快捷键。

## 加载方式

编辑器代码用动态 import 拆成单独的 chunk，不开编辑器就不加载（约 386KB，都是 CodeMirror）。

## macOS 菜单

macOS 的系统菜单默认把 `Cmd+W` 绑在 Close Window 上，快捷键会被菜单截走，所以 `src-tauri/src/menu.rs` 自己拼了一份不含 Close Window 的菜单（App / Edit / Window 三段），`Cmd+C` / `Cmd+V` 这些靠 Edit 里的预置项继续工作。
