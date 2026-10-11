import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Clock, Code2, Cpu, Gauge, Loader2, MessageSquareText, MonitorSmartphone, Palette, Play, SlidersHorizontal, Sparkles, Square, Volume2, AlertCircle } from "lucide-react";
import {
  estimateVideoCost,
  formatUsd,
  ELEVENLABS_VOICES,
  GEMINI_MODELS,
  LANGUAGES,
  MODES,
  OPENROUTER_MODELS,
  ORIENTATIONS,
  REGISTERS,
  VIDEO_LENGTHS,
  VIDEO_THEMES,
  providerLabel,
  type AiProvider,
  type EnvStatus,
  type ConceptRegister,
  type Mode,
  type Orientation,
  type RenderQuality,
  type VideoLength,
  type VideoTheme,
} from "@shared/types";
import { Toggle } from "../components/Toggle";
import { Dropdown } from "../components/Dropdown";

const QUALITIES: { value: RenderQuality; label: string; hint: string }[] = [
  { value: "l", label: "Fast", hint: "720p" },
  { value: "m", label: "Balanced", hint: "1080p" },
  { value: "h", label: "High", hint: "1440p · 60fps" },
];

// Sentinels for the per-video model / voice pickers.
const DEFAULT_OPT = "__default__";
const CUSTOM_OPT = "__custom__";

const EXAMPLES = [
  "Binary search on a sorted array",
  "Dijkstra's shortest path",
  "Quicksort partitioning",
  "Hash table collisions",
  "Breadth-first search on a graph",
];

const CONCEPT_EXAMPLES = [
  "Primitive accumulation (Marx)",
  "Anomie (Durkheim)",
  "Division of labor and solidarity (Durkheim)",
  "Commodity fetishism (Marx)",
  "Atomization in mass society",
];

