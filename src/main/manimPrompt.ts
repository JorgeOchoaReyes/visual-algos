import type { SchemaType } from "@google/generative-ai";

export type VizKind = "array" | "graph" | "tree" | "grid" | "linkedlist" | "none";

/** How the left panel is presented (independent of the visualization). */
export type PanelMode = "code" | "concept" | "visual";

export interface GraphNode {
  id: string;
  x: number;
  y: number;
}

/** A single animation step (internal form the renderer consumes). */
export interface SpecStep {
  line: number; // 1-based index into code
  say: string; // spoken line for this step (also the caption); drives its timing
  dur?: number; // exact seconds for this step (filled by the audio pass)
  // array / linkedlist:
  compare?: number[];
  swap?: [number, number];
  set?: [number, number][];
  range?: [number, number];
  sorted?: number[];
  pointers?: Record<string, number>;
  found?: number | null;
  // graph / tree:
  active?: string[];
  visit?: string[];
  edge?: [string, string][];
  label?: Record<string, string>;
  queue?: string[];
  // grid:
  gcompare?: [number, number][];
  gset?: [number, number, number][];
  gdone?: [number, number][];
  gpath?: [number, number][];
  // legacy:
  highlight?: number[];
  array?: number[];
  caption?: string;
}

/** The structured content Gemini produces (the AI writes DATA, not code). */
export interface GeneratedSpec {
  title: string;
  description: string;
  narration: string;
  mode: PanelMode;
  viz: VizKind;
  code: string[]; // source lines (mode "code") or bullet points (mode "concept")
  array: number[]; // array / linkedlist
  target?: number | null;
  nodes?: GraphNode[]; // graph / tree
  edges?: (string | number)[][]; // graph / tree: [from, to] or [from, to, weight]
  grid?: number[][]; // grid
  steps: SpecStep[];
}

export const SYSTEM_INSTRUCTION = `You explain ANY topic as a short, precise, step-by-step animation. You DO NOT
write animation code — you output structured DATA that a fixed renderer turns
into a video: a left panel, a visualization, and an ordered list of steps. Each
step highlights ONE panel line, updates the visualization, AND carries the exact
sentence the narrator speaks — so panel, visuals and voice stay locked together.

FIRST decide the presentation "mode" from the topic:
  "code"    – programming / algorithms. The panel is real SOURCE CODE, and
              usually pair it with a data-structure viz (array/graph/grid/…).
  "concept" – math, science, history, philosophy, or any idea best explained in
              words. The panel is 5–12 short BULLET POINTS (NOT code). Pair with
              a viz when a picture helps (a concept-map "graph", a comparison
              "grid"), or "none" for a points-only explainer.
  "visual"  – the picture carries everything and no panel is needed; the viz
              fills the frame (leave "code" empty).

Then set "viz" to the visualization (or "none"):
  "array"      – sorting, searching, two-pointer, sliding window (drawn as bars)
  "graph"      – BFS, DFS, Dijkstra, topological sort (nodes + edges)
  "tree"       – BST, heap, tree traversals (nodes + edges with positions)
  "grid"       – dynamic programming tables, matrices, grid pathfinding
  "linkedlist" – linked-list traversal / search / build
  "none"       – no right-side visualization (points-only concept explainers)

Examples: "quicksort" → mode code, viz array. "Dijkstra" → mode code, viz graph.
"the trolley problem" → mode concept, viz none (or a graph concept-map).
"branches of philosophy" → mode concept, viz graph. "how a binary search tree
works" → mode code, viz tree. "compare TCP vs UDP" → mode concept, viz grid.

CRITICAL (mode code): match the visualization to the DATA STRUCTURE the algorithm
operates on. If it works on a graph or tree — nodes, neighbors, adjacency, edges,
traversal, shortest path, BFS/DFS, Dijkstra, topological order, a tree/heap — you
MUST use viz "graph"/"tree" with real "nodes" and "edges". NEVER encode a graph
as an array/adjacency-matrix of bars. Same for grids and linked lists.

PANEL RULES
- mode "code": the "code" array is COMPLETE, correct, runnable code (6–20 short
  lines). NEVER stub or hide logic behind a placeholder or an unshown helper (no
  "_merge(...) # complex"): write the full body so a viewer sees how it works.
- mode "concept": the "code" array is 5–12 SHORT bullet points in plain language
  (a phrase each, not code). Each step highlights one point as the narrator
  reaches it.
- mode "visual": leave "code" empty; the viz carries the explanation.
- Every step: "line" (1-based index into the panel; omit/1 for visual mode) +
  "say" (ONE spoken sentence for this step). The tracks MUST agree: the
  highlighted line, the spoken "say", and the visualization change all match.
- Aim for 8–34 steps. Also give an overall "narration" (the say lines joined).

DATA SIZE — use ENOUGH data for a meaningful visualization (this matters a lot):
  arrays: 8–12 elements (never fewer than 8); linked lists: 6–9 nodes; graphs:
  6–9 nodes with several edges; grids: at least 4×4 (or 3×4). Tiny examples
  (3–4 items) look trivial and are NOT acceptable — always fill the structure.

DATA + STEP FIELDS BY viz:
- array / linkedlist: provide "array" of 8–12 integers (8+ minimum). Step fields:
    compare:[i,j] (examined), swap:[i,j] (in-place swap, animated),
    set:[[i,v]] (write a value), range:[lo,hi] (sub-array, for divide&conquer),
    pointers:[{name,index}] (use your code's variable names i/j/lo/mid/hi/k/cur),
    sorted:[i] (finalized, turns green), found:i (linkedlist match).
- graph / tree: provide "nodes":[{id,x,y}] (6–9 nodes) with a clean 2-D layout
  (trees: root on top, children below; graphs: spread out, few crossings) and
  "edges" as
  [[from,to]] (add a weight: [from,to,w] for weighted graphs). Step fields:
    active:[ids] (current node(s)), visit:[ids] (mark visited/green, cumulative),
    edge:[[u,v]] (edges traversed this step), label:[{id,text}] (put text on a
    node, e.g. a Dijkstra distance), queue:[ids] (current queue/stack contents).
- grid: provide "grid" as a 2-D array of integers (use 0 for empty). Step fields:
    gcompare:[[r,c]] (cells read), gset:[[r,c,v]] (cell written),
    gdone:[[r,c]] (finalized/green, cumulative), gpath:[[r,c]] (final path).

Return ONLY the JSON described by the schema. Fill only the fields relevant to
the chosen viz.`;

