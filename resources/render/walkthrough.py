"""Deterministic 'code-follows-line' walkthrough renderer (bundled with the app).

Reads spec.json from the working directory and renders a synced animation that
keeps CODE, VISUALS and (optionally) VOICE aligned:

  - the executing code line is highlighted in the left panel;
  - the array is drawn as BARS (height = value) so magnitude and order are
    obvious at a glance — not just a moving cursor;
  - each step can compare, swap, or write values, mark a sub-range, move named
    pointers (i/j/lo/mid/hi/k), and mark finished elements green;
  - each step lasts `dur` seconds when provided (set by the audio pass so the
    narration clip for that step lines up), otherwise a length estimated from
    its spoken line.

The LLM only ever produces the DATA in spec.json — never Manim code — so renders
are consistent and safe. Syntax highlighting is done by tokenizing each line
with Pygments and coloring per-token Text.

Per-step fields (all optional except line):
  line     : 1-based line number executing now
  say      : spoken line for this step (also used as caption / to size the step)
  dur      : exact seconds this step should last (audio pass fills this in)
  range    : [lo, hi] half-open segment currently in play
  compare  : [i, j, ...] indices being compared            -> cyan
  swap     : [i, j] two elements trade places (animated)   -> magenta
  set      : [[i, v], ...] write value v into index i       -> bar morphs
  array    : full new array state (legacy; diffed to writes)
  highlight: [i, ...] legacy alias for `compare`
  pointers : {name: index} markers under the bars
  found    : index to mark done/green (legacy)
  sorted   : [i, ...] indices finalized (green, cumulative)
"""

import json
from manim import *
from pygments import lex
from pygments.lexers import get_lexer_by_name
from pygments.token import Keyword, Name, String, Number, Comment, Operator

# ---------------- Themes ----------------
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
PORTRAIT = SPEC.get("orientation") == "portrait"
SHOW_CAPTIONS = bool(SPEC.get("captions", False))
INTRO_SECONDS = 2.2  # must match the audio pass's leading silence

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


