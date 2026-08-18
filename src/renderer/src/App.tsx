import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Nav } from "./components/Nav";
import { UpdateBanner } from "./components/UpdateBanner";
import { SetupBanner } from "./components/SetupBanner";
import { Library } from "./pages/Library";
import { New } from "./pages/New";
import { Detail } from "./pages/Detail";
import { SettingsPage } from "./pages/Settings";
import { useEnvStatus, useSettings } from "./lib/hooks";

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  const location = useLocation();
  const { env, recheck } = useEnvStatus();
  const { settings, save } = useSettings();

  const envReady = !!env?.ready;
  const hasKey = !!settings?.geminiApiKey;
  const canGenerate = envReady && hasKey;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav envReady={canGenerate} />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Page><Library /></Page>} />
            <Route
              path="/new"
              element={
                <Page>
                  <New
                    canGenerate={canGenerate}
                    env={env}
                    hasKey={hasKey}
                    hasElevenLabs={!!settings?.elevenLabsApiKey}
                    model={settings?.geminiModel ?? "gemini-2.5-flash"}
                  />
                </Page>
              }
            />
            <Route path="/v/:id" element={<Page><Detail /></Page>} />
            <Route
              path="/settings"
              element={
                <Page>
                  <SettingsPage
                    settings={settings}
                    env={env}
                    onSave={save}
                    onRecheckEnv={recheck}
                  />
                </Page>
              }
            />
          </Routes>
        </AnimatePresence>
      </main>
      <footer className="border-t border-white/5 py-4 text-center text-xs text-white/35">
        Visual Algos · renders locally with Manim + Gemini
      </footer>
      <UpdateBanner />
      <SetupBanner />
    </div>
  );
}
