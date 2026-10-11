"""Deterministic multi-structure walkthrough renderer (bundled with the app).

Reads spec.json and renders a synced animation where CODE, VISUALS and (optional)
VOICE stay locked together. The spec's `viz` field picks the drawing surface;
all surfaces share the same step clock, panel-line highlight, caption and
per-step `dur` (set by the audio pass) so narration lines up with the visuals.

  viz = "array"       -> bars (sorting / searching / two-pointer)
  viz = "graph"       -> nodes + edges (BFS/DFS/Dijkstra/topological sort)
  viz = "tree"        -> nodes + edges, auto tidy-laid-out from the edges
  viz = "grid"        -> 2-D cells (DP tables, matrices, grid pathfinding)
  viz = "table"       -> labeled comparison table (header row + row labels)
  viz = "map"         -> concept map (labeled pills + relation arrows)
  viz = "linkedlist"  -> boxes with next-arrows (list traversal / search)
  viz = "concept"     -> abstract-concept scene (actors / zones / links)

The LLM only ever produces DATA (never Manim code), so renders stay safe. Every
field is optional and every reference is checked: a bad id or index is skipped,
never a crash.

Shared per-step fields: line, say, dur, note (short callout), vars{name:value}
Array   : compare[], swap[i,j], set[[i,v]], range[lo,hi], sorted[], pointers{},
          highlight[] (legacy), array[] (legacy), found
Graph   : active[], visit[], edge[[u,v]], label{id:txt}, queue[], path[ids]
Grid    : gcompare[[r,c]], gset[[r,c,v]], gdone[[r,c]], gpath[[r,c]]
List    : compare[], set[[i,v]], pointers{name:index}, found
Concept : move[[id,x,y]], enter[[id,zone]], scatter[], link/unlink[[a,b]],
          enclose[], dissolve[], spawn[actors], grow[[id,f]], restyle[], pulse[]
"""

import json
import zlib
import numpy as np
from manim import *
from pygments import lex
from pygments.lexers import get_lexer_by_name
from pygments.token import Keyword, Name, String, Number, Comment, Operator

THEMES = {
    "8bit": dict(
        bg="#12142b", panel="#1e2140", text="#eef0ff", dim="#8a8fc7",
        accent="#ffd23f", accent2="#00e5ff", good="#39d98a", edge="#0a0c1c",
        line="#4b5199", cell="#2a2f5e", compare="#00e5ff", swap="#ff5d8f", rng="#3a3f78",
        c_kw="#ffd23f", c_fn="#00e5ff", c_str="#39d98a", c_num="#ff9f1c",
        c_com="#8a8fc7", c_op="#ff5d8f", c_def="#eef0ff", pixel=True, path="#ffd23f",
    ),
    "ink": dict(
        bg="#0f1216", panel="#151a21", text="#e8eaed", dim="#8a92a0",
        accent="#5b7cfa", accent2="#82aaff", good="#34d399", edge="#2a313c",
        line="#3e4859", cell="#1b2028", compare="#82aaff", swap="#f0709a", rng="#232a36",
        c_kw="#c792ea", c_fn="#82aaff", c_str="#c3e88d", c_num="#f78c6c",
        c_com="#676e95", c_op="#89ddff", c_def="#e8eaed", pixel=False, path="#ffcb6b",
    ),
    "slate": dict(
        bg="#12161c", panel="#171d25", text="#e9edf1", dim="#93a0ad",
        accent="#22c58b", accent2="#7cc4ff", good="#34d399", edge="#2a313c",
        line="#3c4857", cell="#0d1116", compare="#7cc4ff", swap="#f0709a", rng="#1c242e",
        c_kw="#7cc4ff", c_fn="#22c58b", c_str="#a5e887", c_num="#f4b740",
        c_com="#5f6b7a", c_op="#c7d0da", c_def="#e9edf1", pixel=False, path="#f4b740",
    ),
    # Scholarly: serif type on black, gold accents. The code panel stays
    # monospace regardless of theme (its per-character layout needs it).
    "manuscript": dict(
        bg="#000000", panel="#0d0d0d", text="#f5f0e6", dim="#8f887a",
        accent="#d4af37", accent2="#9db4d4", good="#7fb069", edge="#1f1f1f",
        line="#4a4537", cell="#141414", compare="#9db4d4", swap="#c96a6a", rng="#1e1a14",
        c_kw="#d4af37", c_fn="#9db4d4", c_str="#7fb069", c_num="#d99a4e",
        c_com="#6b6558", c_op="#c96a6a", c_def="#f5f0e6", pixel=False, path="#e8c547",
        font="Times New Roman",
    ),
}


def _raise_encoder_quality():
    """Manim encodes every clip with libx264 at a hard-coded crf 23, which
    smears thin text and line edges. Wrap the `av` module its file writer uses
    so new H.264 streams get crf 16 + the "animation" tune instead. Best
    effort: any surprise in Manim's internals leaves the default untouched."""
    try:
        import av as _av
        from manim.scene import scene_file_writer as _sfw

        class _Container:
            def __init__(self, c):
                self._c = c

            def add_stream(self, codec_name=None, rate=None, options=None, **kw):
                if codec_name == "libx264":
                    options = dict(options or {})
                    options["crf"] = "16"
                    options.setdefault("preset", "medium")
                    options.setdefault("tune", "animation")
                return self._c.add_stream(codec_name, rate=rate, options=options, **kw)

            def __getattr__(self, name):
                return getattr(self._c, name)

            def __enter__(self):
                self._c.__enter__()
                return self

            def __exit__(self, *a):
                return self._c.__exit__(*a)

        class _AvProxy:
            def __getattr__(self, name):
                return getattr(_av, name)

            @staticmethod
            def open(*a, **kw):
                c = _av.open(*a, **kw)
                return _Container(c) if kw.get("mode") == "w" or (len(a) > 1 and a[1] == "w") else c

        if getattr(_sfw, "av", None) is _av:
            _sfw.av = _AvProxy()
    except Exception:
        pass


_raise_encoder_quality()

SPEC = json.load(open("spec.json", "r", encoding="utf-8"))
if not isinstance(SPEC, dict):
    SPEC = {}
# Shape guards: the surfaces below trust these container types.
SPEC["steps"] = [s for s in (SPEC.get("steps") or []) if isinstance(s, dict)] if isinstance(SPEC.get("steps"), list) else []
for _k in ("code", "array", "nodes", "edges", "grid", "table", "actors", "zones", "links"):
    if not isinstance(SPEC.get(_k), list):
        SPEC[_k] = []
SPEC["code"] = ["" if c is None else str(c) for c in SPEC["code"]]
for _s in SPEC["steps"]:
    for _k in ("pointers", "label", "vars"):
        if _k in _s and not isinstance(_s[_k], dict):
            _s.pop(_k)
TH = THEMES.get(SPEC.get("theme", "8bit"), THEMES["8bit"])
VIZ = SPEC.get("viz", "array")
# How the left panel is presented:
#   "code"    – syntax-highlighted source (algorithms)
#   "concept" – plain prose points, numbered (concepts, philosophy, history, math)
#   "visual"  – no panel; the visualization fills the frame
MODE = SPEC.get("mode", "code")
PORTRAIT = SPEC.get("orientation") == "portrait"
SHOW_CAPTIONS = bool(SPEC.get("captions", True))
INTRO_SECONDS = 2.2  # must match narration.ts

# Pixel size follows the requested quality (vector shapes scale for free); the
# frame rate comes from manim's -ql/-qm/-qh flag.
_RES = {"l": (1280, 720), "m": (1920, 1080), "h": (2560, 1440)}
_pw, _ph = _RES.get(SPEC.get("quality", "m"), _RES["m"])
config.background_color = TH["bg"]
if PORTRAIT:
    config.pixel_width, config.pixel_height = _ph, _pw
    config.frame_height, config.frame_width = 14.22, 8.0
else:
    config.pixel_width, config.pixel_height = _pw, _ph
    config.frame_height, config.frame_width = 8.0, 14.22
FW, FH = config.frame_width, config.frame_height

FONT = "Monospace"
# Display font for titles, captions and concept labels. Code panels and
# data-structure text stay monospace (their column layout depends on it).
TFONT = TH.get("font", FONT)


def T(s, font_size=24, **kw):
    """Text rendered at ~64pt and scaled to font_size: Pango's hinting at small
    sizes gives uneven letter spacing ("Gr oundwor k"). Not larger than that —
    Pango's fixed layout width would start wrapping long lines."""
    k = max(1.0, 64.0 / max(float(font_size), 1.0))
    return Text(s, font_size=font_size * k, **kw).scale(1.0 / k)


def tok_color(t):
    if t in Comment: return TH["c_com"]
    if t in Keyword: return TH["c_kw"]
    if t in String: return TH["c_str"]
    if t in Number: return TH["c_num"]
    if t in Name.Builtin or t in Name.Function or t in Name.Class: return TH["c_fn"]
    if t in Operator: return TH["c_op"]
    return TH["c_def"]


def say_time(text):
    return max(1.2, min(5.0, len(text or "") / 13.5))


def step_dur(step):
    try:
        if step.get("dur") is not None:
            return max(0.4, float(step["dur"]))
    except (TypeError, ValueError):
        pass
    return say_time(step.get("say") or step.get("caption"))


# ----------------------------------------------------------------- helpers ----
def _int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default


def wrap_text(s, limit):
    """Greedy word wrap to lines of at most `limit` characters."""
    words = str(s or "").split()
    if not words:
        return ""
    lines, cur = [], words[0]
    for w in words[1:]:
        if len(cur) + 1 + len(w) <= limit:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return "\n".join(lines)


def balance2(s, limit):
    """Split a label over two balanced lines when it is longer than `limit`."""
    s = str(s)
    if len(s) <= limit or " " not in s:
        return s
    words = s.split()
    best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        score = max(len(a), len(b))
        if best is None or score < best[0]:
            best = (score, a + "\n" + b)
    return best[1]


def fit_text(t, max_w, max_h=None):
    """Scale a mobject down (never up) to fit max_w x max_h."""
    sc = 1.0
    if t.width > max_w:
        sc = min(sc, max_w / t.width)
    if max_h is not None and t.height > max_h:
        sc = min(sc, max_h / t.height)
    if sc < 1.0:
        t.scale(sc)
    return t


def pill(text_mob, th, stroke=None, fill=None, pad_x=0.18, pad_y=0.10, radius=0.10, opacity=0.92):
    bg = RoundedRectangle(corner_radius=radius, width=text_mob.width + pad_x * 2,
                          height=text_mob.height + pad_y * 2, stroke_width=2 if stroke else 0,
                          stroke_color=stroke or th["edge"], fill_color=fill or th["panel"],
                          fill_opacity=opacity)
    bg.move_to(text_mob)
    return VGroup(bg, text_mob)


def _out_first(t):
    return smooth(min(1.0, t / 0.45))


def _in_second(t):
    return smooth(max(0.0, (t - 0.4) / 0.6))


def swap(old, new):
    """Animations replacing `old` with `new` at the same place, without overlap."""
    out = []
    if old is not None and len(old.submobjects) + (1 if old.points.size else 0) > 0:
        out.append(FadeOut(old, rate_func=_out_first))
    if new is not None:
        out.append(FadeIn(new, rate_func=_in_second))
    return out


def name_color(name, th):
    """Stable, distinct color per pointer/variable name."""
    palette = [th["accent"], th["accent2"], th["swap"], th["good"], th["c_num"]]
    common = {"i": 0, "j": 2, "k": 3, "lo": 1, "left": 1, "l": 1, "hi": 2, "right": 2, "r": 2,
              "mid": 0, "m": 0, "cur": 0, "p": 0, "slow": 1, "fast": 2, "prev": 3}
    key = str(name).lower()
    if key in common:
        return palette[common[key]]
    return palette[zlib.crc32(key.encode()) % len(palette)]


def _ptr(name, color, above=False):
    """Pointer marker whose arrowhead points at its target: below the target it
    points up (label underneath); above the target it points down."""
    tri = Triangle(fill_color=color, fill_opacity=1, stroke_width=0).scale(0.11)
    lbl = T(str(name), font=FONT, font_size=15, color=color)
    if above:
        tri.rotate(PI)
        return VGroup(lbl, tri).arrange(DOWN, buff=0.05)
    return VGroup(tri, lbl).arrange(DOWN, buff=0.05)


def _seg_hits_rect(p, q, rect, shrink=0.0):
    """Whether segment p->q passes through an axis-aligned rect (x0,y0,x1,y1)."""
    x0, y0, x1, y1 = rect[0] + shrink, rect[1] + shrink, rect[2] - shrink, rect[3] - shrink
    if x1 <= x0 or y1 <= y0:
        return False
    for k in range(1, 40):
        t = k / 40.0
        x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
        if x0 < x < x1 and y0 < y < y1:
            return True
    return False


def _rect_exit(center, half_w, half_h, toward):
    """Point where the ray center->toward leaves a rect of the given half-size."""
    d = np.array(toward, dtype=float) - np.array(center, dtype=float)
    d[2] = 0
    if np.linalg.norm(d[:2]) < 1e-6:
        return np.array(center, dtype=float)
    tx = half_w / abs(d[0]) if abs(d[0]) > 1e-9 else 1e9
    ty = half_h / abs(d[1]) if abs(d[1]) > 1e-9 else 1e9
    return np.array(center, dtype=float) + d * min(tx, ty, 1.0)


