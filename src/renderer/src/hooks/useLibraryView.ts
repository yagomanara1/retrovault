import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type LibraryView = 'console' | 'grid';

const STORAGE_KEY = 'rv.library.view';

function storedView(): LibraryView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'console';
  } catch {
    return 'console'; // storage indisponível: padrão
  }
}

/**
 * Modo da Biblioteca: tela inicial estilo PS5 ("console", padrão) ou grade.
 * A URL (?view=) manda; a escolha fica lembrada para a próxima vez (conveniência local).
 */
export function useLibraryView(): [LibraryView, (view: LibraryView) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('view');
  const view: LibraryView = fromUrl === 'grid' || fromUrl === 'console' ? fromUrl : storedView();

  const setView = useCallback(
    (next: LibraryView) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // só não lembra
      }
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('view', next);
        if (next === 'console') p.delete('categoria'); // o filtro da grade não vale na tela inicial
        return p;
      });
    },
    [setParams],
  );
  return [view, setView];
}

/**
 * A tela inicial estilo PS5 só existe com jogos na biblioteca: vazia, carregando ou com erro, vale a grade
 * (que mostra o estado certo). Usada pela Biblioteca e pelo App, que esconde a barra de cima só quando a
 * tela de console está de fato na tela (ela tem o próprio menu); as duas decisões não podem divergir,
 * senão a biblioteca vazia fica sem menu nenhum.
 */
export function showsConsoleHome(view: LibraryView, gameCount: number | undefined): boolean {
  return view === 'console' && !!gameCount;
}
