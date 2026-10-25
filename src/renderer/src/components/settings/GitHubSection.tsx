import { useState, type FormEvent } from 'react';
import { GITHUB_TOKEN_HINT, GITHUB_TOKEN_PATTERN } from '@shared/store';
import { useGitHubAccount, useGitHubStatus } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Form';
import { ProgressBar } from '../ui/ProgressBar';
import { Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { CheckIcon, LinkIcon } from '../ui/icons';

/** Página do GitHub que cria um token fine-grained (o padrão já é só leitura de repositórios públicos). */
const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * Vincula a conta do GitHub (o mesmo que o Quiver Launcher faz): com um token, o limite da API
 * sobe de 60 para 5.000 consultas por hora. O token é conferido no GitHub antes de ser guardado
 * (cifrado no main) e nunca volta para a tela.
 */
export function GitHubSection() {
  const { data: status, isLoading } = useGitHubStatus();
  const { connect, disconnect } = useGitHubAccount();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token.trim()) {
      setError('Cole o token gerado no GitHub.');
      return;
    }
    // Mesmo formato que o main valida: o erro aparece na hora, sem ir até o GitHub.
    if (!GITHUB_TOKEN_PATTERN.test(token.trim())) {
      setError(GITHUB_TOKEN_HINT);
      return;
    }
    try {
      const result = await connect.mutateAsync(token.trim());
      setToken('');
      toast.push({
        tone: 'success',
        title: `Conectado como ${result.login}`,
        description: result.rate ? `${formatNumber(result.rate.limit)} consultas por hora na Loja.` : undefined,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="panel" aria-labelledby="github-heading">
      <header className="panel__header">
        <h2 id="github-heading" className="panel__title">
          Conta do GitHub
        </h2>
      </header>
      <p className="muted">
        A Loja consulta as versões dos ports no GitHub. Sem conta, o GitHub permite 60 consultas por hora; com a sua conta
        vinculada, 5.000. O token é só de leitura, fica cifrado no Windows (DPAPI) e não dá acesso a nada privado.
      </p>

      {isLoading ? (
        <Skeleton className="github-status__skeleton" />
      ) : (
        status && (
          <div className="github-status">
            <p className="github-status__account">
              {status.login ? (
                <>
                  <CheckIcon size={16} /> Conectado como <strong>{status.login}</strong>
                </>
              ) : (
                'Sem conta vinculada'
              )}
            </p>
            {status.rate ? (
              <>
                <ProgressBar
                  value={status.rate.remaining}
                  max={status.rate.limit}
                  size="sm"
                  label="Consultas restantes nesta hora"
                  valueText={`${status.rate.remaining} de ${status.rate.limit}`}
                />
                <p className="field__hint">
                  {formatNumber(status.rate.remaining)} de {formatNumber(status.rate.limit)} consultas restantes · renova às{' '}
                  {new Date(status.rate.resetAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            ) : (
              <p className="field__hint">Sem conexão com o GitHub agora.</p>
            )}
          </div>
        )
      )}

      {status?.login ? (
        <div className="form__actions form__actions--start">
          <Button variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.push({ tone: 'info', title: 'Conta do GitHub desvinculada' }) })}>
            Desconectar
          </Button>
        </div>
      ) : (
        <>
          <ol className="github-steps">
            <li>
              Abra a página de tokens do GitHub (entre na sua conta se pedir).{' '}
              <Button size="sm" variant="secondary" icon={<LinkIcon size={14} />} onClick={() => void call('app:open-external', NEW_TOKEN_URL)}>
                Abrir GitHub
              </Button>
            </li>
            <li>Dê um nome (ex.: RetroVault) e escolha a validade.</li>
            <li>
              Em “Repository access” deixe <strong>Public repositories</strong> e não marque nenhuma permissão.
            </li>
            <li>Clique em “Generate token”, copie e cole aqui.</li>
          </ol>
          <form className="form" onSubmit={submit} noValidate>
            <TextField
              label="Token do GitHub"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              error={error}
              maxLength={300}
            />
            <div className="form__actions form__actions--start">
              <Button type="submit" variant="primary" loading={connect.isPending}>
                Conectar
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
