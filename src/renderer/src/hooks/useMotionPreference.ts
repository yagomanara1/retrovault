import { useCallback, useState } from 'react';

/**
 * Animações da interface:
 * - "system": segue o Windows ("Efeitos de animação" desligado = movimento reduzido);
 * - "full": sempre suaves, mesmo com os efeitos do Windows desligados (comum em PCs "otimizados" para jogos);
 * - "reduced": sempre reduzidas.
 * O CSS lê o atributo `data-motion` do <html> (ver base.css).
 */
export type MotionPreference = 'system' | 'full' | 'reduced';

const STORAGE_KEY = 'rv.motion';

function storedPreference(): MotionPreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'full' || v === 'reduced' ? v : 'system';
  } catch {
    return 'system'; // storage indisponível: padrão
  }
}

/** Aplica a preferência salva; chamado antes do primeiro render para não "piscar" animações. */
export function applyMotionPreference(pref: MotionPreference = storedPreference()): void {
  if (pref === 'system') delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = pref;
}

export function useMotionPreference(): [MotionPreference, (pref: MotionPreference) => void] {
  const [pref, setPref] = useState(storedPreference);
  const update = useCallback((next: MotionPreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // só não lembra
    }
    applyMotionPreference(next);
    setPref(next);
  }, []);
  return [pref, update];
}
