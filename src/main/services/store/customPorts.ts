import type { CustomPortInput, RepoAssetOption, RepoInspection, StorePort } from '@shared/store';
import type { CustomPortRepository } from '../../db/repositories/customPortRepository';
import { AppError } from '../../errors';
import { pickAsset, portSchema } from './catalogSchema';
import type { GitHubClient } from './githubClient';

const MAX_CUSTOM = 100;

/**
 * "dono/repo" a partir do que o usuário colar: o link do repositório (com ou sem /releases, .git,
 * barra no fim), o link de uma release ou só "dono/repo". null se não for um repositório do GitHub.
 */
export function parseRepoInput(input: string): string | null {
  const text = input.trim();
  const short = /^([\w.-]{1,100})\/([\w.-]{1,100})$/.exec(text);
  if (short) return `${short[1]}/${short[2]!.replace(/\.git$/i, '')}`;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) return null;
    return `${owner}/${repo.replace(/\.git$/i, '')}`;
  } catch {
    return null;
  }
}

const PACKAGE = /\.(zip|7z|tar\.gz|tgz|exe|msi)$/i;
/** O que nunca é o pacote de Windows: outros sistemas, ARM, assinaturas, hashes e código-fonte. */
const NOT_WINDOWS = /(linux|ubuntu|debian|mac|osx|darwin|android|\.apk$|appimage|steamdeck|switch|ios|arm64|aarch64|armv7|source|src\b|sources|symbols|\.sha\d+$|\.sig$|\.asc$|\.txt$|\.json$)/i;
const LOOKS_WINDOWS = /(win|windows|x64|x86_64|amd64|pc)/i;

/** Tokens de arquitetura que não são "versão": ficam fixos na regra (x64 não pode virar x86). */
const ARCH = /x86_64|x86-64|x64|x86|win64|win32|amd64|i386|i686/gi;

/**
 * Regra (regex) que reconhece o mesmo arquivo nas próximas versões: o nome escapado, com cada
 * sequência de números trocada por "qualquer número" (a versão muda) e as arquiteturas mantidas.
 * Ex.: "Game-v1.2.3-windows-x64.zip" → "^Game-v\d+\.\d+\.\d+-windows-x64\.zip$".
 */
export function patternFromAssetName(name: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of name.matchAll(ARCH)) {
    parts.push(generalize(name.slice(last, m.index)), escapeRegex(m[0]));
    last = m.index! + m[0].length;
  }
  parts.push(generalize(name.slice(last)));
  return `^${parts.join('')}$`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generalize(text: string): string {
  return text
    .split(/(\d+)/)
    .map((piece, i) => (i % 2 === 1 ? '\\d+' : escapeRegex(piece)))
    .join('');
}

/** Arquivos que podem ser o pacote de Windows, o mais provável primeiro. */
export function windowsCandidates(assets: readonly { name: string; size: number }[]): RepoAssetOption[] {
  const usable = assets.filter((a) => PACKAGE.test(a.name) && !NOT_WINDOWS.test(a.name));
  const score = (name: string) => (LOOKS_WINDOWS.test(name) ? 0 : 1) + (/\.(zip|7z)$/i.test(name) ? 0 : 0.5);
  return [...usable]
    .sort((a, b) => score(a.name) - score(b.name))
    .map((a) => ({ name: a.name, size: a.size, pattern: patternFromAssetName(a.name) }));
}

