import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ArtworkSlot, Game } from '@shared/types';
import { useSetArtworkData } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

type Mode = 'fill' | 'fit-blur' | 'fit-dark';

/** Tamanho final de cada arte (o mesmo formato em que ela aparece no app). */
const TARGET: Record<ArtworkSlot, { width: number; height: number; label: string }> = {
  cover: { width: 900, height: 1200, label: 'Capa (3:4)' },
  background: { width: 1920, height: 840, label: 'Fundo (16:7)' },
  icon: { width: 512, height: 512, label: 'Ícone (quadrado)' },
};

const MODES = [
  { value: 'fill', label: 'Preencher' },
  { value: 'fit-blur', label: 'Caber inteira' },
  { value: 'fit-dark', label: 'Caber (fundo escuro)' },
] as const;

/** Largura da prévia na tela, por tipo (a imagem final tem o tamanho de TARGET). */
const PREVIEW_WIDTH: Record<ArtworkSlot, number> = { cover: 270, background: 560, icon: 260 };
const MAX_ZOOM = 3;
const KEY_STEP = 0.02;

interface View {
  /** Ponto da imagem (0..1) que fica no centro da moldura, no modo "Preencher". */
  cx: number;
  cy: number;
  zoom: number;
}

/**
 * Enquadra uma arte no formato em que ela aparece no app: preencher a moldura (arrastando e
 * aproximando para escolher o recorte) ou caber inteira, com as sobras preenchidas pela própria
 * arte desfocada ou por um fundo escuro. A montagem é feita num canvas e vai pronta para o main.
 */
export function FramingEditor({ game, slot, sourceUrl, open, onClose }: { game: Game; slot: ArtworkSlot; sourceUrl: string; open: boolean; onClose: () => void }) {
  const target = TARGET[slot];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>('fit-blur');
  const [view, setView] = useState<View>({ cx: 0.5, cy: 0.5, zoom: 1 });
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const save = useSetArtworkData();
  const toast = useToast();

  // Carrega a arte atual (rv-media:// com CORS liberado, para o canvas poder exportar).
  useEffect(() => {
    if (!open) return;
    setImage(null);
    setLoadError(false);
    setView({ cx: 0.5, cy: 0.5, zoom: 1 });
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      // Imagem quase no formato da moldura: preencher fica melhor; muito diferente: caber inteira.
      const ratio = img.naturalWidth / img.naturalHeight / (target.width / target.height);
      setMode(ratio > 0.9 && ratio < 1.1 ? 'fill' : 'fit-blur');
    };
    img.onerror = () => setLoadError(true);
    img.src = sourceUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [open, sourceUrl, target.width, target.height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d')!;
    const { width: W, height: H } = target;
    const iw = image.naturalWidth;
    const ih = image.naturalHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    const cover = Math.max(W / iw, H / ih);

    if (mode === 'fill') {
      const scale = cover * view.zoom;
      const dw = iw * scale;
      const dh = ih * scale;
      const { x, y } = clampOffset(W / 2 - view.cx * dw, H / 2 - view.cy * dh, dw, dh, W, H);
      ctx.drawImage(image, x, y, dw, dh);
      return;
    }

    if (mode === 'fit-blur') {
      ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px)`;
      const bw = iw * cover * 1.1;
      const bh = ih * cover * 1.1;
      ctx.drawImage(image, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#0c0f15';
      ctx.fillRect(0, 0, W, H);
    }
    const fit = Math.min(W / iw, H / ih);
    ctx.drawImage(image, (W - iw * fit) / 2, (H - ih * fit) / 2, iw * fit, ih * fit);
  }, [image, mode, view, target]);

  useEffect(draw, [draw]);

  /** Centro possível do recorte: a moldura nunca sai da imagem (sem faixas vazias nem "folga" ao arrastar). */
  const clampView = useCallback(
    (v: View): View => {
      if (!image) return v;
      const scale = Math.max(target.width / image.naturalWidth, target.height / image.naturalHeight) * v.zoom;
      const hx = target.width / 2 / (image.naturalWidth * scale);
      const hy = target.height / 2 / (image.naturalHeight * scale);
      return { zoom: v.zoom, cx: Math.min(1 - hx, Math.max(hx, v.cx)), cy: Math.min(1 - hy, Math.max(hy, v.cy)) };
    },
    [image, target],
  );

  /** Arrastar move o recorte (só no modo "Preencher"). */
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'fill' || !image) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start || !image) return;
    const canvasPerCss = target.width / e.currentTarget.clientWidth;
    const scale = Math.max(target.width / image.naturalWidth, target.height / image.naturalHeight) * start.view.zoom;
    setView(
      clampView({
        ...start.view,
        cx: start.view.cx - ((e.clientX - start.x) * canvasPerCss) / (image.naturalWidth * scale),
        cy: start.view.cy - ((e.clientY - start.y) * canvasPerCss) / (image.naturalHeight * scale),
      }),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  /** Setas do teclado também movem o recorte (acessível sem mouse). */
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (mode !== 'fill') return;
    const delta = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[e.key];
    if (!delta) return;
    e.preventDefault();
    setView((v) => clampView({ ...v, cx: v.cx + delta[0]!, cy: v.cy + delta[1]! }));
  };

  function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    // Ícone mantém a transparência (PNG); capa e fundo vão como foto (JPEG).
    const dataUrl = slot === 'icon' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
    save.mutate(
      { id: game.id, slot, data: dataUrl.slice(dataUrl.indexOf(',') + 1) },
      {
        onSuccess: () => {
          toast.push({ tone: 'success', title: 'Arte ajustada', description: `${target.label} de ${game.title}` });
          onClose();
        },
        onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível salvar', description: errorMessage(err) }),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustar enquadramento"
      description={`${target.label} de ${game.title}`}
      size={slot === 'background' ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!image} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="framing">
        <SegmentedControl label="Como encaixar a imagem" value={mode} options={MODES} onChange={setMode} />
        <div className="framing__stage" aria-busy={!image && !loadError}>
          {loadError ? (
            <p className="framing__error" role="alert">
              Não foi possível abrir esta imagem para ajustar. Escolha outra imagem e tente de novo.
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              width={target.width}
              height={target.height}
              className={mode === 'fill' ? 'framing__canvas framing__canvas--draggable' : 'framing__canvas'}
              style={{ width: PREVIEW_WIDTH[slot] }}
              tabIndex={mode === 'fill' ? 0 : -1}
              role="img"
              aria-label={mode === 'fill' ? 'Prévia. Arraste ou use as setas para escolher o recorte.' : 'Prévia da arte inteira na moldura.'}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
            />
          )}
        </div>
        {mode === 'fill' && image && (
          <label className="framing__zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              onChange={(e) => setView((v) => clampView({ ...v, zoom: Number(e.target.value) }))}
            />
          </label>
        )}
        <p className="field__hint">
          {mode === 'fill'
            ? 'A imagem cobre toda a moldura; arraste para escolher a parte que aparece.'
            : 'A imagem aparece inteira, sem cortes; as sobras ficam com a própria arte desfocada ou escura.'}
        </p>
      </div>
    </Modal>
  );
}

/** Mantém a imagem cobrindo a moldura inteira (sem faixas vazias ao arrastar). */
function clampOffset(x: number, y: number, dw: number, dh: number, W: number, H: number) {
  return { x: Math.min(0, Math.max(W - dw, x)), y: Math.min(0, Math.max(H - dh, y)) };
}
