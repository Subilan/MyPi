import { memo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Separator } from "@/components/ui/separator";
import { isTauriRuntime } from "@/lib/agent/client";
import { cn } from "@/lib/utils";

const CARET = [
  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-4",
  "[&>*:last-child]:after:w-1.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:bg-foreground",
  "[&>*:last-child]:after:align-text-bottom [&>*:last-child]:after:content-['']",
].join(" ");

const components: Components = {
  p({ node: _node, className, ...props }) {
    return <p className={cn("my-3 first:mt-0 last:mb-0", className)} {...props} />;
  },
  h1({ node: _node, className, ...props }) {
    return (
      <h1
        className={cn("my-4 first:mt-0 last:mb-0 text-lg font-semibold", className)}
        {...props}
      />
    );
  },
  h2({ node: _node, className, ...props }) {
    return (
      <h2
        className={cn("my-4 first:mt-0 last:mb-0 text-base font-semibold", className)}
        {...props}
      />
    );
  },
  h3({ node: _node, className, ...props }) {
    return (
      <h3
        className={cn("my-4 first:mt-0 last:mb-0 font-semibold", className)}
        {...props}
      />
    );
  },
  h4({ node: _node, className, ...props }) {
    return (
      <h4
        className={cn("my-4 first:mt-0 last:mb-0 font-semibold", className)}
        {...props}
      />
    );
  },
  ul({ node: _node, className, ...props }) {
    return <ul className={cn("my-3 list-disc pl-6", className)} {...props} />;
  },
  ol({ node: _node, className, ...props }) {
    return <ol className={cn("my-3 list-decimal pl-6", className)} {...props} />;
  },
  li({ node: _node, className, ...props }) {
    return <li className={cn("mt-1.5 first:mt-0 marker:text-muted-foreground", className)} {...props} />;
  },
  blockquote({ node: _node, className, ...props }) {
    return (
      <blockquote
        className={cn("my-3 border-l-2 border-border pl-3 text-muted-foreground", className)}
        {...props}
      />
    );
  },
  pre({ node: _node, className, ...props }) {
    return (
      <pre
        className={cn(
          "my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-6",
          "[&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0",
          className,
        )}
        {...props}
      />
    );
  },
  code({ node: _node, className, ...props }) {
    return (
      <code
        className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[13px]", className)}
        {...props}
      />
    );
  },
  a({ node: _node, className, href, onClick, ...props }) {
    return (
      <a
        className={cn("text-primary underline underline-offset-4 hover:opacity-80", className)}
        href={href}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || !href) return;
          event.preventDefault();
          if (isTauriRuntime()) void openUrl(href);
          else window.open(href, "_blank", "noreferrer");
        }}
        {...props}
      />
    );
  },
  hr({ node: _node, className }) {
    return <Separator className={cn("my-4", className)} />;
  },
  table({ node: _node, className, ...props }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className={cn("w-full border-collapse text-sm", className)} {...props} />
      </div>
    );
  },
  th({ node: _node, className, ...props }) {
    return (
      <th
        className={cn("border-b border-border px-3 py-1.5 text-left font-medium", className)}
        {...props}
      />
    );
  },
  td({ node: _node, className, ...props }) {
    return (
      <td className={cn("border-b border-border/60 px-3 py-1.5 align-top", className)} {...props} />
    );
  },
  img({ node: _node, className, ...props }) {
    return <img className={cn("my-2 max-w-full rounded-md", className)} {...props} />;
  },
};

export const Markdown = memo(function Markdown({
  text,
  caret = false,
}: {
  text: string;
  caret?: boolean;
}) {
  return (
    <div className={cn("break-words", caret ? CARET : null)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
