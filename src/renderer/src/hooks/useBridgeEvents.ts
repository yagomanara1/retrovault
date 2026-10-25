import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GRADE_LABEL } from '@/components/trophies/trophyUtils';
import { useToast } from '@/components/ui/Toast';
import { onEvent } from '@/lib/api';
import { formatPlaytime } from '@/lib/format';
import { qk, type InstallProgressMap } from './queries';
import type { Game } from '@shared/types';

/** Conecta eventos do processo principal ao cache do react-query e aos toasts. */
export function useBridgeEvents(): void {
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    // A lista do jogo e a página geral de troféus mudam juntas.
    const refreshTrophies = (gameId: number) => {
      void qc.invalidateQueries({ queryKey: qk.trophies(gameId) });
      void qc.invalidateQueries({ queryKey: qk.trophyOverview });
    };
    const unsubscribers = [
      onEvent('session:started', () => {
        void qc.invalidateQueries({ queryKey: qk.running });
      }),
      onEvent('session:ended', ({ gameId, durationSeconds }) => {
        void qc.invalidateQueries({ queryKey: qk.running });
        void qc.invalidateQueries({ queryKey: qk.games });
        void qc.invalidateQueries({ queryKey: qk.ra });
        const game = qc.getQueryData<Game[]>(qk.games)?.find((g) => g.id === gameId);
        if (game && durationSeconds >= 60) {
          toast.push({ tone: 'info', title: `Sessão encerrada: ${game.title}`, description: `Você jogou ${formatPlaytime(durationSeconds)}.` });
        }
      }),
      onEvent('achievements:unlocked', ({ achievements }) => {
        for (const a of achievements) {
          toast.push({
            tone: 'achievement',
            title: a.title,
            description: `${a.gameTitle} · ${a.points} pts${a.hardcore ? ' · Hardcore' : ''}`,
            imageUrl: a.badgeUrl,
          });
        }
        void qc.invalidateQueries({ queryKey: qk.ra });
      }),
      onEvent('trophies:unlocked', ({ gameId, gameTitle, trophies }) => {
        for (const t of trophies) {
          toast.push({
            tone: 'achievement',
            eyebrow: `Troféu de ${GRADE_LABEL[t.grade]} obtido`,
            title: t.name,
            description: gameTitle,
            imageUrl: t.iconUrl,
          });
        }
        refreshTrophies(gameId);
      }),
      onEvent('trophies:imported', ({ gameId, gameTitle, count }) => {
        toast.push({
          tone: 'success',
          title: `${count} troféus encontrados`,
          description: `${gameTitle}: importados automaticamente da pasta do jogo.`,
        });
        refreshTrophies(gameId);
      }),
      onEvent('trophies:changed', ({ gameId }) => refreshTrophies(gameId)),
      onEvent('saves:changed', ({ gameId }) => {
        void qc.invalidateQueries({ queryKey: qk.saves(gameId) });
      }),
      onEvent('store:install-progress', (progress) => {
        qc.setQueryData<InstallProgressMap>(qk.storeProgress, (map = {}) => ({ ...map, [progress.portId]: progress }));
      }),
      onEvent('mods:progress', (progress) => {
        qc.setQueryData<Record<string, typeof progress>>(['mods', 'progress'], (map = {}) => ({ ...map, [`${progress.portId}:${progress.modId}`]: progress }));
      }),
      onEvent('store:updates-changed', () => {
        void qc.invalidateQueries({ queryKey: qk.storeUpdates });
      }),
      onEvent('app:update-changed', (state) => {
        qc.setQueryData(qk.appUpdate, state);
      }),
      onEvent('games:changed', () => {
        void qc.invalidateQueries({ queryKey: qk.games, exact: true });
        // O jogo pode ter entrado numa categoria (contagens e abas da tela inicial).
        void qc.invalidateQueries({ queryKey: qk.categories });
      }),
      onEvent('games:relocated', ({ gameId, title, path }) => {
        toast.push({ tone: 'success', title: `${title} foi encontrado`, description: `Novo local: ${path}` });
        void qc.invalidateQueries({ queryKey: qk.games }); // inclui ['games', 'missing']
        refreshTrophies(gameId);
      }),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [qc, toast]);
}
