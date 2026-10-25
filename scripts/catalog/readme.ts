// Gera a lista de ports (com os créditos de cada projeto) do README do repositório do catálogo,
// a partir do catalog.json desse repositório: o que o app mostra na Loja é o que aparece no README.
import { quiverPageUrl, type StorePort } from '@shared/store';
import { CONSOLE_CATEGORIES, consoleOfPort } from '@shared/consoleCategories';
import { parseCatalog } from '../../src/main/services/store/catalogSchema';

const PORTS_MARK = '<!-- PORTS -->';
const TOTAL_MARK = '<!-- TOTAL -->';

const NEEDS: Record<StorePort['requires']['kind'], string> = {
  rom: 'ROM do jogo',
  'game-files': 'Arquivos do jogo',
  none: 'Nada (jogo livre)',
};
const AI: Record<NonNullable<StorePort['ai']>, string> ={ none: 'Não', assisted: 'Com ajuda', generated: 'Sim' };

/** Texto de célula de tabela Markdown: sem quebra de linha e com `|` escapado. */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function row(port: StorePort): string {
  const repo = port.source.repo;
  const owner = repo.split('/')[0];
  const project = `[${cell(port.name)}](https://github.com/${repo})`;
  const author = `[${cell(port.developer)}](https://github.com/${owner})`;
  const quiver = port.quiver ? `[Ver](${quiverPageUrl(port.quiver)})` : '—';
  return `| ${project} | ${cell(port.original.title)} | ${author} | ${NEEDS[port.requires.kind]} | ${AI[port.ai ?? 'none']} | ${quiver} |`;
}

/** Seções por console (na ordem dos consoles do app), cada uma com a tabela dos seus ports em ordem alfabética. */
export function portsSection(ports: StorePort[]): string {
  const groups = new Map<string, StorePort[]>();
  for (const port of ports) {
    const name = consoleOfPort(port.original)?.name ?? 'Outros';
    groups.set(name, [...(groups.get(name) ?? []), port]);
  }
  const order = (name: string): number => {
    const i = CONSOLE_CATEGORIES.findIndex((c) => c.name === name);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([name, list]) =>
      [
        `### ${name} (${list.length})`,
        '',
        '| Port | Jogo original | Autor | Você precisa de | Feito com IA | No Quiver |',
        '|---|---|---|---|---|---|',
        ...[...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(row),
      ].join('\n'),
    )
    .join('\n\n');
}

/** Preenche o modelo do README com o total e a lista de ports do catalog.json. */
export function renderReadme(template: string, catalogJson: string): string {
  if (!template.includes(PORTS_MARK) || !template.includes(TOTAL_MARK)) throw new Error('modelo do README sem as marcas da lista de ports');
  const { ports } = parseCatalog(JSON.parse(catalogJson.replace(/^﻿/, '')));
  return template.replaceAll(TOTAL_MARK, String(ports.length)).replace(PORTS_MARK, portsSection(ports));
}
