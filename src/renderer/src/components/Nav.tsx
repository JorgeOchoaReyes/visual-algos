import { Link, NavLink } from "react-router-dom";
import { LayoutGrid, Settings as SettingsIcon, Sparkles } from "lucide-react";

function Logo() {
  return (
    <span className="tile8 relative grid h-8 w-8 place-items-center overflow-hidden">
      <span className="flex items-end gap-[2px]">
        <span className="h-2 w-[3px] bg-[#05040b]/70" />
        <span className="h-3 w-[3px] bg-[#05040b]/85" />
        <span className="h-4 w-[3px] bg-[#05040b]" />
      </span>
    </span>
  );
}

const linkBase =
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition";

export function Nav({ envReady }: { envReady: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo />
          <span>
            Viz<span className="text-white/50">uals</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? "bg-white/[0.06] text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`
            }
          >
            <LayoutGrid size={15} /> Library
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? "bg-white/[0.06] text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`
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
          <Link to="/new" className="btn8 ml-1">
            <Sparkles size={15} /> New video
          </Link>
        </nav>
      </div>
    </header>
  );
}
