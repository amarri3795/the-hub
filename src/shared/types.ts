export type StoreId =
  | "steam"
  | "epic"
  | "ubisoft"
  | "minecraft"
  | "gog"
  | "xbox"
  | "other";

export type SortBy = "name" | "recent" | "playtime" | "store";
export type GridDensity = "compact" | "comfortable" | "big";

export type HubGame = {
  id: string;
  store: StoreId;
  name: string;
  launchId?: string;
  installPath?: string;
  coverUrl?: string;
  coverUrls?: string[];
  catalogNamespace?: string;
  catalogItemId?: string;
  playtimeMinutes?: number;
  lastPlayed?: number;
  steamCategories?: string[];
};

export type ScanResult = {
  games: HubGame[];
  steamPath: string | null;
  epicPath: string | null;
  ubisoftPath: string | null;
  minecraftPath: string | null;
  gogPath: string | null;
  xboxPath: string | null;
  errors: string[];
};

export type BackupInfo = {
  id: string;
  createdAt: string;
  path: string;
  label: string;
};

export type Collection = {
  id: string;
  name: string;
  gameIds: string[];
};

export type LaunchOptions = {
  args?: string;
  cwd?: string;
  runAsAdmin?: boolean;
};

export type GameExtras = {
  savePath: string | null;
  notes: string;
  backups: BackupInfo[];
  guessedSavePaths: string[];
  favorite: boolean;
  hidden: boolean;
  tags: string[];
  collectionIds: string[];
  launchOptions: LaunchOptions;
};

export type LibraryPrefs = {
  favorites: string[];
  hidden: string[];
  tags: Record<string, string[]>;
  recent: { id: string; at: number }[];
  customGames: HubGame[];
  collections: Collection[];
  sortBy: SortBy;
  gridDensity: GridDensity;
  accentColor: string;
  closeToTray: boolean;
  launchOptions: Record<string, LaunchOptions>;
  /** Activated license key (normalized). */
  premiumKey?: string;
  premiumUnlocked?: boolean;
  premiumUnlockedAt?: number;
};

export type PremiumSource = "none" | "license" | "owner";

export type PremiumStatus = {
  unlocked: boolean;
  source: PremiumSource;
  keyPreview?: string;
  unlockedAt?: number;
  message: string;
};

export type UpdateStatus = {
  checking: boolean;
  available: boolean;
  version?: string;
  message: string;
};

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/** Encodings searched/replaced by the save value editor. */
export type SaveValueKind = "i32le" | "u32le" | "i64le" | "f32le" | "text";

export type SaveFileEntry = {
  relativePath: string;
  size: number;
  sizeLabel: string;
  modifiedAt: number;
};

export type SaveValueHit = {
  offset: number;
  kind: SaveValueKind;
  value: number;
  label: string;
};

export type SaveJsonField = {
  path: string;
  value: number;
};

export type SaveScanResult = ActionResult & {
  hits?: SaveValueHit[];
  fileSize?: number;
  truncated?: boolean;
};

export type SaveReplaceResult = ActionResult & {
  replaced?: number;
};
