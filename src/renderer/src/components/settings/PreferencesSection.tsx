import type { Settings } from '@shared/types';
import { useUpdateSettings } from '@/hooks/queries';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { SegmentedControl, Switch } from '../ui/Form';
import { SettingsPanel } from './SettingsPanel';

export function PreferencesSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <SettingsPanel id="prefs" title="Preferências">
      <Switch
        label="Modo Hardcore"
        description="Desativa save states, rewind e cheats no RetroArch; conquistas valem pontos Hardcore."
        checked={settings.hardcoreMode}
        onChange={(hardcoreMode) => update.mutate({ hardcoreMode })}
        disabled={update.isPending}
      />
      <Switch
        label="Notificações de conquistas e troféus"
        description="Mostra uma notificação do Windows quando uma conquista ou troféu for desbloqueado durante o jogo."
        checked={settings.notifyAchievements}
        onChange={(notifyAchievements) => update.mutate({ notifyAchievements })}
        disabled={update.isPending}
      />
      <Switch
        label="Mostrar no Discord o que estou jogando"
        description="Enquanto um jogo aberto pelo RetroVault roda, seu perfil do Discord mostra o nome dele, a plataforma e há quanto tempo você joga. Só funciona com o app do Discord aberto neste PC."
        checked={settings.discordPresence}
        onChange={(discordPresence) => update.mutate({ discordPresence })}
        disabled={update.isPending}
      />
      <MotionSetting />
    </SettingsPanel>
  );
}

const MOTION_OPTIONS = [
  { value: 'system', label: 'Seguir o Windows' },
  { value: 'full', label: 'Sempre suaves' },
  { value: 'reduced', label: 'Reduzidas' },
] as const;

/** Preferência local deste computador (não vai para o banco): só muda a aparência. */
function MotionSetting() {
  const [motion, setMotion] = useMotionPreference();
  const systemReduces = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="switch-row">
      <div>
        <div className="switch-row__label">Animações</div>
        <p className="field__hint">
          {systemReduces
            ? 'Os "Efeitos de animação" do Windows estão desligados; em "Seguir o Windows" o app troca de tela sem animar.'
            : 'Transições ao passar o mouse, selecionar jogos e trocar de tela.'}
        </p>
      </div>
      <SegmentedControl label="Animações" value={motion} options={MOTION_OPTIONS} onChange={setMotion} />
    </div>
  );
}
