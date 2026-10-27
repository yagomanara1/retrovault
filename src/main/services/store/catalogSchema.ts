import { z } from 'zod';
import { isCategoryIconKey, type CategoryIconKey } from '@shared/categoryIcons';
import { QUIVER_SLUG, type StoreAsset, type StorePort } from '@shared/store';

/** Versão do formato do catálogo que este app entende (campos novos opcionais não mudam a versão). */
export const CATALOG_SCHEMA_VERSION = 1;

const MAX_PATTERN = 200;

/**
 * Endereço da página de um arquivo no GitHub (github.com/dono/repo/blob/ramo/caminho) → o arquivo
 * em si (raw.githubusercontent.com/dono/repo/ramo/caminho). Outros endereços passam iguais.
 */
export function toRawGitHubUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(u.pathname);
    if (u.hostname !== 'github.com' || !m) return url;
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  } catch {
    return url;
  }
}

/** Hosts de onde a Loja aceita baixar imagens (logos dos projetos e o CDN do SteamGridDB). */
const ART_HOSTS = new Set(['raw.githubusercontent.com', 'cdn2.steamgriddb.com']);

export function isAllowedArtUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ART_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Regex do catálogo: curta e compilável (um catálogo remoto ruim não pode derrubar a Loja). */
const assetPattern = z
  .string()
  .min(1)
  .max(MAX_PATTERN)
  .refine((p) => {
    try {
      new RegExp(p, 'i');
      return true;
    } catch {
      return false;
    }
  }, 'regex inválida');

/** Exportado para o teste que confere o schema do editor do repositório do catálogo (catalog.schema.json). */
export const portSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'id inválido'),
  name: z.string().trim().min(1).max(80),
  original: z.object({
    title: z.string().trim().min(1).max(120),
    platform: z.string().refine(isCategoryIconKey, 'plataforma desconhecida').transform((p) => p as CategoryIconKey),
    system: z.string().trim().min(1).max(40).optional(),
  }),
  developer: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  source: z.object({
    type: z.literal('github'),
    repo: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/, 'repositório inválido (dono/nome)'),
  }),
  assets: z.object({ windows: assetPattern }),
  // Relativo à pasta do port, sem sair dela (nada de "..", unidade ou barra inicial).
  executable: z
    .string()
    // Aceita nomes com acento e símbolos (ex.: "Crash™ Team Racing Nitro-Fueled.exe"); só os caracteres
    // proibidos no Windows ficam de fora. O caminho ainda é conferido por safeEntryPath ao instalar.
    // eslint-disable-next-line no-control-regex -- recusar caracteres de controle é o objetivo
    .regex(/^(?!.*\.\.)(?![\\/])(?![A-Za-z]:)[^<>:"|?*\u0000-\u001f]{1,200}\.exe$/i, 'executável inválido')
    .optional(),
  requires: z.object({
    kind: z.enum(['rom', 'game-files', 'none']),
    label: z.string().trim().min(1).max(160),
    note: z.string().trim().max(400).optional(),
  }),
  setup: z
    .object({
      method: z.enum(['copy', 'in-app']),
      target: z
        .string()
        .regex(/^(?!.*\.\.)(?![\\/])(?![A-Za-z]:)[\w ./\\-]{1,200}$/, 'destino inválido')
        .optional(),
      accepted: z
        .array(
          z
            .object({
              name: z.string().trim().min(1).max(80),
              sha1: z.string().regex(/^[0-9a-f]{40}$/i).transform((s) => s.toLowerCase()).optional(),
              md5: z.string().regex(/^[0-9a-f]{32}$/i).transform((s) => s.toLowerCase()).optional(),
              sha256: z.string().regex(/^[0-9a-f]{64}$/i).transform((s) => s.toLowerCase()).optional(),
              header: z.object({ code: z.string().regex(/^[A-Z0-9]{4}$/), version: z.number().int().min(0).max(255) }).optional(),
            })
            .refine((r) => r.sha1 || r.md5 || r.sha256 || r.header, 'cada versão precisa de sha1, md5, sha256 ou header'),
        )
        .max(50)
        .optional(),
      instructions: z.string().trim().min(1).max(400),
    })
    .refine((s) => s.method !== 'copy' || !!s.target, 'method "copy" precisa de target')
    .optional(),
  art: z
    .object({
      logo: z
        .string()
        .url()
        .refine((u) => isAllowedArtUrl(u), 'logo só de https://raw.githubusercontent.com')
        .optional(),
      boxart: z
        .string()
        .url()
        .refine((u) => isAllowedArtUrl(u), 'capa só de https://raw.githubusercontent.com')
        .optional(),
    })
    .optional(),
  artQuery: z.string().trim().min(1).max(120).optional(),
  install: z.enum(['archive', 'portable', 'installer']).optional(),
  // Caminhos absolutos com variável de ambiente no começo (%LOCALAPPDATA%\Programs\…); nada de "..".
  installedExe: z
    .array(z.string().regex(/^%(LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|USERPROFILE)%\\(?!.*\.\.)[\w .()\\-]{1,200}\.exe$/i, 'caminho inválido'))
    .max(6)
    .optional(),
  ai: z.enum(['none', 'assisted', 'generated']).optional(),
  // Mods do GameBanana: a pasta é relativa à do port (nada de "..", unidade ou barra inicial).
  mods: z
    .object({
      gamebanana: z.number().int().positive(),
      folder: z.string().regex(/^(?!.*\.\.)(?![\\/])(?![A-Za-z]:)[\w .\\/-]{1,100}$/, 'pasta de mods inválida'),
      extensions: z.array(z.string().regex(/^\.[a-z0-9]{1,8}$/i, 'extensão inválida')).min(1).max(8),
    })
    .optional(),
  homepage: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'apenas https')
    .optional(),
  quiver: z.string().max(150).regex(QUIVER_SLUG, 'slug do Quiver inválido (minúsculas, números e hífens)').optional(),
});