def relax(pos, min_dist, iters=200):
    """Push points apart until every pair is at least min_dist apart."""
    ids = list(pos.keys())
    for _ in range(iters):
        moved = False
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                pa, pb = pos[ids[a]], pos[ids[b]]
                d = pb - pa
                dist = float(np.linalg.norm(d[:2]))
                if dist < min_dist:
                    moved = True
                    if dist < 1e-6:
                        ang = (zlib.crc32(f"{ids[a]}|{ids[b]}".encode()) % 360) * PI / 180
                        d = np.array([np.cos(ang), np.sin(ang), 0.0])
                        dist = 1.0
                    push = (min_dist - dist) / 2 + 1e-3
                    u = d / dist
                    pos[ids[a]] = pa - u * push
                    pos[ids[b]] = pb + u * push
        if not moved:
            break
    return pos


def fit_points(raw, box, margin=(0.0, 0.0)):
    """Map raw {id: (x, y)} linearly into box=(cx,cy,w,h) (independent axes)."""
    cx, cy, w, h = box
    w, h = max(0.5, w - margin[0] * 2), max(0.5, h - margin[1] * 2)
    xs = [p[0] for p in raw.values()] or [0]
    ys = [p[1] for p in raw.values()] or [0]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    out = {}
    for k, (x, y) in raw.items():
        fx = (x - minx) / (maxx - minx) if maxx > minx else 0.5
        fy = (y - miny) / (maxy - miny) if maxy > miny else 0.5
        out[k] = np.array([cx + (fx - 0.5) * w, cy + (fy - 0.5) * h, 0.0])
    return out


