import type { ConceptActor, ConceptZone, GeneratedSpec, SpecStep } from "./manimPrompt";

/**
 * Symbolic register: "glyphs" — a fixed motif lexicon for concept videos.
 *
 * The model never chooses how anything looks. It PARSES a concept into
 * elements tagged with archetypal MOTIFS (life, death, war, power, flow…)
 * plus a sequence of dynamics; this module compiles the parse into an
 * ordinary concept spec. The lexicon binds each motif to one glyph + color,
 * so "life" is drawn the same way in every video — the layout stays free per
 * concept, the encoding does not. Symbolic coherence comes from the compiler,
 * not the model, and the renderer never learns the register exists.
 */

// --- The lexicon ---------------------------------------------------------------

export interface Motif {
  id: string;
  kind: string; // glyph drawn by the renderer
  color: string; // role token: yellow | green | pink | cyan | gray
  gloss: string; // what the motif means (shown to the model, not the viewer)
}

export const MOTIFS: Motif[] = [
  { id: "source", kind: "burst", color: "yellow", gloss: "origin; that from which things flow" },
  { id: "life", kind: "star", color: "green", gloss: "vitality, growth, the living" },
  { id: "death", kind: "cross", color: "gray", gloss: "ending, the dead, extinction" },
  { id: "war", kind: "triangle", color: "pink", gloss: "violence, conflict, force" },
  { id: "order", kind: "square", color: "cyan", gloss: "law, structure, institution" },
  { id: "power", kind: "circle", color: "yellow", gloss: "authority, capital, concentrated might" },
  { id: "people", kind: "dot", color: "gray", gloss: "ordinary persons, the many" },
  { id: "wealth", kind: "diamond", color: "green", gloss: "stock, hoard, accumulated value" },
  { id: "exchange", kind: "ring", color: "cyan", gloss: "market, medium, circulation" },
  { id: "crisis", kind: "burst", color: "pink", gloss: "rupture, breakdown, catastrophe" },
];

const MOTIF_BY_ID = new Map(MOTIFS.map((m) => [m.id, m]));

const OPS = [
  "flow", "radiate", "bind", "sever", "clash", "perish", "transform",
  "scatter", "gather", "swell", "contract", "reveal",
] as const;
type Op = (typeof OPS)[number];

interface GlyphElement {
  id: string;
  motif: Motif;
  label?: string;
  x: number;
  y: number;
  size: number;
}

interface Dynamic {
  line: number;
  say: string;
  op: Op;
  from?: string;
  to?: string;
  at?: string;
  ids?: string[];
  zone?: string;
  motif?: string;
  factor?: number;
}

