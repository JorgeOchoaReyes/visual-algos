import type { SchemaType } from "@google/generative-ai";
import type { Mode } from "@shared/types";

export type VizKind = "array" | "graph" | "tree" | "grid" | "linkedlist" | "concept";

/** Actor in a concept scene (positions in a normalized 0-10 x 0-10 space, y up). */
export interface ConceptActor {
  id: string;
  x: number;
  y: number;
  kind?: "dot" | "circle" | "square";
  color?: string; // role token: cyan | yellow | green | pink | gray
  size?: number; // 0.3-3, default 1
  label?: string;
}

/** Region in a concept scene ("open" = dashed border, "solid" = fenced). */
export interface ConceptZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: "rect" | "circle";
  style?: "open" | "solid";
  color?: string;
  label?: string;
}

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
  // concept:
  move?: [string, number, number][];
  enter?: [string, string][];
  scatter?: string[];
  link?: [string, string][];
  unlink?: [string, string][];
  enclose?: string[];
  dissolve?: string[];
  spawn?: ConceptActor[];
  grow?: [string, number][];
  restyle?: { id: string; color?: string; label?: string }[];
  pulse?: string[];
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
  viz: VizKind;
  code: string[];
  array: number[]; // array / linkedlist
  target?: number | null;
  nodes?: GraphNode[]; // graph / tree
  edges?: (string | number)[][]; // graph / tree: [from, to] or [from, to, weight]
  grid?: number[][]; // grid
  // concept:
  tradition?: string; // whose account this animates (required for concept)
  actors?: ConceptActor[];
  zones?: ConceptZone[];
  links?: [string, string][]; // initial ties
  steps: SpecStep[];
}

export const SYSTEM_INSTRUCTION = `You explain computer-science algorithms as short, precise, step-by-step
animations. You DO NOT write animation code — you output structured DATA that a
fixed renderer turns into a video: the algorithm's source code on the left, a
data-structure visualization on the right, and an ordered list of steps. Each
step highlights ONE code line, updates the visualization, AND carries the exact
sentence the narrator speaks — so code, visuals and voice stay locked together.

PICK THE RIGHT VISUALIZATION with "viz":
  "array"      – sorting, searching, two-pointer, sliding window (drawn as bars)
  "graph"      – BFS, DFS, Dijkstra, topological sort (nodes + edges)
  "tree"       – BST, heap, tree traversals (nodes + edges with positions)
  "grid"       – dynamic programming tables, matrices, grid pathfinding
  "linkedlist" – linked-list traversal / search / build

CRITICAL: match the visualization to the DATA STRUCTURE the algorithm operates
on, not to what's convenient. If the algorithm works on a graph or tree — it
mentions nodes, neighbors, adjacency, edges, traversal, shortest path, BFS/DFS,
Dijkstra, topological order, or a tree/heap — you MUST use viz "graph" or "tree"
and provide real "nodes" and "edges". NEVER encode a graph as an array or an
adjacency matrix and render it as bars — that hides the actual structure. Same
for grids (use "grid") and linked lists (use "linkedlist").

CODE RULES (all viz)
- Write COMPLETE, correct, runnable code (6–20 short lines). NEVER stub or hide
  logic behind a placeholder or an unshown helper (no "_merge(...) # complex"):
  write the full body so a viewer can see how it actually works.
- Every step: "line" (1-based code line) + "say" (ONE spoken sentence describing
  exactly what happens this step). The three tracks MUST agree: the highlighted
  line does this step, "say" narrates it, the visualization changes to match.
- Never emit a step that only changes line + say with no visual change. Aim for
  12–34 steps. Also give an overall "narration" (the say lines joined).

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
  required: ["title", "description", "narration", "viz", "code", "steps"],
} as const;

export const SCHEMA_CAST = RESPONSE_SCHEMA as unknown as { type: SchemaType };

// --- Concept mode (abstract social-theory visualizations) --------------------

export const CONCEPT_SYSTEM_INSTRUCTION = `You explain abstract concepts from social theory, political economy and
philosophy as short, precise animated diagrams. You DO NOT write animation
code — you output structured DATA that a fixed renderer turns into a video: the
numbered steps of the ARGUMENT on the left, an animated scene of actors, zones
and ties on the right, and an ordered list of steps. Each step highlights ONE
argument line, changes the scene, AND carries the exact sentence the narrator
speaks — argument, visuals and voice stay locked together.

"viz" is ALWAYS "concept".

