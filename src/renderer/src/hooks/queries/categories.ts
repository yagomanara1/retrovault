// Categorias da biblioteca.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Game } from '@shared/types';
import { call } from '@/lib/api';
import { qk, replaceGame } from './keys';

// ---------- Categorias ----------

export function useCategories() {
  return useQuery({ queryKey: qk.categories, queryFn: () => call('categories:list'), staleTime: 60_000 });
}

/** Categorias e jogos mudam juntos (contagens, grupos da barra lateral, filtro da biblioteca). */
function useCategoryMutation<I, O>(mutationFn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.categories });
      void qc.invalidateQueries({ queryKey: qk.games, exact: true });
    },
  });
}

export const useCreateCategory = () => useCategoryMutation((name: string) => call('categories:create', name));
export const useRenameCategory = () => useCategoryMutation((input: { id: number; name: string }) => call('categories:rename', input));
export const useDeleteCategory = () => useCategoryMutation((id: number) => call('categories:delete', id));
export const useSetCategoryIcon = () =>
  useCategoryMutation((input: { id: number; icon: string | null }) => call('categories:set-icon', input));
export const useMoveCategory = () => useCategoryMutation((input: { id: number; direction: -1 | 1 }) => call('categories:move', input));
/**
 * Grava o jogo devolvido direto no cache: duas marcações seguidas partem do estado novo, e não de
 * uma lista antiga que desfaria a primeira enquanto a revalidação não chega.
 */
export function useSetGameCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { gameId: number; categoryIds: number[] }) => call('categories:set-game', input),
    onSuccess: (game) => {
      qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
      void qc.invalidateQueries({ queryKey: qk.categories });
    },
  });
}
export const useAutoOrganize = () => useCategoryMutation((_: void) => call('categories:auto-organize'));