def tree_layout(nodes, edges):
    """Tidy layered layout for a tree: in-order x, depth y. Children are ordered
    by the model's x (so a BST's left/right child stays on the right side), and a
    child left of its parent is placed before it in the in-order walk. Returns
    {id: (x, y)} or None if the edges don't form a tree/forest."""
    ids = list(nodes.keys())
    children = {i: [] for i in ids}
    parent = {}
    for e in edges:
        u, v = str(e[0]), str(e[1])
        if u not in children or v not in children or u == v or v in parent:
            continue
        # Guard against cycles: skip an edge that would make v an ancestor of u.
        a, cyc = u, False
        while a in parent:
            a = parent[a]
            if a == v:
                cyc = True
                break
        if cyc or a == v:
            continue
        parent[v] = u
        children[u].append(v)
    roots = [i for i in ids if i not in parent]
    if not roots or len(roots) > max(1, len(ids) // 3):
        return None
    mx = {i: float(nodes[i].get("x", 0) or 0) for i in ids}
    for i in ids:
        children[i].sort(key=lambda c: mx[c])
    out, counter = {}, [0]

    if max(len(c) for c in children.values()) > 2:
        def place(n, depth):
            kids = children[n]
            if not kids:
                out[n] = (float(counter[0]), -float(depth))
                counter[0] += 1
                return
            for c in kids:
                place(c, depth + 1)
            out[n] = ((out[kids[0]][0] + out[kids[-1]][0]) / 2.0, -float(depth))

        for r in sorted(roots, key=lambda r: mx[r]):
            place(r, 0)
            counter[0] += 1
        return out

    def walk(n, depth):
        kids = children[n]
        left = [c for c in kids if mx[c] < mx[n]]
        right = [c for c in kids if mx[c] >= mx[n]]
        if not left and len(right) >= 2:  # model gave no side info: split evenly
            half = len(right) // 2
            left, right = right[:half], right[half:]
        for c in left:
            walk(c, depth + 1)
        out[n] = (float(counter[0]), -float(depth))
        counter[0] += 1
        for c in right:
            walk(c, depth + 1)

    for r in sorted(roots, key=lambda r: mx[r]):
        walk(r, 0)
        counter[0] += 1  # gap between trees of a forest
    return out


# ---------------------------------------------------------------- surfaces ----
class ArraySurface:
    """Bars whose height is the value; state colors, pointers, swap arcs."""

    def __init__(self, th, box):
        self.th = th
        self.box = box
        self.values = [_int(v, 0) for v in SPEC.get("array", [])][:12]
        self.sorted_set = set()
        steps = SPEC.get("steps", [])
        # Scale bars to every value the video will ever show, not just the
        # initial array, so later writes never overflow the region.
        allv = list(self.values)
        for s in steps:
            for pr in s.get("set") or []:
                if isinstance(pr, (list, tuple)) and len(pr) >= 2 and _int(pr[1]) is not None:
                    allv.append(_int(pr[1]))
            if isinstance(s.get("array"), list):
                allv += [_int(v, 0) for v in s["array"]]
        self.lo = min([0] + allv)
        self.hi = max([1] + allv)
        # rows of pointers needed: the most pointers ever sharing one index
        self.ptr_rows = 1
        for s in steps:
            p = s.get("pointers") or {}
            if isinstance(p, dict) and p:
                cnt = {}
                for v in p.values():
                    k = _int(v)
                    cnt[k] = cnt.get(k, 0) + 1
                self.ptr_rows = max(self.ptr_rows, max(cnt.values()))
        self.ptr_rows = min(self.ptr_rows, 3)
        self.has_ptrs = any(s.get("pointers") for s in steps)
        self.has_range = any(s.get("range") for s in steps)

    def build(self, scene):
        th = self.th
        vals = self.values
        n = len(vals)
        cx, cy, w, h = self.box
        stroke = 4 if th["pixel"] else 3
        self.stroke = stroke
        below = 0.42 + (0.30 if self.has_range else 0) + (0.42 * self.ptr_rows if self.has_ptrs else 0)
        self.baseline_y = cy - h / 2 + below
        self.max_bar_h = max(1.0, h - below - 0.45)
        col_w = min(1.05, w / max(n, 1))
        self.col_w = col_w
        self.bar_w = col_w * 0.70
        self.fs = int(max(13, min(22, col_w * 24)))

        def slot_x(i):
            return cx + (i - (n - 1) / 2) * col_w
        self.slot_x = slot_x

        self.elems = [self.make_elem(v, i, "idle") for i, v in enumerate(vals)]
        self.cur = list(vals)
        self.bars = VGroup(*self.elems)
        self.idxs = VGroup(*[T(str(i), font=FONT, font_size=14, color=th["dim"])
                             .move_to([slot_x(i), self.baseline_y - 0.22, 0]) for i in range(n)])
        self.base = Line([slot_x(0) - col_w / 2, self.baseline_y, 0],
                         [slot_x(n - 1) + col_w / 2, self.baseline_y, 0],
                         stroke_width=2, color=th["line"]) if n else VGroup()
        self.range_marker = Line([0, 0, 0], [0, 0, 0], stroke_width=0)
        self.pointers, self.active_ptrs = {}, set()
        scene.play(LaggedStart(*[GrowFromEdge(e, DOWN) for e in self.elems], lag_ratio=0.06),
                   FadeIn(self.idxs), *([Create(self.base)] if n else []), run_time=0.7)
        scene.add(self.range_marker)

    def _style(self, state):
        th, s = self.th, self.stroke
        return {
            "idle": (th["line"], s, th["cell"], 1.0),
            "range": (th["accent2"], s, th["rng"], 1.0),
            "out": (th["line"], s, th["cell"], 1.0),
            "compare": (th["compare"], s + 1, th["compare"], 0.38),
            "swap": (th["swap"], s + 1, th["swap"], 0.40),
            "set": (th["swap"], s + 1, th["swap"], 0.40),
            "sorted": (th["good"], s + 1, th["good"], 0.36),
        }[state]

    def make_elem(self, val, i, state, faded=False):
        th = self.th
        sc, sw, fc, fo = self._style(state)
        frac = (val - self.lo) / max(self.hi - self.lo, 1)
        bh = 0.30 + frac * self.max_bar_h
        bar = Rectangle(width=self.bar_w, height=bh, stroke_width=sw, stroke_color=sc,
                        fill_color=fc, fill_opacity=fo)
        bar.move_to([self.slot_x(i), self.baseline_y + bh / 2, 0])
        num = T(str(val), font=FONT, font_size=self.fs, color=th["text"])
        fit_text(num, self.col_w * 0.95)
        num.next_to(bar, UP, buff=0.08)
        g = VGroup(bar, num)
        if faded:
            g.set_opacity(0.35)
            bar.set_fill(opacity=fo * 0.35)
        return g

    def _range_target(self, lo, hi):
        n = len(self.values)
        lo = max(0, min(lo, n)); hi = max(0, min(hi, n))
        if hi <= lo:
            return Line([0, 0, 0], [0, 0, 0], stroke_width=0)
        x0 = self.slot_x(lo) - self.col_w / 2 + 0.05
        x1 = self.slot_x(hi - 1) + self.col_w / 2 - 0.05
        y = self.baseline_y - 0.48
        return Line([x0, y, 0], [x1, y, 0], stroke_width=6, color=self.th["accent2"])

    def apply(self, step):
        th, anims, n = self.th, [], len(self.values)
        for s in step.get("sorted", []) or []:
            if _int(s) is not None:
                self.sorted_set.add(_int(s))
        if _int(step.get("found")) is not None:
            self.sorted_set.add(_int(step["found"]))
        rng = step.get("range")
        rng = [_int(rng[0], 0), _int(rng[1], 0)] if isinstance(rng, (list, tuple)) and len(rng) == 2 else None
        in_range = set(range(rng[0], rng[1])) if rng else None
        compare = {_int(c) for c in (step.get("compare") or step.get("highlight") or [])}
        swap = step.get("swap")
        swap = [_int(swap[0]), _int(swap[1])] if isinstance(swap, (list, tuple)) and len(swap) == 2 else None
        setops = []
        if step.get("set"):
            for pr in step["set"]:
                if isinstance(pr, (list, tuple)) and len(pr) >= 2 and _int(pr[0]) is not None and _int(pr[1]) is not None:
                    setops.append((_int(pr[0]), _int(pr[1])))
        elif isinstance(step.get("array"), list):
            for i, v in enumerate(step["array"][:n]):
                if i < len(self.cur) and _int(v, 0) != self.cur[i]:
                    setops.append((i, _int(v, 0)))
        newv = {i: v for i, v in setops if 0 <= i < n}
        anims.append(self.range_marker.animate.become(self._range_target(*rng)) if rng
                     else self.range_marker.animate.set_opacity(0))
        for slot in range(n):
            if slot in self.sorted_set:
                state = "sorted"
            elif slot in newv:
                state = "set"
            elif swap and slot in swap:
                state = "swap"
            elif slot in compare:
                state = "compare"
            elif in_range is not None and slot in in_range:
                state = "range"
            else:
                state = "idle"
            faded = in_range is not None and slot not in in_range and state in ("idle", "sorted")
            elem = self.elems[slot]
            if slot in newv:
                # One Transform per element (bar + label move together) — never
                # a second animation on its children in the same play().
                anims.append(Transform(elem, self.make_elem(newv[slot], slot, state, faded)))
                self.cur[slot] = newv[slot]
            else:
                sc, sw, fc, fo = self._style(state)
                op = 0.35 if faded else 1.0
                anims.append(elem[0].animate.set_stroke(sc, sw, opacity=op).set_fill(fc, fo * op))
                anims.append(elem[1].animate.set_opacity(op))
        wanted = step.get("pointers", {}) or {}
        if not isinstance(wanted, dict):
            wanted = {}
        wanted = {str(k): _int(v) for k, v in wanted.items() if _int(v) is not None}
        row_at = {}
        for name, i in wanted.items():
            i = max(0, min(i, max(0, n - 1)))
            row = row_at.get(i, 0)
            row_at[i] = row + 1
            y = self.baseline_y - 0.42 - (0.30 if self.has_range else 0) - 0.22 - min(row, self.ptr_rows - 1) * 0.42
            pos = [self.slot_x(i), y, 0]
            if name in self.pointers:
                anims.append(self.pointers[name].animate.move_to(pos).set_opacity(1))
            else:
                p = _ptr(name, name_color(name, th))
                p.move_to(pos)
                self.pointers[name] = p
                anims.append(FadeIn(p, shift=UP * 0.1))
            self.active_ptrs.add(name)
        for name in list(self.active_ptrs):
            if name not in wanted:
                anims.append(self.pointers[name].animate.set_opacity(0))
                self.active_ptrs.discard(name)
        return anims

    def extra(self, scene, step, dur, used):
        swap = step.get("swap")
        if isinstance(swap, (list, tuple)) and len(swap) == 2:
            a, b = _int(swap[0]), _int(swap[1])
            n = len(self.values)
            if a is not None and b is not None and 0 <= a < n and 0 <= b < n and a != b:
                dx = self.slot_x(b) - self.slot_x(a)
                rt = min(0.7, max(0.3, dur * 0.35))
                # Arc the two bars past each other (one over, one under).
                scene.play(self.elems[a].animate(path_arc=-PI / 2.2).shift(RIGHT * dx),
                           self.elems[b].animate(path_arc=-PI / 2.2).shift(LEFT * dx), run_time=rt)
                self.elems[a], self.elems[b] = self.elems[b], self.elems[a]
                self.cur[a], self.cur[b] = self.cur[b], self.cur[a]
                used += rt
        return used


class GraphSurface:
    """Nodes + edges. Trees get an automatic tidy layout; graphs keep the
    model's coordinates but are spread apart so nodes never collide. Short ids
    draw as circles; word labels ("Summary", "Cluster 0") draw as pills sized to
    their text. Edges stop at the node boundary, carry arrowheads when the graph
    is directed, and stay tinted once traversed. Per-step annotations are placed
    in the first free slot around their node, so they never pile up."""

    LABEL_MAX = 14

    def __init__(self, th, box, tree=False):
        self.th = th
        self.box = box
        self.tree = tree
        self.nodes = {}
        for nd in SPEC.get("nodes", []) or []:
            if isinstance(nd, dict) and nd.get("id") is not None:
                self.nodes[str(nd["id"])] = nd
        self.edges = [e for e in (SPEC.get("edges", []) or [])
                      if isinstance(e, (list, tuple)) and len(e) >= 2
                      and str(e[0]) in self.nodes and str(e[1]) in self.nodes and str(e[0]) != str(e[1])]
        self.directed = bool(SPEC.get("directed", False))
        self.visited, self.used, self.labels = set(), set(), {}
        self.halos, self.path_nodes, self.path_edges = [], set(), set()
        steps = SPEC.get("steps", [])
        self.use_queue = any("queue" in s and s.get("queue") is not None for s in steps)
        self.queue_label = str(SPEC.get("queueLabel") or "queue")[:12]
        self.texts = {k: str(nd.get("label") or k)[:self.LABEL_MAX] for k, nd in self.nodes.items()}
        self.pills = any(len(t) > 3 for t in self.texts.values())
        self.has_labels = any(s.get("label") for s in steps)

    # ---- layout -----------------------------------------------------------
    def _raw_positions(self):
        raw = tree_layout(self.nodes, self.edges) if self.tree else None
        if raw is not None:
            return raw
        raw = {k: (float(nd.get("x", 0) or 0), float(nd.get("y", 0) or 0)) for k, nd in self.nodes.items()}
        xs = {round(p[0], 3) for p in raw.values()}
        ys = {round(p[1], 3) for p in raw.values()}
        if len(raw) > 4 and (len(xs) == 1 or len(ys) == 1):
            ids = list(raw.keys())  # collinear coordinates: use a circle
            return {k: (np.cos(2 * PI * j / len(ids)), np.sin(2 * PI * j / len(ids))) for j, k in enumerate(ids)}
        if self.tree and len(ys) >= 2:
            # No usable edges, so trust the coordinates — but a tree's root row
            # is its smallest; if that row is at the bottom, the model meant y
            # downward. Flip so the root sits on top.
            rows = {}
            for p in raw.values():
                rows.setdefault(round(p[1], 3), 0)
                rows[round(p[1], 3)] += 1
            lo, hi = min(rows), max(rows)
            if rows[lo] < rows[hi]:
                raw = {k: (p[0], -p[1]) for k, p in raw.items()}
        return raw

    def _layout(self):
        cx, cy, w, h = self.box
        qh = 0.75 if self.use_queue else 0.0
        top_pad = 0.35 if self.has_labels else 0.0  # room for annotations above the top row
        self.core = (cx, cy + qh / 2 - top_pad / 2, w, h - qh - top_pad)
        raw = self._raw_positions()
        n = max(1, len(raw))
        # Size the node shape first (pills are as wide as their text).
        fs = 19 if n <= 8 else (17 if n <= 12 else 15)
        probes = {k: T(t, font=FONT, font_size=fs) for k, t in self.texts.items()}
        if self.pills:
            nh = max(p.height for p in probes.values()) + 0.30
            nw = {k: max(nh * 1.3, p.width + 0.36) for k, p in probes.items()}
        else:
            nh = 0.72 if n <= 8 else (0.62 if n <= 12 else 0.52)
            nw = {k: nh for k in probes}
        maxw = max(nw.values()) if nw else nh
        # Shrink everything if the widest row can't fit side by side.
        rows = {}
        for k, p in raw.items():
            rows.setdefault(round(p[1], 3), []).append(k)
        widest = max((sum(nw[k] for k in ks) + 0.35 * (len(ks) - 1)) for ks in rows.values()) if rows else maxw
        sc = min(1.0, (self.core[2] - 0.2) / max(widest, 1e-3))
        self.fs = fs * sc
        self.nh = nh * sc
        self.nw = {k: v * sc for k, v in nw.items()}
        maxw *= sc
        box = self.core
        levels = len(rows)
        if self.tree and levels >= 2:
            # Don't stretch a shallow tree over the whole height: cap the gap
            # between levels so edges stay short and the tree reads as a unit.
            span = min(self.core[3], (levels - 1) * 1.55 + self.nh + 0.3)
            box = (self.core[0], self.core[1], self.core[2], span)
        pos = fit_points(raw, box, margin=(maxw / 2 + 0.05, self.nh / 2 + 0.1))
        if self.tree:
            pos = self._spread_rows(pos)
        else:
            pos = relax(pos, max(self.nh, maxw * 0.9) + 0.3)
            if len(pos) > 1:
                pos = fit_points({k: (p[0], p[1]) for k, p in pos.items()}, box, margin=(maxw / 2 + 0.05, self.nh / 2 + 0.1))
        if not self.pills and len(pos) > 1:
            mind = min(np.linalg.norm((pos[a] - pos[b])[:2]) for a in pos for b in pos if a < b)
            d = max(0.42, min(0.92, mind * 0.62))  # circles grow into generous spacing
            self.nh = d
            self.nw = {k: d for k in pos}
        return pos

    def _spread_rows(self, pos):
        """Push same-level nodes apart until neighbours have a clear gap, then
        squeeze horizontally (about the center) if the level got too wide."""
        cx, w = self.core[0], self.core[2]
        rows = {}
        for k, p in pos.items():
            rows.setdefault(round(p[1], 2), []).append(k)
        gap = 0.36
        for ks in rows.values():
            ks.sort(key=lambda k: pos[k][0])
            for _ in range(50):
                moved = False
                for a, b in zip(ks, ks[1:]):
                    need = (self.nw[a] + self.nw[b]) / 2 + gap
                    have = pos[b][0] - pos[a][0]
                    if have < need - 1e-3:
                        push = (need - have) / 2
                        pos[a] = pos[a] + np.array([-push, 0, 0])
                        pos[b] = pos[b] + np.array([push, 0, 0])
                        moved = True
                if not moved:
                    break
        xs0 = [pos[k][0] - self.nw[k] / 2 for k in pos]
        xs1 = [pos[k][0] + self.nw[k] / 2 for k in pos]
        lo, hi = min(xs0), max(xs1)
        mid = (lo + hi) / 2
        sc = min(1.0, (w - 0.1) / max(hi - lo, 1e-3))
        for k in pos:
            pos[k] = np.array([cx + (pos[k][0] - mid) * sc, pos[k][1], 0.0])
        return pos

    def _boundary(self, nid, toward, pad=0.0):
        c = self.pos[nid]
        if self.pills:
            return _rect_exit(c, self.nw[nid] / 2 + pad, self.nh / 2 + pad, toward)
        d = np.array(toward, dtype=float) - c
        L = np.linalg.norm(d[:2])
        return c if L < 1e-6 else c + d / L * (self.nh / 2 + pad)

    def _shape(self, nid):
        th = self.th
        if self.pills:
            m = RoundedRectangle(corner_radius=min(0.22, self.nh / 2), width=self.nw[nid], height=self.nh)
        else:
            m = Circle(radius=self.nh / 2)
        return m.set_stroke(th["accent2"], 4).set_fill(th["cell"], 1).move_to(self.pos[nid]).set_z_index(2)

    def _edge_mob(self, u, v, color, width, opacity=1.0):
        a = self._boundary(u, self.pos[v], 0.02)
        b = self._boundary(v, self.pos[u], 0.04)
        if np.linalg.norm((b - a)[:2]) < 0.05:
            return Line(a, a + RIGHT * 0.01, stroke_width=0)
        if self.directed:
            m = Arrow(a, b, buff=0, stroke_width=width, color=color, tip_length=0.18,
                      max_tip_length_to_length_ratio=0.35, max_stroke_width_to_length_ratio=40)
            m.tip.set_fill(color, opacity=opacity)
        else:
            m = Line(a, b, stroke_width=width, color=color)
        m.set_stroke(opacity=opacity)
        return m.set_z_index(0)

    # ---- build ------------------------------------------------------------
    def build(self, scene):
        th = self.th
        self.pos = self._layout()
        self.edge_mobs = {}
        egrp, wgrp = VGroup(), VGroup()
        for e in self.edges:
            u, v = str(e[0]), str(e[1])
            if (u, v) in self.edge_mobs or (not self.directed and (v, u) in self.edge_mobs):
                continue
            m = self._edge_mob(u, v, th["line"], 3.5)
            self.edge_mobs[(u, v)] = m
            egrp.add(m)
            if len(e) > 2 and str(e[2]).strip():
                mid = (self.pos[u] + self.pos[v]) / 2
                d = self.pos[v] - self.pos[u]
                nrm = np.array([-d[1], d[0], 0.0])
                nrm = nrm / (np.linalg.norm(nrm[:2]) or 1)
                if nrm[1] < 0:
                    nrm = -nrm
                lab = T(str(e[2])[:8], font=FONT, font_size=15, color=th["dim"])
                wgrp.add(pill(lab, th, fill=th["bg"], pad_x=0.06, pad_y=0.03, radius=0.06).move_to(mid + nrm * 0.2).set_z_index(1))
        self.ncirc, self.ntext = {}, {}
        texts = {k: T(t, font=FONT, font_size=self.fs, color=th["text"]) for k, t in self.texts.items()}
        if texts:
            # One glyph size on every node: the most-shrunk label sets it.
            smin = min(min(1.0, (self.nw[k] - 0.16) / max(t.width, 1e-6), (self.nh - 0.12) / max(t.height, 1e-6))
                       for k, t in texts.items())
            for t in texts.values():
                t.scale(smin)
        for nid in self.nodes:
            self.ncirc[nid] = self._shape(nid)
            self.ntext[nid] = texts[nid].move_to(self.pos[nid]).set_z_index(3)
        cx, cy, w, h = self.box
        self.queue_y = cy - h / 2 + 0.32
        self.queue_row = self._build_queue([])
        scene.play(LaggedStart(*[GrowFromCenter(self.ncirc[n]) for n in self.nodes], lag_ratio=0.05),
                   *[FadeIn(t) for t in self.ntext.values()], run_time=0.5)
        scene.play(Create(egrp), FadeIn(wgrp), *([FadeIn(self.queue_row)] if self.use_queue else []), run_time=0.4)

    def _build_queue(self, items):
        th = self.th
        g = VGroup(T(self.queue_label + ":", font=FONT, font_size=17, color=th["dim"]))
        for it in list(items)[:10]:
            t = T(str(it)[:8], font=FONT, font_size=18, color=th["text"])
            box = RoundedRectangle(corner_radius=0.06, width=max(0.5, t.width + 0.22), height=0.5, stroke_width=3,
                                   stroke_color=th["accent"], fill_color=th["panel"], fill_opacity=1)
            g.add(VGroup(box, t.move_to(box)))
        g.arrange(RIGHT, buff=0.14)
        if len(g) == 1:
            g.add(T("(empty)", font=FONT, font_size=15, color=th["dim"]))
            g.arrange(RIGHT, buff=0.14)
        fit_text(g, self.box[2] - 0.2)
        return g.move_to([self.box[0], self.queue_y, 0])

    def _key(self, u, v):
        if (u, v) in self.edge_mobs:
            return (u, v)
        if (v, u) in self.edge_mobs:  # undirected, or a reversed directed edge
            return (v, u)
        return None

    # ---- annotations --------------------------------------------------------
    def _rect_of(self, m):
        c = m.get_center()
        return (c[0] - m.width / 2, c[1] - m.height / 2, c[0] + m.width / 2, c[1] + m.height / 2)

    def _place_label(self, nid, mob):
        """Put an annotation in the first slot around its node that collides with
        no node, edge label or other annotation, and stays inside the frame."""
        c = self.pos[nid]
        hw, hh = self.nw[nid] / 2, self.nh / 2
        lw, lh = mob.width / 2, mob.height / 2
        g = 0.08
        cands = [
            c + np.array([0, hh + lh + g, 0]),                 # above
            c + np.array([hw + lw + g, 0, 0]),                 # right
            c + np.array([-hw - lw - g, 0, 0]),                # left
            c + np.array([0, -hh - lh - g, 0]),                # below
            c + np.array([hw + lw * 0.6, hh + lh, 0]),         # upper right
            c + np.array([-hw - lw * 0.6, hh + lh, 0]),        # upper left
            c + np.array([0, hh + 3 * lh + 2 * g, 0]),         # above, second tier
            c + np.array([0, -hh - 3 * lh - 2 * g, 0]),        # below, second tier
        ]
        blockers = [self._rect_of(s) for k, s in self.ncirc.items() if k != nid]
        blockers += [self._rect_of(l) for k, l in self.labels.items() if k != nid]
        if self.use_queue:
            blockers.append(self._rect_of(self.queue_row))

        bx, by, bw, bh = self.box

        def bad(p):
            r = (p[0] - lw - 0.03, p[1] - lh - 0.03, p[0] + lw + 0.03, p[1] + lh + 0.03)
            hits = sum(1 for b in blockers if r[0] < b[2] and b[0] < r[2] and r[1] < b[3] and b[1] < r[3])
            off = (r[0] < bx - bw / 2 - 0.05 or r[2] > bx + bw / 2 + 0.05
                   or r[1] < by - bh / 2 - 0.05 or r[3] > by + bh / 2 + 0.3)
            return hits + (10 if off else 0)
        best = min(cands, key=bad)
        mob.move_to(best)
        return bad(best)

    # ---- steps --------------------------------------------------------------
    def apply(self, step):
        th, anims = self.th, []
        for v in step.get("visit", []) or []:
            if str(v) in self.nodes:
                self.visited.add(str(v))
        active = {str(a) for a in (step.get("active", []) or []) if str(a) in self.nodes}
        if isinstance(step.get("path"), list) and step["path"]:
            p = [str(x) for x in step["path"] if str(x) in self.nodes]
            self.path_nodes = set(p)
            self.path_edges = {k for k in (self._key(p[i], p[i + 1]) for i in range(len(p) - 1)) if k}
        for nid, c in self.ncirc.items():
            if nid in active:
                anims.append(c.animate.set_stroke(th["compare"], 6).set_fill(th["compare"], 0.38))
            elif nid in self.path_nodes:
                anims.append(c.animate.set_stroke(th["path"], 6).set_fill(th["path"], 0.30))
            elif nid in self.visited:
                anims.append(c.animate.set_stroke(th["good"], 5).set_fill(th["good"], 0.32))
            else:
                anims.append(c.animate.set_stroke(th["accent2"], 4).set_fill(th["cell"], 1))
        for hm in self.halos:
            anims.append(FadeOut(hm))
        self.halos = []
        for nid in active:
            if self.pills:
                hm = RoundedRectangle(corner_radius=min(0.28, self.nh / 2 + 0.08), width=self.nw[nid] + 0.16, height=self.nh + 0.16)
            else:
                hm = Circle(radius=self.nh / 2 * 1.4)
            hm.set_stroke(th["compare"], 2.5, opacity=0.7).set_fill(th["compare"], 0.10).move_to(self.pos[nid]).set_z_index(1)
            self.halos.append(hm)
            anims.append(FadeIn(hm, scale=0.8))
        hot = set()
        for e in step.get("edge", []) or []:
            if isinstance(e, (list, tuple)) and len(e) >= 2:
                k = self._key(str(e[0]), str(e[1]))
                if k:
                    hot.add(k)
        for key, m in self.edge_mobs.items():
            if key in hot:
                col, wd, op = th["path"], 7, 1.0
            elif key in self.path_edges:
                col, wd, op = th["path"], 6, 1.0
            elif key in self.used:
                col, wd, op = th["good"], 4.5, 0.75
            else:
                col, wd, op = th["line"], 3.5, 1.0
            anims.append(self._edge_anim(m, col, wd, op))
        for k in hot:
            m = self.edge_mobs[k]
            flash = (m.copy() if not self.directed else Line(m.get_start(), m.get_end()))
            anims.append(ShowPassingFlash(flash.set_stroke(th["text"], 8, opacity=0.9), time_width=0.6))
        self.used |= hot
        for nid, txt in (step.get("label", {}) or {}).items():
            nid = str(nid)
            if nid not in self.nodes:
                continue
            t = T(str(txt)[:16], font=FONT, font_size=15, color=th["accent"])
            target = pill(t, th, stroke=th["accent"], fill=th["bg"], pad_x=0.08, pad_y=0.04, radius=0.06).set_z_index(4)
            old = self.labels.pop(nid, None)
            if self._place_label(nid, target) > 0:
                target.scale(0.78)
                if self._place_label(nid, target) > 0:
                    # Nowhere free around this node: show the annotation inside
                    # the node instead of letting it cover its neighbours.
                    inner = T(str(txt)[:16], font=FONT, font_size=self.fs, color=th["accent"])
                    fit_text(inner, self.nw[nid] - 0.16, self.nh - 0.12).move_to(self.pos[nid]).set_z_index(3)
                    anims += swap(self.ntext[nid], inner)
                    self.ntext[nid] = inner
                    if old is not None:
                        anims.append(FadeOut(old))
                    continue
            anims += swap(old, target)
            self.labels[nid] = target
        if self.use_queue and "queue" in step and step.get("queue") is not None:
            new = self._build_queue(step.get("queue") or [])
            anims += swap(self.queue_row, new)
            self.queue_row = new
        return anims

    def _edge_anim(self, m, col, wd, op):
        if self.directed:
            return m.animate.set_stroke(col, wd, opacity=op).set_fill(col, opacity=op)
        return m.animate.set_stroke(col, wd, opacity=op)

    def extra(self, scene, step, dur, used):
        return used


class MapSurface:
    """Concept map: labeled pill-nodes joined by labeled relation arrows — for
    SYSTEMS OF IDEAS (a theory, a philosophy) where the value is the relations
    between concepts. Arrows stop at the pill borders and bend around any pill
    that sits on the straight path; relation labels sit on a background chip."""

    def __init__(self, th, box):
        self.th = th
        self.box = box
        self.nodes = {}
        for nd in SPEC.get("nodes", []) or []:
            if isinstance(nd, dict) and nd.get("id") is not None:
                self.nodes[str(nd["id"])] = nd
        self.edges = [e for e in (SPEC.get("edges", []) or [])
                      if isinstance(e, (list, tuple)) and len(e) >= 2
                      and str(e[0]) in self.nodes and str(e[1]) in self.nodes and str(e[0]) != str(e[1])]
        self.visited, self.used, self.halos = set(), set(), []

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.box
        ids = list(self.nodes.keys())
        if not ids:
            return
        self.pills, self.groups = {}, {}
        for nid in ids:
            nd = self.nodes[nid]
            t = T(balance2(str(nd.get("label", nid))[:40], 14), font=TFONT, font_size=19,
                     color=th["text"], line_spacing=0.7).set_z_index(3)
            p = RoundedRectangle(corner_radius=0.14, width=t.width + 0.46, height=t.height + 0.32,
                                 stroke_width=3, stroke_color=th["accent2"], fill_color=th["cell"],
                                 fill_opacity=1).set_z_index(2)
            g = VGroup(p, t)
            self.pills[nid], self.groups[nid] = p, g
        # Shrink pills uniformly if the widest would crowd the region.
        maxw = max(g.width for g in self.groups.values())
        cols = max(2, int(np.ceil(np.sqrt(len(ids)))))
        sc = min(1.0, (w / cols) * 0.92 / maxw)
        if sc < 1.0:
            for g in self.groups.values():
                g.scale(sc)
        raw = {k: (float(nd.get("x", 0) or 0), float(nd.get("y", 0) or 0)) for k, nd in self.nodes.items()}
        halfw = max(g.width for g in self.groups.values()) / 2
        halfh = max(g.height for g in self.groups.values()) / 2
        pos = fit_points(raw, self.box, margin=(halfw + 0.05, halfh + 0.05))
        for k in ids:
            self.groups[k].move_to(pos[k])
        self._separate(ids)
        node_grp = VGroup(*self.groups.values())
        node_grp.move_to([cx, cy, 0])
        sc2 = min(1.0, w / max(node_grp.width, 1e-3), h / max(node_grp.height, 1e-3))
        if sc2 < 1.0:
            node_grp.scale(sc2, about_point=np.array([cx, cy, 0]))

        self.edge_mobs, self.edge_labels = {}, {}
        egrp, lgrp = VGroup(), VGroup()
        for e in self.edges:
            u, v = str(e[0]), str(e[1])
            if (u, v) in self.edge_mobs:
                continue
            m, mid = self._arrow(u, v, th["line"], 3)
            self.edge_mobs[(u, v)] = m
            egrp.add(m)
            if len(e) > 2 and isinstance(e[2], str) and e[2].strip():
                lab = T(e[2].strip()[:20], font=TFONT, font_size=15, color=th["dim"])
                chip = pill(lab, th, fill=th["bg"], pad_x=0.06, pad_y=0.03, radius=0.05, opacity=0.95)
                chip.move_to(mid).set_z_index(1)
                # Slide the label along the edge's normal until it clears every pill.
                rects = [self._rect(k, 0.04) for k in self.pills]
                d = self.pills[v].get_center() - self.pills[u].get_center()
                nrm = np.array([-d[1], d[0], 0.0]) / (np.linalg.norm(d[:2]) or 1)
                for off in (0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8):
                    c = mid + nrm * off
                    box = (c[0] - chip.width / 2, c[1] - chip.height / 2, c[0] + chip.width / 2, c[1] + chip.height / 2)
                    if not any(box[0] < r[2] and r[0] < box[2] and box[1] < r[3] and r[1] < box[3] for r in rects):
                        chip.move_to(c)
                        break
                self.edge_labels[(u, v)] = chip
                lgrp.add(chip)
        scene.play(LaggedStart(*[FadeIn(g, scale=0.9) for g in self.groups.values()], lag_ratio=0.08), run_time=0.5)
        if len(egrp):
            scene.play(Create(egrp), FadeIn(lgrp), run_time=0.4)

    def _rect(self, nid, pad=0.0):
        p = self.pills[nid]
        c = p.get_center()
        return (c[0] - p.width / 2 - pad, c[1] - p.height / 2 - pad, c[0] + p.width / 2 + pad, c[1] + p.height / 2 + pad)

    def _separate(self, ids):
        for _ in range(150):
            moved = False
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    gi, gj = self.groups[ids[i]], self.groups[ids[j]]
                    ci, cj = gi.get_center(), gj.get_center()
                    aw, ah = gi.width / 2 + 0.28, gi.height / 2 + 0.30
                    bw, bh = gj.width / 2 + 0.28, gj.height / 2 + 0.30
                    dx, dy = cj[0] - ci[0], cj[1] - ci[1]
                    ox, oy = (aw + bw) - abs(dx), (ah + bh) - abs(dy)
                    if ox > 0 and oy > 0:
                        moved = True
                        if ox <= oy:
                            s = ox / 2 + 0.01
                            sgn = 1.0 if dx >= 0 else -1.0
                            gi.shift(np.array([-sgn * s, 0, 0])); gj.shift(np.array([sgn * s, 0, 0]))
                        else:
                            s = oy / 2 + 0.01
                            sgn = 1.0 if dy >= 0 else -1.0
                            gi.shift(np.array([0, -sgn * s, 0])); gj.shift(np.array([0, sgn * s, 0]))
            if not moved:
                break

    def _arrow(self, u, v, color, width):
        """Arrow u->v clipped to both pills; curved if a third pill is in the way.
        Returns (mobject, label anchor point)."""
        cu, cv = self.pills[u].get_center(), self.pills[v].get_center()
        others = [self._rect(k, 0.06) for k in self.pills if k not in (u, v)]
        blocked = any(_seg_hits_rect(cu, cv, r) for r in others)
        pu = _rect_exit(cu, self.pills[u].width / 2 + 0.04, self.pills[u].height / 2 + 0.04, cv)
        pv = _rect_exit(cv, self.pills[v].width / 2 + 0.06, self.pills[v].height / 2 + 0.06, cu)
        if not blocked:
            m = Arrow(pu, pv, buff=0, stroke_width=width, color=color, tip_length=0.16,
                      max_tip_length_to_length_ratio=0.3, max_stroke_width_to_length_ratio=40)
            return m.set_z_index(0), (pu + pv) / 2
        best = None
        for ang in (0.6, -0.6, 1.0, -1.0, 1.5, -1.5):
            arc = ArcBetweenPoints(cu, cv, angle=ang)
            pts = [arc.point_from_proportion(t) for t in np.linspace(0, 1, 40)]
            hits = sum(1 for r in others for p in pts if r[0] < p[0] < r[2] and r[1] < p[1] < r[3])
            if best is None or hits < best[0]:
                best = (hits, ang, arc)
            if hits == 0:
                break
        _, ang, arc = best
        # Trim the arc to the pill borders.
        ru, rv = self._rect(u, 0.04), self._rect(v, 0.06)
        ts = np.linspace(0, 1, 120)
        pts = [arc.point_from_proportion(t) for t in ts]
        t0 = next((t for t, p in zip(ts, pts) if not (ru[0] < p[0] < ru[2] and ru[1] < p[1] < ru[3])), 0.1)
        t1 = next((t for t, p in zip(ts[::-1], pts[::-1]) if not (rv[0] < p[0] < rv[2] and rv[1] < p[1] < rv[3])), 0.9)
        a, b = arc.point_from_proportion(t0), arc.point_from_proportion(t1)
        m = CurvedArrow(a, b, angle=ang * (t1 - t0), stroke_width=width, color=color, tip_length=0.16)
        return m.set_z_index(0), arc.point_from_proportion((t0 + t1) / 2)

    def apply(self, step):
        th, anims = self.th, []
        for v in step.get("visit", []) or []:
            if str(v) in self.nodes:
                self.visited.add(str(v))
        active = {str(a) for a in (list(step.get("active", []) or []) + list(step.get("pulse", []) or []))}
        for nid, p in self.pills.items():
            if nid in active:
                anims.append(p.animate.set_stroke(th["compare"], 6).set_fill(th["compare"], 0.30))
            elif nid in self.visited:
                anims.append(p.animate.set_stroke(th["good"], 4).set_fill(th["good"], 0.22))
            else:
                anims.append(p.animate.set_stroke(th["accent2"], 3).set_fill(th["cell"], 1))
        for hm in self.halos:
            anims.append(FadeOut(hm))
        self.halos = []
        for nid in active:
            if nid in self.pills:
                p = self.pills[nid]
                hm = RoundedRectangle(corner_radius=0.2, width=p.width + 0.22, height=p.height + 0.22,
                                      stroke_width=2.5, stroke_color=th["compare"], stroke_opacity=0.7,
                                      fill_opacity=0).move_to(p).set_z_index(1)
                self.halos.append(hm)
                anims.append(FadeIn(hm, scale=1.15))
        hot = set()
        for e in list(step.get("edge", []) or []) + list(step.get("link", []) or []):
            if isinstance(e, (list, tuple)) and len(e) >= 2:
                k = (str(e[0]), str(e[1]))
                if k not in self.edge_mobs and (k[1], k[0]) in self.edge_mobs:
                    k = (k[1], k[0])
                if k in self.edge_mobs:
                    hot.add(k)
        for key, m in self.edge_mobs.items():
            if key in hot:
                col, wd, op = th["accent"], 6, 1.0
            elif key in self.used:
                col, wd, op = th["good"], 4, 0.8
            else:
                col, wd, op = th["line"], 3, 1.0
            anims.append(m.animate.set_stroke(col, wd, opacity=op).set_fill(col, opacity=op)
                         .set_fill(opacity=0, family=False))
            if key in self.edge_labels:
                anims.append(self.edge_labels[key][1].animate.set_color(th["accent"] if key in hot else th["dim"]))
        self.used |= hot
        return anims

    def extra(self, scene, step, dur, used):
        return used


class GridSurface:
    """2-D grid of cells (DP tables, matrices, grid pathfinding).

    gridStyle "numbers" (default) prints every value; "heat" also shades each
    cell by its value; "maze" draws value-1 cells as walls and hides zeros.
    Optional rowLabels / colLabels head the rows and columns (e.g. the two
    strings of an edit-distance table)."""

    def __init__(self, th, box):
        self.th = th
        self.box = box
        self.grid = [[("" if v is None else v) for v in row] for row in (SPEC.get("grid", []) or []) if isinstance(row, list)]
        self.grid = [r[:16] for r in self.grid[:16]]
        self.style = SPEC.get("gridStyle") if SPEC.get("gridStyle") in ("numbers", "heat", "maze") else "numbers"
        self.row_labels = [str(x)[:4] for x in (SPEC.get("rowLabels") or [])]
        self.col_labels = [str(x)[:4] for x in (SPEC.get("colLabels") or [])]
        self.done = set()
        vals = [v for row in self.grid for v in row if isinstance(v, (int, float))]
        for s in SPEC.get("steps", []):
            for t in s.get("gset") or []:
                if isinstance(t, (list, tuple)) and len(t) >= 3 and isinstance(t[2], (int, float)):
                    vals.append(t[2])
        self.vmin, self.vmax = (min(vals), max(vals)) if vals else (0, 1)

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.box
        rows = len(self.grid)
        cols = max((len(r) for r in self.grid), default=0)
        self.rows, self.cols = rows, cols
        has_rl, has_cl = bool(self.row_labels), bool(self.col_labels)
        side = min(1.0, (w - (0.6 if has_rl else 0)) / max(cols, 1), (h - (0.5 if has_cl else 0)) / max(rows, 1))
        self.side = side
        ox = cx + (0.3 if has_rl else 0)
        oy = cy - (0.25 if has_cl else 0)
        maxlen = max([len(str(v)) for row in self.grid for v in row] + [1])
        self.fs = int(max(10, min(30, side * 30, side * 58 / max(maxlen, 1))))

        def cpos(r, c):
            return [ox + (c - (cols - 1) / 2) * side, oy + ((rows - 1) / 2 - r) * side, 0]
        self.cpos = cpos

        self.cells, self.texts, self.vals = {}, {}, {}
        grp = VGroup()
        for r in range(rows):
            for c in range(len(self.grid[r])):
                v = self.grid[r][c]
                self.vals[(r, c)] = v
                sq = Square(side * 0.92, stroke_width=3, **self._base(v)).move_to(cpos(r, c))
                t = self._mk_text(r, c, v)
                self.cells[(r, c)] = sq
                self.texts[(r, c)] = t
                grp.add(sq, t)
        heads = VGroup()
        for r, lab in enumerate(self.row_labels[:rows]):
            heads.add(T(lab, font=FONT, font_size=min(24, self.fs), color=th["accent"])
                      .move_to([cpos(r, 0)[0] - side * 0.85, cpos(r, 0)[1], 0]))
        for c, lab in enumerate(self.col_labels[:cols]):
            heads.add(T(lab, font=FONT, font_size=min(24, self.fs), color=th["accent"])
                      .move_to([cpos(0, c)[0], cpos(0, c)[1] + side * 0.8, 0]))
        scene.play(LaggedStart(*[FadeIn(m) for m in grp], lag_ratio=0.004), FadeIn(heads), run_time=0.7)

    def _base(self, v):
        th = self.th
        if self.style == "maze" and v == 1:
            return dict(stroke_color=th["edge"], fill_color=th["edge"], fill_opacity=1)
        if self.style == "heat" and isinstance(v, (int, float)):
            f = (v - self.vmin) / max(self.vmax - self.vmin, 1e-9)
            return dict(stroke_color=th["edge"], fill_color=interpolate_color(ManimColor(th["cell"]), ManimColor(th["accent2"]), 0.15 + 0.6 * f), fill_opacity=1)
        return dict(stroke_color=th["edge"] if not th["pixel"] else th["line"], fill_color=th["cell"], fill_opacity=1)

    def _mk_text(self, r, c, val):
        hide = self.style == "maze" and (val == 0 or val == 1 or val == "")
        t = T(str(val), font=FONT, font_size=self.fs, color=self.th["text"])
        fit_text(t, self.side * 0.82)
        if hide:
            t.set_opacity(0)
        return t.move_to(self.cpos(r, c))

    def apply(self, step):
        th, anims = self.th, []
        for rc in step.get("gdone", []) or []:
            if isinstance(rc, (list, tuple)) and len(rc) >= 2:
                self.done.add((_int(rc[0]), _int(rc[1])))
        compare = {(_int(x[0]), _int(x[1])) for x in (step.get("gcompare", []) or []) if isinstance(x, (list, tuple)) and len(x) >= 2}
        path = {(_int(x[0]), _int(x[1])) for x in (step.get("gpath", []) or []) if isinstance(x, (list, tuple)) and len(x) >= 2}
        sets = [x for x in (step.get("gset", []) or []) if isinstance(x, (list, tuple)) and len(x) >= 3]
        set_rc = set()
        for x in sets:
            r, c, v = _int(x[0]), _int(x[1]), x[2]
            if (r, c) in self.texts:
                set_rc.add((r, c))
                self.vals[(r, c)] = v
                new = self._mk_text(r, c, v)
                if self.style == "maze":
                    new.set_opacity(1)
                anims.append(Transform(self.texts[(r, c)], new))
        for (r, c), sq in self.cells.items():
            if (r, c) in path:
                anims.append(sq.animate.set_stroke(th["accent"], 5).set_fill(th["accent"], 0.42))
            elif (r, c) in set_rc:
                anims.append(sq.animate.set_stroke(th["swap"], 5).set_fill(th["swap"], 0.36))
            elif (r, c) in compare:
                anims.append(sq.animate.set_stroke(th["compare"], 5).set_fill(th["compare"], 0.32))
            elif (r, c) in self.done:
                anims.append(sq.animate.set_stroke(th["good"], 4).set_fill(th["good"], 0.28))
            else:
                b = self._base(self.vals.get((r, c)))
                anims.append(sq.animate.set_stroke(b["stroke_color"], 3).set_fill(b["fill_color"], b["fill_opacity"]))
        return anims

    def extra(self, scene, step, dur, used):
        return used


class TableSurface:
    """Labeled comparison table: a header row + row labels + text cells, with
    adaptive column widths and wrapped cells. Body rows start dimmed and light
    up as the narration reaches them, so the comparison reveals row by row.

    Data: SPEC["table"] is a 2-D array of strings; row 0 is the header row and
    column 0 is the row labels. Step fields reuse the grid verbs on (row, col):
    gcompare highlights, gdone settles, gpath accents.
    """

    def __init__(self, th, box):
        self.th = th
        self.box = box
        self.table = [[("" if v is None else str(v)) for v in row] for row in (SPEC.get("table", []) or []) if isinstance(row, list)]
        self.done, self.seen_rows = set(), {0}

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.box
        rows = len(self.table)
        cols = max((len(r) for r in self.table), default=0)
        self.rows, self.cols = rows, cols
        if rows == 0 or cols == 0:
            return
        pad_x, pad_y, fs = 0.26, 0.16, 21
        wrap_at = 16 if cols >= 4 else 20
        texts = {}
        col_w = [0.0] * cols
        row_h = [0.0] * rows
        for r in range(rows):
            for c in range(cols):
                val = self.table[r][c] if c < len(self.table[r]) else ""
                hdr = (r == 0 or c == 0)
                t = T(wrap_text(val, wrap_at) or " ", font=TFONT, font_size=fs,
                         color=(th["accent"] if r == 0 else th["text"]), line_spacing=0.8,
                         **({"weight": BOLD} if hdr else {}))
                texts[(r, c)] = t
                col_w[c] = max(col_w[c], t.width + pad_x * 2)
                row_h[r] = max(row_h[r], t.height + pad_y * 2)
        col_w = [max(cw, 1.0) for cw in col_w]
        row_h = [max(rh, 0.6) for rh in row_h]
        total_w, total_h = sum(col_w), sum(row_h)
        xs = [0.0]
        for c in range(cols):
            xs.append(xs[-1] + col_w[c])
        ys = [0.0]
        for r in range(rows):
            ys.append(ys[-1] + row_h[r])
        self.cells, self.texts = {}, {}
        grp = VGroup()
        for r in range(rows):
            for c in range(cols):
                px = xs[c] + col_w[c] / 2 - total_w / 2
                py = total_h / 2 - (ys[r] + row_h[r] / 2)
                hdr = (r == 0 or c == 0)
                rect = Rectangle(width=col_w[c], height=row_h[r], stroke_width=2,
                                 stroke_color=th["line"],
                                 fill_color=(th["panel"] if hdr else th["cell"]),
                                 fill_opacity=1).move_to([px, py, 0])
                t = texts[(r, c)].move_to([px, py, 0])
                self.cells[(r, c)] = rect
                self.texts[(r, c)] = t
                grp.add(rect, t)
        rule = Line([-total_w / 2, total_h / 2 - row_h[0], 0], [total_w / 2, total_h / 2 - row_h[0], 0],
                    stroke_width=4, color=th["accent"])
        grp.add(rule)
        sc = min(1.35, w / max(total_w, 1e-3), h * 0.9 / max(total_h, 1e-3))
        grp.scale(sc).move_to([cx, cy, 0])
        self.group = grp
        for r in range(1, rows):
            for c in range(cols):
                self.texts[(r, c)].set_opacity(0.3 if c > 0 else 0.6)
        scene.play(FadeIn(grp, shift=UP * 0.15), run_time=0.6)

    def _base_fill(self, r, c):
        return self.th["panel"] if (r == 0 or c == 0) else self.th["cell"]

    def apply(self, step):
        th, anims = self.th, []
        for rc in step.get("gdone", []) or []:
            if isinstance(rc, (list, tuple)) and len(rc) >= 2:
                self.done.add((_int(rc[0]), _int(rc[1])))
        compare = {(_int(x[0]), _int(x[1])) for x in (step.get("gcompare", []) or []) if isinstance(x, (list, tuple)) and len(x) >= 2}
        path = {(_int(x[0]), _int(x[1])) for x in (step.get("gpath", []) or []) if isinstance(x, (list, tuple)) and len(x) >= 2}
        newly = {r for (r, c) in (compare | path | self.done)} - self.seen_rows
        self.seen_rows |= {r for (r, c) in (compare | path | self.done)}
        for (r, c), rect in self.cells.items():
            if (r, c) in path:
                anims.append(rect.animate.set_stroke(th["accent"], 4).set_fill(th["accent"], 0.30))
            elif (r, c) in compare:
                anims.append(rect.animate.set_stroke(th["compare"], 4).set_fill(th["compare"], 0.28))
            elif (r, c) in self.done:
                anims.append(rect.animate.set_stroke(th["good"], 3).set_fill(th["good"], 0.22))
            else:
                anims.append(rect.animate.set_stroke(th["line"], 2).set_fill(self._base_fill(r, c), 1))
        for r in newly:
            for c in range(self.cols):
                if (r, c) in self.texts:
                    anims.append(self.texts[(r, c)].animate.set_opacity(1))
        return anims

    def extra(self, scene, step, dur, used):
        return used


class ListSurface:
    """Singly linked list: boxes with next-arrows (traversal / search / build)."""

    def __init__(self, th, box):
        self.th = th
        self.box = box
        self.values = [v for v in SPEC.get("array", [])][:10]
        self.found = set()

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.box
        n = len(self.values)
        self.cy = cy - 0.2
        col_w = min(1.7, (w - 0.9) / max(n, 1))
        self.col_w = col_w
        box_w = min(1.0, col_w * 0.62)
        self.box_w = box_w
        lx = cx - 0.45

        def slot_x(i):
            return lx + (i - (n - 1) / 2) * col_w
        self.slot_x = slot_x
        self.fs = int(max(14, min(22, box_w * 26)))

        grp = VGroup()
        self.boxes, self.texts = {}, {}
        for i, v in enumerate(self.values):
            b = RoundedRectangle(corner_radius=0.08, width=box_w, height=0.8, stroke_width=3,
                                 stroke_color=th["accent2"], fill_color=th["cell"], fill_opacity=1).move_to([slot_x(i), self.cy, 0])
            t = fit_text(T(str(v), font=FONT, font_size=self.fs, color=th["text"]), box_w * 0.85).move_to([slot_x(i), self.cy, 0])
            self.boxes[i], self.texts[i] = b, t
            grp.add(b, t)
            if i < n - 1:
                grp.add(Arrow([slot_x(i) + box_w / 2, self.cy, 0], [slot_x(i + 1) - box_w / 2, self.cy, 0],
                              buff=0.05, stroke_width=4, color=th["line"], max_tip_length_to_length_ratio=0.3))
        if n:
            nullt = T("None", font=FONT, font_size=16, color=th["dim"]).next_to(self.boxes[n - 1], RIGHT, buff=0.45)
            grp.add(Arrow([slot_x(n - 1) + box_w / 2, self.cy, 0], nullt.get_left(), buff=0.06,
                          stroke_width=4, color=th["line"], max_tip_length_to_length_ratio=0.3), nullt)
        self.pointers, self.active_ptrs = {}, set()
        scene.play(LaggedStart(*[FadeIn(m, shift=RIGHT * 0.1) for m in grp], lag_ratio=0.03), run_time=0.7)

    def apply(self, step):
        th, anims, n = self.th, [], len(self.values)
        compare = {_int(c) for c in (step.get("compare", []) or step.get("highlight", []) or [])}
        if _int(step.get("found")) is not None:
            self.found.add(_int(step["found"]))
        for pr in (step.get("set", []) or []):
            if isinstance(pr, (list, tuple)) and len(pr) >= 2 and _int(pr[0]) in self.texts:
                i = _int(pr[0])
                anims.append(Transform(self.texts[i], fit_text(T(str(pr[1]), font=FONT, font_size=self.fs, color=th["text"]),
                                                               self.box_w * 0.85).move_to([self.slot_x(i), self.cy, 0])))
        for i in range(n):
            b = self.boxes[i]
            if i in self.found:
                anims.append(b.animate.set_stroke(th["good"], 5).set_fill(th["good"], 0.32))
            elif i in compare:
                anims.append(b.animate.set_stroke(th["compare"], 5).set_fill(th["compare"], 0.32))
            else:
                anims.append(b.animate.set_stroke(th["accent2"], 3).set_fill(th["cell"], 1))
        wanted = step.get("pointers", {}) or {}
        if not isinstance(wanted, dict):
            wanted = {}
        row_at = {}
        for name, i in wanted.items():
            i = _int(i)
            if i is None:
                continue
            i = max(0, min(i, max(0, n - 1)))
            row = row_at.get(i, 0)
            row_at[i] = row + 1
            pos = [self.slot_x(i), self.cy + 0.72 + row * 0.42, 0]
            if name in self.pointers:
                anims.append(self.pointers[name].animate.move_to(pos).set_opacity(1))
            else:
                p = _ptr(name, name_color(name, th), above=True)
                p.move_to(pos)
                self.pointers[name] = p
                anims.append(FadeIn(p, shift=DOWN * 0.1))
            self.active_ptrs.add(name)
        for name in list(self.active_ptrs):
            if name not in wanted:
                anims.append(self.pointers[name].animate.set_opacity(0))
                self.active_ptrs.discard(name)
        return anims

    def extra(self, scene, step, dur, used):
        return used


class ConceptSurface:
    """Abstract-concept scene: actors (dots/shapes), zones (regions) and links.

    Spec coordinates are a normalized 0-10 x 0-10 space (y up) mapped linearly
    into the region — a fixed map (not min/max fit) so mid-scene moves and
    spawns land at absolute, predictable positions.

    Step verbs: move[[id,x,y]], enter[[id,zone]], scatter[ids], link/unlink
    [[a,b]], enclose[zone ids], dissolve[ids], spawn[actors], grow[[id,f]],
    restyle[{id,color,label}], pulse[ids]. Unknown ids are ignored.

    Actor shapes and their labels are SEPARATE mobjects (like GraphSurface's
    nodes), and every mobject gets at most ONE animation per step — move,
    recolor and grow are chained onto a single .animate builder — because two
    animations on the same (or nested) mobjects in one play() override each
    other.
    """

    def __init__(self, th, region):
        self.th = th
        self.region = region  # (cx, cy, w, h)
        self.shapes = {}      # actor id -> shape mobject
        self.labels = {}      # actor id -> label Text
        self.zones = {}       # zone id -> VGroup(border[, label])
        self.zone_specs = {}  # zone id -> zone dict from the spec
        self.links = {}       # frozenset((a, b)) -> Line

    def _color(self, name):
        th = self.th
        return {
            "cyan": th["accent2"], "yellow": th["accent"], "green": th["good"],
            "pink": th["swap"], "gray": th["dim"],
        }.get(str(name or "cyan"), th["accent2"])

    def _pos(self, x, y):
        cx, cy, w, h = self.region
        return np.array([cx + (float(x) / 10.0 - 0.5) * w,
                         cy + (float(y) / 10.0 - 0.5) * h, 0.0])

    def _clamp(self, p):
        cx, cy, w, h = self.region
        return np.array([max(cx - w / 2 + 0.2, min(p[0], cx + w / 2 - 0.2)),
                         max(cy - h / 2 + 0.2, min(p[1], cy + h / 2 - 0.2)), 0.0])

    def _center(self, oid):
        if oid in self.shapes:
            return self.shapes[oid].get_center()
        if oid in self.zones:
            return self.zones[oid][0].get_center()
        return None

    def _make_shape(self, a):
        th = self.th
        color = self._color(a.get("color"))
        size = max(0.3, min(float(a.get("size") or 1), 3.0))
        kind = a.get("kind", "dot")
        if kind == "circle":
            shape = Circle(radius=0.30 * size, stroke_width=4, stroke_color=color,
                           fill_color=th["cell"], fill_opacity=1)
        elif kind == "square":
            shape = Square(0.5 * size, stroke_width=4, stroke_color=color,
                           fill_color=th["cell"], fill_opacity=1)
        elif kind == "triangle":
            shape = Triangle(stroke_width=4, stroke_color=color,
                             fill_color=th["cell"], fill_opacity=1).scale(0.3 * size)
        elif kind == "star":
            shape = Star(n=5, outer_radius=0.32 * size, stroke_width=3,
                         stroke_color=color, fill_color=color, fill_opacity=0.85)
        elif kind == "burst":
            shape = Star(n=8, outer_radius=0.34 * size, inner_radius=0.14 * size,
                         stroke_width=3, stroke_color=color, fill_color=color, fill_opacity=0.85)
        elif kind == "ring":
            shape = Annulus(inner_radius=0.17 * size, outer_radius=0.30 * size,
                            stroke_width=0, fill_color=color, fill_opacity=0.9)
        elif kind == "diamond":
            shape = Square(0.44 * size, stroke_width=4, stroke_color=color,
                           fill_color=th["cell"], fill_opacity=1).rotate(PI / 4)
        elif kind == "cross":
            arm = 0.24 * size
            shape = VGroup(
                Line([-arm, -arm, 0], [arm, arm, 0], stroke_width=6, color=color),
                Line([-arm, arm, 0], [arm, -arm, 0], stroke_width=6, color=color),
            )
        else:
            shape = Dot(radius=0.13 * size, color=color)
        shape.move_to(self._pos(a.get("x", 5), a.get("y", 5))).set_z_index(2)
        return shape

    def _label_pos(self, shape, height=None):
        h = shape.height if height is None else height
        return shape.get_center() + DOWN * (h / 2 + 0.18)

    def _make_label(self, aid, text, pos=None):
        t = T(str(text), font=TFONT, font_size=14, color=self.th["dim"]).set_z_index(2)
        return t.move_to(self._label_pos(self.shapes[aid]) if pos is None else pos)

    def _make_zone(self, z):
        th = self.th
        cx, cy, w, h = self.region
        color = self._color(z.get("color"))
        zw = max(0.5, float(z.get("w") or 3) / 10.0 * w)
        zh = max(0.5, float(z.get("h") or 3) / 10.0 * h)
        if z.get("shape") == "circle":
            border = Circle(radius=zw / 2, stroke_width=3, stroke_color=color, fill_opacity=0)
        else:
            border = Rectangle(width=zw, height=zh, stroke_width=3, stroke_color=color, fill_opacity=0)
        if z.get("style") == "solid":
            border.set_stroke(width=5)
        else:
            border = DashedVMobject(border, num_dashes=28)
        border.move_to(self._pos(z.get("x", 5), z.get("y", 5))).set_z_index(0)
        g = VGroup(border)
        if z.get("label"):
            # In the lower quarter of the scene the space above a zone is
            # usually contested (things sit right above it) while below is
            # frame edge padding — put the label there.
            side = DOWN if float(z.get("y", 5)) < 2.5 else UP
            g.add(T(str(z["label"]), font=TFONT, font_size=15, color=color)
                  .next_to(border, side, buff=0.10).set_z_index(1))
        return g

    def _zone_bbox(self, zid):
        """(x0, y0, x1, y1) of a zone's border."""
        b = self.zones[zid][0]
        c = b.get_center()
        return (c[0] - b.width / 2, c[1] - b.height / 2, c[0] + b.width / 2, c[1] + b.height / 2)

    def _point_in_zone(self, p, zid, margin=0.0):
        """Whether p lies inside the zone's border (+margin grows the zone)."""
        if zid not in self.zones:
            return False
        z = self.zone_specs.get(zid, {})
        b = self.zones[zid][0]
        c = b.get_center()
        if z.get("shape") == "circle":
            return np.linalg.norm((p - c)[:2]) <= b.width / 2 + margin
        x0, y0, x1, y1 = self._zone_bbox(zid)
        return x0 - margin <= p[0] <= x1 + margin and y0 - margin <= p[1] <= y1 + margin

    def _containing_zone(self, p):
        for zid in self.zones:
            if self._point_in_zone(p, zid):
                return zid
        return None

    @staticmethod
    def _rects_overlap(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def _pick_label_pos(self, center, sw, sh, lw, lh, occupied):
        """First label slot (below/above/right/left of a shape) whose padded
        rect collides with nothing in occupied; falls back to below."""
        pad = 0.04
        cands = [
            center + DOWN * (sh / 2 + 0.18 + lh / 2),
            center + UP * (sh / 2 + 0.18 + lh / 2),
            center + RIGHT * (sw / 2 + 0.14 + lw / 2),
            center + LEFT * (sw / 2 + 0.14 + lw / 2),
        ]
        for c in cands:
            r = (c[0] - lw / 2 - pad, c[1] - lh / 2 - pad, c[0] + lw / 2 + pad, c[1] + lh / 2 + pad)
            if not any(self._rects_overlap(r, o) for o in occupied):
                return c
        return cands[0]

    def _occupied_rects(self, skip_labels=(), planned=None):
        """Bounding rects of shapes and labels, for label placement. planned
        maps actor id -> target center for shapes moving this step."""
        planned = planned or {}
        rects = []
        for aid, sh in self.shapes.items():
            c = planned.get(aid, sh.get_center())
            rects.append((c[0] - sh.width / 2, c[1] - sh.height / 2,
                          c[0] + sh.width / 2, c[1] + sh.height / 2))
        for lid, t in self.labels.items():
            if lid in skip_labels:
                continue
            c = t.get_center()
            rects.append((c[0] - t.width / 2, c[1] - t.height / 2,
                          c[0] + t.width / 2, c[1] + t.height / 2))
        for zg in self.zones.values():
            if len(zg) > 1:
                c = zg[1].get_center()
                rects.append((c[0] - zg[1].width / 2, c[1] - zg[1].height / 2,
                              c[0] + zg[1].width / 2, c[1] + zg[1].height / 2))
        return rects

    def _slot_in_zone(self, actor_id, zone_id):
        """Deterministic golden-angle slot inside a zone (stable across runs)."""
        if zone_id not in self.zones:
            return None
        border = self.zones[zone_id][0]
        center = border.get_center()
        rx, ry = border.width / 2 * 0.7, border.height / 2 * 0.7
        crc = zlib.crc32(str(actor_id).encode())
        ang = (crc % 360) * PI / 180.0
        r = np.sqrt(((crc // 360) % 97 + 1) / 98.0)
        p = center + np.array([np.cos(ang) * rx * r, np.sin(ang) * ry * r, 0.0])
        if not self._point_in_zone(p, zone_id, margin=0.05):
            p = center  # e.g. a circle zone narrower than its bbox: use the middle
        return p

    def _mk_link(self, a, b):
        return Line(self._center(a), self._center(b),
                    stroke_width=2.5, color=self.th["dim"]).set_z_index(0)

    def build(self, scene):
        for z in SPEC.get("zones", []) or []:
            zid = str(z.get("id", ""))
            if not zid or zid in self.zones:
                continue
            self.zone_specs[zid] = dict(z)
            self.zones[zid] = self._make_zone(z)
        for a in SPEC.get("actors", []) or []:
            aid = str(a.get("id", ""))
            if not aid or aid in self.shapes or aid in self.zones:
                continue
            self.shapes[aid] = self._make_shape(a)
        for a in SPEC.get("actors", []) or []:
            aid = str(a.get("id", ""))
            if not a.get("label") or aid not in self.shapes or aid in self.labels:
                continue
            sh = self.shapes[aid]
            probe = T(str(a["label"]), font=TFONT, font_size=14)
            pos = self._pick_label_pos(sh.get_center(), sh.width, sh.height,
                                       probe.width, probe.height, self._occupied_rects())
            self.labels[aid] = self._make_label(aid, a["label"], pos=pos)
        static = VGroup()
        for pair in SPEC.get("links", []) or []:
            a, b = str(pair[0]), str(pair[1])
            key = frozenset((a, b))
            if a != b and key not in self.links and self._center(a) is not None and self._center(b) is not None:
                ln = self._mk_link(a, b)
                self.links[key] = ln
                static.add(ln)
        zgrps = list(self.zones.values())
        if zgrps or len(static):
            scene.play(*[Create(z) for z in zgrps], Create(static), run_time=0.3)
        actors = list(self.shapes.values())
        if actors:
            scene.play(LaggedStart(*[GrowFromCenter(m) for m in actors], lag_ratio=0.04, run_time=0.35),
                       *[FadeIn(t) for t in self.labels.values()])

    def apply(self, step):
        th, anims = self.th, []

        # --- plan per-actor updates so each mobject animates at most once ----
        targets = {}   # id -> final position
        recolor = {}   # id -> color
        relabel = {}   # id -> label text
        growf = {}     # id -> scale factor

        for m in step.get("move", []) or []:
            aid = str(m[0])
            if aid in self.shapes and len(m) >= 3:
                targets[aid] = self._clamp(self._pos(m[1], m[2]))
        for e in step.get("enter", []) or []:
            aid, zid = str(e[0]), str(e[1])
            if aid in self.shapes:
                p = self._slot_in_zone(aid, zid)
                if p is not None:
                    targets[aid] = self._clamp(p)
        ids = [str(i) for i in (step.get("scatter", []) or []) if str(i) in self.shapes]
        if ids:
            centroid = np.mean([self.shapes[i].get_center() for i in ids], axis=0)
            for i in ids:
                p = self.shapes[i].get_center()
                # Scattering means leaving: an actor inside a zone is pushed
                # away from the ZONE's center until it is outside the fence.
                zid = self._containing_zone(p)
                origin = self.zones[zid][0].get_center() if zid else centroid
                d = p - origin
                if np.linalg.norm(d[:2]) < 1e-3:  # degenerate: hashed direction
                    ang = (zlib.crc32(i.encode()) % 12) * (2 * PI / 12)
                    d = np.array([np.cos(ang), np.sin(ang), 0.0])
                d = d / np.linalg.norm(d[:2])
                t = self._clamp(p + d * 1.9)
                if zid:
                    # Walk outward until clear of the zone. The straight ray
                    # can be blocked (region edge inside the zone), so rotate
                    # the direction until some ray escapes.
                    found = False
                    for rot in (0, PI / 4, -PI / 4, PI / 2, -PI / 2, 3 * PI / 4, -3 * PI / 4, PI):
                        ca, sa = np.cos(rot), np.sin(rot)
                        dr = np.array([d[0] * ca - d[1] * sa, d[0] * sa + d[1] * ca, 0.0])
                        for k in range(9):
                            cand = self._clamp(p + dr * (1.9 + k * 0.8))
                            if not self._point_in_zone(cand, zid, margin=0.3):
                                t, found = cand, True
                                break
                        if found:
                            break
                targets[i] = t
        for gr in step.get("grow", []) or []:
            aid = str(gr[0])
            if aid in self.shapes and len(gr) >= 2:
                growf[aid] = max(0.3, min(float(gr[1]), 3.0))
        for r in step.get("restyle", []) or []:
            aid = str(r.get("id", ""))
            if r.get("color") and (aid in self.shapes or aid in self.zones):
                recolor[aid] = self._color(r["color"])
            if r.get("label") and (aid in self.shapes or aid in self.zones):
                relabel[aid] = str(r["label"])

        # spawn: new actors appear this step
        for a in step.get("spawn", []) or []:
            aid = str(a.get("id", ""))
            if not aid or aid in self.shapes or aid in self.zones:
                continue
            self.shapes[aid] = self._make_shape(a)
            anims.append(GrowFromCenter(self.shapes[aid]))
            if a.get("label"):
                sh = self.shapes[aid]
                probe = T(str(a["label"]), font=TFONT, font_size=14)
                pos = self._pick_label_pos(sh.get_center(), sh.width, sh.height,
                                           probe.width, probe.height, self._occupied_rects())
                self.labels[aid] = self._make_label(aid, a["label"], pos=pos)
                anims.append(FadeIn(self.labels[aid]))

        # one chained animation per actor shape
        for aid in set(list(targets) + list(recolor) + list(growf)):
            if aid not in self.shapes:
                continue
            shape = self.shapes[aid]
            b = shape.animate
            if aid in growf:
                b = b.scale(growf[aid])
            if aid in targets:
                b = b.move_to(targets[aid])
            if aid in recolor:
                b = b.set_color(recolor[aid]) if isinstance(shape, Dot) else b.set_stroke(recolor[aid])
            anims.append(b)
            # the label follows: Transform covers move + text change together
            f = growf.get(aid, 1.0)
            if aid in relabel or aid in self.labels:
                txt = relabel.get(aid) or self.labels[aid].text
                probe = T(str(txt), font=TFONT, font_size=14)
                lp = self._pick_label_pos(
                    targets.get(aid, shape.get_center()), shape.width * f, shape.height * f,
                    probe.width, probe.height,
                    self._occupied_rects(skip_labels={aid}, planned=targets))
            if aid in relabel:
                new = T(relabel[aid], font=TFONT, font_size=14, color=th["dim"]).move_to(lp).set_z_index(2)
                if aid in self.labels:
                    anims.append(Transform(self.labels[aid], new))
                else:
                    self.labels[aid] = new
                    anims.append(FadeIn(new))
            elif aid in self.labels:
                anims.append(self.labels[aid].animate.move_to(lp))
        # label-only restyle (actor didn't otherwise animate)
        for aid, txt in relabel.items():
            if aid in self.shapes and aid not in targets and aid not in recolor and aid not in growf:
                sh = self.shapes[aid]
                probe = T(str(txt), font=TFONT, font_size=14)
                pos = self._pick_label_pos(
                    sh.get_center(), sh.width, sh.height, probe.width, probe.height,
                    self._occupied_rects(skip_labels={aid}, planned=targets))
                new = self._make_label(aid, txt, pos=pos)
                if aid in self.labels:
                    anims.append(Transform(self.labels[aid], new))
                else:
                    self.labels[aid] = new
                    anims.append(FadeIn(new))

        # links follow moved endpoints
        for key, ln in self.links.items():
            a, b = tuple(key)
            if a in targets or b in targets:
                pa = targets.get(a, self._center(a))
                pb = targets.get(b, self._center(b))
                if pa is not None and pb is not None:
                    anims.append(ln.animate.put_start_and_end_on(pa, pb))

        # link / unlink
        for pair in step.get("link", []) or []:
            a, b = str(pair[0]), str(pair[1])
            key = frozenset((a, b))
            if a == b or key in self.links:
                continue
            pa = targets.get(a, self._center(a))
            pb = targets.get(b, self._center(b))
            if pa is None or pb is None:
                continue
            ln = Line(pa, pb, stroke_width=2.5, color=th["dim"]).set_z_index(0)
            self.links[key] = ln
            anims.append(Create(ln))
        for pair in step.get("unlink", []) or []:
            key = frozenset((str(pair[0]), str(pair[1])))
            ln = self.links.pop(key, None)
            if ln is not None:
                anims.append(Succession(ln.animate(run_time=0.15).set_stroke(th["swap"], 4),
                                        FadeOut(ln, run_time=0.25)))

        # zone updates (enclose / restyle) — merged into ONE Transform per zone,
        # since two animations on the same mobject in one play() crash Manim
        zone_updates = {}
        for zid in step.get("enclose", []) or []:
            zid = str(zid)
            if zid in self.zones:
                zone_updates.setdefault(zid, {})["style"] = "solid"
        for r in step.get("restyle", []) or []:
            zid = str(r.get("id", ""))
            if zid not in self.zones:
                continue
            if r.get("color"):
                zone_updates.setdefault(zid, {})["color"] = str(r["color"])
            if r.get("label"):
                zone_updates.setdefault(zid, {})["label"] = str(r["label"])
        for zid, upd in zone_updates.items():
            self.zone_specs[zid] = {**self.zone_specs[zid], **upd}
            anims.append(Transform(self.zones[zid], self._make_zone(self.zone_specs[zid])))

        # dissolve: fade + unregister; purge links touching the object
        for did in step.get("dissolve", []) or []:
            did = str(did)
            gone = []
            if did in self.shapes:
                gone.append(self.shapes.pop(did))
                if did in self.labels:
                    gone.append(self.labels.pop(did))
            elif did in self.zones:
                gone.append(self.zones.pop(did))
                self.zone_specs.pop(did, None)
            if not gone:
                continue
            anims += [FadeOut(m) for m in gone]
            for key in [k for k in self.links if did in k]:
                anims.append(FadeOut(self.links.pop(key)))

        # pulse: emphasis — skipped for objects already animating this step
        busy = set(list(targets) + list(recolor) + list(growf) + list(relabel))
        for pid in step.get("pulse", []) or []:
            pid = str(pid)
            if pid in busy:
                continue
            if pid in self.shapes:
                anims.append(Indicate(self.shapes[pid], color=th["accent"]))
            elif pid in self.zones:
                anims.append(Indicate(self.zones[pid], color=th["accent"]))
        return anims

    def extra(self, scene, step, dur, used):
        return used


# ------------------------------------------------------------- overlays ----
class NoteCallout:
    """Short per-step callout ("swap 38 <-> 27", "dist[C] = 4") in a pill at the
    top of the visualization; it fades out on steps that carry no note."""

    def __init__(self, th, anchor):
        self.th, self.anchor, self.cur, self.text = th, anchor, None, None

    def update(self, note):
        th, anims = self.th, []
        note = str(note or "").strip()[:60]
        if note == (self.text or ""):
            return anims
        old, self.cur = self.cur, None
        if old is not None and not note:
            anims.append(FadeOut(old, shift=UP * 0.08))
        if note:
            t = T(note, font=TFONT, font_size=19, color=th["text"])
            fit_text(t, self.anchor[2] - 0.5)
            g = pill(t, th, stroke=th["accent"], fill=th["panel"], pad_x=0.22, pad_y=0.10, radius=0.14, opacity=0.95)
            g.move_to([self.anchor[0], self.anchor[1], 0]).set_z_index(6)
            self.cur = g
            anims += swap(old, g)
        self.text = note
        return anims


class VarsTracker:
    """Row of "name = value" chips for the algorithm's live state. Values persist
    until changed; a chip that changed this step is outlined in the accent."""

    def __init__(self, th, anchor, pinned=None):
        self.th, self.anchor = th, anchor
        self.state = dict(pinned or {})
        self.order = list(self.state.keys())
        self.group = None

    def _build(self, changed):
        th = self.th
        chips = VGroup()
        for k in self.order[-6:]:
            v = self.state[k]
            t = VGroup(T(str(k), font=FONT, font_size=17, color=th["dim"]),
                       T("=", font=FONT, font_size=17, color=th["dim"]),
                       T(str(v)[:14], font=FONT, font_size=17, color=th["text"])).arrange(RIGHT, buff=0.08)
            hot = k in changed
            chips.add(pill(t, th, stroke=(th["accent"] if hot else th["line"]), fill=th["panel"],
                           pad_x=0.14, pad_y=0.07, radius=0.08))
        chips.arrange(RIGHT, buff=0.16)
        fit_text(chips, self.anchor[2])
        return chips.move_to([self.anchor[0], self.anchor[1], 0]).set_z_index(5)

    def intro(self):
        if not self.state:
            return []
        self.group = self._build(set())
        return [FadeIn(self.group)]

    def update(self, vars_):
        if not isinstance(vars_, dict):
            vars_ = {}
        changed = set()
        for k, v in vars_.items():
            k = str(k)[:10]
            v = str(v)
            if self.state.get(k) != v:
                changed.add(k)
            if k not in self.state:
                self.order.append(k)
            self.state[k] = v
        if not changed and (self.group is None or not getattr(self, "_hot", False)):
            return []
        self._hot = bool(changed)
        new = self._build(changed)
        old, self.group = self.group, new
        return swap(old, new)


# ------------------------------------------------------------------- scene ----
class Walkthrough(Scene):
    def build_code_panel(self, th, fs):
        """Syntax-highlighted source on a true monospace grid, with line numbers."""
        lines = SPEC.get("code", [])[:22]
        one = T("M", font=FONT, font_size=fs); two = T("MM", font=FONT, font_size=fs)
        cw = two.width - one.width; chh = one.height; line_h = chh + 0.26
        try:
            lexer = get_lexer_by_name(SPEC.get("language", "python"))
        except Exception:
            lexer = get_lexer_by_name("text")
        gutter = (len(str(len(lines))) + 1.6) * cw

        def line_chars(src):
            out = []
            for ttype, val in lex(src, lexer):
                color = tok_color(ttype)
                for ch in val.rstrip("\n"):
                    out.append((ch, color))
            return out

        rows, nums = VGroup(), VGroup()
        anchor = "\u2502"  # full-height box-drawing bar: same glyph on every line
        for row, src in enumerate(lines):
            src = str(src).replace("\t", "    ")
            chars = line_chars(src)
            t = T(anchor + "".join(ch for ch, _ in chars), font=FONT, font_size=fs)
            colors = [c for ch, c in chars if not ch.isspace()]
            # Shift so the anchor sits at a fixed spot: every glyph then lands on
            # the line's true baseline (per-glyph centering floated "_" and ".").
            t.shift(np.array([gutter - cw / 2, -row * line_h, 0]) - t[0].get_center())
            if len(t) == 1 + len(colors):
                for g, c in zip(t[1:], colors):
                    g.set_color(c)
            else:
                t.set_color(TH["c_def"])
            lg = VGroup(*t[1:])
            if len(lg) == 0:
                # A point, not an invisible rectangle: line dimming sets fill
                # opacity, which turned the rectangle into a visible square.
                lg.add(VectorizedPoint([gutter + cw / 2, -row * line_h, 0]))
            rows.add(lg)
            nums.add(T(str(row + 1), font=FONT, font_size=fs - 3, color=th["dim"])
                     .move_to([gutter - 1.2 * cw, -row * line_h, 0], aligned_edge=RIGHT).set_opacity(0.6))
        return rows, nums, chh

    def build_concept_panel(self, th, fs, max_w):
        """The argument / key points as numbered prose lines, one font size for
        all (long points wrap onto a second line instead of shrinking)."""
        lines = SPEC.get("code", [])[:14]
        fs2 = fs + 3
        probe = T("M", font=TFONT, font_size=fs2)
        chh = probe.height
        rows, nums = VGroup(), VGroup()
        wrap_at = 34 if not PORTRAIT else 30
        y = 0.0
        for row, src in enumerate(lines):
            txt = T(wrap_text(str(src), wrap_at) or " ", font=TFONT, font_size=fs2, color=th["text"], line_spacing=0.85)
            num = T(f"{row + 1}", font=FONT, font_size=fs2 - 2, color=th["accent"])
            txt.move_to([0.62, y, 0], aligned_edge=UL)
            num.move_to([0.2, txt.get_top()[1] - chh / 2, 0])
            rows.add(VGroup(txt))
            nums.add(num)
            y = txt.get_bottom()[1] - 0.34
        grp = VGroup(rows, nums)
        if grp.width > max_w:
            grp.scale(max_w / grp.width)
        return rows, nums, chh

    def construct(self):
        th = TH
        steps = [s for s in SPEC.get("steps", [])[:60] if isinstance(s, dict)]
        fs = 18 if not PORTRAIT else 22
        stroke = 4 if th["pixel"] else 3
        has_panel = MODE in ("code", "concept") and len(SPEC.get("code", [])) > 0
        has_viz = VIZ != "none"
        has_notes = any(str(s.get("note") or "").strip() for s in steps)
        pinned = {}
        if SPEC.get("target") is not None and VIZ in ("array", "linkedlist"):
            pinned["target"] = str(SPEC["target"])
        has_vars = bool(pinned) or any(isinstance(s.get("vars"), dict) and s.get("vars") for s in steps)
        captions = SHOW_CAPTIONS or (not has_panel and not has_viz)

        # ---- header ----
        title = T(SPEC.get("title", "Algorithm"), font=TFONT, weight=BOLD,
                     font_size=32 if not PORTRAIT else 42, color=th["text"])
        fit_text(title, FW - 1.0)
        title.to_edge(UP, buff=0.42 if not PORTRAIT else 1.0)
        rule = Line(LEFT * 0.5, RIGHT * 0.5, stroke_width=4, color=th["accent"]).next_to(title, DOWN, buff=0.2)
        header_bottom = rule.get_bottom()[1]
        tradition = None
        if SPEC.get("tradition"):
            tradition = fit_text(T(str(SPEC["tradition"]), font=TFONT, font_size=17, color=th["dim"]), FW - 1.2)
            tradition.next_to(rule, DOWN, buff=0.12)
            header_bottom = tradition.get_bottom()[1]

        # ---- content area (between header and caption strip) ----
        cap_h = (1.05 if not PORTRAIT else 1.55) if captions else 0.35
        top = header_bottom - 0.30
        bottom = -FH / 2 + cap_h + 0.28
        content_h = top - bottom
        content_cy = (top + bottom) / 2

        # ---- left panel (code or concept), if any ----
        code_lines, line_nums, panel, code = VGroup(), VGroup(), None, None
        code_scale, chh = 1.0, 0.3
        panel_w_used = 0.0
        if has_panel:
            if MODE == "concept":
                max_w = (FW * 0.40) if (has_viz and not PORTRAIT) else (FW - 1.4)
                code_lines, line_nums, chh = self.build_concept_panel(th, fs, max_w)
            else:
                code_lines, line_nums, chh = self.build_code_panel(th, fs)
            body = VGroup(code_lines, line_nums)
            panel = RoundedRectangle(
                corner_radius=0.0 if th["pixel"] else 0.14, width=body.width + 0.7,
                height=body.height + 0.6, fill_color=th["panel"], fill_opacity=1,
                stroke_color=th["accent"] if th["pixel"] else th["line"], stroke_width=stroke).move_to(body)
            code = VGroup(panel, body)
            if PORTRAIT:
                region_w, region_h = FW - 0.7, content_h * (0.40 if has_viz else 0.95)
            elif has_viz:
                # The panel gets what the code needs (within 34–52% of the frame)
                # so one long line no longer shrinks every line to a squint.
                region_w = min(max(code.width, FW * 0.34), FW * 0.44)
                region_h = content_h
            else:
                region_w, region_h = FW * 0.8, content_h
            code.scale(min(region_w / code.width, region_h / code.height, 1.0))
            code_scale = panel.height / (body.height + 0.6) if body.height > 0 else 1.0
            if PORTRAIT:
                code.move_to([0, top - code.height / 2, 0])
            elif has_viz:
                code.move_to([-FW / 2 + 0.45 + code.width / 2, content_cy, 0])
            else:
                code.move_to([0, content_cy, 0])
            panel_w_used = code.width

        def hl_for(i):
            ln = code_lines[i]
            h = max(ln.height + 0.12 * code_scale, (chh + 0.16) * code_scale)
            return Rectangle(width=panel.width - 0.20 * code_scale, height=h,
                             stroke_width=0, fill_color=th["accent"], fill_opacity=0.20
                             ).move_to([panel.get_center()[0], ln.get_center()[1], 0])

        def marker_for(i):
            ln = code_lines[i]
            h = max(ln.height + 0.12 * code_scale, (chh + 0.16) * code_scale)
            return Rectangle(width=0.07, height=h, stroke_width=0, fill_color=th["accent"], fill_opacity=1
                             ).move_to([panel.get_left()[0] + 0.10 * code_scale, ln.get_center()[1], 0])

        # ---- visualization box ----
        if PORTRAIT:
            vtop = (code.get_bottom()[1] - 0.35) if has_panel else top
            vbox = [0.0, (vtop + bottom) / 2, FW - 0.7, vtop - bottom]
        elif has_panel:
            left = -FW / 2 + 0.45 + panel_w_used + 0.45
            right = FW / 2 - 0.4
            vbox = [(left + right) / 2, content_cy, right - left, content_h]
        else:
            vbox = [0.0, content_cy, FW - 1.4, content_h]
        note_anchor = vars_anchor = None
        if has_notes:
            note_anchor = (vbox[0], vbox[1] + vbox[3] / 2 - 0.25, vbox[2])
            vbox[3] -= 0.62
            vbox[1] -= 0.31
        if has_vars:
            vars_anchor = (vbox[0], vbox[1] - vbox[3] / 2 + 0.24, vbox[2])
            vbox[3] -= 0.62
            vbox[1] += 0.31
        vbox = tuple(vbox)

        surface = None
        if has_viz:
            if VIZ == "graph":
                surface = GraphSurface(th, vbox)
            elif VIZ == "tree":
                surface = GraphSurface(th, vbox, tree=True)
            elif VIZ == "map":
                surface = MapSurface(th, vbox)
            elif VIZ == "grid":
                surface = GridSurface(th, vbox)
            elif VIZ == "table":
                surface = TableSurface(th, vbox)
            elif VIZ == "linkedlist":
                surface = ListSurface(th, vbox)
            elif VIZ == "concept":
                surface = ConceptSurface(th, vbox)
            else:
                surface = ArraySurface(th, vbox)
        note = NoteCallout(th, note_anchor) if has_notes else None
        tracker = VarsTracker(th, vars_anchor, pinned) if has_vars else None

        # ---- intro: exactly INTRO_SECONDS so narration lands on step 1 ----
        t0 = self.renderer.time
        self.play(FadeIn(title, shift=DOWN * 0.2), GrowFromCenter(rule),
                  *([FadeIn(tradition, shift=DOWN * 0.2)] if tradition is not None else []),
                  run_time=0.45)
        if has_panel:
            self.add(panel)
            self.play(LaggedStart(*[FadeIn(l) for l in code_lines], lag_ratio=0.04),
                      FadeIn(line_nums), run_time=0.55)
        if surface is not None:
            surface.build(self)
        intro_extra = tracker.intro() if tracker else []
        highlight = marker = None
        if has_panel:
            highlight = hl_for(0).set_opacity(0)
            marker = marker_for(0).set_opacity(0)
            self.add(highlight, marker)
        if intro_extra:
            self.play(*intro_extra, run_time=0.2)
        self.wait(max(0.05, INTRO_SECONDS - (self.renderer.time - t0)))

        # ---- caption strip + progress bar ----
        cap_w = FW - (1.4 if not PORTRAIT else 0.9)

        def make_caption(txt):
            txt = str(txt or "").strip()
            if not txt:
                return VGroup()
            limit = 78 if not PORTRAIT else 30
            t = T(wrap_text(txt, limit), font=TFONT, font_size=19 if not PORTRAIT else 26,
                     color=th["text"], line_spacing=0.8)
            fit_text(t, cap_w - 0.4, cap_h - 0.25)
            g = pill(t, th, fill=th["panel"], pad_x=0.24, pad_y=0.10, radius=0.12, opacity=0.88)
            return g.move_to([0, -FH / 2 + 0.16 + cap_h / 2, 0]).set_z_index(8)

        caption = VGroup()
        n_steps = max(1, len(steps))
        bar_y = -FH / 2 + 0.06
        track = Line([-FW / 2, bar_y, 0], [FW / 2, bar_y, 0], stroke_width=3, color=th["line"]).set_opacity(0.5)
        prog = Line([-FW / 2, bar_y, 0], [-FW / 2 + 0.001, bar_y, 0], stroke_width=4, color=th["accent"])
        self.add(track, prog)

        # ---- steps on a fixed clock: step k ends at INTRO + sum(dur[:k+1]) ----
        # Anchored to the nominal intro end (not "now"), so an intro that ran a
        # little long is absorbed by the next steps instead of shifting the voice.
        clock = t0 + INTRO_SECONDS
        prev_line = None
        for k, step in enumerate(steps):
            dur = step_dur(step)
            clock += dur
            anims = []
            if has_panel and len(code_lines) > 0:
                li = max(0, min((_int(step.get("line"), 1) or 1) - 1, len(code_lines) - 1))
                anims.append(highlight.animate.become(hl_for(li)))
                anims.append(marker.animate.become(marker_for(li)))
                if li != prev_line:
                    # Focus: the active line is bright; for an argument, points
                    # not reached yet stay faint so the reasoning unfolds.
                    for j, ln in enumerate(code_lines):
                        if MODE == "concept":
                            op = 1.0 if j == li else (0.62 if j < li else 0.32)
                        else:
                            op = 1.0 if j == li else 0.55
                        anims.append(ln.animate.set_opacity(op))
                    prev_line = li
            if surface is not None:
                anims += surface.apply(step)
            if note is not None:
                anims += note.update(step.get("note"))
            if tracker is not None:
                anims += tracker.update(step.get("vars"))
            if captions:
                new_cap = make_caption(step.get("say") or step.get("caption") or "")
                anims += swap(caption if len(caption) else None, new_cap if len(new_cap) else None)
                caption = new_cap
            frac = (k + 1) / n_steps
            anims.append(prog.animate.put_start_and_end_on([-FW / 2, bar_y, 0], [-FW / 2 + FW * frac, bar_y, 0]))
            change_rt = min(0.6, max(0.25, dur * 0.4))
            self.play(*anims, run_time=change_rt)
            if surface is not None:
                surface.extra(self, step, dur, change_rt)
            remaining = clock - self.renderer.time
            if remaining > 0.02:
                self.wait(remaining)

        # ---- outro: optional takeaway card ----
        takeaway = str(SPEC.get("takeaway") or "").strip()
        if takeaway:
            dim = Rectangle(width=FW + 1, height=FH + 1, stroke_width=0, fill_color=th["bg"], fill_opacity=0.82).set_z_index(20)
            t = T(wrap_text(takeaway, 44 if not PORTRAIT else 24), font=TFONT, font_size=30 if not PORTRAIT else 36,
                     color=th["text"], line_spacing=0.9)
            fit_text(t, FW - 2.0, FH * 0.5)
            card = pill(t, th, stroke=th["accent"], fill=th["panel"], pad_x=0.5, pad_y=0.36, radius=0.2, opacity=0.97)
            card.move_to(ORIGIN).set_z_index(21)
            self.play(FadeIn(dim), FadeOut(caption) if len(caption) else Wait(0), run_time=0.4)
            self.play(FadeIn(card, scale=0.94), run_time=0.45)
            self.wait(max(2.0, len(takeaway) / 16.0))
        else:
            self.wait(1.0)
