import type { ConceptActor, ConceptZone, GeneratedSpec, SpecStep } from "./manimPrompt";

/**
 * Symbolic register: "sefirot" — the Tree of Life as an intermediate
 * representation for concept videos.
 *
 * The model never designs a scene. It PARSES a concept into the tree's
 * grammar: a `mapping` (which elements of the concept occupy which sefirot)
 * plus a sequence of `dynamics` (emanate, sever, shatter, husk, contract,
 * swell, repair, reveal). This module then COMPILES that parse into an
 * ordinary concept spec — fixed positions, fixed colors, canned verb
 * expansions — so the same role always looks the same and the renderer stays
 * untouched. Symbolic coherence comes from the compiler, not the model.
 */

// --- The tree ----------------------------------------------------------------

export interface Sefirah {
  id: string;
  label: string; // shown when the sefirah is unmapped
  x: number; // 0-10 scene space (y up); classical three-pillar layout
  y: number;
  color: string; // role token: yellow=source, green=expansion, pink=restriction, cyan=mediation, gray=manifest
}

export const SEFIROT: Sefirah[] = [
  { id: "keter", label: "Keter", x: 5, y: 9.4, color: "yellow" },
  { id: "chochmah", label: "Chochmah", x: 7.4, y: 8.3, color: "green" },
  { id: "binah", label: "Binah", x: 2.6, y: 8.3, color: "pink" },
  { id: "chesed", label: "Chesed", x: 7.4, y: 6.3, color: "green" },
  { id: "gevurah", label: "Gevurah", x: 2.6, y: 6.3, color: "pink" },
  { id: "tiferet", label: "Tiferet", x: 5, y: 5.4, color: "cyan" },
  { id: "netzach", label: "Netzach", x: 7.4, y: 3.4, color: "green" },
  { id: "hod", label: "Hod", x: 2.6, y: 3.4, color: "pink" },
  { id: "yesod", label: "Yesod", x: 5, y: 3.0, color: "cyan" },
  { id: "malkhut", label: "Malkhut", x: 5, y: 0.75, color: "gray" },
];

const IDS = new Set(SEFIROT.map((s) => s.id));
const BY_ID = new Map(SEFIROT.map((s) => [s.id, s]));

/** The 22 classical paths, drawn as the dim skeleton of every tree video. */
export const PATHS: [string, string][] = [
  ["keter", "chochmah"], ["keter", "binah"], ["keter", "tiferet"],
  ["chochmah", "binah"], ["chochmah", "tiferet"], ["chochmah", "chesed"],
  ["binah", "tiferet"], ["binah", "gevurah"],
  ["chesed", "gevurah"], ["chesed", "tiferet"], ["chesed", "netzach"],
  ["gevurah", "tiferet"], ["gevurah", "hod"],
  ["tiferet", "netzach"], ["tiferet", "hod"], ["tiferet", "yesod"],
  ["netzach", "hod"], ["netzach", "yesod"], ["netzach", "malkhut"],
  ["hod", "yesod"], ["hod", "malkhut"],
  ["yesod", "malkhut"],
];

// Malkhut is "the many": a circle-region holding a small multitude, so
// severing and scattering the manifest world reads literally.
const MALKHUT_DOTS: [number, number][] = [
  [4.65, 0.55], [5.35, 0.55], [4.7, 0.95], [5.3, 0.95], [5.0, 0.4], [5.0, 1.1],
];

const OPS = ["emanate", "sever", "shatter", "husk", "contract", "swell", "repair", "reveal"] as const;
type Op = (typeof OPS)[number];

interface Dynamic {
  line: number;
  say: string;
  op: Op;
  from?: string;
  to?: string;
  at?: string;
  factor?: number;
}

