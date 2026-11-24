declare interface Window {
  ps5Desktop?: {
    getLanAddresses(): Promise<string[]>;
  };
}
