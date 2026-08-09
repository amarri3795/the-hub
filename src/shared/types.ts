export type StoreId = "steam" | "epic" | "other";

export type HubGame = {
  id: string;
  store: StoreId;
  appId?: string;
  name: string;
  installPath?: string;
  coverUrl?: string;
};

export type ScanResult = {
  games: HubGame[];
  steamPath: string | null;
  errors: string[];
};
