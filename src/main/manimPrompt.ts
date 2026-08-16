import type { RenderQuality } from "@shared/types";

export interface GeneratedScene {
  title: string;
  description: string;
  sceneName: string;
  code: string;
}

/** Instructions given to Gemini so the output is one render-safe Manim scene. */
export const SYSTEM_INSTRUCTION = `You are an expert Manim (Community Edition, v0.18+) developer who creates clear,
beautiful, 3Blue1Brown-style animations that explain computer-science algorithms
and data structures.

You will be given a topic. Produce ONE self-contained Manim scene that visually
explains it. Follow these rules strictly:

CODE RULES
- Import only from manim: "from manim import *". You may also "import numpy as np".
- Define exactly ONE class that subclasses Scene. Its construct() method drives
  the whole animation.
- The animation must be self-contained and deterministic. Do NOT read files,
  access the network, use os/sys/subprocess/open/eval/exec, or load external
  assets, images, fonts, SVGs, or audio.
- Keep the total animation between roughly 20 and 60 seconds of runtime. Use
  self.wait() pauses so viewers can follow along.
- Prefer Text(), MarkupText(), and geometric mobjects (Square, Circle, Arrow,
  Line, VGroup, etc.). Use MathTex()/Tex() only when a formula genuinely helps.
- Show the algorithm actually working step by step on a concrete small example
  (e.g. sort/search a small array, traverse a small graph). Highlight comparisons,
  swaps, pointers, or visited nodes with color changes and transforms.
- Lay elements out so nothing overlaps or runs off-screen. Use .arrange(),
  .next_to(), .to_edge(), and reasonable font sizes.
- The code must run with no arguments via: manim render -q<quality> scene.py <ClassName>
- Do NOT include explanatory prose, markdown, or comments outside the code field.

OUTPUT
Return JSON matching the provided schema: a short human title, a one-to-two
sentence description of what the video shows, the exact scene class name, and the
complete Python code as a single string.`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title, max ~60 chars." },
    description: {
      type: "string",
      description: "1-2 sentence summary of what the animation shows.",
    },
    sceneName: {
      type: "string",
      description: "Exact name of the Scene subclass defined in the code.",
    },
    code: { type: "string", description: "Complete, runnable Manim Python source." },
  },
  required: ["title", "description", "sceneName", "code"],
} as const;

export function buildUserPrompt(topic: string): string {
  return `Topic: ${topic}\n\nCreate the Manim scene now.`;
}

export const QUALITY_FLAG: Record<RenderQuality, string> = {
  l: "-ql",
  m: "-qm",
  h: "-qh",
};

/**
 * Generated Python is arbitrary code executed by `manim`. We statically scan it
 * before rendering. This is a guardrail; the strongest protection is that this
 * runs on the user's own machine under their own account, and only ever touches
 * a temp dir.
 */
const DENYLIST: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bimport\s+os\b/, reason: "os module" },
  { pattern: /\bimport\s+sys\b/, reason: "sys module" },
  { pattern: /\bimport\s+subprocess\b/, reason: "subprocess module" },
  { pattern: /\bimport\s+socket\b/, reason: "socket module" },
  { pattern: /\bimport\s+shutil\b/, reason: "shutil module" },
  { pattern: /\bimport\s+requests\b/, reason: "requests module" },
  { pattern: /\bimport\s+urllib\b/, reason: "urllib module" },
  { pattern: /\bimport\s+pathlib\b/, reason: "pathlib module" },
  { pattern: /\bfrom\s+os\b/, reason: "os import" },
  { pattern: /\bfrom\s+subprocess\b/, reason: "subprocess import" },
  { pattern: /\b__import__\s*\(/, reason: "__import__" },
  { pattern: /\beval\s*\(/, reason: "eval()" },
  { pattern: /\bexec\s*\(/, reason: "exec()" },
  { pattern: /\bopen\s*\(/, reason: "open()" },
  { pattern: /\bcompile\s*\(/, reason: "compile()" },
  { pattern: /\bglobals\s*\(/, reason: "globals()" },
];

export interface Validated {
  ok: boolean;
  reason?: string;
}

export function validateManimCode(scene: GeneratedScene): Validated {
  const { code, sceneName } = scene;

  if (!code || code.trim().length < 40) {
    return { ok: false, reason: "Generated code was empty or too short." };
  }
  if (!/from\s+manim\s+import|import\s+manim/.test(code)) {
    return { ok: false, reason: "Generated code does not import manim." };
  }
  if (!sceneName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sceneName)) {
    return { ok: false, reason: "Invalid scene class name." };
  }
  if (!new RegExp(`class\\s+${sceneName}\\s*\\(`).test(code)) {
    return { ok: false, reason: `Code does not define class ${sceneName}.` };
  }
  for (const { pattern, reason } of DENYLIST) {
    if (pattern.test(code)) {
      return { ok: false, reason: `Disallowed construct in generated code: ${reason}.` };
    }
  }
  return { ok: true };
}
