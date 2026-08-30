"""Deterministic multi-structure walkthrough renderer (bundled with the app).

Reads spec.json and renders a synced animation where CODE, VISUALS and (optional)
VOICE stay locked together. The spec's `viz` field picks the drawing surface;
all surfaces share the same step timing, code-line highlight, caption and
per-step `dur` (set by the audio pass) so narration lines up with the visuals.

  viz = "array"       -> bars (sorting / searching / two-pointer)
  viz = "graph"       -> nodes + edges (BFS/DFS/Dijkstra/topological sort)
  viz = "tree"        -> same as graph, positions given by the spec
  viz = "grid"        -> 2-D cells (DP tables, matrices, grid pathfinding)
  viz = "linkedlist"  -> boxes with next-arrows (list traversal / search)
  viz = "concept"     -> abstract-concept scene (actors / zones / links)

The LLM only ever produces DATA (never Manim code), so renders stay safe.

Shared per-step fields: line, say, dur, pointers.
Array   : compare[], swap[i,j], set[[i,v]], range[lo,hi], sorted[], highlight[],
          array[] (legacy), found (legacy)
Graph   : active[], visit[], edge[[u,v]], label{id:txt}, queue[]
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
        cell="#2a2f5e", compare="#00e5ff", swap="#ff5d8f", rng="#3a3f78",
        c_kw="#ffd23f", c_fn="#00e5ff", c_str="#39d98a", c_num="#ff9f1c",
        c_com="#8a8fc7", c_op="#ff5d8f", c_def="#eef0ff", pixel=True,
    ),
    "ink": dict(
        bg="#0f1216", panel="#151a21", text="#e8eaed", dim="#8a92a0",
        accent="#5b7cfa", accent2="#5b7cfa", good="#34d399", edge="#2a313c",
        cell="#1b2028", compare="#5b7cfa", swap="#f0709a", rng="#232a36",
        c_kw="#c792ea", c_fn="#82aaff", c_str="#c3e88d", c_num="#f78c6c",
        c_com="#676e95", c_op="#89ddff", c_def="#e8eaed", pixel=False,
    ),
    "slate": dict(
        bg="#12161c", panel="#171d25", text="#e9edf1", dim="#93a0ad",
        accent="#22c58b", accent2="#7cc4ff", good="#34d399", edge="#2a313c",
        cell="#0d1116", compare="#7cc4ff", swap="#f0709a", rng="#1c242e",
        c_kw="#7cc4ff", c_fn="#22c58b", c_str="#a5e887", c_num="#f4b740",
        c_com="#5f6b7a", c_op="#c7d0da", c_def="#e9edf1", pixel=False,
    ),
    # Scholarly: serif type on black, gold accents. The code panel stays
    # monospace regardless of theme (its per-character layout needs it).
    "manuscript": dict(
        bg="#000000", panel="#0d0d0d", text="#f5f0e6", dim="#8f887a",
        accent="#d4af37", accent2="#9db4d4", good="#7fb069", edge="#1f1f1f",
        cell="#141414", compare="#9db4d4", swap="#c96a6a", rng="#1e1a14",
        c_kw="#d4af37", c_fn="#9db4d4", c_str="#7fb069", c_num="#d99a4e",
        c_com="#6b6558", c_op="#c96a6a", c_def="#f5f0e6", pixel=False,
        font="Times New Roman",
    ),
}

SPEC = json.load(open("spec.json", "r", encoding="utf-8"))
TH = THEMES.get(SPEC.get("theme", "8bit"), THEMES["8bit"])
VIZ = SPEC.get("viz", "array")
# How the left panel is presented:
#   "code"    – syntax-highlighted source (algorithms)
#   "concept" – plain text bullet points (concepts, philosophy, history, math)
#   "visual"  – no panel; the visualization fills the frame
MODE = SPEC.get("mode", "code")
PORTRAIT = SPEC.get("orientation") == "portrait"
SHOW_CAPTIONS = bool(SPEC.get("captions", False))
INTRO_SECONDS = 2.2  # must match narration.ts

config.background_color = TH["bg"]
if PORTRAIT:
    config.pixel_width, config.pixel_height = 1080, 1920
    config.frame_height, config.frame_width = 14.22, 8.0
else:
    config.pixel_width, config.pixel_height = 1280, 720
    config.frame_height, config.frame_width = 8.0, 14.22

FONT = "Monospace"
# Display font for titles, captions and concept labels. Code panels and
# data-structure text stay monospace (their column layout depends on it).
TFONT = TH.get("font", FONT)


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
    return float(step["dur"]) if step.get("dur") is not None else say_time(step.get("say") or step.get("caption"))


# ---------------------------------------------------------------- surfaces ----
class ArraySurface:
    """Bars whose height is the value."""

    def __init__(self, th, region):
        self.th = th
        self.values = [int(v) for v in SPEC.get("array", [])][:12]
        self.region = region  # (l, r, baseline_y)
        self.sorted_set = set()

    def build(self, scene):
        th = self.th
        vals = self.values
        n = len(vals)
        l, r, baseline_y = self.region
        stroke = 4 if th["pixel"] else 3
        self.stroke = stroke
        col_w = min(0.95, (r - l) / max(n, 1))
        self.col_w = col_w
        bar_w = col_w * 0.68
        self.bar_w = bar_w
        max_bar_h = 2.7 if not PORTRAIT else 2.4
        self.baseline_y = baseline_y
        center_x = (l + r) / 2
        maxv = max(vals) if vals else 1
        self.maxv = maxv

        def slot_x(i):
            return center_x + (i - (n - 1) / 2) * col_w
        self.slot_x = slot_x

        def make_elem(val, i):
            h = 0.45 + (val / maxv) * max_bar_h
            bar = Rectangle(width=bar_w, height=h, stroke_width=stroke,
                            stroke_color=th["edge"], fill_color=th["cell"], fill_opacity=1)
            bar.move_to([slot_x(i), baseline_y + h / 2, 0])
            num = Text(str(val), font=FONT, font_size=19, color=th["text"]).next_to(bar, UP, buff=0.10)
            return VGroup(bar, num)
        self.make_elem = make_elem

        self.elems = [make_elem(v, i) for i, v in enumerate(vals)]
        self.cur = list(vals)
        self.bars = VGroup(*self.elems)
        self.idxs = VGroup(*[Text(str(i), font=FONT, font_size=14, color=th["dim"])
                             .move_to([slot_x(i), baseline_y - 0.26, 0]) for i in range(n)])
        self.base = Line([slot_x(0) - col_w / 2, baseline_y, 0],
                         [slot_x(n - 1) + col_w / 2, baseline_y, 0], stroke_width=2, color=th["dim"]) if n else VGroup()
        self.range_marker = Line([0, 0, 0], [0, 0, 0], stroke_width=0)
        self.pointers, self.slots, self.active_ptrs = {}, {}, set()
        scene.play(FadeIn(self.bars), FadeIn(self.idxs), *([FadeIn(self.base)] if n else []), run_time=0.6)
        scene.add(self.range_marker)

    def _range_target(self, lo, hi):
        n = len(self.values)
        lo = max(0, min(lo, n)); hi = max(0, min(hi, n))
        if hi <= lo:
            return Line([0, 0, 0], [0, 0, 0], stroke_width=0)
        x0 = self.slot_x(lo) - self.col_w / 2 + 0.05
        x1 = self.slot_x(hi - 1) + self.col_w / 2 - 0.05
        y = self.baseline_y - 0.52
        return Line([x0, y, 0], [x1, y, 0], stroke_width=6, color=self.th["accent2"])

    def _ptr_pos(self, name, i):
        self.slots.setdefault(name, len(self.slots))
        return [self.slot_x(i), self.baseline_y - 0.92 - self.slots[name] * 0.38, 0]

    def apply(self, step):
        th, anims, n = self.th, [], len(self.values)
        stroke = self.stroke
        for s in step.get("sorted", []) or []:
            self.sorted_set.add(int(s))
        if step.get("found") is not None:
            self.sorted_set.add(int(step["found"]))
        rng = step.get("range")
        in_range = set(range(rng[0], rng[1])) if rng and len(rng) == 2 else set()
        compare = set(step.get("compare", []) or step.get("highlight", []) or [])
        swap = step.get("swap")
        setops = []
        if step.get("set"):
            setops = [(int(i), int(v)) for i, v in step["set"]]
        elif isinstance(step.get("array"), list):
            for i, v in enumerate(step["array"][:n]):
                if i < len(self.cur) and int(v) != self.cur[i]:
                    setops.append((i, int(v)))
        set_idx = {i for i, _ in setops}
        for i, v in setops:
            if 0 <= i < n:
                anims.append(Transform(self.elems[i], self.make_elem(v, i)))
                self.cur[i] = v
        anims.append(self.range_marker.animate.become(self._range_target(*rng)) if rng else self.range_marker.animate.set_opacity(0))
        for slot in range(n):
            b = self.elems[slot][0]
            if slot in self.sorted_set:
                anims.append(b.animate.set_stroke(th["good"], stroke + 1).set_fill(th["good"], 0.30))
            elif slot in set_idx:
                anims.append(b.animate.set_stroke(th["swap"], stroke + 1).set_fill(th["swap"], 0.32))
            elif slot in compare or (swap and slot in swap):
                col = th["swap"] if swap else th["compare"]
                anims.append(b.animate.set_stroke(col, stroke + 1).set_fill(col, 0.30))
            elif slot in in_range:
                anims.append(b.animate.set_stroke(th["accent2"], stroke).set_fill(th["rng"], 1))
            else:
                anims.append(b.animate.set_stroke(th["edge"], stroke).set_fill(th["cell"], 1))
        wanted = step.get("pointers", {}) or {}
        for name, i in wanted.items():
            i = max(0, min(int(i), max(0, n - 1)))
            color = th["accent"] if name.lower() in ("j", "mid", "i", "cur", "k", "p") else th["accent2"]
            pos = self._ptr_pos(name, i)
            if name in self.pointers:
                anims.append(self.pointers[name].animate.move_to(pos).set_opacity(1))
            else:
                p = _ptr(name, color)
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
        if swap and len(swap) == 2:
            a, b = int(swap[0]), int(swap[1])
            n = len(self.values)
            if 0 <= a < n and 0 <= b < n:
                dx = self.slot_x(b) - self.slot_x(a)
                rt = min(0.7, max(0.3, dur * 0.4))
                scene.play(self.elems[a].animate.shift(RIGHT * dx),
                           self.elems[b].animate.shift(LEFT * dx), run_time=rt)
                self.elems[a], self.elems[b] = self.elems[b], self.elems[a]
                self.cur[a], self.cur[b] = self.cur[b], self.cur[a]
                used += rt
        return used


class GraphSurface:
    """Nodes + edges (also used for trees; positions come from the spec)."""

    def __init__(self, th, region):
        self.th = th
        self.region = region
        self.nodes = {nd["id"]: nd for nd in SPEC.get("nodes", [])}
        self.edges = SPEC.get("edges", [])
        self.visited = set()
        self.labels = {}

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.region
        xs = [nd["x"] for nd in self.nodes.values()] or [0, 1]
        ys = [nd["y"] for nd in self.nodes.values()] or [0, 1]
        minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

        def npos(nd):
            fx = (nd["x"] - minx) / (maxx - minx) if maxx > minx else 0.5
            fy = (nd["y"] - miny) / (maxy - miny) if maxy > miny else 0.5
            return [cx + (fx - 0.5) * w, cy + (fy - 0.5) * h, 0]
        self.npos = npos
        self.R = 0.36

        self.edge_lines = {}
        egrp = VGroup()
        for e in self.edges:
            u, v = e[0], e[1]
            if u not in self.nodes or v not in self.nodes:
                continue
            ln = Line(npos(self.nodes[u]), npos(self.nodes[v]), stroke_width=4, color=th["edge"]).set_z_index(0)
            self.edge_lines[(u, v)] = ln
            self.edge_lines[(v, u)] = ln
            egrp.add(ln)
            if len(e) > 2:
                mid = (np.array(npos(self.nodes[u])) + np.array(npos(self.nodes[v]))) / 2
                egrp.add(Text(str(e[2]), font=FONT, font_size=15, color=th["dim"]).move_to(mid + np.array([0, 0.22, 0])))

        self.ncirc = {}
        ngrp = VGroup()
        for nid, nd in self.nodes.items():
            c = Circle(radius=self.R, stroke_width=4, stroke_color=th["accent2"],
                       fill_color=th["cell"], fill_opacity=1).move_to(npos(nd)).set_z_index(1)
            t = Text(str(nid), font=FONT, font_size=19, color=th["text"]).move_to(npos(nd)).set_z_index(2)
            self.ncirc[nid] = c
            ngrp.add(c, t)

        # Only show the queue row if some step actually uses a queue (BFS/DFS);
        # concept maps and plain graphs don't need it.
        self.use_queue = any("queue" in s for s in SPEC.get("steps", []))
        self.queue_row = VGroup(Text("queue:", font=FONT, font_size=17, color=th["dim"])).to_corner(DR, buff=0.45)
        scene.play(Create(egrp), run_time=0.5)
        scene.play(LaggedStart(*[GrowFromCenter(self.ncirc[n]) for n in self.nodes], lag_ratio=0.05, run_time=0.6),
                   *[FadeIn(ngrp[i]) for i in range(1, len(ngrp), 2)])
        if self.use_queue:
            scene.add(self.queue_row)

    def _build_queue(self, items):
        g = VGroup(Text("queue:", font=FONT, font_size=17, color=self.th["dim"]))
        for it in items:
            g.add(VGroup(
                Square(0.5, stroke_width=3, stroke_color=self.th["accent"], fill_color=self.th["panel"], fill_opacity=1),
                Text(str(it), font=FONT, font_size=18, color=self.th["text"]),
            ))
        return g.arrange(RIGHT, buff=0.16).to_corner(DR, buff=0.45)

    def apply(self, step):
        th, anims = self.th, []
        for v in step.get("visit", []) or []:
            self.visited.add(v)
        active = set(step.get("active", []) or [])
        for nid in self.nodes:
            c = self.ncirc[nid]
            if nid in active:
                anims.append(c.animate.set_stroke(th["compare"], 6).set_fill(th["compare"], 0.35))
            elif nid in self.visited:
                anims.append(c.animate.set_stroke(th["good"], 5).set_fill(th["good"], 0.30))
            else:
                anims.append(c.animate.set_stroke(th["accent2"], 4).set_fill(th["cell"], 1))
        for ln in set(self.edge_lines.values()):
            anims.append(ln.animate.set_stroke(th["edge"], 4))
        for e in step.get("edge", []) or []:
            key = (e[0], e[1])
            if key in self.edge_lines:
                anims.append(self.edge_lines[key].animate.set_stroke(th["accent"], 7))
        for nid, txt in (step.get("label", {}) or {}).items():
            if nid in self.nodes:
                target = Text(str(txt), font=FONT, font_size=15, color=th["accent"]).next_to(self.ncirc[nid], DOWN, buff=0.10)
                if nid in self.labels:
                    anims.append(Transform(self.labels[nid], target))
                else:
                    self.labels[nid] = target
                    anims.append(FadeIn(target))
        if "queue" in step:
            anims.append(Transform(self.queue_row, self._build_queue(step.get("queue") or [])))
        return anims

    def extra(self, scene, step, dur, used):
        return used


class GridSurface:
    """2-D grid of cells (DP tables, matrices, grid pathfinding)."""

    def __init__(self, th, region):
        self.th = th
        self.region = region
        self.grid = [[("" if v is None else v) for v in row] for row in SPEC.get("grid", [])]
        self.done = set()

    def build(self, scene):
        th = self.th
        cx, cy, w, h = self.region
        rows = len(self.grid)
        cols = max((len(r) for r in self.grid), default=0)
        self.rows, self.cols = rows, cols
        side = min(1.0, (w) / max(cols, 1), (h) / max(rows, 1))
        self.side = side

        def cpos(r, c):
            x = cx + (c - (cols - 1) / 2) * side
            y = cy + ((rows - 1) / 2 - r) * side
            return [x, y, 0]
        self.cpos = cpos

        self.cells = {}
        self.texts = {}
        grp = VGroup()
        for r in range(rows):
            for c in range(len(self.grid[r])):
                sq = Square(side * 0.92, stroke_width=3, stroke_color=th["edge"],
                            fill_color=th["cell"], fill_opacity=1).move_to(cpos(r, c))
                t = Text(str(self.grid[r][c]), font=FONT, font_size=int(side * 30), color=th["text"]).move_to(cpos(r, c))
                self.cells[(r, c)] = sq
                self.texts[(r, c)] = t
                grp.add(sq, t)
        scene.play(FadeIn(grp), run_time=0.6)

    def _mk_text(self, r, c, val):
        return Text(str(val), font=FONT, font_size=int(self.side * 30), color=self.th["text"]).move_to(self.cpos(r, c))

    def apply(self, step):
        th, anims = self.th, []
        for rc in step.get("gdone", []) or []:
            self.done.add((rc[0], rc[1]))
        compare = {(x[0], x[1]) for x in (step.get("gcompare", []) or [])}
        path = {(x[0], x[1]) for x in (step.get("gpath", []) or [])}
        sets = step.get("gset", []) or []
        set_rc = {(x[0], x[1]) for x in sets}
        for x in sets:
            r, c, v = x[0], x[1], x[2]
            if (r, c) in self.texts:
                anims.append(Transform(self.texts[(r, c)], self._mk_text(r, c, v)))
        for (r, c), sq in self.cells.items():
            if (r, c) in path:
                anims.append(sq.animate.set_stroke(th["accent"], 5).set_fill(th["accent"], 0.28))
            elif (r, c) in set_rc:
                anims.append(sq.animate.set_stroke(th["swap"], 5).set_fill(th["swap"], 0.30))
            elif (r, c) in compare:
                anims.append(sq.animate.set_stroke(th["compare"], 5).set_fill(th["compare"], 0.28))
            elif (r, c) in self.done:
                anims.append(sq.animate.set_stroke(th["good"], 4).set_fill(th["good"], 0.24))
            else:
                anims.append(sq.animate.set_stroke(th["edge"], 3).set_fill(th["cell"], 1))
        return anims

    def extra(self, scene, step, dur, used):
        return used


class ListSurface:
    """Singly linked list: boxes with next-arrows (traversal / search / build)."""

    def __init__(self, th, region):
        self.th = th
        self.region = region
        self.values = [v for v in SPEC.get("array", [])][:10]

    def build(self, scene):
        th = self.th
        l, r, cy = self.region
        n = len(self.values)
        self.cy = cy
        col_w = min(1.7, (r - l) / max(n, 1))
        self.col_w = col_w
        box_w = col_w * 0.6
        self.box_w = box_w
        cx = (l + r) / 2

        def slot_x(i):
            return cx + (i - (n - 1) / 2) * col_w
        self.slot_x = slot_x

        grp = VGroup()
        self.boxes = {}
        self.texts = {}
        for i, v in enumerate(self.values):
            b = RoundedRectangle(corner_radius=0.08, width=box_w, height=0.9, stroke_width=3,
                                 stroke_color=th["accent2"], fill_color=th["cell"], fill_opacity=1).move_to([slot_x(i), cy, 0])
            t = Text(str(v), font=FONT, font_size=22, color=th["text"]).move_to([slot_x(i), cy, 0])
            self.boxes[i] = b
            self.texts[i] = t
            grp.add(b, t)
            if i < n - 1:
                grp.add(Arrow([slot_x(i) + box_w / 2, cy, 0], [slot_x(i + 1) - box_w / 2, cy, 0],
                              buff=0.05, stroke_width=4, color=th["dim"], max_tip_length_to_length_ratio=0.25))
        nullt = Text("None", font=FONT, font_size=16, color=th["dim"]).next_to(grp, RIGHT, buff=0.2)
        grp.add(Arrow([slot_x(n - 1) + box_w / 2, cy, 0], nullt.get_left(), buff=0.08,
                      stroke_width=4, color=th["dim"], max_tip_length_to_length_ratio=0.3), nullt)
        self.pointers, self.slots, self.active_ptrs = {}, {}, set()
        scene.play(FadeIn(grp), run_time=0.7)

    def _ptr_pos(self, name, i):
        self.slots.setdefault(name, len(self.slots))
        return [self.slot_x(i), self.cy + 0.75 + self.slots[name] * 0.42, 0]

    def apply(self, step):
        th, anims, n = self.th, [], len(self.values)
        compare = set(step.get("compare", []) or step.get("highlight", []) or [])
        found = step.get("found")
        done = set()
        if found is not None:
            done.add(int(found))
        for i, v in (step.get("set", []) or []):
            if int(i) in self.texts:
                anims.append(Transform(self.texts[int(i)],
                             Text(str(v), font=FONT, font_size=22, color=th["text"]).move_to([self.slot_x(int(i)), self.cy, 0])))
        for i in range(n):
            b = self.boxes[i]
            if i in done:
                anims.append(b.animate.set_stroke(th["good"], 4).set_fill(th["good"], 0.28))
            elif i in compare:
                anims.append(b.animate.set_stroke(th["compare"], 4).set_fill(th["compare"], 0.28))
            else:
                anims.append(b.animate.set_stroke(th["accent2"], 3).set_fill(th["cell"], 1))
        wanted = step.get("pointers", {}) or {}
        for name, i in wanted.items():
            i = max(0, min(int(i), max(0, n - 1)))
            color = th["accent"] if name.lower() in ("cur", "p", "i", "fast") else th["accent2"]
            pos = self._ptr_pos(name, i)
            if name in self.pointers:
                anims.append(self.pointers[name].animate.move_to(pos).set_opacity(1))
            else:
                p = _ptr(name, color, up=True)
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
        t = Text(str(text), font=TFONT, font_size=14, color=self.th["dim"]).set_z_index(2)
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
            g.add(Text(str(z["label"]), font=TFONT, font_size=15, color=color)
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
        assert self._point_in_zone(p, zone_id, margin=0.05), (
            f"enter slot for {actor_id} fell outside zone {zone_id}")
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
            probe = Text(str(a["label"]), font=TFONT, font_size=14)
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
                    cx, cy, w, h = self.region
                    zx0, zy0, zx1, zy1 = self._zone_bbox(zid)
                    zone_fills_region = (zx1 - zx0 >= w - 0.9) and (zy1 - zy0 >= h - 0.9)
                    assert zone_fills_region or not self._point_in_zone(t, zid), (
                        f"scatter left {i} inside zone {zid}")
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
                probe = Text(str(a["label"]), font=TFONT, font_size=14)
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
                probe = Text(str(txt), font=TFONT, font_size=14)
                lp = self._pick_label_pos(
                    targets.get(aid, shape.get_center()), shape.width * f, shape.height * f,
                    probe.width, probe.height,
                    self._occupied_rects(skip_labels={aid}, planned=targets))
            if aid in relabel:
                new = Text(relabel[aid], font=TFONT, font_size=14, color=th["dim"]).move_to(lp).set_z_index(2)
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
                probe = Text(str(txt), font=TFONT, font_size=14)
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



def _ptr(name, color, up=False):
    tri = Triangle(fill_color=color, fill_opacity=1, stroke_width=0).scale(0.11)
    if not up:
        tri.rotate(PI)
    lbl = Text(name, font=FONT, font_size=15, color=color)
    return VGroup(tri, lbl).arrange(UP if up else DOWN, buff=0.05)


# ------------------------------------------------------------------- scene ----
class Walkthrough(Scene):
    def build_code_panel(self, th, panel_w, fs):
        """Syntax-highlighted source on a true monospace grid."""
        lines = SPEC.get("code", [])[:22]
        one = Text("M", font=FONT, font_size=fs); two = Text("MM", font=FONT, font_size=fs)
        cw = two.width - one.width; chh = one.height; line_h = chh + 0.24
        try:
            lexer = get_lexer_by_name(SPEC.get("language", "python"))
        except Exception:
            lexer = get_lexer_by_name("text")

        def line_chars(src):
            out = []
            for ttype, val in lex(src, lexer):
                color = tok_color(ttype)
                for ch in val.rstrip("\n"):
                    out.append((ch, color))
            return out

        rows = VGroup()
        for row, src in enumerate(lines):
            lg = VGroup()
            for col, (ch, color) in enumerate(line_chars(src)):
                if ch == " ":
                    continue
                lg.add(Text(ch, font=FONT, font_size=fs, color=color).move_to([col * cw + cw / 2, -row * line_h, 0]))
            if len(lg) == 0:
                lg.add(Rectangle(width=cw, height=chh, stroke_width=0, fill_opacity=0).move_to([cw / 2, -row * line_h, 0]))
            rows.add(lg)
        return rows, chh

    def build_concept_panel(self, th, panel_w, fs):
        """Plain bullet points (one Text per point), for non-code topics."""
        lines = SPEC.get("code", [])[:14]
        fs2 = fs + 3
        one = Text("M", font=FONT, font_size=fs2)
        chh = one.height
        line_h = chh + 0.55
        max_w = panel_w - 0.7
        rows = VGroup()
        for row, src in enumerate(lines):
            txt = Text(f"•  {src}", font=FONT, font_size=fs2, color=th["text"])
            if txt.width > max_w:
                txt.scale_to_fit_width(max_w)
            txt.move_to([txt.width / 2, -row * line_h, 0])
            rows.add(VGroup(txt))
        return rows, chh

    def construct(self):
        th = TH
        steps = SPEC.get("steps", [])[:60]
        fs = 18 if not PORTRAIT else 22
        stroke = 4 if th["pixel"] else 3
        has_panel = MODE in ("code", "concept") and len(SPEC.get("code", [])) > 0
        has_viz = VIZ != "none"

        title = Text(SPEC.get("title", "Algorithm"), font=TFONT, weight=BOLD,
                     font_size=30 if not PORTRAIT else 40, color=th["text"]).to_edge(UP, buff=0.35)
        # Whose account this animates (concept mode) — shown under the title.
        tradition = None
        if SPEC.get("tradition"):
            tradition = Text(str(SPEC["tradition"]), font=TFONT, font_size=16,
                             color=th["dim"]).next_to(title, DOWN, buff=0.12)

        # ---- build the left panel (code or concept), if any ----
        code_lines = VGroup()
        panel = None
        code_scale = 1.0
        chh = 0.3
        if has_panel:
            # panel target width depends on whether a viz shares the frame
            panel_target_w = (config.frame_width * 0.46) if has_viz else (config.frame_width * 0.8)
            if MODE == "concept":
                code_lines, chh = self.build_concept_panel(th, panel_target_w, fs)
            else:
                code_lines, chh = self.build_code_panel(th, panel_target_w, fs)
            panel = RoundedRectangle(
                corner_radius=0.0 if th["pixel"] else 0.12, width=code_lines.width + 0.8,
                height=code_lines.height + 0.6, fill_color=th["panel"], fill_opacity=1,
                stroke_color=th["accent"] if th["pixel"] else th["edge"], stroke_width=stroke).move_to(code_lines)
            code = VGroup(panel, code_lines)
            if PORTRAIT:
                region_w, region_h = config.frame_width - 0.8, config.frame_height * (0.40 if has_viz else 0.72)
            else:
                region_w, region_h = panel_target_w, config.frame_height - 2.2
            if tradition is not None:
                region_h -= 0.5
            code.scale(min(region_w / code.width, region_h / code.height, 1.0))
            code_scale = panel.height / (code_lines.height + 0.6)
            if PORTRAIT:
                code.next_to(tradition if tradition is not None else title, DOWN, buff=0.5)
            elif has_viz:
                code.to_edge(LEFT, buff=0.45).set_y(-0.2 if tradition is None else -0.35)
            else:
                code.move_to([0, -0.2, 0])  # centered when it's the only element

        def hl_for(i):
            ln = code_lines[i]
            return Rectangle(width=panel.width - 0.24 * code_scale, height=(chh + 0.16) * code_scale,
                             stroke_width=0, fill_color=th["accent"], fill_opacity=0.22
                             ).move_to([panel.get_center()[0], ln.get_center()[1], 0])

        # ---- pick the drawing surface (region depends on whether a panel shares the frame) ----
        surface = None
        if has_viz:
            if PORTRAIT:
                below = (code.get_bottom()[1] if has_panel else config.frame_height / 2 - 1.6)
                # Portrait uses centered coords (0 = frame center), so the bar
                # region must be centered too — not 0..frame_width, which shoved
                # the array off the right edge in Shorts.
                half = config.frame_width / 2
                arr_region = (-half + 0.5, half - 0.5, below - (2.9 if has_panel else 0.5))
                gg_region = (0.0, below - (2.4 if has_panel else 0.2), config.frame_width - 1.0, 4.4)
                list_region = (-half + 0.5, half - 0.5, below - (2.2 if has_panel else 0.4))
            elif has_panel:
                # right half of the frame (centered coords: 0 = frame center)
                arr_region = (0.4, config.frame_width * 0.5 - 0.35, -1.55)
                gg_region = (config.frame_width * 0.25 + 0.05, 0.35, config.frame_width * 0.40, 4.4)
                list_region = (0.4, config.frame_width * 0.5 - 1.2, 0.2)
            else:  # viz fills the whole frame
                arr_region = (-config.frame_width / 2 + 0.6, config.frame_width / 2 - 0.6, -1.4)
                gg_region = (0.0, -0.2, config.frame_width - 2.0, 5.0)
                list_region = (-config.frame_width / 2 + 0.6, config.frame_width / 2 - 0.6, 0.0)
            if VIZ in ("graph", "tree"):
                surface = GraphSurface(th, gg_region)
            elif VIZ == "grid":
                surface = GridSurface(th, gg_region)
            elif VIZ == "linkedlist":
                surface = ListSurface(th, list_region)
            elif VIZ == "concept":
                surface = ConceptSurface(th, gg_region)
            else:
                surface = ArraySurface(th, arr_region)

        # ---- intro (~INTRO_SECONDS) ----
        self.play(FadeIn(title, shift=DOWN * 0.2),
                  *([FadeIn(tradition, shift=DOWN * 0.2)] if tradition is not None else []),
                  run_time=0.5)
        if has_panel:
            self.add(panel)
            self.play(LaggedStart(*[FadeIn(l) for l in code_lines], lag_ratio=0.04, run_time=0.8))
        else:
            self.wait(0.8)
        if surface is not None:
            surface.build(self)
        else:
            self.wait(0.6)

        highlight = None
        if has_panel:
            highlight = hl_for(0).set_opacity(0)
            self.add(highlight)
            self.play(highlight.animate.become(hl_for(0)), run_time=0.25)
        self.wait(0.05)

        cap_w = config.frame_width - 1.2

        def make_caption(txt):
            c = Text(txt or " ", font=TFONT, font_size=18, color=th["text"])
            if c.width > cap_w:
                c.scale_to_fit_width(cap_w)
            return c.to_edge(DOWN, buff=0.3)

        caption = make_caption("")

        for step in steps:
            dur = step_dur(step)
            anims = []
            if has_panel and len(code_lines) > 0:
                li = max(0, min(int(step.get("line", 1)) - 1, len(code_lines) - 1))
                anims.append(highlight.animate.become(hl_for(li)))
            if surface is not None:
                anims += surface.apply(step)
            if SHOW_CAPTIONS or (not has_panel and not has_viz):
                new_cap = make_caption(step.get("say") or step.get("caption") or "")
                self.remove(caption)
                anims.append(FadeIn(new_cap))
                caption = new_cap
            change_rt = min(0.55, max(0.2, dur * 0.4))
            if anims:
                self.play(*anims, run_time=change_rt)
                used = surface.extra(self, step, dur, change_rt) if surface is not None else change_rt
            else:
                self.wait(change_rt)
                used = change_rt
            self.wait(max(0.15, dur - used))

        self.wait(1.0)