export function New({
  canGenerate,
  hasKey,
  env,
  hasElevenLabs,
  provider,
  model,
  defaultVoiceId,
}: {
  canGenerate: boolean;
  hasKey: boolean;
  env: EnvStatus | null;
  hasElevenLabs: boolean;
  provider: AiProvider;
  model: string;
  defaultVoiceId: string;
}) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Mode>("algorithm");
  const [quality, setQuality] = useState<RenderQuality>("m");
  const [theme, setTheme] = useState<VideoTheme>("8bit");
  const [register, setRegister] = useState<ConceptRegister>("free");
  const [language, setLanguage] = useState("python");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [length, setLength] = useState<VideoLength>("standard");
  const [narrate, setNarrate] = useState(false);
  const [captions, setCaptions] = useState(true);

  // Picking a format nudges the length to a sensible default (Shorts want a
  // punchy ~15–20s; landscape wants the full walkthrough). Still overridable.
  function pickOrientation(o: Orientation) {
    setOrientation(o);
    setLength(o === "portrait" ? "short" : "standard");
  }

  // Per-video model + voice overrides. DEFAULT_OPT = use the Settings default.
  const [modelSel, setModelSel] = useState(DEFAULT_OPT);
  const [customModel, setCustomModel] = useState("");
  const [voiceSel, setVoiceSel] = useState(DEFAULT_OPT);
  const [customVoice, setCustomVoice] = useState("");
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "playing">("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve each picker to the value sent to the pipeline ("" = Settings default).
  const chosenModel =
    modelSel === DEFAULT_OPT ? "" : modelSel === CUSTOM_OPT ? customModel.trim() : modelSel;
  const chosenVoice =
    voiceSel === DEFAULT_OPT ? "" : voiceSel === CUSTOM_OPT ? customVoice.trim() : voiceSel;
  const previewVoiceId = (chosenVoice || defaultVoiceId).trim();

  const providerModels = provider === "openrouter" ? OPENROUTER_MODELS : GEMINI_MODELS;
  const modelOptions = [
    { value: DEFAULT_OPT, label: "Default", note: model || "Settings model" },
    ...providerModels.map((m) => ({ value: m.id, label: m.label, note: m.note })),
    { value: CUSTOM_OPT, label: "Custom…", note: "enter any model id" },
  ];
  const defaultVoiceLabel =
    ELEVENLABS_VOICES.find((v) => v.id === defaultVoiceId)?.label ?? "your Settings voice";
  const voiceOptions = [
    { value: DEFAULT_OPT, label: "Default", note: defaultVoiceLabel },
    ...ELEVENLABS_VOICES.map((v) => ({ value: v.id, label: v.label })),
    { value: CUSTOM_OPT, label: "Custom…", note: "enter a voice id" },
  ];

  function stopSample() {
    audioRef.current?.pause();
    audioRef.current = null;
    setSampleState("idle");
  }
  useEffect(() => stopSample, []);
  useEffect(() => {
    stopSample();
    setSampleError(null);
  }, [previewVoiceId]);

  async function playSample() {
    if (sampleState === "playing") return stopSample();
    setSampleError(null);
    setSampleState("loading");
    try {
      const res = await window.api.voices.sample(previewVoiceId);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = topic.trim();
    if (t.length < 3) {
      setError("Please enter a topic (at least a few words).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await window.api.visualizations.create({
        topic: t,
        quality,
        language,
        orientation,
        length,
        mode,
        theme,
        register,
        narrate: narrate && hasElevenLabs,
        captions,
        ...(chosenModel ? { model: chosenModel } : {}),
        ...(chosenVoice ? { voiceId: chosenVoice } : {}),
      });
      navigate(`/v/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const est = estimateVideoCost(provider, chosenModel || model, narrate && hasElevenLabs);

  return (
    <div className="mx-auto max-w-3xl px-6 pb-28 pt-10">
      <h1 className="text-[26px] font-semibold tracking-tight">New video</h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-white/55">
        {mode === "concept"
          ? "Name an abstract idea and Vizuals animates its mechanism step by step, in sync with the argument."
          : "Describe an algorithm or CS idea. The code stays on screen and each line lights up as the visual runs."}
      </p>

      {!canGenerate && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm">
          <AlertCircle size={17} className="shrink-0 text-amber-300" />
          <div className="flex-1 text-amber-100/85">
            {!hasKey
              ? `Add your ${providerLabel(provider)} API key to start generating.`
              : env && !env.python.ok
                ? "Python 3.10+ was not found."
                : env && !env.manim.ok
                  ? "Manim is not installed yet."
                  : "Finish setup to start generating."}
          </div>
          <Link to="/settings" className="btn8 btn8--ghost h-8 px-3 text-xs">
            Open Settings
          </Link>
        </div>
      )}

      <form id="new-video" onSubmit={onSubmit} className="mt-7 space-y-5">
        {/* ---- What ---- */}
        <section className="panel8 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-[15px] font-semibold">What should it explain?</h2>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={MODES.map((m) => ({ value: m.id, label: m.label }))}
            />
          </div>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            autoFocus
            placeholder={
              mode === "concept"
                ? "e.g. Primitive accumulation — enclosure of the commons, as told by Marx"
                : "e.g. How merge sort recursively splits and merges an array"
            }
            className="field8 w-full resize-none px-4 py-3 text-[14px] leading-relaxed placeholder:text-white/30"
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(mode === "concept" ? CONCEPT_EXAMPLES : EXAMPLES).map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setTopic(e)}
                className="rounded-full border border-edge bg-white/[0.02] px-3 py-1 text-xs text-white/60 transition hover:border-white/25 hover:text-white"
              >
                {e}
              </button>
            ))}
          </div>
          {mode === "concept" && (
            <div className="mt-5 border-t border-edge pt-4">
              <div className="label8">Symbolic language</div>
              <Tiles
                value={register}
                onChange={(v) => setRegister(v as ConceptRegister)}
                options={REGISTERS.map((r) => ({ value: r.id, label: r.label, hint: r.hint }))}
                cols={2}
              />
              {register === "glyphs" && (
                <p className="mt-2 text-xs leading-relaxed text-white/45">
                  The concept is parsed into a fixed lexicon — life, death, war, power, flow — and
                  each motif always gets the same glyph, so your whole library shares one symbolic
                  language.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ---- Look ---- */}
        <section className="panel8 space-y-5 p-5">
          <h2 className="text-[15px] font-semibold">Look &amp; length</h2>
          <div>
            <div className="label8">
              <Palette size={14} /> Theme
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VIDEO_THEMES.map((t) => {
                const sw = THEME_SWATCHES[t.id];
                const on = theme === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`overflow-hidden rounded-lg border text-left transition ${
                      on ? "border-accent ring-2 ring-accent/25" : "border-edge hover:border-white/25"
                    }`}
                  >
                    <div className="flex h-12 items-end gap-1 px-2.5 pb-2" style={{ background: sw.bg }}>
                      {sw.marks.map((c, i) => (
                        <span key={i} className="w-2 rounded-sm" style={{ background: c, height: `${12 + i * 7}px` }} />
                      ))}
                    </div>
                    <div className="px-2.5 py-2">
                      <div className="text-[13px] font-medium">{t.label}</div>
                      <div className="truncate text-[11px] text-white/45">{t.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="label8">
                <MonitorSmartphone size={14} /> Format
              </div>
              <Tiles
                value={orientation}
                onChange={(v) => pickOrientation(v as Orientation)}
                options={ORIENTATIONS.map((o) => ({ value: o.id, label: o.label, hint: o.hint }))}
                cols={2}
              />
            </div>
            <div>
              <div className="label8">
                <Gauge size={14} /> Quality
              </div>
              <Tiles
                value={quality}
                onChange={(v) => setQuality(v as RenderQuality)}
                options={QUALITIES.map((q) => ({ value: q.value, label: q.label, hint: q.hint }))}
                cols={3}
              />
            </div>
          </div>
          <div>
            <div className="label8">
              <Clock size={14} /> Length
            </div>
            <Tiles
              value={length}
              onChange={(v) => setLength(v as VideoLength)}
              options={VIDEO_LENGTHS.map((l) => ({ value: l.id, label: l.label, hint: l.hint }))}
              cols={3}
            />
            {orientation === "portrait" && length !== "short" && (
              <p className="mt-2 text-xs text-amber-300/80">
                Shorts play best at ~15–20s — the Short length keeps it punchy.
              </p>
            )}
          </div>
        </section>

        {/* ---- Audio ---- */}
        <section className="panel8 divide-y divide-edge">
          <ToggleRow
            icon={<MessageSquareText size={17} />}
            title="On-screen captions"
            hint="Show each spoken line as a subtitle, so the video reads even on mute."
            checked={captions}
            onChange={setCaptions}
          />
          <ToggleRow
            icon={<Volume2 size={17} />}
            title="AI narration"
            hint={
              hasElevenLabs
                ? "Generate an ElevenLabs voiceover, timed to each step."
                : "Add an ElevenLabs API key in Settings to enable."
            }
            checked={narrate && hasElevenLabs}
            onChange={setNarrate}
            disabled={!hasElevenLabs}
          />
          {narrate && hasElevenLabs && (
            <div className="px-5 py-4">
              <div className="label8">Voice</div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Dropdown
                    value={voiceSel}
                    options={voiceOptions}
                    onChange={(v) => {
                      setVoiceSel(v);
                      if (v !== CUSTOM_OPT) setCustomVoice("");
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={playSample}
                  disabled={!previewVoiceId || sampleState === "loading"}
                  title="Play a sample of this voice"
                  className="btn8 btn8--ghost h-10 w-10 shrink-0 px-0"
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
              {voiceSel === CUSTOM_OPT && (
                <input
                  type="text"
                  value={customVoice}
                  onChange={(e) => setCustomVoice(e.target.value)}
                  placeholder="ElevenLabs voice id"
                  className="field8 mt-2 w-full px-3.5 py-2.5 text-sm"
                />
              )}
              {sampleError && <p className="mt-1.5 text-xs text-red-300">{sampleError}</p>}
            </div>
          )}
        </section>

        {/* ---- Advanced ---- */}
        <details className="panel8 group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[14px] font-medium text-white/80 marker:hidden">
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-white/50" /> Advanced
              <span className="text-xs font-normal text-white/40">
                {chosenModel || "default model"}
                {mode !== "concept" ? ` · ${LANGUAGES.find((l) => l.id === language)?.label ?? language}` : ""}
              </span>
            </span>
            <ChevronDown size={16} className="text-white/40 transition group-open:rotate-180" />
          </summary>
          <div className={`grid gap-5 border-t border-edge px-5 py-4 ${mode !== "concept" ? "sm:grid-cols-2" : ""}`}>
            <div>
              <div className="label8">
                <Cpu size={14} /> Model <span className="font-normal text-white/40">· {providerLabel(provider)}</span>
              </div>
              <Dropdown
                value={modelSel}
                options={modelOptions}
                onChange={(v) => {
                  setModelSel(v);
                  if (v !== CUSTOM_OPT) setCustomModel("");
                }}
              />
              {modelSel === CUSTOM_OPT && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder={provider === "openrouter" ? "e.g. anthropic/claude-sonnet-4" : "e.g. gemini-2.5-pro"}
                  className="field8 mt-2 w-full px-3.5 py-2.5 text-sm"
                />
              )}
              <p className="mt-1.5 text-xs text-white/40">
                Just for this video. Stronger models write better specs; faster ones cost less.
              </p>
            </div>
            {mode !== "concept" && (
              <div>
                <div className="label8">
                  <Code2 size={14} /> Code language
                </div>
                <Dropdown
                  value={language}
                  options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
                  onChange={setLanguage}
                />
              </div>
            )}
          </div>
        </details>

        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
        )}
      </form>

      {/* ---- Sticky action bar ---- */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-edge bg-ink/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <div className="min-w-0 text-xs text-white/45">
            <span className="text-white/75">≈ {formatUsd(est.total)}</span> per video
            <span className="hidden sm:inline">
              {" "}· {formatUsd(est.model)} {providerLabel(provider)}
              {est.narration > 0 ? ` + ${formatUsd(est.narration)} voice` : ""} · rendering is local &amp; free
            </span>
          </div>
          <button
            type="submit"
            form="new-video"
            disabled={submitting || !canGenerate || topic.trim().length < 3}
            className="btn8 btn8--magenta h-10 px-5"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {submitting ? "Starting…" : "Generate video"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small preview colors for each video theme (mirrors walkthrough.py palettes). */
const THEME_SWATCHES: Record<VideoTheme, { bg: string; marks: string[] }> = {
  "8bit": { bg: "#12142b", marks: ["#00e5ff", "#ffd23f", "#ff5d8f", "#39d98a"] },
  manuscript: { bg: "#000000", marks: ["#9db4d4", "#d4af37", "#c96a6a", "#7fb069"] },
  ink: { bg: "#0f1216", marks: ["#82aaff", "#5b7cfa", "#f0709a", "#34d399"] },
  slate: { bg: "#12161c", marks: ["#7cc4ff", "#22c58b", "#f0709a", "#f4b740"] },
};

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-edge bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-[13px] font-medium transition ${
            value === o.value ? "bg-white/10 text-white shadow-sm" : "text-white/50 hover:text-white/80"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tiles({
  value,
  onChange,
  options,
  cols,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  cols: 2 | 3;
}) {
  return (
    <div className={`grid gap-2 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.hint}
            className={`min-w-0 rounded-lg border px-3 py-2 text-left transition ${
              on ? "border-accent bg-accent/[0.08] ring-2 ring-accent/20" : "border-edge bg-white/[0.02] hover:border-white/25"
            }`}
          >
            <div className={`text-[13px] font-medium ${on ? "text-white" : "text-white/85"}`}>{o.label}</div>
            {o.hint && <div className="truncate text-[11px] text-white/45">{o.hint}</div>}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${checked ? "text-accent" : "text-white/40"}`}>{icon}</span>
        <div>
          <div className="text-[14px] font-medium">{title}</div>
          <div className="text-xs text-white/45">{hint}</div>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
