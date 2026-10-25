import type {
  Achievement,
  AchievementType,
  AwardKind,
  CompletionEntry,
  ConsoleInfo,
  GameProgress,
  RecentAchievement,
  UserProfile,
} from '@shared/types';
import { AppError } from '../../errors';
import type {
  RawAchievement,
  RawCompletionResult,
  RawConsole,
  RawGameListEntry,
  RawGameProgress,
  RawRecentAchievement,
  RawUserProfile,
} from './rawTypes';

export const MEDIA_BASE = 'https://media.retroachievements.org';

/** Entrada da lista de jogos de um console, com hashes para identificação de ROMs. */
export interface GameListEntry {
  id: number;
  title: string;
  consoleId: number;
  consoleName: string;
  iconUrl: string | null;
  numAchievements: number;
  hashes: string[];
}

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${MEDIA_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

function badgeUrl(badgeName: string | null | undefined, locked: boolean): string {
  const name = badgeName || '00000';
  return `${MEDIA_BASE}/Badge/${name}${locked ? '_lock' : ''}.png`;
}

/** A API retorna "YYYY-MM-DD HH:mm:ss" em UTC ou ISO 8601; normaliza tudo para ISO. */
export function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toAchievementType(value: unknown): AchievementType {
  return value === 'progression' || value === 'win_condition' || value === 'missable' ? value : null;
}

function toAwardKind(value: unknown): AwardKind {
  return value === 'mastered' || value === 'completed' || value === 'beaten-hardcore' || value === 'beaten-softcore'
    ? value
    : null;
}

function mapAchievement(raw: RawAchievement, distinctPlayers: number): Achievement {
  const numAwarded = num(raw.NumAwarded);
  return {
    id: num(raw.ID),
    title: raw.Title ?? 'Sem título',
    description: raw.Description ?? '',
    points: num(raw.Points),
    trueRatio: num(raw.TrueRatio),
    type: toAchievementType(raw.type),
    badgeUrl: badgeUrl(raw.BadgeName, false),
    badgeLockedUrl: badgeUrl(raw.BadgeName, true),
    displayOrder: num(raw.DisplayOrder),
    numAwarded,
    numAwardedHardcore: num(raw.NumAwardedHardcore),
    rarity: distinctPlayers > 0 ? Math.min(100, (numAwarded / distinctPlayers) * 100) : 0,
    unlockedAt: toIso(raw.DateEarned),
    unlockedHardcoreAt: toIso(raw.DateEarnedHardcore),
  };
}

export function mapGameProgress(raw: RawGameProgress | null | undefined): GameProgress {
  if (!raw || !raw.ID || !raw.Title) {
    throw new AppError('NOT_FOUND', 'Jogo não encontrado no RetroAchievements.');
  }
  const distinctPlayers = num(raw.NumDistinctPlayers ?? raw.NumDistinctPlayersCasual);
  const rawList = Array.isArray(raw.Achievements) ? raw.Achievements : Object.values(raw.Achievements ?? {});
  const achievements = rawList
    .map((a) => mapAchievement(a, distinctPlayers))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  let earned = 0;
  let earnedHardcore = 0;
  let earnedPoints = 0;
  let totalPoints = 0;
  for (const a of achievements) {
    totalPoints += a.points;
    if (a.unlockedAt || a.unlockedHardcoreAt) {
      earned++;
      earnedPoints += a.points;
    }
    if (a.unlockedHardcoreAt) earnedHardcore++;
  }

  return {
    gameId: num(raw.ID),
    title: raw.Title,
    consoleId: num(raw.ConsoleID),
    consoleName: raw.ConsoleName ?? '',
    iconUrl: mediaUrl(raw.ImageIcon),
    boxArtUrl: mediaUrl(raw.ImageBoxArt),
    titleImageUrl: mediaUrl(raw.ImageTitle),
    ingameImageUrl: mediaUrl(raw.ImageIngame),
    numAchievements: achievements.length || num(raw.NumAchievements),
    numDistinctPlayers: distinctPlayers,
    earned,
    earnedHardcore,
    totalPoints,
    earnedPoints,
    completion: achievements.length ? (earned / achievements.length) * 100 : 0,
    achievements,
  };
}

export function mapProfile(raw: RawUserProfile | null | undefined): UserProfile {
  if (!raw || !raw.User) {
    throw new AppError('RA_AUTH', 'Usuário não encontrado no RetroAchievements. Confira o nome de usuário.');
  }
  return {
    username: raw.User,
    avatarUrl: mediaUrl(raw.UserPic),
    memberSince: toIso(raw.MemberSince),
    motto: raw.Motto?.trim() || null,
    richPresence: raw.RichPresenceMsg?.trim() || null,
    totalPoints: num(raw.TotalPoints),
    totalSoftcorePoints: num(raw.TotalSoftcorePoints),
    totalTruePoints: num(raw.TotalTruePoints),
  };
}

export function mapRecent(raw: RawRecentAchievement): RecentAchievement {
  return {
    achievementId: num(raw.AchievementID),
    title: raw.Title ?? 'Conquista',
    description: raw.Description ?? '',
    points: num(raw.Points),
    badgeUrl: mediaUrl(raw.BadgeURL) ?? badgeUrl(raw.BadgeName, false),
    gameId: num(raw.GameID),
    gameTitle: raw.GameTitle ?? '',
    gameIconUrl: mediaUrl(raw.GameIcon),
    consoleName: raw.ConsoleName ?? '',
    unlockedAt: toIso(raw.Date) ?? new Date().toISOString(),
    hardcore: raw.HardcoreMode === true || num(raw.HardcoreMode) === 1,
  };
}

export function mapCompletion(raw: RawCompletionResult): CompletionEntry {
  return {
    gameId: num(raw.GameID),
    title: raw.Title ?? '',
    iconUrl: mediaUrl(raw.ImageIcon),
    consoleName: raw.ConsoleName ?? '',
    maxPossible: num(raw.MaxPossible),
    numAwarded: num(raw.NumAwarded),
    numAwardedHardcore: num(raw.NumAwardedHardcore),
    mostRecentAwardedAt: toIso(raw.MostRecentAwardedDate),
    highestAward: toAwardKind(raw.HighestAwardKind),
  };
}

export function mapGameListEntry(raw: RawGameListEntry): GameListEntry {
  return {
    id: num(raw.ID),
    title: raw.Title ?? '',
    consoleId: num(raw.ConsoleID),
    consoleName: raw.ConsoleName ?? '',
    iconUrl: mediaUrl(raw.ImageIcon),
    numAchievements: num(raw.NumAchievements),
    hashes: (raw.Hashes ?? []).map((h) => h.toLowerCase()),
  };
}

export function mapConsole(raw: RawConsole): ConsoleInfo {
  return { id: num(raw.ID), name: raw.Name ?? '', iconUrl: mediaUrl(raw.IconURL) };
}
