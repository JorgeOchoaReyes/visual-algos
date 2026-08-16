import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Library } from "./pages/Library";
import { New } from "./pages/New";
import { Detail } from "./pages/Detail";
import { SettingsPage } from "./pages/Settings";
import { useEnvStatus, useSettings } from "./lib/hooks";

export default function App() {
  const { env, recheck } = useEnvStatus();
  const { settings, save } = useSettings();

  const envReady = !!env?.ready;
  const hasKey = !!settings?.geminiApiKey;
  const canGenerate = envReady && hasKey;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav envReady={canGenerate} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route
            path="/new"
            element={<New canGenerate={canGenerate} env={env} hasKey={hasKey} />}
          />
          <Route path="/v/:id" element={<Detail />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                settings={settings}
                env={env}
                onSave={save}
                onRecheckEnv={recheck}
              />
            }
          />
        </Routes>
      </main>
      <footer className="border-t border-edge/60 py-4 text-center text-xs text-white/40">
        Visual Algos · renders locally with Manim + Gemini
      </footer>
    </div>
  );
}
