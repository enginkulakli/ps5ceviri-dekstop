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

declare interface Window {
  ps5Desktop?: {
    ps5: {
      status(): Promise<Ps5Status>;
      discover(): Promise<DetectedPs5[]>;
      pair(ip: string, account: string, pin: string, name: string): Promise<Ps5Status>;
      forget(id: string): Promise<Ps5Status>;
      start(id: string, ip?: string): Promise<Ps5Status>;
      stop(): Promise<Ps5Status>;
      login(pin: string): Promise<void>;
    };
    getLanAddresses(): Promise<string[]>;
  };
}
