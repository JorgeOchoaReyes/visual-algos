"""Deterministic 'code-follows-line' walkthrough renderer (bundled with the app).

Reads spec.json from the working directory and renders a synced animation:
each step highlights the executing code line, then updates the array
visualization (comparisons, pointers, swaps, found) — all in Manim.

The LLM only ever produces the DATA in spec.json — never Manim code — so renders
are consistent and safe. Syntax highlighting is done by tokenizing each line
with Pygments and coloring per-token Text (avoids Manim Code's markup issues and
works with any font).
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
        cell="#2a2f5e",
        c_kw="#ffd23f", c_fn="#00e5ff", c_str="#39d98a", c_num="#ff9f1c",
        c_com="#8a8fc7", c_op="#ff5d8f", c_def="#eef0ff", pixel=True,
    ),
    "ink": dict(
        bg="#0f1216", panel="#151a21", text="#e8eaed", dim="#8a92a0",
        accent="#5b7cfa", accent2="#5b7cfa", good="#34d399", edge="#2a313c",
        cell="#1b2028",
        c_kw="#c792ea", c_fn="#82aaff", c_str="#c3e88d", c_num="#f78c6c",
        c_com="#676e95", c_op="#89ddff", c_def="#e8eaed", pixel=False,
    ),
    "slate": dict(
        bg="#12161c", panel="#171d25", text="#e9edf1", dim="#93a0ad",
        accent="#22c58b", accent2="#7cc4ff", good="#34d399", edge="#2a313c",
        cell="#0d1116",
        c_kw="#7cc4ff", c_fn="#22c58b", c_str="#a5e887", c_num="#f4b740",
        c_com="#5f6b7a", c_op="#c7d0da", c_def="#e9edf1", pixel=False,
    ),
}

SPEC = json.load(open("spec.json", "r", encoding="utf-8"))
TH = THEMES.get(SPEC.get("theme", "8bit"), THEMES["8bit"])
PORTRAIT = SPEC.get("orientation") == "portrait"

config.background_color = TH["bg"]
if PORTRAIT:
    config.pixel_width, config.pixel_height = 1080, 1920
    config.frame_height, config.frame_width = 14.22, 8.0
else:
    config.pixel_width, config.pixel_height = 1280, 720
    config.frame_height, config.frame_width = 8.0, 14.22

FONT = "Monospace"


def tok_color(t):
    if t in Comment:
        return TH["c_com"]
    if t in Keyword:
        return TH["c_kw"]
    if t in String:
        return TH["c_str"]
    if t in Number:
        return TH["c_num"]
    if t in Name.Builtin or t in Name.Function or t in Name.Class:
        return TH["c_fn"]
    if t in Operator:
        return TH["c_op"]
    return TH["c_def"]


class Walkthrough(Scene):
    def construct(self):
        th = TH
        lines = SPEC.get("code", [])[:14]
        values = list(SPEC.get("array", []))[:9]
        target = SPEC.get("target")
        steps = SPEC.get("steps", [])[:44]
        pixel = th["pixel"]
        stroke = 4 if pixel else 2
        fs = 20 if not PORTRAIT else 22

        # True monospace grid: fixed column advance so nothing overlaps and
        # indentation is preserved. cw = per-character advance width.
        one = Text("M", font=FONT, font_size=fs)
        two = Text("MM", font=FONT, font_size=fs)
        cw = (two.width - one.width)
        chh = one.height
        line_h = chh + 0.30  # generous vertical breathing room

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
            corner_radius=0.0 if pixel else 0.14,
            width=code_lines.width + 1.0, height=code_lines.height + 0.8,
            fill_color=th["panel"], fill_opacity=1,
            stroke_color=th["accent"] if pixel else th["edge"], stroke_width=stroke,
        ).move_to(code_lines)
        code = VGroup(panel, code_lines)

        # Title
        title = Text(SPEC.get("title", "Algorithm"), font=FONT, weight=BOLD,
                     font_size=34 if not PORTRAIT else 40, color=th["text"]).to_edge(UP, buff=0.45)

        # Array
        n = len(values)
        side = min(0.62, (config.frame_width - 1.4) / max(n, 1))
        boxes = VGroup(*[Square(side).set_stroke(th["edge"], stroke).set_fill(th["cell"], 1) for _ in values])
        boxes.arrange(RIGHT, buff=0.10)
        nums = VGroup(*[Text(str(v), font=FONT, font_size=int(side * 34), color=th["text"]).move_to(b)
                        for v, b in zip(values, boxes)])
        idxs = VGroup(*[Text(str(i), font=FONT, font_size=13, color=th["dim"]).next_to(boxes[i], UP, buff=0.12)
                        for i in range(n)])
        array_grp = VGroup(boxes, nums, idxs)

        tgt = VGroup()
        if target is not None:
            tgt = Text(f"target = {target}", font=FONT, font_size=22, color=th["accent2"])

        # Layout
        # Scale the code block to fit its region, keeping the generous spacing.
        if PORTRAIT:
            region_w, region_h = config.frame_width - 0.9, config.frame_height * 0.40
        else:
            region_w, region_h = config.frame_width * 0.5 - 0.5, config.frame_height - 2.5
        code_scale = min(region_w / code.width, region_h / code.height, 1.0)
        code.scale(code_scale)

        if PORTRAIT:
            code.next_to(title, DOWN, buff=0.6)
            array_grp.next_to(code, DOWN, buff=1.0)
        else:
            code.to_edge(LEFT, buff=0.55).shift(DOWN * 0.1)
            array_grp.to_edge(RIGHT, buff=0.7).shift(UP * 1.6)
        if target is not None:
            tgt.next_to(array_grp, UP, buff=0.5)

        hl_h = (chh + 0.20) * code_scale

        def hl_for(i):
            ln = code_lines[i]
            r = Rectangle(width=panel.width - 0.28 * code_scale, height=hl_h, stroke_width=0,
                          fill_color=th["accent"], fill_opacity=0.20)
            return r.move_to([panel.get_center()[0], ln.get_center()[1], 0])

        highlight = hl_for(0).set_opacity(0)
        caption = Text("", font=FONT, font_size=22, color=th["text"]).to_edge(DOWN, buff=0.6)

        # Intro
        self.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.5)
        self.add(panel, highlight)
        self.play(LaggedStart(*[FadeIn(l, shift=RIGHT * 0.08) for l in code_lines], lag_ratio=0.05, run_time=0.9))
        self.play(FadeIn(boxes), FadeIn(nums), FadeIn(idxs),
                  *([FadeIn(tgt)] if target is not None else []), run_time=0.6)
        self.play(highlight.animate.become(hl_for(0)), run_time=0.25)

        pointers, slots = {}, {}

        def ptr(name, color):
            tri = Triangle(fill_color=color, fill_opacity=1, stroke_width=0).scale(0.11).rotate(PI)
            lbl = Text(name, font=FONT, font_size=16, color=color)
            return VGroup(tri, lbl).arrange(DOWN, buff=0.05)

        def ptr_pos(name, i):
            slots.setdefault(name, len(slots))
            return boxes[i].get_bottom() + DOWN * (0.16 + slots[name] * 0.4)

        for step in steps:
            anims = []
            li = max(0, min(int(step.get("line", 1)) - 1, len(code_lines) - 1))
            anims.append(highlight.animate.become(hl_for(li)))

            if isinstance(step.get("array"), list):
                for i, nv in enumerate(step["array"][:n]):
                    if i < len(nums) and str(nv) != nums[i].text:
                        anims.append(Transform(nums[i], Text(str(nv), font=FONT,
                                     font_size=int(side * 34), color=th["text"]).move_to(boxes[i])))

            hlset = set(step.get("highlight", []) or [])
            found = step.get("found")
            for i, sq in enumerate(boxes):
                if found is not None and i == found:
                    anims.append(sq.animate.set_stroke(th["good"], stroke + 1).set_fill(th["good"], 0.28))
                elif i in hlset:
                    anims.append(sq.animate.set_stroke(th["accent"], stroke + 1).set_fill(th["accent"], 0.24))
                else:
                    anims.append(sq.animate.set_stroke(th["edge"], stroke).set_fill(th["cell"], 1))

            for name, i in (step.get("pointers", {}) or {}).items():
                i = max(0, min(int(i), n - 1))
                color = th["accent"] if name.lower() in ("mid", "cur", "i", "j", "p", "k") else th["accent2"]
                pos = ptr_pos(name, i)
                if name in pointers:
                    anims.append(pointers[name].animate.move_to(pos))
                else:
                    p = ptr(name, color).move_to(pos)
                    pointers[name] = p
                    anims.append(FadeIn(p, shift=UP * 0.1))

            new_cap = Text(step.get("caption", ""), font=FONT, font_size=22, color=th["text"]).to_edge(DOWN, buff=0.6)
            anims += [FadeOut(caption, run_time=0.2), FadeIn(new_cap)]

            self.play(*anims, run_time=0.8)
            caption = new_cap
            self.wait(0.5)

        self.wait(1.2)
