"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-edge/60 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-accent2 text-sm">
            ∑
          </span>
          <span>Visual Algos</span>
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          {user && (
            <>
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-1.5 text-white/70 hover:bg-panel hover:text-white"
              >
                My videos
              </Link>
              <Link
                href="/new"
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent/90"
              >
                New video
              </Link>
            </>
          )}

          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-panel" />
          ) : user ? (
            <div className="flex items-center gap-2 pl-2">
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  className="h-7 w-7 rounded-full border border-edge"
                />
              ) : null}
              <button
                onClick={() => signOut()}
                className="rounded-md px-3 py-1.5 text-white/60 hover:bg-panel hover:text-white"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent/90"
            >
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
