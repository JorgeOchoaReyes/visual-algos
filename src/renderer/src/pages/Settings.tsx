import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cpu,
  Download,
  KeyRound,
  Loader2,
  MonitorCog,
  Play,
  RefreshCw,
  Square,
  Volume2,
} from "lucide-react";
import {
  AI_PROVIDERS,
  DEFAULT_ELEVENLABS_MODEL,
  ELEVENLABS_MODELS,
  ELEVENLABS_VOICES,
  GEMINI_MODELS,
  OPENROUTER_MODELS,
  type AiProvider,
  type EnvStatus,
  type Settings,
  type ToolStatus,
  type UpdateState,
} from "@shared/types";
import { Dropdown } from "../components/Dropdown";

const CUSTOM = "__custom__";

function updateLabel(u: UpdateState): string {
  switch (u.status) {
    case "checking":
      return "Checking…";
    case "downloading":
      return `Downloading… ${u.percent ?? 0}%`;
    case "available":
      return "Update available";
    case "ready":
      return "Update ready";
    case "none":
      return u.message || "Up to date";
    case "error":
      return "Check failed";
    default:
      return "";
  }
}

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
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customModel, setCustomModel] = useState(false);
  const [orKey, setOrKey] = useState("");
  const [orModel, setOrModel] = useState("google/gemini-2.5-flash");
  const [customOrModel, setCustomOrModel] = useState(false);
  const [pythonPath, setPythonPath] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [voiceId, setVoiceId] = useState(ELEVENLABS_VOICES[0].id);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "playing">("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopSample() {
    audioRef.current?.pause();
    audioRef.current = null;
    setSampleState("idle");
  }

  async function playSample() {
    if (sampleState === "playing") {
      stopSample();
      return;
    }
    setSampleError(null);
    setSampleState("loading");
    try {
      const res = await window.api.voices.sample(voiceId.trim());
      if (!res.ok || !res.dataUrl) {
        setSampleError(res.error || "Could not load the voice sample.");
        setSampleState("idle");
        return;
      }
      const audio = new Audio(res.dataUrl);
      audioRef.current = audio;
      audio.onended = () => setSampleState("idle");
      audio.onerror = () => {
        setSampleError("Playback failed.");
        setSampleState("idle");
      };
      await audio.play();
      setSampleState("playing");
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : "Could not play the sample.");
      setSampleState("idle");
    }
  }

  // Stop any playing sample when the voice changes or the page unmounts.
  useEffect(() => stopSample, []);
  useEffect(() => {
    stopSample();
    setSampleError(null);
  }, [voiceId]);
  const [customVoice, setCustomVoice] = useState(false);
  const [voiceModel, setVoiceModel] = useState(DEFAULT_ELEVENLABS_MODEL);
  const [customVoiceModel, setCustomVoiceModel] = useState(false);
  const [saved, setSaved] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    window.api.app.version().then(setVersion);
  }, []);

  useEffect(() => window.api.updates.onStatus(setUpdate), []);

  function checkForUpdates() {
    setUpdate({ status: "checking" });
    void window.api.updates.check();
  }

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setApiKey(settings.geminiApiKey);
    setModel(settings.geminiModel);
    setCustomModel(!GEMINI_MODELS.some((m) => m.id === settings.geminiModel) && !!settings.geminiModel);
    setOrKey(settings.openRouterApiKey);
    setOrModel(settings.openRouterModel);
    setCustomOrModel(
      !OPENROUTER_MODELS.some((m) => m.id === settings.openRouterModel) &&
        !!settings.openRouterModel,
    );
    setPythonPath(settings.pythonPath);
    setElevenKey(settings.elevenLabsApiKey);
    setVoiceId(settings.elevenLabsVoiceId);
    setCustomVoice(
      !ELEVENLABS_VOICES.some((v) => v.id === settings.elevenLabsVoiceId) &&
        !!settings.elevenLabsVoiceId,
    );
    const vm = settings.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL;
    setVoiceModel(vm);
    setCustomVoiceModel(!ELEVENLABS_MODELS.some((m) => m.id === vm));
  }, [settings]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  async function save() {
    await onSave({
      provider,
      geminiApiKey: apiKey.trim(),
      geminiModel: model.trim(),
      openRouterApiKey: orKey.trim(),
      openRouterModel: orModel.trim(),
      pythonPath: pythonPath.trim(),
      elevenLabsApiKey: elevenKey.trim(),
      elevenLabsVoiceId: voiceId.trim(),
      elevenLabsModel: voiceModel.trim() || DEFAULT_ELEVENLABS_MODEL,
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

  const providerOptions = AI_PROVIDERS.map((p) => ({
    value: p.id,
    label: p.label,
    note: p.hint,
  }));
  const modelOptions = [
    ...GEMINI_MODELS.map((m) => ({ value: m.id, label: m.label, note: m.note })),
    { value: CUSTOM, label: "Custom…", note: "enter any model id" },
  ];
  const orModelOptions = [
    ...OPENROUTER_MODELS.map((m) => ({ value: m.id, label: m.label, note: m.note })),
    { value: CUSTOM, label: "Custom…", note: "enter any model slug" },
  ];
  const voiceOptions = [
    ...ELEVENLABS_VOICES.map((v) => ({ value: v.id, label: v.label })),
    { value: CUSTOM, label: "Custom…", note: "enter a voice id" },
  ];
  const voiceModelOptions = [
    ...ELEVENLABS_MODELS.map((m) => ({ value: m.id, label: m.label, note: m.note })),
    { value: CUSTOM, label: "Custom…", note: "enter a model id" },
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
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs text-white/45">{updateLabel(update)}</span>
          {update.status === "ready" ? (
            <button onClick={() => window.api.updates.install()} className="btn8 !py-1.5 !text-xs">
              <RefreshCw size={13} /> Restart to update
            </button>
          ) : update.status === "available" ? (
            <button onClick={() => window.api.updates.openDownload()} className="btn8 !py-1.5 !text-xs">
              <Download size={13} /> Download v{update.version ?? ""}
            </button>
          ) : (
            <button
              onClick={checkForUpdates}
              disabled={update.status === "checking" || update.status === "downloading"}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={13} className={update.status === "checking" ? "animate-spin" : ""} />
              Check for updates
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-white/35">
        Windows &amp; Linux update automatically. macOS builds aren&apos;t notarized, so they can&apos;t
        self-install — use Download to grab the latest.
      </p>

      {/* AI provider */}
      <section className="mt-8 space-y-4">
        <SectionTitle icon={KeyRound}>AI provider</SectionTitle>
        <p className="-mt-2 text-xs text-white/45">
          Where the walkthrough is written. Only the topic you type is ever sent. Keys are stored
          locally on this machine only.
        </p>
        <Dropdown
          value={provider}
          options={providerOptions}
          onChange={(v) => setProvider(v as AiProvider)}
        />

        {provider === "gemini" ? (
          <>
            <p className="text-xs text-white/45">Get a free key at aistudio.google.com/apikey.</p>
            <div>
              <label className="mb-1.5 block text-xs text-white/60">Gemini API key</label>
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
          </>
        ) : (
          <>
            <p className="text-xs text-white/45">
              Get a key at openrouter.ai/keys — one key for models from many providers. Pick a
              model that can return strict JSON; if generation fails with malformed JSON, try a
              stronger one.
            </p>
            <div>
              <label className="mb-1.5 block text-xs text-white/60">OpenRouter API key</label>
              <input
                type="password"
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                placeholder="sk-or-v1-…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs text-white/60">
                <Cpu size={13} /> Model
              </label>
              <Dropdown
                value={customOrModel ? CUSTOM : orModel}
                options={orModelOptions}
                onChange={(v) => {
                  if (v === CUSTOM) {
                    setCustomOrModel(true);
                    setOrModel("");
                  } else {
                    setCustomOrModel(false);
                    setOrModel(v);
                  }
                }}
              />
              {customOrModel && (
                <input
                  type="text"
                  value={orModel}
                  onChange={(e) => setOrModel(e.target.value)}
                  placeholder="e.g. mistralai/mistral-large"
                  className={`${inputCls} mt-2`}
                />
              )}
            </div>
          </>
        )}
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
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
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
            </div>
            <button
              type="button"
              onClick={playSample}
              disabled={!elevenKey.trim() || !voiceId.trim() || sampleState === "loading"}
              title={elevenKey.trim() ? "Play a sample of this voice" : "Add an API key to preview voices"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/70 transition hover:border-accent/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sampleState === "loading" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : sampleState === "playing" ? (
                <Square size={13} />
              ) : (
                <Play size={15} />
              )}
            </button>
          </div>
          {sampleError && <p className="mt-1.5 text-xs text-red-300">{sampleError}</p>}
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
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-white/60">
            <Cpu size={13} /> Voice model
          </label>
          <Dropdown
            value={customVoiceModel ? CUSTOM : voiceModel}
            options={voiceModelOptions}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustomVoiceModel(true);
                setVoiceModel("");
              } else {
                setCustomVoiceModel(false);
                setVoiceModel(v);
              }
            }}
          />
          {customVoiceModel && (
            <input
              type="text"
              value={voiceModel}
              onChange={(e) => setVoiceModel(e.target.value)}
              placeholder="e.g. eleven_turbo_v2_5"
              className={`${inputCls} mt-2`}
            />
          )}
          <p className="mt-1.5 text-xs text-white/40">
            Higher-quality models sound better; faster models cost less and render quicker.
          </p>
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
            <button onClick={installManim} disabled={installing} className="btn8 mt-3">
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
        <button onClick={save} className="btn8">
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
