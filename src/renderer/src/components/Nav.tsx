import { Link, NavLink } from "react-router-dom";
import { LayoutGrid, Plus, Settings as SettingsIcon } from "lucide-react";

function Logo() {
  return (
    <span className="tile8 relative grid h-7 w-7 place-items-center overflow-hidden">
      <span className="flex items-end gap-[2px]">
        <span className="h-1.5 w-[3px] rounded-full bg-white/70" />
        <span className="h-2.5 w-[3px] rounded-full bg-white/85" />
        <span className="h-3.5 w-[3px] rounded-full bg-white" />
      </span>
    </span>
  );
}

const linkBase =
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition";

export function Nav({ envReady }: { envReady: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-edge/70 bg-ink/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2.5">
        <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <Logo />
          Vizuals
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? "bg-white/[0.07] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white"}`
            }
          >
            <LayoutGrid size={15} /> Library
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? "bg-white/[0.07] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white"}`
            }
          >
            <span className="relative">
              <SettingsIcon size={15} />
              {!envReady && (
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </span>
            Settings
          </NavLink>
          <Link to="/new" className="btn8 ml-2 h-8 px-3 text-[13px]">
            <Plus size={15} /> New video
          </Link>
        </nav>
      </div>
    </header>
  );
}
