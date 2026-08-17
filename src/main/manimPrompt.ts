import type { RenderQuality } from "@shared/types";

export interface GeneratedScene {
  title: string;
  description: string;
  sceneName: string;
  code: string;
  /** Optional voiceover script (~60-110 words). */
  narration?: string;
}

/** Instructions given to Gemini so the output is one render-safe Manim scene. */
export const SYSTEM_INSTRUCTION = `You are an expert Manim (Community Edition, v0.18+) developer who creates clear,
beautiful, 3Blue1Brown-style animations that explain computer-science algorithms
and data structures.

You will be given a topic. Produce ONE self-contained Manim scene that visually
explains it, in a CODE-FOLLOWS-LINE style. Follow these rules strictly.

THE CORE FORMAT — CODE ON SCREEN, HIGHLIGHTED LINE BY LINE (required)
- The video MUST show the algorithm's source code on screen the whole time,
  and MUST highlight the exact line that is "executing" at each step, in sync
  with the visual on the data.
- Split the frame into two panels: the CODE panel (left, ~45% width) and the
  VISUAL panel (right, the array/graph/tree/etc.).
- Write the algorithm as SHORT pseudocode or Python — 6 to 14 lines maximum —
  so it fits without overflowing. Keep each line short.
- Render the code as a VGroup of one Text per line, LEFT-aligned, monospaced
  look via a small font_size (about 22), arranged downward with small buff.
  Store the lines in a list so you can index them, e.g. lines[3].
  (You MAY use Manim's Code mobject instead, but only if it clearly fits the
  panel; the per-line VGroup approach is more reliable — prefer it.)
- Create ONE highlight indicator — a Rectangle or SurroundingRectangle behind
  the current line (a soft fill like YELLOW at ~0.25 opacity, or a colored
  arrow in the left margin). Define a helper that moves the highlight to a
  given line index.
- DRIVE THE ANIMATION BY LINE: for each step of the algorithm, in the SAME
  self.play(...) call (or back-to-back), (a) move the highlight to the line
  that runs, and (b) animate the matching change on the data (a comparison,
  swap, pointer move, visited node, etc.). The highlighted line and the visual
  change must always correspond. Add a brief self.wait() so viewers can read.
- Walk through a CONCRETE small example (e.g. search/sort a 5-8 element array,
  traverse a small graph). Actually step through the loop iterations — do not
  just show start and end.

GENERAL CODE RULES
- Import only from manim: "from manim import *". You may also "import numpy as np".
- Define exactly ONE class that subclasses Scene. Its construct() method drives
  the whole animation.
- Self-contained and deterministic. Do NOT read files, access the network, use
  os/sys/subprocess/open/eval/exec, or load external assets, images, fonts,
  SVGs, or audio.
- Total runtime roughly 25 to 70 seconds. Use self.wait() pauses.
- Prefer Text(), MarkupText(), and geometric mobjects (Square, Circle, Arrow,
  Line, VGroup, etc.). Use MathTex()/Tex() only when a formula genuinely helps.
- Lay elements out so nothing overlaps or runs off-screen. Use .arrange(),
  .next_to(), .to_edge(), reasonable font sizes, and keep within the 14.2 x 8
  frame. Give the code panel and visual panel clearly separated regions.
- The code must run with no arguments via: manim render -q<quality> scene.py <ClassName>
- Do NOT include explanatory prose, markdown, or comments outside the code field.

CORRECTNESS (the code MUST run without errors)
- The Python must be complete and executable as-is. Define EVERY variable
  before you use it; do not reference names you never assigned. Double-check
  every identifier is spelled consistently.
- Keep the logic simple and favor short, obviously-correct helpers over clever
  index arithmetic. It is better to hard-code the steps of a small example than
  to write fragile generic bookkeeping. Fewer moving parts = fewer bugs.
- Only index a VGroup/list within its bounds. Only call methods that exist in
  Manim CE v0.18. Mentally run the construct() method start to finish and make
  sure it cannot raise.

NARRATION
- Also write a short "narration" script: 60 to 110 words of plain spoken English
  that explains what the viewer is seeing, in order. No stage directions, no
  markdown, no code — just sentences a narrator would read aloud. It will be
  turned into a voiceover, so keep it natural and paced to ~30-60 seconds.

OUTPUT
Return JSON matching the provided schema: a short human title, a one-to-two
sentence description of what the video shows (mention it walks through the code
line by line), the exact scene class name, the complete Python code as a single
string, and the narration script.`;

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
    narration: {
      type: "string",
      description: "60-110 word spoken voiceover script (plain sentences).",
    },
  },
  required: ["title", "description", "sceneName", "code", "narration"],
} as const;

export function buildUserPrompt(topic: string): string {
  return `Topic: ${topic}\n\nCreate the Manim scene now.`;
}

/**
 * Prompt to repair a scene that failed to render. We hand back the exact code
 * and the Python traceback and ask for a corrected, complete scene.
 */
export function buildRepairPrompt(
  topic: string,
  code: string,
  errorText: string,
): string {
  return [
    `The following Manim scene for the topic "${topic}" failed to render.`,
    "Fix the bug so it renders cleanly, keeping the same code-follows-line",
    "style and the same scene class name. Return the COMPLETE corrected program",
    "and an updated narration — not a diff.",
    "",
    "=== Error / traceback ===",
    errorText.slice(-2000),
    "",
    "=== Current code ===",
    code,
  ].join("\n");
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
