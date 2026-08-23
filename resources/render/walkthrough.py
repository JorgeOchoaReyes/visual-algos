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

The LLM only ever produces DATA (never Manim code), so renders stay safe.

Shared per-step fields: line, say, dur, pointers.
Array   : compare[], swap[i,j], set[[i,v]], range[lo,hi], sorted[], highlight[],
          array[] (legacy), found (legacy)
Graph   : active[], visit[], edge[[u,v]], label{id:txt}, queue[]
Grid    : gcompare[[r,c]], gset[[r,c,v]], gdone[[r,c]], gpath[[r,c]]
List    : compare[], set[[i,v]], pointers{name:index}, found
"""

import json
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
}

SPEC = json.load(open("spec.json", "r", encoding="utf-8"))
TH = THEMES.get(SPEC.get("theme", "8bit"), THEMES["8bit"])
VIZ = SPEC.get("viz", "array")
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

        self.queue_row = VGroup(Text("queue:", font=FONT, font_size=17, color=th["dim"])).to_corner(DR, buff=0.45)
        scene.play(Create(egrp), run_time=0.5)
        scene.play(LaggedStart(*[GrowFromCenter(self.ncirc[n]) for n in self.nodes], lag_ratio=0.05, run_time=0.6),
                   *[FadeIn(ngrp[i]) for i in range(1, len(ngrp), 2)])
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


def _ptr(name, color, up=False):
    tri = Triangle(fill_color=color, fill_opacity=1, stroke_width=0).scale(0.11)
    if not up:
        tri.rotate(PI)
    lbl = Text(name, font=FONT, font_size=15, color=color)
    return VGroup(tri, lbl).arrange(UP if up else DOWN, buff=0.05)


# ------------------------------------------------------------------- scene ----
class Walkthrough(Scene):
    def construct(self):
        th = TH
        lines = SPEC.get("code", [])[:22]
        steps = SPEC.get("steps", [])[:60]
        fs = 18 if not PORTRAIT else 22
        stroke = 4 if th["pixel"] else 3

        one = Text("M", font=FONT, font_size=fs); two = Text("MM", font=FONT, font_size=fs)
        cw = two.width - one.width; chh = one.height; line_h = chh + 0.24
        lexer = get_lexer_by_name(SPEC.get("language", "python"))

        def line_chars(src):
            out = []
            for ttype, val in lex(src, lexer):
                color = tok_color(ttype)
                for ch in val.rstrip("\n"):
                    out.append((ch, color))
            return out

        code_lines = VGroup()
        for row, src in enumerate(lines):
            lg = VGroup()
            for col, (ch, color) in enumerate(line_chars(src)):
                if ch == " ":
                    continue
                lg.add(Text(ch, font=FONT, font_size=fs, color=color).move_to([col * cw + cw / 2, -row * line_h, 0]))
            if len(lg) == 0:
                lg.add(Rectangle(width=cw, height=chh, stroke_width=0, fill_opacity=0).move_to([cw / 2, -row * line_h, 0]))
            code_lines.add(lg)

        panel = RoundedRectangle(corner_radius=0.0 if th["pixel"] else 0.12, width=code_lines.width + 0.8,
                                 height=code_lines.height + 0.6, fill_color=th["panel"], fill_opacity=1,
                                 stroke_color=th["accent"] if th["pixel"] else th["edge"], stroke_width=stroke).move_to(code_lines)
        code = VGroup(panel, code_lines)
        title = Text(SPEC.get("title", "Algorithm"), font=FONT, weight=BOLD,
                     font_size=30 if not PORTRAIT else 40, color=th["text"]).to_edge(UP, buff=0.35)

        if PORTRAIT:
            region_w, region_h = config.frame_width - 0.8, config.frame_height * 0.42
        else:
            region_w, region_h = config.frame_width * 0.48, config.frame_height - 2.2
        code.scale(min(region_w / code.width, region_h / code.height, 1.0))
        code_scale = code[0].height / (code_lines.height + 0.6)
        if PORTRAIT:
            code.next_to(title, DOWN, buff=0.5)
        else:
            code.to_edge(LEFT, buff=0.45).set_y(-0.2)

        def hl_for(i):
            ln = code_lines[i]
            return Rectangle(width=panel.width - 0.24 * code_scale, height=(chh + 0.16) * code_scale,
                             stroke_width=0, fill_color=th["accent"], fill_opacity=0.22
                             ).move_to([panel.get_center()[0], ln.get_center()[1], 0])

        # pick the drawing surface
        if PORTRAIT:
            arr_region = (0.5, config.frame_width - 0.5, code.get_bottom()[1] - 2.9)
            gg_region = (0.0, code.get_bottom()[1] - 2.4, config.frame_width - 1.0, 4.0)
            list_region = (0.5, config.frame_width - 0.5, code.get_bottom()[1] - 2.2)
        else:
            arr_region = (0.4, config.frame_width * 0.5 - 0.35, -1.55)
            gg_region = (config.frame_width * 0.25 + 0.05, 0.35, config.frame_width * 0.40, 4.4)
            # leave room on the right for the trailing "-> None" terminator
            list_region = (0.4, config.frame_width * 0.5 - 1.2, 0.2)

        if VIZ == "graph" or VIZ == "tree":
            surface = GraphSurface(th, gg_region)
        elif VIZ == "grid":
            surface = GridSurface(th, gg_region)
        elif VIZ == "linkedlist":
            surface = ListSurface(th, list_region)
        else:
            surface = ArraySurface(th, arr_region)

        # intro (~INTRO_SECONDS)
        self.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.5)
        self.add(panel)
        self.play(LaggedStart(*[FadeIn(l) for l in code_lines], lag_ratio=0.04, run_time=0.8))
        surface.build(self)

        highlight = hl_for(0).set_opacity(0)
        self.add(highlight)
        self.play(highlight.animate.become(hl_for(0)), run_time=0.25)
        self.wait(0.05)

        cap_w = config.frame_width - 1.2

        def make_caption(txt):
            c = Text(txt or " ", font=FONT, font_size=18, color=th["text"])
            if c.width > cap_w:
                c.scale_to_fit_width(cap_w)
            return c.to_edge(DOWN, buff=0.3)

        caption = make_caption("")

        for step in steps:
            dur = step_dur(step)
            li = max(0, min(int(step.get("line", 1)) - 1, len(code_lines) - 1))
            anims = [highlight.animate.become(hl_for(li))]
            anims += surface.apply(step)
            if SHOW_CAPTIONS:
                new_cap = make_caption(step.get("say") or step.get("caption") or "")
                self.remove(caption)
                anims.append(FadeIn(new_cap))
                caption = new_cap
            change_rt = min(0.55, max(0.2, dur * 0.4))
            self.play(*anims, run_time=change_rt)
            used = surface.extra(self, step, dur, change_rt)
            self.wait(max(0.15, dur - used))

        self.wait(1.0)
