export {};

declare global {
  interface Window {
    hub: {
      scanLibrary: () => Promise<import("../../shared/types").ScanResult>;
      launchGame: (
        appId: string,
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      openSteam: () => Promise<{ ok: true }>;
    };
  }
}