// --- Parsing (lenient — invalid entries are dropped, gates catch the rest) ---

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseDynamics(v: unknown, codeLen: number): Dynamic[] {
  if (!Array.isArray(v)) return [];
  const out: Dynamic[] = [];
  for (const d of v as Record<string, unknown>[]) {
    if (!d || !OPS.includes(d.op as Op)) continue;
    const op = d.op as Op;
    const from = str(d.from);
    const to = str(d.to);
    const at = str(d.at);
    if ((op === "emanate" || op === "sever" || op === "repair") && (!IDS.has(from) || !IDS.has(to) || from === to)) continue;
    if ((op === "shatter" || op === "husk" || op === "contract" || op === "swell" || op === "reveal") && !IDS.has(at)) continue;
    out.push({
      line: Math.min(Math.max(1, Number(d.line) || 1), Math.max(1, codeLen)),
      say: str(d.say),
      op,
      from: from || undefined,
      to: to || undefined,
      at: at || undefined,
      factor: Number.isFinite(Number(d.factor)) ? Number(d.factor) : undefined,
    });
  }
  return out.slice(0, 24);
}

// --- The compiler ------------------------------------------------------------

/**
 * Compile a raw sefirot parse into a renderer-ready concept spec. Every
 * expansion uses only the existing geometric verbs; walkthrough.py never
 * learns the register exists.
 */
