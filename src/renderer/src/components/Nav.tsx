import { Link, NavLink } from "react-router-dom";

const linkBase = "rounded-md px-3 py-1.5 text-sm transition";

export function Nav({ envReady }: { envReady: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-edge/60 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-accent2 text-sm">
            ∑
          </span>
          <span>Visual Algos</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? "bg-panel text-white" : "text-white/60 hover:bg-panel hover:text-white"}`
            }
          >
            Library
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `${linkBase} flex items-center gap-1.5 ${isActive ? "bg-panel text-white" : "text-white/60 hover:bg-panel hover:text-white"}`
            }
          >
            Settings
            {!envReady && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Setup needed" />
            )}
          </NavLink>
          <Link
            to="/new"
            className="ml-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            New video
          </Link>
        </nav>
      </div>
    </header>
  );
}
