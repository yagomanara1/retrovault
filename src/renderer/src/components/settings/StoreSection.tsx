import { useState, type FormEvent } from 'react';
import type { Settings } from '@shared/types';
import { useStoreCatalog, useStoreSettings, useUpdateSettings } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { Switch, TextField } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { CheckIcon, DownloadIcon, LinkIcon } from '../ui/icons';
import { SettingsPanel } from './SettingsPanel';

const NEW_REPO_URL = 'https://github.com/new';
const SGDB_API_PAGE = 'https://www.steamgriddb.com/profile/preferences/api';

const open = (url: string) => void call('app:open-external', url);

/** Configurações da Loja: catálogo online (catalog.json num repositório seu) e artes do SteamGridDB. */
export function StoreSection({ settings }: { settings: Settings }) {
  return (
    <>
      <UpdatesPanel settings={settings} />
      <CatalogPanel settings={settings} />
      <SteamGridDbPanel settings={settings} />
    </>
  );
}

/** Atualizações dos ports: o app confere sozinho ao abrir e a cada 6 h; aqui só se liga o aviso do Windows. */
function UpdatesPanel({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <SettingsPanel id="port-updates" title="Atualizações dos ports">
      <Switch
        label="Avisar quando sair versão nova"
        description="O RetroVault confere os ports instalados ao abrir e a cada 6 horas. Com isto ligado, mostra uma notificação do Windows (uma vez por versão); o número no ícone da Loja aparece sempre."
        checked={settings.notifyPortUpdates}
        onChange={(notifyPortUpdates) => update.mutate({ notifyPortUpdates })}
        disabled={update.isPending}
      />
    </SettingsPanel>
  );
}

function CatalogPanel({ settings }: { settings: Settings }) {
  const { data: catalog } = useStoreCatalog();
  const { setCatalogUrl, exportCatalog } = useStoreSettings();
  const [url, setUrl] = useState(settings.storeCatalogUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await setCatalogUrl.mutateAsync(url.trim() || null);
      toast.push(
        url.trim()
          ? {
              tone: 'success',
              title: `Catálogo online conectado: ${result.ports} ports`,
              description: result.skipped ? `${result.skipped} itens com erro foram ignorados.` : 'A Loja passa a usar este arquivo.',
            }
          : { tone: 'info', title: 'Loja voltou ao catálogo embutido' },
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function exportFile() {
    try {
      const file = await exportCatalog.mutateAsync();
      if (file) toast.push({ tone: 'success', title: 'Catálogo exportado', description: file });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Não foi possível exportar', description: errorMessage(err) });
    }
  }

  return (
    <SettingsPanel id="catalog" title="Catálogo online">
      <p className="muted">
        Com um <code>catalog.json</code> num repositório seu no GitHub, você inclui ou muda ports na Loja sem atualizar o RetroVault. O app confere o
        arquivo a cada 6 horas; um item com erro é ignorado sem derrubar os outros.
      </p>
      <p className="settings-store__status">
        {settings.storeCatalogUrl ? <CheckIcon size={16} /> : null}
        {settings.storeCatalogUrl
          ? `Usando o catálogo online${catalog?.source === 'embedded' ? ' (inacessível agora: mostrando o embutido)' : ''}.`
          : `Usando o catálogo embutido no app (${catalog?.ports.length ?? '…'} ports).`}
      </p>
      <ol className="github-steps">
        <li>
          Exporte o catálogo atual para começar dele.{' '}
          <Button size="sm" variant="secondary" icon={<DownloadIcon size={14} />} loading={exportCatalog.isPending} onClick={() => void exportFile()}>
            Exportar catalog.json
          </Button>
        </li>
        <li>
          Crie um repositório <strong>público</strong> no GitHub (ex.: retrovault-catalogo).{' '}
          <Button size="sm" variant="secondary" icon={<LinkIcon size={14} />} onClick={() => open(NEW_REPO_URL)}>
            Criar repositório
          </Button>
        </li>
        <li>
          No repositório: <strong>Add file → Upload files</strong>, envie o <code>catalog.json</code> e clique em <strong>Commit changes</strong>.
        </li>
        <li>
          Abra o arquivo no GitHub, clique em <strong>Raw</strong> e copie o endereço (começa com <code>https://raw.githubusercontent.com/</code>).
        </li>
        <li>Cole aqui. Para mudar a Loja depois, é só editar o arquivo no próprio GitHub.</li>
      </ol>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label="Endereço do catalog.json"
          placeholder="https://raw.githubusercontent.com/voce/retrovault-catalogo/main/catalog.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error}
          spellCheck={false}
          maxLength={2000}
        />
        <div className="form__actions form__actions--start">
          <Button type="submit" variant="primary" loading={setCatalogUrl.isPending} disabled={!url.trim()}>
            Testar e usar
          </Button>
          {settings.storeCatalogUrl && (
            <Button
              variant="ghost"
              onClick={() => {
                setUrl('');
                setCatalogUrl.mutate(null, { onSuccess: () => toast.push({ tone: 'info', title: 'Loja voltou ao catálogo embutido' }) });
              }}
            >
              Voltar ao embutido
            </Button>
          )}
        </div>
      </form>
    </SettingsPanel>
  );
}

function SteamGridDbPanel({ settings }: { settings: Settings }) {
  const { connectSgdb, disconnectSgdb } = useStoreSettings();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await connectSgdb.mutateAsync(key.trim());
      setKey('');
      toast.push({ tone: 'success', title: 'SteamGridDB conectado', description: 'Capas e banners aparecem na Loja e nos ports instalados.' });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <SettingsPanel id="sgdb" title="Capas (SteamGridDB)">
      <p className="muted">
        Com uma chave grátis do SteamGridDB, a Loja mostra capa, banner, logo e ícone de cada jogo, e os ports instalados ganham capa na biblioteca
        (só onde ainda não há uma escolhida por você). Sem a chave, aparecem os logos que os projetos publicam. A chave fica cifrada no Windows.
      </p>
      {settings.hasSgdbKey ? (
        <>
          <p className="settings-store__status">
            <CheckIcon size={16} /> Chave do SteamGridDB conectada.
          </p>
          <div className="form__actions form__actions--start">
            <Button
              variant="ghost"
              loading={disconnectSgdb.isPending}
              onClick={() => disconnectSgdb.mutate(undefined, { onSuccess: () => toast.push({ tone: 'info', title: 'SteamGridDB desconectado' }) })}
            >
              Desconectar
            </Button>
          </div>
        </>
      ) : (
        <>
          <ol className="github-steps">
            <li>Entre no SteamGridDB (dá para usar a conta da Steam).</li>
            <li>
              Em <strong>Preferências → API</strong>, gere a chave.{' '}
              <Button size="sm" variant="secondary" icon={<LinkIcon size={14} />} onClick={() => open(SGDB_API_PAGE)}>
                Abrir SteamGridDB
              </Button>
            </li>
            <li>Copie e cole aqui.</li>
          </ol>
          <form className="form" onSubmit={submit} noValidate>
            <TextField
              label="Chave da API do SteamGridDB"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              error={error}
              maxLength={128}
            />
            <div className="form__actions form__actions--start">
              <Button type="submit" variant="primary" loading={connectSgdb.isPending} disabled={!key.trim()}>
                Conectar
              </Button>
            </div>
          </form>
        </>
      )}
    </SettingsPanel>
  );
}