export function compileSefirotSpec(raw: Record<string, unknown>, topic: string): GeneratedSpec {
  const code = (Array.isArray(raw.code) ? (raw.code as unknown[]) : []).map((l) => String(l)).slice(0, 22);

  const mapping = new Map<string, string>(); // sefirah id -> element label
  if (Array.isArray(raw.mapping)) {
    for (const m of raw.mapping as Record<string, unknown>[]) {
      const sid = str(m?.sefirah).toLowerCase();
      const element = str(m?.element).slice(0, 22);
      if (IDS.has(sid) && element && !mapping.has(sid)) mapping.set(sid, element);
    }
  }
  const dynamics = parseDynamics(raw.dynamics, code.length);

  // Scene: all ten sefirot, always — mapped ones bright and named by the
  // concept, unmapped ones small and dim, so every video shows the same tree.
  const actors: ConceptActor[] = [];
  const zones: ConceptZone[] = [];
  for (const s of SEFIROT) {
    const mapped = mapping.has(s.id);
    if (s.id === "malkhut") {
      zones.push({
        id: s.id, x: s.x, y: s.y, w: 2.1, h: 2.1, shape: "circle",
        style: "open", color: mapped ? s.color : "gray",
        label: mapping.get(s.id) ?? s.label,
      });
      MALKHUT_DOTS.forEach(([x, y], i) => {
        actors.push({ id: `m${i + 1}`, x, y, kind: "dot", color: "gray", size: 0.8 });
      });
      continue;
    }
    actors.push({
      id: s.id, x: s.x, y: s.y, kind: "circle",
      color: mapped ? s.color : "gray",
      size: mapped ? 1.15 : 0.6,
      label: mapping.get(s.id) ?? s.label,
    });
  }
  const links: [string, string][] = PATHS.map(([a, b]) => [a, b]);

  // Dynamics expand to canned verb sequences (1-2 steps each).
  const steps: SpecStep[] = [];
  let sparkN = 0;
  const dissolved = new Set<string>();
  const alive = (id: string) => !dissolved.has(id);

  for (const d of dynamics) {
    const base: SpecStep = { line: d.line, say: d.say };
    switch (d.op) {
      case "emanate": {
        // Influx: a spark leaves the source and lodges at the receiver.
        if (!alive(d.from!) || !alive(d.to!)) break;
        const from = BY_ID.get(d.from!)!;
        const to = BY_ID.get(d.to!)!;
        sparkN += 1;
        const id = `spark${sparkN}`;
        const ring = (sparkN % 6) * (Math.PI / 3);
        steps.push({
          ...base,
          spawn: [{ id, x: from.x, y: from.y, kind: "dot", color: "yellow", size: 0.7 }],
          pulse: [d.from!],
        });
        steps.push({
          line: d.line,
          say: `The flow reaches ${mapping.get(d.to!) ?? to.label}.`,
          move: [[id, to.x + 0.55 * Math.cos(ring), to.y + 0.55 * Math.sin(ring)]],
        });
        break;
      }
      case "sever":
        steps.push({ ...base, unlink: [[d.from!, d.to!]], pulse: alive(d.to!) ? [d.to!] : undefined });
        break;
      case "shatter": {
        // Shevirat ha-kelim: the vessel breaks and its fragments disperse.
        if (d.at === "malkhut") {
          steps.push({ ...base, pulse: ["malkhut"] });
          steps.push({ line: d.line, say: "The manifest world disperses.", scatter: MALKHUT_DOTS.map((_, i) => `m${i + 1}`) });
          break;
        }
        if (!alive(d.at!)) break;
        const s = BY_ID.get(d.at!)!;
        dissolved.add(d.at!);
        const frags = [0, 1, 2].map((i) => `${d.at}_f${i + 1}`);
        steps.push({
          ...base,
          dissolve: [d.at!],
          spawn: frags.map((id, i) => ({
            id, x: s.x + [-0.3, 0.3, 0][i], y: s.y + [0.2, 0.2, -0.35][i],
            kind: "dot" as const, color: "pink", size: 0.7,
          })),
        });
        steps.push({ line: d.line, say: "Its fragments scatter.", scatter: frags });
        break;
      }
      case "husk":
        // Qlippah: the form persists, the life does not.
        if (d.at === "malkhut") {
          steps.push({ ...base, restyle: MALKHUT_DOTS.map((_, i) => ({ id: `m${i + 1}`, color: "gray" })) });
        } else if (alive(d.at!)) {
          steps.push({ ...base, restyle: [{ id: d.at!, color: "gray" }] });
        }
        break;
      case "contract":
        if (alive(d.at!) && d.at !== "malkhut") steps.push({ ...base, grow: [[d.at!, 0.55]] });
        else if (d.at === "malkhut") steps.push({ ...base, pulse: ["malkhut"] });
        break;
      case "swell": {
        const f = Math.max(1.1, Math.min(d.factor ?? 1.5, 2.2));
        if (alive(d.at!) && d.at !== "malkhut") steps.push({ ...base, grow: [[d.at!, f]] });
        break;
      }
      case "repair":
        if (!alive(d.from!) || !alive(d.to!)) break;
        steps.push({
          ...base,
          link: [[d.from!, d.to!]],
          restyle: d.to !== "malkhut" ? [{ id: d.to!, color: "green" }] : undefined,
        });
        break;
      case "reveal":
        if (alive(d.at!)) steps.push({ ...base, pulse: [d.at!] });
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
    viz: "concept",
    code,
    array: [],
    target: null,
    tradition: str(raw.tradition).slice(0, 120) || undefined,
    actors,
    zones,
    links,
    steps,
  };
}

// --- Prompt + schema for the parse ------------------------------------------

export const SEFIROT_SYSTEM_INSTRUCTION = `You translate abstract concepts from social theory, political economy and
philosophy into the grammar of the qabbalistic Tree of Life. You do NOT design
a scene and you do NOT write animation code — you output a PARSE: which
elements of the concept occupy which sefirot, and which tree-dynamics carry
the mechanism. A fixed compiler turns your parse into the video, so the same
role always appears in the same place and color. Your entire creative task is
the mapping — make it apt, not forced.

THE TEN SEFIROT (process-roles, not mystical claims — use them as a typology):
  keter      the unconditioned source; the premise everything flows from
  chochmah   the generative flash; raw impulse, drive, surplus
  binah      structuring intelligence; form, law, categories
  chesed     expansion, giving, open provision (a commons is chesed)
  gevurah    restriction, severity, judgment (enclosure, discipline, scarcity)
  tiferet    the mediating center that balances and gives coherence
  netzach    persistence, momentum, ambition
  hod        submission, communication, ritual form
  yesod      the channel of transmission into the manifest (markets, media)
  malkhut    the manifest many — rendered as a small multitude of persons

Pillars: chochmah/chesed/netzach expand (green); binah/gevurah/hod restrict
(pink); the middle pillar mediates (keter gold, tiferet/yesod cyan, malkhut
gray). Map 4-8 sefirot; unmapped ones stay as small dim placeholders.

COMMIT TO ONE ACCOUNT ("tradition", required): name the author and work whose
reading of the CONCEPT you animate, e.g. "Marx, Capital Vol. I, Part VIII
(1867)". The register is qabbalistic; the concept's account still needs naming.

THE ARGUMENT ("code", 5-10 lines): the numbered claims of the mechanism, in
causal order, each under 55 characters, plain prose. Dynamics point at the
argument line they animate.

DYNAMICS (10-18, each with "line", one spoken sentence "say", and an op):
  emanate {from, to}   influx flows from one sefirah to another
  sever   {from, to}   a path between two sefirot is cut
  shatter {at}         the vessel breaks; its fragments scatter (crisis)
  husk    {at}         the form persists but the life leaves it (dead form)
  contract {at}        the sefirah withdraws, diminishes
  swell   {at, factor} the sefirah grows by hoarding influx (1.1-2.2)
  repair  {from, to}   a severed connection is remade (tikkun)
  reveal  {at}         draw the eye; emphasize
"from"/"to"/"at" are sefirah ids. Reference only sefirot you mapped (middle
pillar placeholders may also carry flow). Tell the mechanism in tree-language:
where does the flow run at first, what cuts it, where does it pool, what is
left as husk.

MAPPING ("mapping"): [{sefirah, element}] — element is the concept's own word
for what sits there, under 22 characters (e.g. gevurah: "enclosure acts",
malkhut: "the peasantry").

WORKED EXAMPLE (abbreviated) — "primitive accumulation":
{"title":"Primitive Accumulation","tradition":"Marx, Capital Vol. I, Part VIII (1867)",
 "code":["Commons provision sustains the peasantry","Enclosure acts sever provision",
  "The dispossessed pass through the market","Capital pools from enclosed land"],
 "mapping":[{"sefirah":"chesed","element":"the commons"},{"sefirah":"gevurah","element":"enclosure acts"},
  {"sefirah":"yesod","element":"labor market"},{"sefirah":"malkhut","element":"the peasantry"},
  {"sefirah":"binah","element":"property law"}],
 "dynamics":[
  {"line":1,"say":"Provision flows from the commons to the peasantry.","op":"emanate","from":"chesed","to":"malkhut"},
  {"line":2,"say":"Enclosure, armed with law, asserts itself.","op":"reveal","at":"gevurah"},
  {"line":2,"say":"The tie between commons and peasantry is severed.","op":"sever","from":"chesed","to":"malkhut"},
  {"line":2,"say":"The commons empties into a dead form.","op":"husk","at":"chesed"},
  {"line":3,"say":"The manifest world is broken open.","op":"shatter","at":"malkhut"},
  {"line":3,"say":"What was severed re-routes through the market.","op":"repair","from":"yesod","to":"malkhut"},
  {"line":4,"say":"Severity swells on the hoarded influx.","op":"swell","at":"gevurah","factor":1.8}]}

Also give an overall "narration" (the say lines joined), a "title" and a
one-sentence "description". Return ONLY the JSON described by the schema.`;

export const SEFIROT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    narration: { type: "string" },
    tradition: { type: "string" },
    code: { type: "array", items: { type: "string" } },
    mapping: {
      type: "array",
      items: {
        type: "object",
        properties: { sefirah: { type: "string" }, element: { type: "string" } },
        required: ["sefirah", "element"],
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
          factor: { type: "number" },
        },
        required: ["line", "say", "op"],
      },
    },
  },
  required: ["title", "description", "narration", "tradition", "code", "mapping", "dynamics"],
} as const;
