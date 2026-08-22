import type { SchemaType } from "@google/generative-ai";

/** A single animation step (internal form used by the renderer). */
export interface SpecStep {
  line: number; // 1-based index into code
  say: string; // spoken line for this step (also the caption); drives its timing
  dur?: number; // exact seconds for this step (filled by the audio pass)
  range?: [number, number]; // half-open [lo, hi) sub-array in play
  compare?: number[]; // indices being compared right now
  swap?: [number, number]; // two indices that trade places (animated)
  set?: [number, number][]; // [index, value] writes (merge-style overwrites)
  pointers?: Record<string, number>; // named pointers -> index
  sorted?: number[]; // indices finalized this step (cumulative, marked green)
  // legacy fields (older specs / re-renders still work):
  highlight?: number[];
  array?: number[];
  found?: number | null;
  caption?: string;
}

/** The structured content Gemini produces (the AI writes DATA, not code). */
export interface GeneratedSpec {
  title: string;
  description: string;
  narration: string;
  code: string[];
  array: number[];
  target?: number | null;
  steps: SpecStep[];
}

export const SYSTEM_INSTRUCTION = `You explain computer-science algorithms as short, precise, step-by-step
animations. You DO NOT write animation code. Instead you output structured DATA
that a fixed renderer turns into a video: the algorithm's source code on the
left, the array drawn as BARS on the right (bar height = value), and an ordered
list of steps. Each step highlights ONE code line, updates the bars, AND carries
the exact sentence the narrator speaks — so code, visuals and voice stay locked
together.

CODE RULES
- Choose ONE concrete example. For array algorithms use an array of 8–9 integers
  so the behaviour is clearly visible (not so few it looks trivial).
- Write COMPLETE, correct, runnable code (6–20 short lines) in the requested
  language. NEVER stub or hide logic behind a placeholder or an unshown helper
  (e.g. do NOT write "_merge(...)  # merge logic is complex"): if the algorithm
  needs a merge / partition / heapify step, WRITE ITS FULL BODY so a viewer can
  see how it actually works. Prefer one self-contained function.

STEP RULES — every step is an object with:
  • line     : the 1-based line number in "code" executing at this step.
  • say      : ONE spoken sentence describing exactly what happens this step
               ("Compare 5 and 2 — 5 is bigger, so swap them."). This is read
               aloud AND shown; write it to match the visual precisely.
  • range    : [lo, hi] (half-open) — the sub-array currently being worked on.
               Use it for divide-and-conquer (merge/quick sort) to show scope.
  • compare  : indices being compared/examined right now (they light up).
  • swap     : [i, j] — two elements trade places (animated). Use for in-place
               swaps (bubble/selection/quick sort).
  • set      : [[index, value], ...] — write value into a position. Use for
               merges and any assignment a[k] = ... (bars morph to the value).
  • pointers : {name: index} — named markers under the bars. Use the SAME names
               as your code variables (i, j, k, lo, mid, hi, pivot). Repeat the
               relevant ones each step so they visibly move.
  • sorted   : indices now in their FINAL position (they turn green, cumulative).

ALIGNMENT — the three tracks MUST agree on every step:
  the highlighted 'line' is the code doing this step; 'say' narrates that exact
  action; and the bars change to match (compare / swap / set / pointers move).
  Never emit a step that only changes 'line' + 'say' with no visual change.

- Walk the example to completion (actually loop the iterations; don't skip). Aim
  for 12–34 steps. Keep each 'say' to one sentence.
- Also provide an overall "narration": the 'say' lines joined into a short
  paragraph (used as a fallback).

Return ONLY the JSON described by the schema.`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    narration: { type: "string" },
    code: { type: "array", items: { type: "string" } },
    array: { type: "array", items: { type: "integer" } },
    target: { type: "integer" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          say: { type: "string" },
          range: { type: "array", items: { type: "integer" } },
          compare: { type: "array", items: { type: "integer" } },
          swap: { type: "array", items: { type: "integer" } },
          set: {
            type: "array",
            items: { type: "array", items: { type: "integer" } },
          },
          pointers: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, index: { type: "integer" } },
              required: ["name", "index"],
            },
          },
          sorted: { type: "array", items: { type: "integer" } },
        },
        required: ["line", "say"],
      },
    },
  },
  required: ["title", "description", "narration", "code", "array", "steps"],
} as const;

export const SCHEMA_CAST = RESPONSE_SCHEMA as unknown as { type: SchemaType };

export function buildUserPrompt(topic: string, language: string): string {
  return `Topic: ${topic}\nLanguage for the on-screen code: ${language}\n\nProduce the walkthrough JSON now.`;
}

export function buildRepairPrompt(topic: string, language: string, error: string): string {
  return [
    `The previous walkthrough JSON for "${topic}" (language ${language}) was invalid:`,
    error,
    "",
    "Return a corrected, complete walkthrough JSON that fixes this.",
  ].join("\n");
}

function numArray(v: unknown): number[] {
  return Array.isArray(v)
    ? (v as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];
}

