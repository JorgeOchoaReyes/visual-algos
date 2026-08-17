import { useEffect, useRef, useState } from "react";
import type { EnvStatus, Settings, ToolStatus } from "@shared/types";

function ToolRow({ name, tool }: { name: string; tool: ToolStatus }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-edge bg-ink/40 px-4 py-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${tool.ok ? "bg-emerald-400" : "bg-red-400"}`} />
          {name}
        </div>
        <div className="mt-0.5 text-xs text-white/45">
          {tool.ok
            ? `${tool.version ? `v${tool.version}` : "found"}${tool.detail ? ` · ${tool.detail}` : ""}`
            : tool.detail || "not found"}
        </div>
      </div>
      {tool.path && (
        <code className="max-w-[45%] truncate text-xs text-white/35" title={tool.path}>
          {tool.path}
        </code>
      )}
    </div>
  );
}

export function SettingsPage({
  settings,
  env,
  onSave,
  onRecheckEnv,
}: {
  settings: Settings | null;
  env: EnvStatus | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onRecheckEnv: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [pythonPath, setPythonPath] = useState("");
  const [saved, setSaved] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState<string>("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!settings) return;
    setApiKey(settings.geminiApiKey);
    setModel(settings.geminiModel);
    setPythonPath(settings.pythonPath);
  }, [settings]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  async function save() {
    await onSave({ geminiApiKey: apiKey.trim(), geminiModel: model.trim(), pythonPath: pythonPath.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onRecheckEnv();
  }

  async function installManim() {
    setInstalling(true);
    setLog("");
    const off = window.api.env.onInstallLog((line) => setLog((prev) => prev + line + "\n"));
    try {
      await window.api.env.installManim();
      onRecheckEnv();
    } finally {
      off();
      setInstalling(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Gemini */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/80">Gemini</h2>
        <p className="mt-1 text-xs text-white/45">
          Get a key at aistudio.google.com/apikey. Stored locally on this machine only.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-white/60">API key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza…"
              className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-white/60">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      </section>

      {/* Environment */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white/80">Render environment</h2>
          <button
            onClick={onRecheckEnv}
            className="rounded-md border border-edge px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            Re-check
          </button>
        </div>
        <p className="mt-1 text-xs text-white/45">
          Rendering runs locally with Manim. The installed app ships its own Python + Manim +
          ffmpeg, so this should be green with no setup. (In a source build, use the button below
          or point it at your own Python.)
        </p>

        <div className="mt-4 space-y-2">
          {env ? (
            <>
              <ToolRow name="Python" tool={env.python} />
              <ToolRow name="Manim" tool={env.manim} />
              <ToolRow name="ffmpeg" tool={env.ffmpeg} />
            </>
          ) : (
            <div className="h-16 animate-pulse rounded-lg border border-edge bg-panel" />
          )}
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs text-white/60">
            Python path (optional — leave blank to auto-detect)
          </label>
          <input
            type="text"
            value={pythonPath}
            onChange={(e) => setPythonPath(e.target.value)}
            placeholder="/usr/bin/python3"
            className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {env && env.python.ok && !env.manim.ok && (
          <div className="mt-4 rounded-lg border border-edge bg-panel p-4">
            <p className="text-sm">
              Manim isn't installed. You can let the app create a managed Python environment and
              install it for you.
            </p>
            <p className="mt-1 text-xs text-white/45">
              Note: Manim also needs system libraries (cairo, pango, ffmpeg, and LaTeX for
              formulas). If the install fails, install those with your OS package manager and retry.
            </p>
            <button
              onClick={installManim}
              disabled={installing}
              className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {installing ? "Installing…" : "Install Manim for me"}
            </button>
            {log && (
              <pre
                ref={logRef}
                className="mt-3 max-h-56 overflow-auto rounded-lg border border-edge bg-[#0d1017] p-3 font-mono text-[11px] leading-relaxed text-white/70"
              >
                {log}
              </pre>
            )}
          </div>
        )}
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
        >
          Save settings
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved</span>}
      </div>
    </div>
  );
}