COMMIT TO ONE ACCOUNT ("tradition", required): these concepts are contested —
Durkheim's anomie is not Merton's; primitive accumulation is Marx's polemic.
Name the specific account you animate, with author and work, e.g.
"Marx, Capital Vol. I, Part VIII (1867)" or "Durkheim, Suicide (1897)". Do not
blend rival accounts into a generic composite.

THE ARGUMENT ("code", 5-10 lines): the numbered steps of the mechanism, in
causal order, each a short declarative claim (under 55 characters), plain prose
(no code, no numbering — the renderer numbers them). Example:
  "Peasants hold customary rights to the commons"
  "Enclosure acts fence off the land"
Every step's "line" points at the argument line it animates (1-based).

THE SCENE: a 0-10 x 0-10 space (x rightward, y UPWARD).
- "actors" (6-12): the individuals/groups/institutions in motion.
  {id, x, y, kind: dot|circle|square, color, size 0.3-3, label}.
  dots = ordinary agents; a larger circle/square = an institution or power.
- "zones" (0-3): regions of the space. {id, x, y, w, h, shape: rect|circle,
  style: open|solid, color, label}. "open" draws a dashed border (a commons, a
  market); "solid" a heavy fence (enclosed, closed off).
- "links": initial ties as [{from,to}] (belonging, obligation, solidarity).
- Colors are roles: "gray" ordinary agents · "yellow" power/capital ·
  "green" stabilized/normative · "pink" crisis/rupture · "cyan" neutral other.
- Spread the scene out; leave empty space to move actors into later. Zones and
  large actors must NOT overlap each other — keep them well apart, and leave
  room around a zone for actors that will enter it.
- Label zones and institutions. Do NOT label every ordinary agent — identical
  labels on clustered dots pile up illegibly. At most one representative dot
  per group gets a label.

STEP VERBS (each step uses AT LEAST one; combine freely):
  move:[{id,x,y}]        slide to an absolute position
  enter:[{id,zone}]      move an actor inside a zone (renderer picks the spot)
  scatter:[ids]          disperse actors away from their common center
  link:[{from,to}]       draw a tie between two ids
  unlink:[{from,to}]     sever a tie (it flashes and snaps)
  enclose:[zone ids]     the zone's dashed border becomes a solid fence
  dissolve:[ids]         an actor/zone fades away (ties to it vanish)
  spawn:[actors]         new actors appear mid-scene
  grow:[{id,factor}]     scale an actor (accumulation 1.3-2, decline 0.5-0.8)
  restyle:[{id,color,label}]  recolor and/or relabel (role change)
  pulse:[ids]            briefly emphasize (use alone on an id, not with other
                         verbs on that same id in the same step)

STEP RULES
- 10-24 steps. Every step: "line" + ONE spoken sentence "say" + >=1 verb.
- The three tracks MUST agree: the highlighted argument line claims what the
  scene shows and "say" narrates.