// --- Parsing (lenient — invalid entries are dropped, gates catch the rest) ---

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown, fallback: number): number {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

// --- The compiler ------------------------------------------------------------

/**
 * Compile a raw glyph parse into a renderer-ready concept spec. Every
 * expansion uses only the existing geometric verbs.
 */
export function compileGlyphSpec(raw: Record<string, unknown>, topic: string): GeneratedSpec {
  const code = (Array.isArray(raw.code) ? (raw.code as unknown[]) : []).map((l) => String(l)).slice(0, 22);

  // Elements: id + motif (the lexicon decides how it looks) + free position.
  const elements = new Map<string, GlyphElement>();
  if (Array.isArray(raw.elements)) {
    for (const e of raw.elements as Record<string, unknown>[]) {
      const id = str(e?.id);
      const motif = MOTIF_BY_ID.get(str(e?.motif).toLowerCase());
      if (!id || !motif || elements.has(id)) continue;
      elements.set(id, {
        id,
        motif,
        label: str(e?.label).slice(0, 22) || undefined,
        x: num(e?.x, 5),
        y: num(e?.y, 5),
        size: Math.max(0.5, Math.min(num(e?.size, 1), 2.5)),
      });
      if (elements.size >= 14) break;
    }
  }

  // Zones: free regions (a territory, a market floor); style from the model.
  const zones: ConceptZone[] = [];
  const zoneIds = new Set<string>();
  if (Array.isArray(raw.zones)) {
    for (const z of raw.zones as Record<string, unknown>[]) {
      const id = str(z?.id);
      if (!id || zoneIds.has(id) || elements.has(id)) continue;
      zoneIds.add(id);
      zones.push({
        id,
        x: num(z?.x, 5), y: num(z?.y, 5),
        w: num(z?.w, 3), h: num(z?.h, 3),
        ...(z?.shape === "circle" ? { shape: "circle" as const } : {}),
        ...(z?.style === "solid" ? { style: "solid" as const } : {}),
        color: "cyan",
        ...(str(z?.label) ? { label: str(z?.label).slice(0, 22) } : {}),
      });
      if (zones.length >= 3) break;
    }
  }

  const known = (id: string) => elements.has(id) || zoneIds.has(id);

  const dynamics: Dynamic[] = [];
  if (Array.isArray(raw.dynamics)) {
    for (const d of raw.dynamics as Record<string, unknown>[]) {
      if (!d || !OPS.includes(d.op as Op)) continue;
      dynamics.push({
        line: Math.min(Math.max(1, Number(d.line) || 1), Math.max(1, code.length)),
        say: str(d.say),
        op: d.op as Op,
        from: str(d.from) || undefined,
        to: str(d.to) || undefined,
        at: str(d.at) || undefined,
        ids: Array.isArray(d.ids) ? (d.ids as unknown[]).map((i) => String(i)) : undefined,
        zone: str(d.zone) || undefined,
        motif: str(d.motif).toLowerCase() || undefined,
        factor: Number.isFinite(Number(d.factor)) ? Number(d.factor) : undefined,
      });
      if (dynamics.length >= 26) break;
    }
  }

  // Scene from the lexicon: motif decides glyph + color, model decides place.
  const actors: ConceptActor[] = [...elements.values()].map((e) => ({
    id: e.id, x: e.x, y: e.y,
    kind: e.motif.kind as ConceptActor["kind"],
    color: e.motif.color,
    size: e.size,
    ...(e.label ? { label: e.label } : {}),
  }));

  const links: [string, string][] = [];
  if (Array.isArray(raw.links)) {
    for (const pair of raw.links as Record<string, unknown>[]) {
      const a = str((pair as Record<string, unknown>)?.from);
      const b = str((pair as Record<string, unknown>)?.to);
      if (a && b && a !== b && known(a) && known(b)) links.push([a, b]);
    }
  }

  // Dynamics expand to canned verb sequences. `alias` tracks elements that
  // perish/transform into a new glyph so later ops still find them.
  const steps: SpecStep[] = [];
  const alias = new Map<string, string>();
  const gone = new Set<string>();
  let sparkN = 0;
  const resolve = (id?: string) => {
    let cur = id ?? "";
    while (alias.has(cur)) cur = alias.get(cur)!;
    return cur;
  };
  const pos = new Map<string, [number, number]>(
    [...elements.values()].map((e) => [e.id, [e.x, e.y] as [number, number]]),
  );
  for (const z of zones) pos.set(z.id, [z.x, z.y]);
  const live = (id: string) => known(id) || [...alias.values()].includes(id);

  for (const d of dynamics) {
    const base: SpecStep = { line: d.line, say: d.say };
    const from = resolve(d.from);
    const to = resolve(d.to);
    const at = resolve(d.at);
    switch (d.op) {
      case "flow": {
        // Influx: a spark travels from one element to another.
        if (gone.has(from) || gone.has(to) || !pos.has(from) || !pos.has(to)) break;
        sparkN += 1;
        const id = `spark${sparkN}`;
        const [fx, fy] = pos.get(from)!;
        const [tx, ty] = pos.get(to)!;
        const ring = (sparkN % 6) * (Math.PI / 3);
        steps.push({
          ...base,
          spawn: [{ id, x: fx, y: fy, kind: "dot", color: "yellow", size: 0.7 }],
          pulse: [from],
        });
        steps.push({
          line: d.line,
          say: "The flow arrives.",
          move: [[id, tx + 0.5 * Math.cos(ring), ty + 0.5 * Math.sin(ring)]],
        });
        break;
      }
      case "radiate": {
        // Outward flow: sparks stream from the element in all directions.
        if (gone.has(at) || !pos.has(at)) break;
        const [x, y] = pos.get(at)!;
        const ids = [0, 1, 2].map(() => `spark${++sparkN}`);
        steps.push({
          ...base,
          spawn: ids.map((id, i) => ({ id, x, y, kind: "dot" as const, color: "yellow" as const, size: 0.65 })),
          pulse: [at],
        });
        steps.push({
          line: d.line,
          say: "It pours outward.",
          move: ids.map((id, i) => {
            const ang = (i * 2 * Math.PI) / 3 + Math.PI / 7;
            return [id, x + 2.1 * Math.cos(ang), y + 2.1 * Math.sin(ang)] as [string, number, number];
          }),
        });
        break;
      }
      case "bind":
        if (!gone.has(from) && !gone.has(to) && from !== to) steps.push({ ...base, link: [[from, to]] });
        break;
      case "sever":
        steps.push({ ...base, unlink: [[from, to]], pulse: !gone.has(to) && live(to) ? [to] : undefined });
        break;
      case "clash": {
        // Conflict: the two rush together and the impact rings.
        if (gone.has(from) || gone.has(to) || !pos.has(from) || !pos.has(to)) break;
        const [ax, ay] = pos.get(from)!;
        const [bx, by] = pos.get(to)!;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        steps.push({
          ...base,
          move: [
            [from, mx - 0.45, my],
            [to, mx + 0.45, my],
          ],
        });
        pos.set(from, [mx - 0.45, my]);
        pos.set(to, [mx + 0.45, my]);
        steps.push({ line: d.line, say: "The impact lands.", pulse: [from, to] });
        break;
      }
      case "perish": {
        // Death: the element's glyph is replaced by the death mark.
        if (gone.has(at) || !elements.has(at) && !alias.has(d.at ?? "") && !pos.has(at)) break;
        if (!pos.has(at)) break;
        const [x, y] = pos.get(at)!;
        const dead = MOTIF_BY_ID.get("death")!;
        const nid = `${at}_dead`;
        gone.add(at);
        alias.set(at, nid);
        pos.set(nid, [x, y]);
        steps.push({
          ...base,
          dissolve: [at],
          spawn: [{ id: nid, x, y, kind: dead.kind as ConceptActor["kind"], color: dead.color, size: 0.9 }],
        });
        break;
      }
      case "transform": {
        // Role change: the element becomes another motif, in place.
        const motif = MOTIF_BY_ID.get(d.motif ?? "");
        if (!motif || gone.has(at) || !pos.has(at)) break;
        const [x, y] = pos.get(at)!;
        const nid = `${at}_${motif.id}`;
        gone.add(at);
        alias.set(at, nid);
        pos.set(nid, [x, y]);
        steps.push({
          ...base,
          dissolve: [at],
          spawn: [{ id: nid, x, y, kind: motif.kind as ConceptActor["kind"], color: motif.color, size: 1 }],
        });
        break;
      }
      case "scatter": {
        const ids = (d.ids ?? []).map(resolve).filter((i) => !gone.has(i));
        if (ids.length) steps.push({ ...base, scatter: ids });
        break;
      }
      case "gather": {
        const ids = (d.ids ?? []).map(resolve).filter((i) => !gone.has(i));
        if (ids.length && d.zone && zoneIds.has(d.zone)) {
          steps.push({ ...base, enter: ids.map((i) => [i, d.zone!] as [string, string]) });
        }
        break;
      }
      case "swell": {
        const f = Math.max(1.1, Math.min(d.factor ?? 1.5, 2.2));
        if (!gone.has(at) && live(at)) steps.push({ ...base, grow: [[at, f]] });
        break;
      }
      case "contract":
        if (!gone.has(at) && live(at)) steps.push({ ...base, grow: [[at, 0.55]] });
        break;
      case "reveal":
        if (!gone.has(at) && (live(at) || zoneIds.has(at))) steps.push({ ...base, pulse: [at] });
        break;
    }
  }

  const narration =
    (typeof raw.narration === "string" && raw.narration.trim()) ||
    steps.map((s) => s.say).filter(Boolean).join(" ");

  return {
    title: (str(raw.title) || topic).slice(0, 120),
    description: str(raw.description).slice(0, 600),
    narration: narration.slice(0, 2000),
    mode: "concept",
    viz: "concept",
    code,
    array: [],
    target: null,
    tradition: str(raw.tradition).slice(0, 120) || undefined,
    actors,
    zones: zones.length ? zones : undefined,
    links: links.length ? links : undefined,
    steps,
  };
}

// --- Prompt + schema for the parse ------------------------------------------

const LEXICON_LINES = MOTIFS.map((m) => `  ${m.id.padEnd(9)}${m.gloss}`).join("\n");

export const GLYPH_SYSTEM_INSTRUCTION = `You translate abstract concepts from social theory, political economy and
philosophy into a FIXED SYMBOLIC LEXICON. You do NOT choose how anything
looks and you do NOT write animation code — you output a PARSE: the concept's
elements, each tagged with the archetypal motif that names its role, plus the
dynamics that carry the mechanism. A fixed compiler binds each motif to one
glyph and color, the same in every video, so the videos share one visual
language. Your creative work is the decomposition — choose motifs by what an
element IS in the mechanism, not by surface resemblance.

THE LEXICON (motif — meaning):
${LEXICON_LINES}

COMMIT TO ONE ACCOUNT ("tradition", required): name the author and work whose
reading of the concept you animate, e.g. "Marx, Capital Vol. I, Part VIII
(1867)".

THE ARGUMENT ("code", 5-10 lines): the numbered claims of the mechanism, in
causal order, each under 55 characters, plain prose. Dynamics point at the
argument line they animate.

ELEMENTS ("elements", 4-12): [{id, motif, label, x, y, size}] — id is your
short name ("peasants", "capital"); motif is one lexicon id; label is the
concept's own word for it (under 22 chars); x,y place it in a 0-10 x 0-10
space (y UP) — spread elements out, keep them apart, leave room to move. Use
several small "people" elements for a population (size 0.7), one larger
element (size 1.4-2) for a dominant force. Optional "zones" (0-3):
[{id, label, x, y, w, h, shape: rect|circle, style: open|solid}] for
territories or arenas; optional initial "links": [{from, to}] for standing
ties.

DYNAMICS (10-20, each with "line", one spoken sentence "say", and an op):
  flow      {from, to}       influx travels from one element to another
  radiate   {at}             it pours outward in all directions
  bind      {from, to}       a tie is made
  sever     {from, to}       a tie is cut
  clash     {from, to}       the two rush together; the impact rings
  perish    {at}             the element dies — its glyph becomes the death mark
  transform {at, motif}      the element becomes another motif, in place
  scatter   {ids: [...]}     the listed elements disperse
  gather    {ids, zone}      the listed elements collect inside a zone
  swell     {at, factor}     it grows by what it takes in (1.1-2.2)
  contract  {at}             it withdraws, diminishes
  reveal    {at}             draw the eye to it
Tell the mechanism as events: what flows where, what collides, what dies,
what changes role, who is scattered and who collects the difference.

WORKED EXAMPLE (abbreviated) — "primitive accumulation":
{"title":"Primitive Accumulation","tradition":"Marx, Capital Vol. I, Part VIII (1867)",
 "code":["The commons sustains the peasantry","Enclosure takes the land by force",
  "The dispossessed are driven to the market","Capital pools from enclosed land"],
 "elements":[
  {"id":"commons","motif":"life","label":"the commons","x":2.5,"y":7,"size":1.5},
  {"id":"p1","motif":"people","x":1.8,"y":5.5,"size":0.7},{"id":"p2","motif":"people","x":3.2,"y":5.5,"size":0.7},
  {"id":"p3","motif":"people","x":2.5,"y":4.6,"size":0.7},
  {"id":"enclosure","motif":"war","label":"enclosure","x":7.5,"y":8,"size":1.4},
  {"id":"market","motif":"exchange","label":"labor market","x":7.5,"y":2.5,"size":1.3},
  {"id":"capital","motif":"wealth","label":"capital","x":8.8,"y":6,"size":1}],
 "links":[{"from":"p1","to":"commons"},{"from":"p2","to":"commons"},{"from":"p3","to":"commons"}],
 "dynamics":[
  {"line":1,"say":"The commons feeds those who live from it.","op":"radiate","at":"commons"},
  {"line":2,"say":"Enclosure descends on the commons by force.","op":"clash","from":"enclosure","to":"commons"},
  {"line":2,"say":"The ties of custom are severed.","op":"sever","from":"p1","to":"commons"},
  {"line":2,"say":"The common land dies as commons.","op":"perish","at":"commons"},
  {"line":2,"say":"The peasants are driven off.","op":"scatter","ids":["p1","p2","p3"]},
  {"line":3,"say":"With only labor to sell, they collect at the market.","op":"flow","from":"p1","to":"market"},
  {"line":4,"say":"What the land yielded now pools as capital.","op":"flow","from":"market","to":"capital"},
  {"line":4,"say":"Capital swells on the difference.","op":"swell","at":"capital","factor":1.8}]}

Also give an overall "narration" (the say lines joined), a "title" and a
one-sentence "description". Return ONLY the JSON described by the schema.`;

const idsArr = { type: "array", items: { type: "string" } };

export const GLYPH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    narration: { type: "string" },
    tradition: { type: "string" },
    code: { type: "array", items: { type: "string" } },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          motif: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          size: { type: "number" },
        },
        required: ["id", "motif", "x", "y"],
      },
    },
    zones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          shape: { type: "string" },
          style: { type: "string" },
        },
        required: ["id", "x", "y", "w", "h"],
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
    dynamics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          say: { type: "string" },
          op: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          at: { type: "string" },
          ids: idsArr,
          zone: { type: "string" },
          motif: { type: "string" },
          factor: { type: "number" },
        },
        required: ["line", "say", "op"],
      },
    },
  },
  required: ["title", "description", "narration", "tradition", "code", "elements", "dynamics"],
} as const;
