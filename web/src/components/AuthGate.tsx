"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Wrap any page that requires a signed-in user. Shows a spinner while auth is
 * resolving and a sign-in prompt when logged out.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, signInWithGoogle } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-accent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-panel p-8 text-center">
          <h2 className="text-lg font-semibold">Sign in to continue</h2>
          <p className="mt-2 text-sm text-white/60">
            Your generated videos are saved to your account.
          </p>
          <button
            onClick={() => signInWithGoogle()}
            className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent/90"
          >
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