/** Nome legível a partir do repositório: "zelda-3-launcher" → "Zelda 3 Launcher". */
function prettyName(repo: string): string {
  const name = repo
    .split('/')[1]!
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase: "JetForceGemini" → "Jet Force Gemini"
    .replace(/[-_.]+/g, ' ')
    .trim();
  return name.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

/** Palavras que descrevem o port, não o jogo (saem do "jogo original" sugerido, usado na busca da capa). */
const PORT_WORDS = /\b(launcher|port|pc|recomp|recompiled|recompilation|decomp|decompilation|native|windows|win64|reimplementation)\b/gi;

/** "Super Metroid Launcher" → "Super Metroid"; se sobrar nada, o nome inteiro. */
export function suggestOriginalTitle(name: string): string {
  const cleaned = name.replace(PORT_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || name;
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

interface CustomPortDeps {
  repo: CustomPortRepository;
  github: Pick<GitHubClient, 'latestAssets'>;
  /** Ports do catálogo (para não adicionar de novo um projeto que já está lá). */
  catalogPorts: () => Promise<StorePort[]>;
  /** O port está instalado agora? (não dá para remover da Loja sem desinstalar antes). */
  isInstalled: (portId: string) => boolean;
}

/**
 * Ports adicionados pelo usuário a partir de um repositório do GitHub. Viram itens do mesmo formato
 * do catálogo (validados pelo mesmo portSchema) e a Loja os trata igual: instalar, atualizar, voltar.
 * A diferença: não passaram pela curadoria (a tela avisa) e podem ser removidos da Loja.
 */
export class CustomPortService {
  constructor(private readonly deps: CustomPortDeps) {}

  /** Os ports válidos (um registro que deixou de validar numa versão nova do app só fica de fora). */
  list(): StorePort[] {
    return this.deps.repo.list().flatMap(({ id, json }) => {
      try {
        const parsed = portSchema.safeParse(JSON.parse(json));
        if (parsed.success) return [{ ...parsed.data, custom: true }];
      } catch {
        /* registro corrompido: ignora */
      }
      console.warn('[store] port adicionado pelo usuário ignorado (inválido)', id);
      return [];
    });
  }

  async inspect(input: string): Promise<RepoInspection> {
    const repo = parseRepoInput(input);
    if (!repo) throw new AppError('VALIDATION', 'Cole o link de um repositório do GitHub (ex.: https://github.com/dono/projeto) ou "dono/projeto".');
    await this.ensureNew(repo);
    const latest = await this.deps.github.latestAssets(repo);
    if (!latest) throw new AppError('NOT_FOUND', 'Este repositório não publica versões (Releases) no GitHub, então não há o que instalar.');
    const assets = windowsCandidates(latest.assets);
    if (assets.length === 0) {
      throw new AppError('VALIDATION', `A versão ${latest.tag} não tem arquivo para Windows (.zip, .7z, .tar.gz, .exe ou .msi).`);
    }
    const suggestedName = prettyName(repo);
    return { repo, suggestedName, suggestedTitle: suggestOriginalTitle(suggestedName), latestTag: latest.tag, assets };
  }

  async add(input: CustomPortInput): Promise<StorePort> {
    const repo = parseRepoInput(input.repo);
    if (!repo) throw new AppError('VALIDATION', 'Repositório inválido.');
    await this.ensureNew(repo);
    if (this.deps.repo.list().length >= MAX_CUSTOM) throw new AppError('VALIDATION', `Limite de ${MAX_CUSTOM} ports adicionados.`);
    try {
      new RegExp(input.assetPattern, 'i');
    } catch {
      throw new AppError('VALIDATION', 'A regra do arquivo não é uma expressão regular válida.');
    }
    // A regra precisa achar um arquivo de verdade na versão mais recente (senão "Baixar" nunca funcionaria).
    const latest = await this.deps.github.latestAssets(repo);
    if (!latest || !pickAsset(latest.assets, input.assetPattern)) {
      throw new AppError('VALIDATION', 'A regra do arquivo não encontra nenhum arquivo na versão mais recente.');
    }
    const id = this.freeId(`meu-${slug(repo.split('/')[1]!) || 'port'}`);
    const [owner] = repo.split('/');
    const candidate = {
      id,
      name: input.name.trim(),
      original: { title: input.originalTitle.trim(), platform: input.platform, ...(input.system?.trim() ? { system: input.system.trim() } : {}) },
      developer: owner,
      summary: `Adicionado por você a partir de github.com/${repo}.`,
      description: '',
      tags: [],
      source: { type: 'github', repo },
      assets: { windows: input.assetPattern },
      requires: { kind: input.requiresKind, label: input.requiresLabel.trim() || 'Os arquivos do seu jogo' },
      ...(input.requiresKind === 'none'
        ? {}
        : { setup: { method: 'in-app', instructions: 'Siga as instruções do projeto (botão "Página do projeto") para fornecer a sua cópia do jogo.' } }),
      homepage: `https://github.com/${repo}`,
    };
    const parsed = portSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new AppError('VALIDATION', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    this.deps.repo.save(id, JSON.stringify(parsed.data));
    return { ...parsed.data, custom: true };
  }

  remove(id: string): void {
    if (!this.deps.repo.has(id)) throw new AppError('NOT_FOUND', 'Este port não foi adicionado por você.');
    if (this.deps.isInstalled(id)) throw new AppError('VALIDATION', 'Desinstale o port antes de removê-lo da Loja.');
    this.deps.repo.delete(id);
  }

  /** Recusa um projeto que já está na Loja (no catálogo ou adicionado antes). */
  private async ensureNew(repo: string): Promise<void> {
    const key = repo.toLowerCase();
    const existing = [...(await this.deps.catalogPorts()), ...this.list()].find((p) => p.source.repo.toLowerCase() === key);
    if (existing) throw new AppError('DUPLICATE', `Este projeto já está na Loja: "${existing.name}".`);
  }

  private freeId(base: string): string {
    let id = base;
    for (let n = 2; this.deps.repo.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
    return id;
  }
}
