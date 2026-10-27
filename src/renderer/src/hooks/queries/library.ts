// Biblioteca: lista de jogos, edição, arte e jogos não encontrados.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtworkSlot, Game, NewGameInput, SetArtworkInput, UpdateGameInput } from '@shared/types';
import { call } from '@/lib/api';
import { qk, replaceGame } from './keys';

// ---------- Biblioteca ----------

export function useGames() {
  return useQuery({ queryKey: qk.games, queryFn: () => call('games:list') });
}

/** Deriva um jogo da lista (fonte única de verdade, sem requisição extra). */
export function useGame(id: number) {
  return useQuery({
    queryKey: qk.games,
    queryFn: () => call('games:list'),
    select: (games: Game[]) => games.find((g) => g.id === id) ?? null,
  });
}

export function useRunningGames() {
  return useQuery({ queryKey: qk.running, queryFn: () => call('games:running'), staleTime: Infinity });
}


export function useAddGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewGameInput) => call('games:add', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.games }),
  });
}

export function useUpdateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGameInput) => call('games:update', input),
    // Atualização otimista para ações instantâneas (ex.: favoritar).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.games });
      const previous = qc.getQueryData<Game[]>(qk.games);
      if (input.favorite !== undefined) {
        qc.setQueryData<Game[]>(qk.games, (list) =>
          list?.map((g) => (g.id === input.id ? { ...g, favorite: input.favorite! } : g)),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.games, ctx.previous);
    },
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useRemoveGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:remove', id),
    onSuccess: (_void, id) => qc.setQueryData<Game[]>(qk.games, (list) => list?.filter((g) => g.id !== id)),
  });
}

export function useRematchGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:rematch', id),
    onSuccess: ({ game }) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useSetArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetArtworkInput) => call('games:set-artwork', input),
    onSuccess: (game) => {
      if (game) qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
    },
  });
}

/** Busca de arte online (SteamGridDB): disparada pelo usuário, não em segundo plano. */
export function useArtSearch() {
  return useMutation({
    mutationFn: (input: { id: number; query?: string; sgdbGameId?: number }) => call('games:art-search', input),
  });
}

export function useApplyArt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; slot: ArtworkSlot; url: string }) => call('games:art-apply', input),
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

/** Imagem do editor de enquadramento (base64 de PNG/JPEG). */
export function useSetArtworkData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; slot: ArtworkSlot; data: string }) => call('games:set-artwork-data', input),
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useFillMissingArt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('games:art-fill-missing'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.games, exact: true }),
  });
}

export function useLaunchGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:launch', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.running }),
    // O arquivo pode ter sumido desde a última verificação.
    onError: () => qc.invalidateQueries({ queryKey: qk.missing }),
  });
}

/** Jogos cujo arquivo não existe mais. Revalida ao voltar para a janela (o usuário pode ter movido pastas). */
export function useMissingGames(): Set<number> {
  const { data } = useQuery({ queryKey: qk.missing, queryFn: () => call('games:missing'), staleTime: 30_000 });
  return useMemo(() => new Set(data ?? []), [data]);
}

export function useRelocateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; action: 'pick' | 'auto' }) => call('games:relocate', input),
    onSuccess: (game) => {
      if (!game) return;
      qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
      qc.setQueryData<number[]>(qk.missing, (ids) => ids?.filter((id) => id !== game.id));
      void qc.invalidateQueries({ queryKey: qk.trophies(game.id) });
    },
  });
}