/** Convert the raw Gemini object into our internal form. */
export function normalizeSpec(raw: Record<string, unknown>, topic: string): GeneratedSpec {
  const codeIn = Array.isArray(raw.code) ? (raw.code as unknown[]) : [];
  // Allow enough lines for a complete algorithm (e.g. merge sort's full merge
  // routine) so the AI never has to stub logic out to fit — the code panel
  // scales to fit whatever it emits.
  const code = codeIn.map((l) => String(l)).slice(0, 22);
  const array = numArray(raw.array).slice(0, 9);

  const stepsIn = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
  const steps: SpecStep[] = stepsIn.slice(0, 60).map((s) => {
    const pointers: Record<string, number> = {};
    if (Array.isArray(s.pointers)) {
      for (const p of s.pointers as Record<string, unknown>[]) {
        if (p && typeof p.name === "string" && Number.isFinite(Number(p.index))) {
          pointers[p.name] = Number(p.index);
        }
      }
    } else if (s.pointers && typeof s.pointers === "object") {
      for (const [k, v] of Object.entries(s.pointers as Record<string, unknown>)) {
        if (Number.isFinite(Number(v))) pointers[k] = Number(v);
      }
    }

    const compare = numArray(s.compare).length ? numArray(s.compare) : numArray(s.highlight);
    const swapArr = numArray(s.swap);
    const swap: [number, number] | undefined =
      swapArr.length === 2 ? [swapArr[0], swapArr[1]] : undefined;
    const rngArr = numArray(s.range);
    const range: [number, number] | undefined =
      rngArr.length === 2 ? [rngArr[0], rngArr[1]] : undefined;

    // set: accept [[i,v],...] or fall back to a legacy full `setArray`.
    let set: [number, number][] | undefined;
    if (Array.isArray(s.set)) {
      set = (s.set as unknown[])
        .map((pair) => numArray(pair))
        .filter((p) => p.length === 2)
        .map((p) => [p[0], p[1]] as [number, number]);
      if (set.length === 0) set = undefined;
    }
    const legacyArray = Array.isArray(s.setArray) ? numArray(s.setArray) : undefined;

    const say =
      (typeof s.say === "string" && s.say) ||
      (typeof s.caption === "string" && s.caption) ||
      "";

    return {
      // Clamp into the valid code range: an AI that references a line past the
      // end (or that got truncated) shouldn't fail the whole render.
      line: Math.min(Math.max(1, Number(s.line) || 1), Math.max(1, code.length)),
      say,
      range,
      compare,
      swap,
      set,
      pointers,
      sorted: numArray(s.sorted),
      array: legacyArray,
      found: Number.isFinite(Number(s.found)) ? Number(s.found) : null,
    };
  });

  const narration =
    (typeof raw.narration === "string" && raw.narration.trim()) ||
    steps.map((s) => s.say).filter(Boolean).join(" ");

  return {
    title: (typeof raw.title === "string" && raw.title ? raw.title : topic).slice(0, 120),
    description: typeof raw.description === "string" ? raw.description.slice(0, 600) : "",
    narration: narration.slice(0, 2000),
    code,
    array,
    target: Number.isFinite(Number(raw.target)) ? Number(raw.target) : null,
    steps,
  };
}

export interface Validated {
  ok: boolean;
  reason?: string;
}

/** True if a step produces any visible change on the bars. */
function stepMoves(s: SpecStep): boolean {
  return !!(
    (s.compare && s.compare.length) ||
    (s.swap && s.swap.length === 2) ||
    (s.set && s.set.length) ||
    (s.pointers && Object.keys(s.pointers).length) ||
    (s.sorted && s.sorted.length) ||
    (s.range && s.range.length === 2) ||
    (s.highlight && s.highlight.length) ||
    (s.array && s.array.length) ||
    s.found != null
  );
}

/**
 * Structural validation — a HARD gate. If this fails the spec cannot render.
 */
export function validateSpec(spec: GeneratedSpec): Validated {
  if (spec.code.length < 3) return { ok: false, reason: "Too few code lines." };
  if (spec.array.length < 2) return { ok: false, reason: "Array example is missing or too small." };
  if (spec.steps.length < 2) return { ok: false, reason: "Too few steps." };
  // Line numbers are clamped in normalizeSpec, so they're always in range here.
  return { ok: true };
}

/**
 * Quality check — a SOFT gate. A structurally valid spec whose visualization
 * rarely moves renders fine, just less usefully. The pipeline uses this to TRY
 * a repair, but still renders the original if the repair doesn't land.
 */
export function vizChangesEnough(spec: GeneratedSpec): Validated {
  const changing = spec.steps.filter(stepMoves).length;
  if (changing < Math.ceil(spec.steps.length * 0.6)) {
    return {
      ok: false,
      reason:
        "Most steps don't update the visualization. Every step should compare, swap, set, move a pointer, or mark a range/sorted element.",
    };
  }
  const withSay = spec.steps.filter((s) => s.say && s.say.trim().length > 0).length;
  if (withSay < Math.ceil(spec.steps.length * 0.8)) {
    return {
      ok: false,
      reason: "Most steps are missing a spoken 'say' line; every step needs one so the narration matches the visuals.",
    };
  }
  return { ok: true };
}
