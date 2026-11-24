type Ps5Console = { id: string; ip: string; name: string };
type DetectedPs5 = Ps5Console & { standby: boolean };
type Ps5Status = {
  available: boolean;
  consoles: Ps5Console[];
  stage: "idle" | "discovering" | "connecting" | "connected" | "pin" | "video" | "stopping" | "error";
  id?: string;
  ip?: string;
  error?: string;
};

type LiveStatus = {
  available: boolean; active: boolean; english: string; turkish: string;
  ocr: string; ocrMs?: number; translation: string; model: "empty" | "loading" | "ready" | "error";
};
type TvStatus = {
  available?: boolean; running: boolean; port?: number; clients: string[]; overlayClients: number;
  lastSentText?: string; lastError?: string; sentCount: number; rejectedCount: number;
};
type ArchiveGame = { id: string; name: string; count: number };
type ArchiveRecord = { id: number; source: string; translated: string; engine: string; created: number };
type RemoteEngine = "google_cloud" | "ai";

declare interface Window {
  ps5Desktop?: {
    ps5: {
      status(): Promise<Ps5Status>;
      discover(): Promise<DetectedPs5[]>;
      pair(ip: string, account: string, pin: string, name: string): Promise<Ps5Status>;
      forget(id: string): Promise<Ps5Status>;
      start(id: string, ip: string, options: import("./settings").Settings): Promise<Ps5Status>;
      stop(): Promise<Ps5Status>;
      login(pin: string): Promise<void>;
    };
    live: {
      status(): Promise<LiveStatus>;
      configure(options: import("./settings").Settings): Promise<void>;
      offline(): Promise<LiveStatus>;
      translate(input: string, options: import("./settings").Settings): Promise<{ text: string; cached: boolean }>;
      keys(): Promise<Record<RemoteEngine, boolean>>;
      key(engine: RemoteEngine, value: string): Promise<void>;
      usage(engine: RemoteEngine): Promise<{ daily: { chars: number; requests: number }; monthly: { chars: number; requests: number } }>;
    };
    tv: {
      status(): Promise<TvStatus>;
      start(port: number, ip: string): Promise<TvStatus>;
      stop(): Promise<TvStatus>;
      test(): Promise<TvStatus>;
    };
    archive: {
      games(): Promise<ArchiveGame[]>;
      create(name: string): Promise<string>;
      page(game: string, search: string, before: number): Promise<ArchiveRecord[]>;
      edit(id: number, text: string): Promise<void>;
      delete(id: number): Promise<void>;
      export(game?: string): Promise<boolean>;
      import(): Promise<{ added: number; skipped: number } | null>;
    };
    getLanAddresses(): Promise<string[]>;
  };
}
