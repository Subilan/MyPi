import type { Link, Parent, Root, Text } from "mdast";
import type {} from "remark-parse"; // 激活 unified Data 上的 micromarkExtensions 声明

const AUTOLINK_CONSTRUCTS = ["wwwAutolink", "protocolAutolink", "emailAutolink"];
const CJK_PUNCTUATION = /[。，、；：？！）】》」』”’]/;

interface DataHost {
  data: () => { micromarkExtensions?: unknown };
}

function bareAutolink(node: Link): Text | null {
  if (node.title !== null || node.children.length !== 1) return null;
  const only = node.children[0];
  if (only.type !== "text") return null;
  if (node.url !== only.value && node.url !== `http://${only.value}`) return null;
  return only;
}

// GFM 自动链接在词法阶段会吞掉 URL 后紧贴的 `**` 和中文标点，这里关掉词法层的 construct，
// 让 remark-gfm 自带的 mdast transform 在 emphasis 之后补链接，再把中文标点还给正文。
export function remarkGfmAutolink(this: DataHost) {
  const data = this.data();
  const extensions = Array.isArray(data.micromarkExtensions)
    ? data.micromarkExtensions
    : (data.micromarkExtensions = []);
  extensions.push({ disable: { null: AUTOLINK_CONSTRUCTS } });

  return (tree: Root) => {
    const parents: Parent[] = [tree];
    while (parents.length > 0) {
      const parent = parents.pop() as Parent;
      for (let index = parent.children.length - 1; index >= 0; index -= 1) {
        const child = parent.children[index];
        if (child.type === "link") {
          const text = bareAutolink(child);
          const cut = text ? text.value.search(CJK_PUNCTUATION) : -1;
          if (!text || cut < 0) continue;
          const trail = text.value.slice(cut);
          text.value = text.value.slice(0, cut);
          child.url = child.url.slice(0, -trail.length);
          parent.children.splice(index + 1, 0, { type: "text", value: trail });
        } else if ("children" in child) {
          parents.push(child as Parent);
        }
      }
    }
  };
}
