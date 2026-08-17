import { useState } from "react";
import { Check, Copy } from "lucide-react";

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
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1017]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2 text-xs text-white/40">
        <span className="font-mono">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[460px] overflow-auto p-4 text-xs leading-relaxed">
        <code className="font-mono text-white/90">{code}</code>
      </pre>
    </div>
  );
}
