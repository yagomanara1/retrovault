import type { AddGameResult } from '@shared/types';
import type { ToastInput } from '../ui/Toast';

/** Traduz o resultado da identificação automática em feedback para o usuário. */
export function matchFeedback({ game, match }: AddGameResult): ToastInput {
  if (!match) return { tone: 'success', title: `${game.title} adicionado à biblioteca` };
  switch (match.reason) {
    case 'matched':
      return {
        tone: 'success',
        title: 'Jogo identificado no RetroAchievements',
        description: `${match.raTitle} — suas conquistas já aparecem aqui.`,
      };
    case 'no-credentials':
      return {
        tone: 'warning',
        title: `${game.title} adicionado`,
        description: 'Configure sua conta do RetroAchievements para identificar o jogo automaticamente.',
      };
    case 'not-found':
      return {
        tone: 'warning',
        title: `${game.title} adicionado`,
        description: 'Esta ROM não corresponde a nenhum hash conhecido. Vincule manualmente na página do jogo.',
      };
    case 'unsupported-format':
    case 'no-console':
      return {
        tone: 'info',
        title: `${game.title} adicionado`,
        description: 'Identificação automática indisponível para este formato. Use “Vincular ao RetroAchievements”.',
      };
    case 'error':
    default:
      return {
        tone: 'warning',
        title: `${game.title} adicionado`,
        description: 'Não foi possível consultar o RetroAchievements agora. Tente identificar novamente mais tarde.',
      };
  }
}
