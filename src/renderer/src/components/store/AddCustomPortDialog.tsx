import { useState, type FormEvent } from 'react';
import { CONSOLE_CATEGORIES } from '@shared/consoleCategories';
import type { RepoInspection, StorePort, StoreRequirement } from '@shared/store';
import { useCustomPorts, useInspectRepo } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { AlertIcon } from '../ui/icons';

const CONSOLES = CONSOLE_CATEGORIES.map((c) => ({ value: c.key, label: c.name }));
const REQUIRES: { value: StoreRequirement['kind']; label: string }[] = [
  { value: 'game-files', label: 'Os arquivos do jogo (disco, dump, ISO…)' },
  { value: 'rom', label: 'Uma ROM' },
  { value: 'none', label: 'Nada (jogo gratuito)' },
];

/**
 * Adicionar à Loja um port que não está no catálogo: cola o link do repositório do GitHub, o app
 * lê a versão mais recente e sugere o arquivo de Windows; o usuário confere nome, jogo e console.
 */
export function AddCustomPortDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (port: StorePort) => void }) {
  const inspect = useInspectRepo();
  const { add } = useCustomPorts();
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<RepoInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [original, setOriginal] = useState('');
  const [consoleKey, setConsoleKey] = useState('pc');
  const [asset, setAsset] = useState('');
  const [requiresKind, setRequiresKind] = useState<StoreRequirement['kind']>('game-files');
  const [requiresLabel, setRequiresLabel] = useState('');

  function reset() {
    setUrl('');
    setFound(null);
    setError(null);
    inspect.reset();
    add.reset();
  }
  function close() {
    reset();
    onClose();
  }

  function lookUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    inspect.mutate(url, {
      onSuccess: (result) => {
        setFound(result);
        setName(result.suggestedName);
        setOriginal(result.suggestedTitle);
        setAsset(result.assets[0]!.pattern);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!found) return;
    const chosen = CONSOLE_CATEGORIES.find((c) => c.key === consoleKey)!;
    setError(null);
    add.mutate(
      {
        repo: found.repo,
        name,
        originalTitle: original,
        platform: chosen.icon,
        system: chosen.name,
        assetPattern: asset,
        requiresKind,
        requiresLabel,
      },
      {
        onSuccess: (port) => {
          onAdded(port);
          close();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Adicionar port do GitHub"
      description="Para um projeto que ainda não está na Loja. Ele precisa publicar versões (Releases) com um arquivo para Windows."
      size="md"
      footer={
        found ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Outro link
            </Button>
            <Button variant="primary" type="submit" form="custom-port-form" loading={add.isPending}>
              Adicionar à Loja
            </Button>
          </>
        ) : (
          <Button variant="primary" type="submit" form="custom-port-lookup" loading={inspect.isPending} disabled={url.trim().length < 3}>
            Buscar
          </Button>
        )
      }
    >
      {!found ? (
        <form id="custom-port-lookup" className="form" onSubmit={lookUp}>
          <TextField
            label="Link do repositório"
            placeholder="https://github.com/dono/projeto"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint='Também serve "dono/projeto" ou o link de uma versão.'
            error={error}
            autoFocus
          />
        </form>
      ) : (
        <form id="custom-port-form" className="form" onSubmit={submit}>
          <p className="custom-port__found">
            <strong>{found.repo}</strong> · versão mais recente: {found.latestTag}
          </p>
          <TextField label="Nome na Loja" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Jogo original"
            value={original}
            maxLength={120}
            required
            onChange={(e) => setOriginal(e.target.value)}
            hint="É o nome usado para buscar a capa e para a categoria."
          />
          <SelectField label="Console do jogo original" value={consoleKey} options={CONSOLES} onChange={setConsoleKey} />
          <SelectField
            label="Arquivo de Windows"
            value={asset}
            options={found.assets.map((a) => ({ value: a.pattern, label: `${a.name} (${formatBytes(a.size)})` }))}
            onChange={setAsset}
            hint="As próximas versões são reconhecidas pelo mesmo padrão de nome."
          />
          <SelectField label="O que o port pede" value={requiresKind} options={REQUIRES} onChange={setRequiresKind} />
          {requiresKind !== 'none' && (
            <TextField
              label="Descrição do que é preciso"
              placeholder="Ex.: a ROM americana do jogo"
              value={requiresLabel}
              maxLength={160}
              onChange={(e) => setRequiresLabel(e.target.value)}
            />
          )}
          <p className="custom-port__warning" role="note">
            <AlertIcon size={16} />
            <span>
              Projetos adicionados por você não passam pela curadoria da Loja. Confira na página do projeto se ele pede a sua própria cópia do jogo
              e não traz o jogo no pacote.
            </span>
          </p>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
