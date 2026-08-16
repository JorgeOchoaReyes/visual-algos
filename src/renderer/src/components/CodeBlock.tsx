import { useState } from "react";

export function CodeBlock({ code, language = "python" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-edge bg-[#0d1017]">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2 text-xs text-white/40">
        <span>{language}</span>
        <button onClick={copy} className="rounded px-2 py-1 hover:bg-white/5 hover:text-white">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[460px] overflow-auto p-4 text-xs leading-relaxed">
        <code className="font-mono text-white/90">{code}</code>
      </pre>
    </div>
  );
}
