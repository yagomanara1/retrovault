/**
 * Junta ids num só aviso: uma rajada de mudanças (inicialização, importação de muitos jogos) vira uma
 * recarga no renderer em vez de uma por jogo. O primeiro id abre a janela de espera; os que chegam
 * durante ela vão juntos.
 */
export function createIdBatcher(flush: (ids: number[]) => void, delayMs = 200) {
  const pending = new Set<number>();
  let timer: NodeJS.Timeout | null = null;

  const flushNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.size === 0) return;
    const ids = [...pending];
    pending.clear();
    flush(ids);
  };

  return {
    add(id: number): void {
      pending.add(id);
      timer ??= setTimeout(flushNow, delayMs);
    },
    /** Envia o que estiver pendente agora (ex.: ao fechar o app). */
    flushNow,
  };
}
