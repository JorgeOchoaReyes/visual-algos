"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

const EXAMPLES = [
  "Binary search on a sorted array",
  "Dijkstra's shortest path",
  "Quicksort partitioning",
  "How a hash table handles collisions",
  "Breadth-first search on a graph",
  "The two-pointer technique",
];

export default function Home() {
  const { user, signInWithGoogle } = useAuth();

  return (
    <div className="grid-bg">
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
        <div className="mx-auto mb-6 w-fit rounded-full border border-edge bg-panel px-3 py-1 text-xs text-white/60">
          Manim · Gemini · Firebase
        </div>
        <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Turn any algorithm into a{" "}
          <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">
            math video
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-white/60">
          Type a computer-science topic. AI writes a 3Blue1Brown-style Manim
          scene, renders it to a real video, and saves it to your library.
        </p>

        <div className="mt-9 flex items-center justify-center gap-3">
          {user ? (
            <Link
              href="/new"
              className="rounded-lg bg-accent px-6 py-3 font-medium text-white hover:bg-accent/90"
            >
              Create a video
            </Link>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="rounded-lg bg-accent px-6 py-3 font-medium text-white hover:bg-accent/90"
            >
              Get started — it's free
            </button>
          )}
          <a
            href="https://www.manim.community/"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-edge px-6 py-3 font-medium text-white/70 hover:bg-panel"
          >
            What's Manim?
          </a>
        </div>

        <div className="mt-14">
          <p className="text-xs uppercase tracking-widest text-white/30">Try a topic</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => (
              <Link
                key={e}
                href={user ? `/new?topic=${encodeURIComponent(e)}` : "/"}
                onClick={(ev) => {
                  if (!user) {
                    ev.preventDefault();
                    signInWithGoogle();
                  }
                }}
                className="rounded-full border border-edge bg-panel px-3.5 py-1.5 text-sm text-white/70 hover:border-accent/50 hover:text-white"
              >
                {e}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { n: "1", t: "Describe it", d: "Enter any algorithm or data-structure topic in plain English." },
            { n: "2", t: "AI animates it", d: "Gemini writes a Manim scene; a render worker turns it into video." },
            { n: "3", t: "Watch & share", d: "Your video lands in your library, ready to play and download." },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-edge bg-panel p-5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent2 text-sm font-semibold">
                {s.n}
              </div>
              <h3 className="mt-3 font-medium">{s.t}</h3>
              <p className="mt-1 text-sm text-white/55">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