const rc = { type: "array", items: { type: "integer" } };

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    narration: { type: "string" },
    mode: { type: "string" },
    viz: { type: "string" },
    code: { type: "array", items: { type: "string" } },
    array: { type: "array", items: { type: "integer" } },
    target: { type: "integer" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
        required: ["id", "x", "y"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, weight: { type: "integer" } },
        required: ["from", "to"],
      },
    },
    grid: { type: "array", items: { type: "array", items: { type: "integer" } } },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          say: { type: "string" },
          compare: rc,
          swap: rc,
          set: { type: "array", items: rc },
          range: rc,
          sorted: rc,
          pointers: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, index: { type: "integer" } },
              required: ["name", "index"],
            },
          },
          found: { type: "integer" },
          active: { type: "array", items: { type: "string" } },
          visit: { type: "array", items: { type: "string" } },
          edge: {
            type: "array",
            items: {
              type: "object",
              properties: { from: { type: "string" }, to: { type: "string" } },
              required: ["from", "to"],
            },
          },
          label: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, text: { type: "string" } },
              required: ["id", "text"],
            },
          },
          queue: { type: "array", items: { type: "string" } },
          gcompare: { type: "array", items: rc },
          gset: { type: "array", items: rc },
          gdone: { type: "array", items: rc },
          gpath: { type: "array", items: rc },
        },
        required: ["line", "say"],
      },
    },
  },
  required: ["title", "description", "narration", "mode", "viz", "steps"],
} as const;

export const SCHEMA_CAST = RESPONSE_SCHEMA as unknown as { type: SchemaType };

/**
 * Providers without a native response-schema parameter (OpenRouter's OpenAI-
 * compatible endpoint) get the same schema as prompt text instead.
 */
/**
 * A full walkthrough spec (complete code + many richly-detailed steps) is
 * large; without a high ceiling the JSON gets truncated mid-object and fails to
 * parse. Both providers give it the same room.
 */
export const MAX_OUTPUT_TOKENS = 16384;