class Walkthrough(Scene):
    def construct(self):
        th = TH
        lines = SPEC.get("code", [])[:22]
        values = [int(v) for v in SPEC.get("array", [])][:9]
        steps = SPEC.get("steps", [])[:60]
        pixel = th["pixel"]
        stroke = 3 if not pixel else 4
        fs = 18 if not PORTRAIT else 22

        # ---------- code panel ----------
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
                lg.add(Text(ch, font=FONT, font_size=fs, color=color)
                       .move_to([col * cw + cw / 2, -row * line_h, 0]))
            if len(lg) == 0:
                lg.add(Rectangle(width=cw, height=chh, stroke_width=0, fill_opacity=0)
                       .move_to([cw / 2, -row * line_h, 0]))
            code_lines.add(lg)

        panel = RoundedRectangle(
            corner_radius=0.0 if pixel else 0.12, width=code_lines.width + 0.8,
            height=code_lines.height + 0.6, fill_color=th["panel"], fill_opacity=1,
            stroke_color=th["accent"] if pixel else th["edge"], stroke_width=stroke,
        ).move_to(code_lines)
        code = VGroup(panel, code_lines)

        title = Text(SPEC.get("title", "Algorithm"), font=FONT, weight=BOLD,
                     font_size=30 if not PORTRAIT else 40, color=th["text"]).to_edge(UP, buff=0.35)

        # ---------- layout ----------
        n = len(values)
        if PORTRAIT:
            region_w, region_h = config.frame_width - 0.8, config.frame_height * 0.42
        else:
            region_w, region_h = config.frame_width * 0.48, config.frame_height - 2.2
        code.scale(min(region_w / code.width, region_h / code.height, 1.0))
        code_scale = code[0].height / (code_lines.height + 0.6)

        if PORTRAIT:
            code.next_to(title, DOWN, buff=0.5)
            region_l = 0.5
            region_r = config.frame_width - 0.5
            baseline_y = code.get_bottom()[1] - 2.9
        else:
            code.to_edge(LEFT, buff=0.45).set_y(-0.2)
            region_l = 0.4
            region_r = config.frame_width * 0.5 - 0.35
            baseline_y = -1.55

        avail = region_r - region_l
        col_w = min(0.95, avail / max(n, 1))
        bar_w = col_w * 0.68
        max_bar_h = 2.7 if not PORTRAIT else 2.4
        center_x = (region_l + region_r) / 2 if not PORTRAIT else 0.0

        def slot_x(i):
            return center_x + (i - (n - 1) / 2) * col_w

        maxv = max(values) if values else 1

        def make_elem(val, i):
            h = 0.45 + (val / maxv) * max_bar_h
            bar = Rectangle(width=bar_w, height=h, stroke_width=stroke,
                            stroke_color=th["edge"], fill_color=th["cell"], fill_opacity=1)
            bar.move_to([slot_x(i), baseline_y + h / 2, 0])
            num = Text(str(val), font=FONT, font_size=19 if not PORTRAIT else 22, color=th["text"])
            num.next_to(bar, UP, buff=0.10)
            return VGroup(bar, num)

        elems = [make_elem(v, i) for i, v in enumerate(values)]
        cur_vals = list(values)
        bars_grp = VGroup(*elems)
        idxs = VGroup(*[Text(str(i), font=FONT, font_size=14, color=th["dim"])
                        .move_to([slot_x(i), baseline_y - 0.26, 0]) for i in range(n)])
        base_line = Line([slot_x(0) - col_w / 2, baseline_y, 0],
                         [slot_x(n - 1) + col_w / 2, baseline_y, 0],
                         stroke_width=2, color=th["dim"]) if n else VGroup()

        target = SPEC.get("target")
        tgt = VGroup()
        if target is not None:
            tgt = Text(f"target = {target}", font=FONT, font_size=20, color=th["accent2"])
            tgt.next_to(bars_grp, UP, buff=0.35)

        range_marker = Line([0, 0, 0], [0, 0, 0], stroke_width=0)

        def range_target(lo, hi):
            lo = max(0, min(lo, n)); hi = max(0, min(hi, n))
            if hi <= lo:
                return Line([0, 0, 0], [0, 0, 0], stroke_width=0)
            x0 = slot_x(lo) - col_w / 2 + 0.05
            x1 = slot_x(hi - 1) + col_w / 2 - 0.05
            y = baseline_y - 0.52
            return Line([x0, y, 0], [x1, y, 0], stroke_width=6, color=th["accent2"])

        cap_w = config.frame_width - 1.2

        def make_caption(txt):
            c = Text(txt or " ", font=FONT, font_size=18, color=th["text"])
            if c.width > cap_w:
                c.scale_to_fit_width(cap_w)
            return c.to_edge(DOWN, buff=0.3)

        caption = make_caption("")

        # ---------- intro (~INTRO_SECONDS) ----------
        self.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.5)
        self.add(panel)
        self.play(LaggedStart(*[FadeIn(l) for l in code_lines], lag_ratio=0.04, run_time=0.8))
        extras = [FadeIn(bars_grp), FadeIn(idxs)]
        if n:
            extras.append(FadeIn(base_line))
        if target is not None:
            extras.append(FadeIn(tgt))
        self.play(*extras, run_time=0.6)

        highlight = Rectangle(width=panel.width - 0.24 * code_scale,
                              height=(chh + 0.16) * code_scale, stroke_width=0,
                              fill_color=th["accent"], fill_opacity=0.22)

        def hl_for(i):
            ln = code_lines[i]
            return highlight.copy().move_to([panel.get_center()[0], ln.get_center()[1], 0])

        self.add(highlight)
        self.play(highlight.animate.become(hl_for(0)), run_time=0.25)
        self.wait(0.05)

        pointers, slots, active_ptrs = {}, {}, set()

        def ptr(name, color):
            tri = Triangle(fill_color=color, fill_opacity=1, stroke_width=0).scale(0.11).rotate(PI)
            lbl = Text(name, font=FONT, font_size=15, color=color)
            return VGroup(tri, lbl).arrange(DOWN, buff=0.04)

        def ptr_pos(name, i):
            slots.setdefault(name, len(slots))
            return [slot_x(i), baseline_y - 0.92 - slots[name] * 0.38, 0]

        sorted_set = set()

        for step in steps:
            dur = float(step.get("dur")) if step.get("dur") is not None else say_time(step.get("say") or step.get("caption"))
            anims = []
            li = max(0, min(int(step.get("line", 1)) - 1, len(code_lines) - 1))
            anims.append(highlight.animate.become(hl_for(li)))

            for s in step.get("sorted", []) or []:
                sorted_set.add(int(s))
            found = step.get("found")
            if found is not None:
                sorted_set.add(int(found))

            rng = step.get("range")
            in_range = set(range(rng[0], rng[1])) if rng and len(rng) == 2 else set()
            compare = set(step.get("compare", []) or step.get("highlight", []) or [])
            swap = step.get("swap")

            # writes: explicit `set`, or diff a full `array`
            setops = []
            if step.get("set"):
                setops = [(int(i), int(v)) for i, v in step["set"]]
            elif isinstance(step.get("array"), list):
                for i, v in enumerate(step["array"][:n]):
                    if i < len(cur_vals) and int(v) != cur_vals[i]:
                        setops.append((i, int(v)))
            set_idx = {i for i, _ in setops}
            for i, v in setops:
                if 0 <= i < n:
                    anims.append(Transform(elems[i], make_elem(v, i)))
                    cur_vals[i] = v

            if rng:
                anims.append(range_marker.animate.become(range_target(rng[0], rng[1])))
            else:
                anims.append(range_marker.animate.set_opacity(0))

            for slot in range(n):
                b = elems[slot][0]
                if slot in sorted_set:
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
                pos = ptr_pos(name, i)
                if name in pointers:
                    anims.append(pointers[name].animate.move_to(pos).set_opacity(1))
                else:
                    p = ptr(name, color).move_to(pos)
                    pointers[name] = p
                    anims.append(FadeIn(p, shift=UP * 0.1))
                active_ptrs.add(name)
            for name in list(active_ptrs):
                if name not in wanted and name in pointers:
                    anims.append(pointers[name].animate.set_opacity(0))
                    active_ptrs.discard(name)

            if SHOW_CAPTIONS:
                new_cap = make_caption(step.get("say") or step.get("caption") or "")
                self.remove(caption)
                anims.append(FadeIn(new_cap))
                caption = new_cap

            change_rt = min(0.55, max(0.2, dur * 0.4))
            self.play(*anims, run_time=change_rt)

            used = change_rt
            if swap and len(swap) == 2:
                a, b = int(swap[0]), int(swap[1])
                if 0 <= a < n and 0 <= b < n:
                    dx = slot_x(b) - slot_x(a)
                    swap_rt = min(0.7, max(0.3, dur * 0.4))
                    self.play(elems[a].animate.shift(RIGHT * dx),
                              elems[b].animate.shift(LEFT * dx), run_time=swap_rt)
                    elems[a], elems[b] = elems[b], elems[a]
                    cur_vals[a], cur_vals[b] = cur_vals[b], cur_vals[a]
                    used += swap_rt

            self.wait(max(0.15, dur - used))

        self.wait(1.0)