- Also give an overall "narration" (the say lines joined), a "title" (the
  concept's name) and a one-sentence "description".

WORKED EXAMPLE (abbreviated) — topic "primitive accumulation":
{"title":"Primitive Accumulation","tradition":"Marx, Capital Vol. I, Part VIII (1867)",
 "viz":"concept",
 "code":["Peasants hold customary rights to the commons","Landlords enclose the land by law",
  "Peasants are driven off","Sheep pasture replaces subsistence farming",
  "The dispossessed must sell their labor","Capital accumulates from enclosed land"],
 "actors":[{"id":"p1","x":2,"y":6,"kind":"dot","color":"gray"}, {"id":"p2","x":3,"y":7,"kind":"dot","color":"gray"},
  {"id":"lord","x":8.6,"y":8,"kind":"circle","color":"yellow","size":1.4,"label":"landlord"}],
 "zones":[{"id":"commons","x":2.8,"y":6,"w":4.4,"h":5,"style":"open","color":"green","label":"commons"},
  {"id":"market","x":8,"y":2,"w":3.4,"h":3,"style":"open","color":"cyan","label":"labor market"}],
 "links":[{"from":"p1","to":"commons"},{"from":"p2","to":"commons"}],
 "steps":[
  {"line":1,"say":"Peasants live from the common land.","pulse":["commons"]},
  {"line":2,"say":"A landlord claims the land.","move":[{"id":"lord","x":5.8,"y":7}]},
  {"line":2,"say":"The commons is enclosed by law.","enclose":["commons"]},
  {"line":3,"say":"The peasants' ties to the land are severed.","unlink":[{"from":"p1","to":"commons"},{"from":"p2","to":"commons"}]},
  {"line":3,"say":"They are driven off the land.","scatter":["p1","p2"]},
  {"line":4,"say":"Sheep replace people on the pasture.","spawn":[{"id":"s1","x":2.4,"y":6,"kind":"dot","color":"green"}],"restyle":[{"id":"commons","label":"sheep pasture"}]},
  {"line":5,"say":"With only labor to sell, they enter the market.","enter":[{"id":"p1","zone":"market"},{"id":"p2","zone":"market"}]},
  {"line":6,"say":"Rents and profits flow to the landlord.","grow":[{"id":"lord","factor":1.6}]}]}

Return ONLY the JSON described by the schema. Fill only the fields relevant to
your scene.`;

const ids = { type: "array", items: { type: "string" } };
const idPair = {
  type: "array",
  items: {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" } },
    required: ["from", "to"],
  },
};
const actorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    kind: { type: "string" },
    color: { type: "string" },
    size: { type: "number" },
    label: { type: "string" },
  },
  required: ["id", "x", "y"],
};

export const CONCEPT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    narration: { type: "string" },
    viz: { type: "string" },
    tradition: { type: "string" },
    code: { type: "array", items: { type: "string" } },
    actors: { type: "array", items: actorSchema },
    zones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          shape: { type: "string" },
          style: { type: "string" },
          color: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "x", "y", "w", "h"],
      },
    },
    links: idPair,
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          say: { type: "string" },
          move: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
              required: ["id", "x", "y"],
            },
          },
          enter: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, zone: { type: "string" } },
              required: ["id", "zone"],
            },
          },
          scatter: ids,
          link: idPair,
          unlink: idPair,
          enclose: ids,
          dissolve: ids,
          spawn: { type: "array", items: actorSchema },
          grow: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, factor: { type: "number" } },
              required: ["id", "factor"],
            },
          },
          restyle: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, color: { type: "string" }, label: { type: "string" } },
              required: ["id"],
            },
          },
          pulse: ids,
        },
        required: ["line", "say"],
      },
    },
  },
  required: ["title", "description", "narration", "viz", "tradition", "code", "actors", "steps"],
} as const;

export function promptFor(mode: Mode): string {
  return mode === "concept" ? CONCEPT_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION;
}

export function schemaFor(mode: Mode): Record<string, unknown> {
  return (mode === "concept" ? CONCEPT_RESPONSE_SCHEMA : RESPONSE_SCHEMA) as unknown as Record<string, unknown>;
}

export function schemaCastFor(mode: Mode): { type: SchemaType } {
  return schemaFor(mode) as unknown as { type: SchemaType };
}

export function schemaHintFor(mode: Mode): string {
  return `The JSON you return MUST match this JSON Schema exactly:
${JSON.stringify(schemaFor(mode), null, 2)}

Return the JSON object on its own — no prose, no markdown fences.`;
}


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

export function buildUserPrompt(topic: string, language: string, mode: Mode): string {
  if (mode === "concept") {
    return `Concept: ${topic}\n\nProduce the concept walkthrough JSON now.`;
  }
  return `Topic: ${topic}\nLanguage for the on-screen code: ${language}\n\nProduce the walkthrough JSON now.`;
}

export function buildRepairPrompt(topic: string, language: string, error: string, mode: Mode): string {
  const what = mode === "concept" ? `The previous concept JSON for "${topic}"` : `The previous walkthrough JSON for "${topic}" (language ${language})`;
  return [
    `${what} was invalid:`,
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

const VIZ_KINDS: VizKind[] = ["array", "graph", "tree", "grid", "linkedlist"];

/** Parse a raw actor object (used for "actors" and step "spawn"). */
function parseActor(a: Record<string, unknown>): ConceptActor | null {
  if (!a || a.id == null || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(a.y))) return null;
  const actor: ConceptActor = { id: String(a.id), x: Number(a.x), y: Number(a.y) };
  if (a.kind === "dot" || a.kind === "circle" || a.kind === "square") actor.kind = a.kind;
  if (typeof a.color === "string" && a.color) actor.color = a.color;
  if (Number.isFinite(Number(a.size))) actor.size = Number(a.size);
  if (a.label != null && a.label !== "") actor.label = String(a.label);
  return actor;
}

/** Parse [{from,to}] (or legacy [a,b] tuples) into [from, to] pairs. */
function parseIdPairs(v: unknown): [string, string][] {
  if (!Array.isArray(v)) return [];
  const out: [string, string][] = [];
  for (const e of v as unknown[]) {
    if (Array.isArray(e) && e.length >= 2) out.push([String(e[0]), String(e[1])]);
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      if (o.from != null && o.to != null) out.push([String(o.from), String(o.to)]);
    }
  }
  return out;
}

/** Convert the raw Gemini object into our internal (renderer-ready) form. */
export function normalizeSpec(raw: Record<string, unknown>, topic: string, mode: Mode): GeneratedSpec {
  // The mode is authoritative: a confused model can't cross modes.
  const viz: VizKind =
    mode === "concept"
      ? "concept"
      : VIZ_KINDS.includes(raw.viz as VizKind)
        ? (raw.viz as VizKind)
        : "array";
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

    // concept verbs
    const move: [string, number, number][] = Array.isArray(s.move)
      ? (s.move as Record<string, unknown>[])
          .filter((m) => m && m.id != null && Number.isFinite(Number(m.x)) && Number.isFinite(Number(m.y)))
          .map((m) => [String(m.id), Number(m.x), Number(m.y)] as [string, number, number])
      : [];
    const enter: [string, string][] = Array.isArray(s.enter)
      ? (s.enter as Record<string, unknown>[])
          .filter((e) => e && e.id != null && e.zone != null)
          .map((e) => [String(e.id), String(e.zone)] as [string, string])
      : [];
    const spawn = Array.isArray(s.spawn)
      ? (s.spawn as Record<string, unknown>[]).map(parseActor).filter((a): a is ConceptActor => a !== null)
      : [];
    const grow: [string, number][] = Array.isArray(s.grow)
      ? (s.grow as Record<string, unknown>[])
          .filter((g) => g && g.id != null && Number.isFinite(Number(g.factor)))
          .map((g) => [String(g.id), Number(g.factor)] as [string, number])
      : [];
    const restyle = Array.isArray(s.restyle)
      ? (s.restyle as Record<string, unknown>[])
          .filter((r) => r && r.id != null && (r.color != null || r.label != null))
          .map((r) => ({
            id: String(r.id),
            ...(r.color != null ? { color: String(r.color) } : {}),
            ...(r.label != null ? { label: String(r.label) } : {}),
          }))
      : [];
    const link = parseIdPairs(s.link);
    const unlink = parseIdPairs(s.unlink);

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
      move: move.length ? move : undefined,
      enter: enter.length ? enter : undefined,
      scatter: Array.isArray(s.scatter) ? strArray(s.scatter) : undefined,
      link: link.length ? link : undefined,
      unlink: unlink.length ? unlink : undefined,
      enclose: Array.isArray(s.enclose) ? strArray(s.enclose) : undefined,
      dissolve: Array.isArray(s.dissolve) ? strArray(s.dissolve) : undefined,
      spawn: spawn.length ? spawn : undefined,
      grow: grow.length ? grow : undefined,
      restyle: restyle.length ? restyle : undefined,
      pulse: Array.isArray(s.pulse) ? strArray(s.pulse) : undefined,
    };
  });

  const narration =
    (typeof raw.narration === "string" && raw.narration.trim()) ||
    steps.map((s) => s.say).filter(Boolean).join(" ");

  const actors = Array.isArray(raw.actors)
    ? (raw.actors as Record<string, unknown>[]).map(parseActor).filter((a): a is ConceptActor => a !== null).slice(0, 16)
    : [];
  const zones: ConceptZone[] = Array.isArray(raw.zones)
    ? (raw.zones as Record<string, unknown>[])
        .filter((z) => z && z.id != null)
        .map((z) => ({
          id: String(z.id),
          x: Number(z.x) || 0,
          y: Number(z.y) || 0,
          w: Number(z.w) || 3,
          h: Number(z.h) || 3,
          ...(z.shape === "circle" ? { shape: "circle" as const } : {}),
          ...(z.style === "solid" ? { style: "solid" as const } : {}),
          ...(typeof z.color === "string" && z.color ? { color: z.color } : {}),
          ...(z.label != null && z.label !== "" ? { label: String(z.label) } : {}),
        }))
        .slice(0, 4)
    : [];
  const links = parseIdPairs(raw.links);

  return {
    title: (typeof raw.title === "string" && raw.title ? raw.title : topic).slice(0, 120),
    description: typeof raw.description === "string" ? raw.description.slice(0, 600) : "",
    narration: narration.slice(0, 2000),
    viz,
    code,
    array,
    target: Number.isFinite(Number(raw.target)) ? Number(raw.target) : null,
    nodes: nodes.length ? nodes : undefined,
    edges: edges.length ? edges : undefined,
    grid: grid.length ? grid : undefined,
    tradition: typeof raw.tradition === "string" && raw.tradition.trim() ? raw.tradition.trim().slice(0, 120) : undefined,
    actors: actors.length ? actors : undefined,
    zones: zones.length ? zones : undefined,
    links: links.length ? links : undefined,
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
    (s.move && s.move.length) ||
    (s.enter && s.enter.length) ||
    (s.scatter && s.scatter.length) ||
    (s.link && s.link.length) ||
    (s.unlink && s.unlink.length) ||
    (s.enclose && s.enclose.length) ||
    (s.dissolve && s.dissolve.length) ||
    (s.spawn && s.spawn.length) ||
    (s.grow && s.grow.length) ||
    (s.restyle && s.restyle.length) ||
    (s.pulse && s.pulse.length) ||
    (s.highlight && s.highlight.length) ||
    (s.array && s.array.length) ||
    s.found != null
  );
}

/** Structural validation — a HARD gate. */
export function validateSpec(spec: GeneratedSpec): Validated {
  if (spec.code.length < 3) return { ok: false, reason: "Too few code lines." };
  if (spec.steps.length < 2) return { ok: false, reason: "Too few steps." };
  if (spec.viz === "concept") {
    if (!spec.actors || spec.actors.length < 3) return { ok: false, reason: "Concept scene needs at least 3 actors." };
    if (!spec.tradition) return { ok: false, reason: "Concept spec must name the tradition it animates (author + work)." };
    const ids = new Set([...spec.actors.map((a) => a.id), ...(spec.zones ?? []).map((z) => z.id)]);
    for (const [a, b] of spec.links ?? []) {
      if (!ids.has(a) || !ids.has(b)) return { ok: false, reason: `Link references an unknown id: ${a}-${b}.` };
    }
  } else if (spec.viz === "graph" || spec.viz === "tree") {
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
  } else {
    if (spec.array.length < 2) return { ok: false, reason: "Array example is missing or too small." };
  }
  return { ok: true };
}

/** Quality check — a SOFT gate (triggers a repair but never blocks rendering). */
export function vizChangesEnough(spec: GeneratedSpec): Validated {
  // Enough data for a meaningful visualization. Tiny examples read as trivial;
  // flag them so the pipeline regenerates with a fuller structure.
  if (spec.viz === "concept") {
    if (!spec.actors || spec.actors.length < 3) return { ok: false, reason: "Concept scene needs at least 3 actors." };
    if (!spec.tradition) return { ok: false, reason: "Concept spec must name the tradition it animates (author + work)." };
    const ids = new Set([...spec.actors.map((a) => a.id), ...(spec.zones ?? []).map((z) => z.id)]);
    for (const [a, b] of spec.links ?? []) {
      if (!ids.has(a) || !ids.has(b)) return { ok: false, reason: `Link references an unknown id: ${a}-${b}.` };
    }
  } else if (spec.viz === "graph" || spec.viz === "tree") {
    if ((spec.nodes?.length ?? 0) < 5) {
      return { ok: false, reason: "Too few nodes — use 6–9 nodes for a meaningful graph." };
    }
  } else if (spec.viz === "grid") {
    const rows = spec.grid?.length ?? 0;
    const cols = spec.grid?.[0]?.length ?? 0;
    if (rows < 3 || cols < 3) {
      return { ok: false, reason: "Grid is too small — use at least 4×4 (3×4 minimum)." };
    }
  } else {
    if (spec.array.length < 7) {
      return { ok: false, reason: "Array example is too small — use 8–12 elements for a meaningful visualization." };
    }
  }

  const changing = spec.steps.filter(stepMoves).length;
  if (changing < Math.ceil(spec.steps.length * 0.6)) {
    return {
      ok: false,
      reason: "Most steps don't update the visualization; every step should change the picture.",
    };
  }
  const withSay = spec.steps.filter((s) => s.say && s.say.trim().length > 0).length;
  if (withSay < Math.ceil(spec.steps.length * 0.8)) {
    return { ok: false, reason: "Most steps are missing a spoken 'say' line." };
  }
  return { ok: true };
}