/** Pull a JSON object out of a model response, tolerating fences / stray prose. */
export function extractJson(text: string): string {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

export const SCHEMA_HINT = `The JSON you return MUST match this JSON Schema exactly:
${JSON.stringify(RESPONSE_SCHEMA, null, 2)}

Return the JSON object on its own — no prose, no markdown fences.`;

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
function pairArray(v: unknown): [number, number][] {
  return Array.isArray(v)
    ? (v as unknown[]).map((p) => numArray(p)).filter((p) => p.length >= 2).map((p) => [p[0], p[1]] as [number, number])
    : [];
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map((s) => String(s)) : [];
}

const VIZ_KINDS: VizKind[] = ["array", "graph", "tree", "grid", "linkedlist", "none"];
const MODES: PanelMode[] = ["code", "concept", "visual"];

/** Convert the raw Gemini object into our internal (renderer-ready) form. */
export function normalizeSpec(raw: Record<string, unknown>, topic: string): GeneratedSpec {
  const mode: PanelMode = MODES.includes(raw.mode as PanelMode) ? (raw.mode as PanelMode) : "code";
  const viz: VizKind = VIZ_KINDS.includes(raw.viz as VizKind) ? (raw.viz as VizKind) : "array";
  const code = (Array.isArray(raw.code) ? (raw.code as unknown[]) : []).map((l) => String(l)).slice(0, 22);
  const array = numArray(raw.array).slice(0, 12);

  const nodes: GraphNode[] = Array.isArray(raw.nodes)
    ? (raw.nodes as Record<string, unknown>[])
        .filter((n) => n && n.id != null)
        .map((n) => ({ id: String(n.id), x: Number(n.x) || 0, y: Number(n.y) || 0 }))
    : [];
  const edges: (string | number)[][] = Array.isArray(raw.edges)
    ? (raw.edges as Record<string, unknown>[])
        .filter((e) => e && e.from != null && e.to != null)
        .map((e) =>
          e.weight != null && Number.isFinite(Number(e.weight))
            ? [String(e.from), String(e.to), Number(e.weight)]
            : [String(e.from), String(e.to)],
        )
    : [];
  const grid: number[][] = Array.isArray(raw.grid)
    ? (raw.grid as unknown[]).map((row) => numArray(row)).filter((r) => r.length > 0)
    : [];

  const stepsIn = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
  const steps: SpecStep[] = stepsIn.slice(0, 60).map((s) => {
    const pointers: Record<string, number> = {};
    if (Array.isArray(s.pointers)) {
      for (const p of s.pointers as Record<string, unknown>[]) {
        if (p && typeof p.name === "string" && Number.isFinite(Number(p.index))) pointers[p.name] = Number(p.index);
      }
    } else if (s.pointers && typeof s.pointers === "object") {
      for (const [k, v] of Object.entries(s.pointers as Record<string, unknown>)) {
        if (Number.isFinite(Number(v))) pointers[k] = Number(v);
      }
    }

    const compare = numArray(s.compare).length ? numArray(s.compare) : numArray(s.highlight);
    const sw = numArray(s.swap);
    const swap: [number, number] | undefined = sw.length === 2 ? [sw[0], sw[1]] : undefined;
    const rg = numArray(s.range);
    const range: [number, number] | undefined = rg.length === 2 ? [rg[0], rg[1]] : undefined;
    const set = pairArray(s.set);

    // graph
    const edge: [string, string][] = Array.isArray(s.edge)
      ? (s.edge as Record<string, unknown>[])
          .filter((e) => e && e.from != null && e.to != null)
          .map((e) => [String(e.from), String(e.to)] as [string, string])
      : [];
    const label: Record<string, string> = {};
    if (Array.isArray(s.label)) {
      for (const l of s.label as Record<string, unknown>[]) {
        if (l && l.id != null && l.text != null) label[String(l.id)] = String(l.text);
      }
    }
    // grid triples
    const gset: [number, number, number][] = Array.isArray(s.gset)
      ? (s.gset as unknown[]).map((t) => numArray(t)).filter((t) => t.length >= 3).map((t) => [t[0], t[1], t[2]] as [number, number, number])
      : [];

    const say = (typeof s.say === "string" && s.say) || (typeof s.caption === "string" && s.caption) || "";

    return {
      line: Math.min(Math.max(1, Number(s.line) || 1), Math.max(1, code.length)),
      say,
      compare,
      swap,
      set: set.length ? set : undefined,
      range,
      sorted: numArray(s.sorted),
      pointers,
      found: Number.isFinite(Number(s.found)) ? Number(s.found) : null,
      active: strArray(s.active),
      visit: strArray(s.visit),
      edge: edge.length ? edge : undefined,
      label: Object.keys(label).length ? label : undefined,
      queue: Array.isArray(s.queue) ? strArray(s.queue) : undefined,
      gcompare: pairArray(s.gcompare),
      gset: gset.length ? gset : undefined,
      gdone: pairArray(s.gdone),
      gpath: pairArray(s.gpath),
    };
  });

  const narration =
    (typeof raw.narration === "string" && raw.narration.trim()) ||
    steps.map((s) => s.say).filter(Boolean).join(" ");

  return {
    title: (typeof raw.title === "string" && raw.title ? raw.title : topic).slice(0, 120),
    description: typeof raw.description === "string" ? raw.description.slice(0, 600) : "",
    narration: narration.slice(0, 2000),
    mode,
    viz,
    code,
    array,
    target: Number.isFinite(Number(raw.target)) ? Number(raw.target) : null,
    nodes: nodes.length ? nodes : undefined,
    edges: edges.length ? edges : undefined,
    grid: grid.length ? grid : undefined,
    steps,
  };
}

export interface Validated {
  ok: boolean;
  reason?: string;
}

/** True if a step produces any visible change on the visualization. */
function stepMoves(s: SpecStep): boolean {
  return !!(
    (s.compare && s.compare.length) ||
    (s.swap && s.swap.length === 2) ||
    (s.set && s.set.length) ||
    (s.pointers && Object.keys(s.pointers).length) ||
    (s.sorted && s.sorted.length) ||
    (s.range && s.range.length === 2) ||
    (s.active && s.active.length) ||
    (s.visit && s.visit.length) ||
    (s.edge && s.edge.length) ||
    (s.label && Object.keys(s.label).length) ||
    (s.queue && s.queue.length) ||
    (s.gcompare && s.gcompare.length) ||
    (s.gset && s.gset.length) ||
    (s.gdone && s.gdone.length) ||
    (s.gpath && s.gpath.length) ||
    (s.highlight && s.highlight.length) ||
    (s.array && s.array.length) ||
    s.found != null
  );
}

/** Structural validation — a HARD gate. */
export function validateSpec(spec: GeneratedSpec): Validated {
  if (spec.steps.length < 2) return { ok: false, reason: "Too few steps." };
  // The panel: code and concept modes both need panel lines; visual mode doesn't.
  if (spec.mode !== "visual" && spec.code.length < 2) {
    return { ok: false, reason: "Too few panel lines (code or bullet points)." };
  }
  // The visualization: only check the data for the chosen viz.
  if (spec.viz === "graph" || spec.viz === "tree") {
    if (!spec.nodes || spec.nodes.length < 2) return { ok: false, reason: "Graph needs at least 2 nodes." };
    const ids = new Set(spec.nodes.map((n) => n.id));
    if (spec.edges) {
      for (const e of spec.edges) {
        if (!ids.has(String(e[0])) || !ids.has(String(e[1]))) {
          return { ok: false, reason: `Edge references an unknown node: ${e[0]}-${e[1]}.` };
        }
      }
    }
  } else if (spec.viz === "grid") {
    if (!spec.grid || spec.grid.length < 1 || spec.grid[0].length < 1) {
      return { ok: false, reason: "Grid is missing or empty." };
    }
  } else if (spec.viz === "array" || spec.viz === "linkedlist") {
    if (spec.array.length < 2) return { ok: false, reason: "Array example is missing or too small." };
  }
  // viz "none" needs no data — a panel-only explainer.
  if (spec.mode === "visual" && spec.viz === "none") {
    return { ok: false, reason: "A visual-mode spec needs a visualization (viz can't be none)." };
  }
  return { ok: true };
}

/** Quality check — a SOFT gate (triggers a repair but never blocks rendering). */
export function vizChangesEnough(spec: GeneratedSpec): Validated {
  // Enough data for a meaningful visualization. Tiny examples read as trivial;
  // flag them so the pipeline regenerates with a fuller structure.
  if (spec.viz === "graph" || spec.viz === "tree") {
    if ((spec.nodes?.length ?? 0) < 5) {
      return { ok: false, reason: "Too few nodes — use 6–9 nodes for a meaningful graph." };
    }
  } else if (spec.viz === "grid") {
    const rows = spec.grid?.length ?? 0;
    const cols = spec.grid?.[0]?.length ?? 0;
    if (rows < 3 || cols < 3) {
      return { ok: false, reason: "Grid is too small — use at least 4×4 (3×4 minimum)." };
    }
  } else if (spec.viz === "array" || spec.viz === "linkedlist") {
    if (spec.array.length < 7) {
      return { ok: false, reason: "Array example is too small — use 8–12 elements for a meaningful visualization." };
    }
  }

  // "Movement" only matters when there's a visualization. For a points-only
  // concept explainer (viz none), the step just advances the highlighted point.
  if (spec.viz !== "none") {
    const changing = spec.steps.filter(stepMoves).length;
    if (changing < Math.ceil(spec.steps.length * 0.6)) {
      return {
        ok: false,
        reason: "Most steps don't update the visualization; every step should change the picture.",
      };
    }
  }
  const withSay = spec.steps.filter((s) => s.say && s.say.trim().length > 0).length;
  if (withSay < Math.ceil(spec.steps.length * 0.8)) {
    return { ok: false, reason: "Most steps are missing a spoken 'say' line." };
  }
  return { ok: true };
}
