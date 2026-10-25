import { useEffect, useRef } from 'react';

// Navegação por controle (PS4/PS5/Xbox pelo padrão "standard" do navegador).
// Botões: 0 = ✕/A, 3 = △/Y, 14/15 = direcional ←/→; analógico esquerdo no eixo 0.

export interface GamepadActions {
  onLeft?: () => void;
  onRight?: () => void;
  onConfirm?: () => void;
  onSecondary?: () => void;
}

const BUTTON = { confirm: 0, secondary: 3, left: 14, right: 15 } as const;
const STICK_THRESHOLD = 0.6;
const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;

/**
 * Lê o controle a cada quadro e dispara cada ação uma vez por toque (segurar ←/→ repete, como no console).
 * Fica quieto com a janela sem foco (ex.: o jogo aberto por cima) ou com um diálogo aberto.
 */
export function useGamepadNavigation(actions: GamepadActions, enabled = true): void {
  // Ref: o loop lê sempre as ações mais novas sem reiniciar a cada render.
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== 'function') return;
    let frame = 0;
    const pressed = new Set<string>();
    const holdStart = new Map<string, number>();
    const lastRepeat = new Map<string, number>();

    const fire = (key: string, active: boolean, action: (() => void) | undefined, repeat: boolean, now: number) => {
      if (!active) {
        pressed.delete(key);
        holdStart.delete(key);
        return;
      }
      if (!pressed.has(key)) {
        pressed.add(key);
        holdStart.set(key, now);
        lastRepeat.set(key, now);
        action?.();
        return;
      }
      if (repeat && now - holdStart.get(key)! > REPEAT_DELAY_MS && now - lastRepeat.get(key)! > REPEAT_RATE_MS) {
        lastRepeat.set(key, now);
        action?.();
      }
    };

    const loop = (now: number) => {
      if (!navigator.getGamepads().some(Boolean)) {
        frame = 0; // todos desconectados: para até o próximo "gamepadconnected"
        return;
      }
      frame = requestAnimationFrame(loop);
      if (!document.hasFocus() || document.querySelector('dialog[open]')) {
        pressed.clear(); // ao voltar, um botão ainda segurado não dispara sozinho
        return;
      }
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const btn = (i: number) => !!pad.buttons[i]?.pressed;
        const axis = pad.axes[0] ?? 0;
        const a = latest.current;
        fire(`${pad.index}:left`, btn(BUTTON.left) || axis < -STICK_THRESHOLD, a.onLeft, true, now);
        fire(`${pad.index}:right`, btn(BUTTON.right) || axis > STICK_THRESHOLD, a.onRight, true, now);
        fire(`${pad.index}:confirm`, btn(BUTTON.confirm), a.onConfirm, false, now);
        fire(`${pad.index}:secondary`, btn(BUTTON.secondary), a.onSecondary, false, now);
      }
    };
    // Só lê o controle enquanto houver um conectado (sem controle, nenhum custo por quadro).
    const start = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };
    window.addEventListener('gamepadconnected', start);
    if (navigator.getGamepads().some(Boolean)) start();
    return () => {
      window.removeEventListener('gamepadconnected', start);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
