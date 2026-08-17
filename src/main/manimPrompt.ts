import type { SchemaType } from "@google/generative-ai";

/** A single animation step (internal form used by the renderer). */
export interface SpecStep {
  line: number; // 1-based index into code
  highlight?: number[]; // array indices to emphasize
  pointers?: Record<string, number>; // named pointers -> index
  array?: number[]; // new full array state (for swaps/sorts)
  found?: number | null; // index to mark done/green
  caption: string;
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
left, a small array visualization on the right, and an ordered list of steps
that each highlight ONE code line and update the array state in sync.

Rules:
- Choose ONE concrete, SHORT example (an array of 5–8 integers). Keep it small so
  the whole run is quick.
- Write the algorithm as 6–14 SHORT lines of real, correct code in the requested
  language. This is what appears on screen and gets highlighted line by line.
- Produce an ordered list of steps that walk the example to completion (actually
  loop through the iterations — don't skip to the end). Each step has:
    • line: the 1-based line number in "code" that is executing at this step.
    • caption: a short human sentence describing what happens (e.g. "mid = 3",
      "a[3] < target, search right", "swap 5 and 3").
    • highlight: array indices being compared / looked at right now (optional).
    • pointers: named markers under cells, as a list of {name, index} — e.g.
      lo/hi/mid, i/j, left/right. Only include the pointers that exist at this
      step; pointers persist and move across steps.
    • setArray: the FULL new array contents, ONLY when the array actually changed
      this step (a swap or write). Omit when unchanged.
    • found: an array index to mark as done/success (optional).
- Keep steps between ~6 and ~30. Every 'line' must be a valid line number.
- Also write a 60–110 word spoken "narration" that explains the walk in order.
- Make the steps and code perfectly consistent: the highlighted line must match
  what the caption and array change describe.

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
          caption: { type: "string" },
          highlight: { type: "array", items: { type: "integer" } },
          pointers: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, index: { type: "integer" } },
              required: ["name", "index"],
            },
          },
          setArray: { type: "array", items: { type: "integer" } },
          found: { type: "integer" },
        },
        required: ["line", "caption"],
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

/** Convert the raw Gemini object (pointers as list, setArray) into our form. */
export function normalizeSpec(raw: Record<string, unknown>, topic: string): GeneratedSpec {
  const codeIn = Array.isArray(raw.code) ? (raw.code as unknown[]) : [];
  const code = codeIn.map((l) => String(l)).slice(0, 14);
  const arrayIn = Array.isArray(raw.array) ? (raw.array as unknown[]) : [];
  const array = arrayIn.map((n) => Number(n)).filter((n) => Number.isFinite(n)).slice(0, 9);

  const stepsIn = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
  const steps: SpecStep[] = stepsIn.slice(0, 40).map((s) => {
    const pointers: Record<string, number> = {};
    if (Array.isArray(s.pointers)) {
      for (const p of s.pointers as Record<string, unknown>[]) {
        if (p && typeof p.name === "string" && Number.isFinite(Number(p.index))) {
          pointers[p.name] = Number(p.index);
        }
      }
    }
    const setArray = Array.isArray(s.setArray)
      ? (s.setArray as unknown[]).map((n) => Number(n))
      : undefined;
    return {
      line: Math.max(1, Number(s.line) || 1),
      caption: typeof s.caption === "string" ? s.caption : "",
      highlight: Array.isArray(s.highlight)
        ? (s.highlight as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : [],
      pointers,
      array: setArray,
      found: Number.isFinite(Number(s.found)) ? Number(s.found) : null,
    };
  });

  return {
    title: (typeof raw.title === "string" && raw.title ? raw.title : topic).slice(0, 120),
    description: typeof raw.description === "string" ? raw.description.slice(0, 600) : "",
    narration: typeof raw.narration === "string" ? raw.narration.slice(0, 1200) : "",
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

export function validateSpec(spec: GeneratedSpec): Validated {
  if (spec.code.length < 3) return { ok: false, reason: "Too few code lines." };
  if (spec.array.length < 2) return { ok: false, reason: "Array example is missing or too small." };
  if (spec.steps.length < 2) return { ok: false, reason: "Too few steps." };
  for (const s of spec.steps) {
    if (s.line < 1 || s.line > spec.code.length) {
      return { ok: false, reason: `Step references line ${s.line}, out of range.` };
    }
  }
  return { ok: true };
}
