import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cpu,
  Download,
  KeyRound,
  MonitorCog,
  RefreshCw,
  Volume2,
} from "lucide-react";
import {
  ELEVENLABS_VOICES,
  GEMINI_MODELS,
  type EnvStatus,
  type Settings,
  type ToolStatus,
} from "@shared/types";
import { Dropdown } from "../components/Dropdown";

const CUSTOM = "__custom__";

function ToolRow({ name, tool }: { name: string; tool: ToolStatus }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
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

function SectionTitle({ icon: Icon, children }: { icon: typeof Cpu; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-white/85">
      <Icon size={16} className="text-accent" />
      {children}
    </h2>
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
  const [customModel, setCustomModel] = useState(false);
  const [pythonPath, setPythonPath] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [voiceId, setVoiceId] = useState(ELEVENLABS_VOICES[0].id);
  const [customVoice, setCustomVoice] = useState(false);
  const [saved, setSaved] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [version, setVersion] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    window.api.app.version().then(setVersion);
  }, []);

  useEffect(() => {
    if (!settings) return;
    setApiKey(settings.geminiApiKey);
    setModel(settings.geminiModel);
    setCustomModel(!GEMINI_MODELS.some((m) => m.id === settings.geminiModel) && !!settings.geminiModel);
    setPythonPath(settings.pythonPath);
    setElevenKey(settings.elevenLabsApiKey);
    setVoiceId(settings.elevenLabsVoiceId);
    setCustomVoice(
      !ELEVENLABS_VOICES.some((v) => v.id === settings.elevenLabsVoiceId) &&
        !!settings.elevenLabsVoiceId,
    );
  }, [settings]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  async function save() {
    await onSave({
      geminiApiKey: apiKey.trim(),
      geminiModel: model.trim(),
      pythonPath: pythonPath.trim(),
      elevenLabsApiKey: elevenKey.trim(),
      elevenLabsVoiceId: voiceId.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
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

  const modelOptions = [
    ...GEMINI_MODELS.map((m) => ({ value: m.id, label: m.label, note: m.note })),
    { value: CUSTOM, label: "Custom…", note: "enter any model id" },
  ];
  const voiceOptions = [
    ...ELEVENLABS_VOICES.map((v) => ({ value: v.id, label: v.label })),
    { value: CUSTOM, label: "Custom…", note: "enter a voice id" },
  ];

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm outline-none transition focus:border-accent";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {version && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 font-mono text-xs text-white/55">
            v{version}
          </span>
        )}
      </div>

      {/* Gemini */}
      <section className="mt-8 space-y-4">
        <SectionTitle icon={KeyRound}>Gemini</SectionTitle>
        <p className="-mt-2 text-xs text-white/45">
          Get a key at aistudio.google.com/apikey. Stored locally on this machine only.
        </p>
        <div>
          <label className="mb-1.5 block text-xs text-white/60">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-white/60">
            <Cpu size={13} /> Model
          </label>
          <Dropdown
            value={customModel ? CUSTOM : model}
            options={modelOptions}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustomModel(true);
                setModel("");
              } else {
                setCustomModel(false);
                setModel(v);
              }
            }}
          />
          {customModel && (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gemini-2.5-pro-exp"
              className={`${inputCls} mt-2`}
            />
          )}
        </div>
      </section>

      {/* ElevenLabs */}
      <section className="mt-10 space-y-4">
        <SectionTitle icon={Volume2}>Narration (ElevenLabs)</SectionTitle>
        <p className="-mt-2 text-xs text-white/45">
          Optional. Add a key to generate a spoken voiceover and mux it into your videos. Get one
          at elevenlabs.io. Stored locally.
        </p>
        <div>
          <label className="mb-1.5 block text-xs text-white/60">API key</label>
          <input
            type="password"
            value={elevenKey}
            onChange={(e) => setElevenKey(e.target.value)}
            placeholder="sk_…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-white/60">Voice</label>
          <Dropdown
            value={customVoice ? CUSTOM : voiceId}
            options={voiceOptions}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustomVoice(true);
                setVoiceId("");
              } else {
                setCustomVoice(false);
                setVoiceId(v);
              }
            }}
          />
          {customVoice && (
            <input
              type="text"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="ElevenLabs voice id"
              className={`${inputCls} mt-2`}
            />
          )}
        </div>
      </section>

      {/* Environment */}
      <section className="mt-10 space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle icon={MonitorCog}>Render environment</SectionTitle>
          <button
            onClick={onRecheckEnv}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:text-white"
          >
            <RefreshCw size={12} /> Re-check
          </button>
        </div>
        <p className="-mt-1 text-xs text-white/45">
          The installed app ships its own Python + Manim + ffmpeg, so this should be green with no
          setup. (In a source build, use the button below or point it at your own Python.)
        </p>

        <div className="space-y-2">
          {env ? (
            <>
              <ToolRow name="Python" tool={env.python} />
              <ToolRow name="Manim" tool={env.manim} />
              <ToolRow name="ffmpeg" tool={env.ffmpeg} />
            </>
          ) : (
            <div className="h-16 animate-pulse rounded-xl border border-white/[0.06] bg-panel/60" />
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-white/60">
            Python path (optional — leave blank to auto-detect)
          </label>
          <input
            type="text"
            value={pythonPath}
            onChange={(e) => setPythonPath(e.target.value)}
            placeholder="/usr/bin/python3"
            className={inputCls}
          />
        </div>

        {env && env.python.ok && !env.manim.ok && (
          <div className="rounded-xl border border-white/[0.07] bg-panel/50 p-4">
            <p className="text-sm">
              Manim isn't installed. Let the app create a managed Python environment and install it.
            </p>
            <p className="mt-1 text-xs text-white/45">
              Manim also needs system libraries (cairo, pango, ffmpeg). If the install fails, add
              those with your OS package manager and retry.
            </p>
            <button
              onClick={installManim}
              disabled={installing}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              <Download size={15} /> {installing ? "Installing…" : "Install Manim for me"}
            </button>
            {log && (
              <pre
                ref={logRef}
                className="mt-3 max-h-56 overflow-auto rounded-lg border border-white/10 bg-[#0d1017] p-3 font-mono text-[11px] leading-relaxed text-white/70"
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
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-accent to-accent2 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20"
        >
          Save settings
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-300">
            <Check size={15} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
