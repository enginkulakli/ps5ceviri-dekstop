import { createContext, useCallback, useContext, useState, useRef, type ReactNode } from "react";

export type OcrRegion = { x: number; y: number; w: number; h: number };

export type Console = { id: string; name: string; host: string; registered: boolean };

export type TranslationMode = "subtitle" | "fullscreen";
export type TranslationEngine = "offline" | "google_cloud" | "ai";
export type GlossaryEntry = { source: string; target: string };

export type Settings = {
  sourceLang: string;
  targetLang: string;
  engine: TranslationEngine;
  mode: TranslationMode;
  ocrRegion: OcrRegion;
  exclusions: OcrRegion[];
  confirmations: number;
  minimumVisibleMs: number;
  ocrIntervalMs: number;
  sensitivity: number;
  repeatWindowMs: number;
  clearDelayMs: number;
  autoConnect: boolean;
  foregroundService: boolean;
  keepWifiAwake: boolean;
  glossary: GlossaryEntry[];
  gameId: string;
  generalArchive: boolean;
  shareEngines: boolean;
  dailyCharacters: number;
  monthlyCharacters: number;
  tvPort: number;
  tvIp: string;
  consoles: Console[];
  selectedConsoleId: string | null;
  tvSetupDeferred: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  sourceLang: "en",
  targetLang: "tr",
  engine: "offline",
  mode: "subtitle",
  ocrRegion: { x: 0, y: 0.72, w: 1, h: 0.28 },
  exclusions: [],
  confirmations: 2,
  minimumVisibleMs: 700,
  ocrIntervalMs: 300,
  sensitivity: 0.5,
  repeatWindowMs: 4000,
  clearDelayMs: 2000,
  autoConnect: true,
  foregroundService: true,
  keepWifiAwake: true,
  glossary: [],
  gameId: "general",
  generalArchive: true,
  shareEngines: false,
  dailyCharacters: 10000,
  monthlyCharacters: 100000,
  tvPort: 8787,
  tvIp: "",
  consoles: [],
  selectedConsoleId: null,
  tvSetupDeferred: false,
};

const KEY = "ps5ceviri_desktop_settings_v1";

type SettingsContextValue = {
  settings: Settings;
  error: string | null;
  update: (patch: Partial<Settings>) => boolean;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const loaded = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (Object.hasOwn(saved, key)) Object.assign(loaded, { [key]: saved[key] });
    }
    return loaded;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(readSettings);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(settings);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      latest.current = next;
      setSettings(next);
      setError(null);
      return true;
    } catch {
      setError("Ayarlar kaydedilemedi. Uygulamanın yerel depolama alanını kontrol edin.");
      return false;
    }
  }, []);

  return <SettingsContext.Provider value={{ settings, error, update }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("SettingsProvider is required");
  return context;
}
