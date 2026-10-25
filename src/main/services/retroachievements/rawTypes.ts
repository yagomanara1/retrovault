// Formatos crus da Web API do RetroAchievements (https://api-docs.retroachievements.org).
// Todos os campos são opcionais: a API varia entre versões e retorna números como string às vezes.

type Num = number | string | null | undefined;

export interface RawAchievement {
  ID?: Num;
  Title?: string | null;
  Description?: string | null;
  Points?: Num;
  TrueRatio?: Num;
  BadgeName?: string | null;
  DisplayOrder?: Num;
  NumAwarded?: Num;
  NumAwardedHardcore?: Num;
  DateEarned?: string | null;
  DateEarnedHardcore?: string | null;
  type?: string | null;
}

export interface RawGameProgress {
  ID?: Num;
  Title?: string | null;
  ConsoleID?: Num;
  ConsoleName?: string | null;
  ImageIcon?: string | null;
  ImageTitle?: string | null;
  ImageIngame?: string | null;
  ImageBoxArt?: string | null;
  NumAchievements?: Num;
  NumDistinctPlayers?: Num;
  NumDistinctPlayersCasual?: Num;
  Achievements?: Record<string, RawAchievement> | RawAchievement[] | null;
}

export interface RawUserProfile {
  User?: string | null;
  UserPic?: string | null;
  MemberSince?: string | null;
  RichPresenceMsg?: string | null;
  Motto?: string | null;
  TotalPoints?: Num;
  TotalSoftcorePoints?: Num;
  TotalTruePoints?: Num;
}

export interface RawRecentAchievement {
  Date?: string | null;
  HardcoreMode?: Num | boolean;
  AchievementID?: Num;
  Title?: string | null;
  Description?: string | null;
  BadgeName?: string | null;
  BadgeURL?: string | null;
  Points?: Num;
  GameTitle?: string | null;
  GameIcon?: string | null;
  GameID?: Num;
  ConsoleName?: string | null;
}

export interface RawCompletionResult {
  GameID?: Num;
  Title?: string | null;
  ImageIcon?: string | null;
  ConsoleName?: string | null;
  MaxPossible?: Num;
  NumAwarded?: Num;
  NumAwardedHardcore?: Num;
  MostRecentAwardedDate?: string | null;
  HighestAwardKind?: string | null;
}

export interface RawCompletionPage {
  Count?: Num;
  Total?: Num;
  Results?: RawCompletionResult[] | null;
}

export interface RawGameListEntry {
  ID?: Num;
  Title?: string | null;
  ConsoleID?: Num;
  ConsoleName?: string | null;
  ImageIcon?: string | null;
  NumAchievements?: Num;
  Hashes?: string[] | null;
}

export interface RawConsole {
  ID?: Num;
  Name?: string | null;
  IconURL?: string | null;
  Active?: boolean | null;
  IsGameSystem?: boolean | null;
}