const catalogSchema = z.object({
  schemaVersion: z.number().int().min(1),
  ports: z.array(z.unknown()).max(1000),
});

export interface ParsedCatalog {
  ports: StorePort[];
  /** Itens ignorados (inválidos ou repetidos), com o motivo; útil para quem mantém o catálogo. */
  skipped: string[];
}

/**
 * Valida o catálogo item a item: um port mal escrito é ignorado sem derrubar os outros.
 * Lança erro só quando o arquivo inteiro não é um catálogo (ou é de uma versão mais nova do formato).
 */
export function parseCatalog(raw: unknown): ParsedCatalog {
  const result = catalogSchema.safeParse(raw);
  if (!result.success) throw new Error('o arquivo precisa ser um objeto com "schemaVersion" e a lista "ports"');
  const catalog = result.data;
  if (catalog.schemaVersion > CATALOG_SCHEMA_VERSION) {
    throw new Error(`Catálogo no formato ${catalog.schemaVersion}; atualize o RetroVault para ler.`);
  }
  const ports: StorePort[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  catalog.ports.forEach((item, index) => {
    const result = portSchema.safeParse(item);
    if (!result.success) {
      skipped.push(`#${index}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return;
    }
    if (seen.has(result.data.id)) {
      skipped.push(`#${index}: id repetido "${result.data.id}"`);
      return;
    }
    seen.add(result.data.id);
    ports.push(result.data);
  });
  return { ports, skipped };
}

/** Primeiro arquivo cujo nome bate com a regex do catálogo (sem diferenciar maiúsculas). */
export function pickAsset<A extends Pick<StoreAsset, 'name'>>(assets: readonly A[], pattern: string): A | null {
  const re = new RegExp(pattern, 'i');
  return assets.find((a) => re.test(a.name)) ?? null;
}
