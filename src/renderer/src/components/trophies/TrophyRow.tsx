import { memo } from 'react';
import type { Trophy, TrophyGrade } from '@shared/types';
import { cx } from '@/lib/cx';
import { formatDateTime } from '@/lib/format';
import { Button } from '../ui/Button';
import { LockIcon, PencilIcon, TrashIcon, TrophyIcon } from '../ui/icons';
import { GRADE_LABEL } from './trophyUtils';

export function TrophyGradeBadge({ grade, size = 16 }: { grade: TrophyGrade; size?: number }) {
  return (
    <span className={cx('grade', `grade--${grade}`)} title={GRADE_LABEL[grade]}>
      <TrophyIcon size={size} />
      <span className="sr-only">{GRADE_LABEL[grade]}</span>
    </span>
  );
}

interface TrophyRowProps {
  trophy: Trophy;
  revealHidden: boolean;
  editable: boolean;
  busy: boolean;
  /** Ausente: o troféu não se marca à mão (vem do emulador). */
  onToggle?: (trophy: Trophy) => void;
  onEdit: (trophy: Trophy) => void;
  onDelete: (trophy: Trophy) => void;
}

export const TrophyRow = memo(function TrophyRow({
  trophy: t,
  revealHidden,
  editable,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: TrophyRowProps) {
  const unlocked = Boolean(t.unlockedAt);
  // Como no PS4: troféus ocultos só mostram nome e descrição depois de obtidos.
  const concealed = t.hidden && !unlocked && !revealHidden;

  return (
    <li className={cx('trophy', unlocked ? 'trophy--unlocked' : 'trophy--locked', `trophy--${t.grade}`)}>
      <div className="trophy__icon">
        {t.iconUrl && !concealed ? (
          <img src={t.iconUrl} alt="" width={64} height={64} loading="lazy" decoding="async" />
        ) : (
          <LockIcon size={24} />
        )}
      </div>
      <div className="trophy__info">
        <h3 className="trophy__title">
          {!concealed && <TrophyGradeBadge grade={t.grade} />}
          {concealed ? 'Troféu oculto' : t.name}
          <span className="sr-only">{unlocked ? ' — obtido' : ' — não obtido'}</span>
        </h3>
        <p className="trophy__detail">{concealed ? 'Continue jogando para descobrir este troféu.' : t.detail}</p>
      </div>
      <div className="trophy__side">
        {unlocked ? (
          <span className="trophy__date">
            Obtido em <time dateTime={t.unlockedAt!}>{formatDateTime(t.unlockedAt)}</time>
            {t.unlockSource === 'manual' && <span className="tag">Marcado manualmente</span>}
          </span>
        ) : (
          <span className="trophy__locked">
            <LockIcon size={14} /> Não obtido
          </span>
        )}
        <div className="trophy__actions">
          {onToggle && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle(t)}>
              {unlocked ? 'Desmarcar' : 'Marcar como obtido'}
            </Button>
          )}
          {editable && (
            <>
              <Button size="sm" variant="ghost" icon={<PencilIcon size={14} />} aria-label={`Editar ${t.name}`} onClick={() => onEdit(t)} />
              <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} aria-label={`Excluir ${t.name}`} onClick={() => onDelete(t)} />
            </>
          )}
        </div>
      </div>
    </li>
  );
});
