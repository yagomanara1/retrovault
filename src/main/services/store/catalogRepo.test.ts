import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON_KEYS } from '@shared/categoryIcons';
import { quiverPageUrl } from '@shared/store';
import Ajv from 'ajv';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { ApiCache } from '../apiCache';
import { parseCatalog, portSchema } from './catalogSchema';
import { StoreCatalogService } from './catalogService';
import type { FetchFn, GitHubClient } from './githubClient';
import { SEED_CATALOG } from './seedCatalog';
import { portsSection, renderReadme } from '../../../../scripts/catalog/readme';

// O schema do editor do repositório do catálogo (scripts/catalog/template/catalog.schema.json) é escrito
// à mão: estes testes garantem que ele acompanha a validação do app (catalogSchema.ts).
const schema = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../scripts/catalog/template/catalog.schema.json'), 'utf8'));
const port = schema.definitions.port;

describe('catalog.schema.json (editor do repositório do catálogo)', () => {
  it('tem exatamente os campos de um port que o app aceita', () => {
    expect(Object.keys(port.properties).sort()).toEqual(Object.keys(portSchema.shape).sort());
  });

  it('obrigatórios iguais aos do app', () => {
    const required = Object.entries(portSchema.shape)
      .filter(([, field]) => !field.isOptional())
      .map(([key]) => key)
      .filter((key) => key !== 'tags'); // tags tem padrão [] no app: opcional no arquivo
    expect([...port.required].sort()).toEqual(required.sort());
  });

  it('o catálogo embutido inteiro passa no schema do editor (sem marcar erro onde o app aceita)', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate({ $schema: './catalog.schema.json', schemaVersion: 1, ports: parseCatalog(SEED_CATALOG).ports });
    expect(ok ? [] : validate.errors).toEqual([]);
  });

  it('o catalog.json exportado volta inteiro pelo caminho online (com $schema e até com BOM de editor do Windows)', async () => {
    const db = openDatabase(':memory:');
    const cache = new ApiCache(new CacheRepository(db));
    const exported = await new StoreCatalogService({ cache, github: {} as GitHubClient, remoteUrl: () => null }).exportJson();
    const remote = new StoreCatalogService({
      cache,
      github: {} as GitHubClient,
      remoteUrl: () => 'https://raw.githubusercontent.com/eu/retrovault-catalog/main/catalog.json',
      fetchFn: (async () => new Response(`﻿${exported}`, { status: 200, headers: { 'content-type': 'text/plain' } })) as FetchFn,
    });
    const result = await remote.testRemote('https://raw.githubusercontent.com/eu/retrovault-catalog/main/catalog.json');
    expect(result).toEqual({ ports: SEED_CATALOG.ports.length, skipped: [] });
    expect((await remote.catalog()).source).toBe('remote');
  });

  it('a lista de plataformas é a dos ícones do app', () => {
    expect([...port.properties.original.properties.platform.enum].sort()).toEqual([...CATEGORY_ICON_KEYS].sort());
  });

  it('README do repositório: todo port aparece com o link do projeto e do autor, agrupado por console', async () => {
    const exported = await new StoreCatalogService({ cache: new ApiCache(new CacheRepository(openDatabase(':memory:'))), github: {} as GitHubClient, remoteUrl: () => null }).exportJson();
    const readme = renderReadme(readFileSync(path.resolve(__dirname, '../../../../scripts/catalog/template/README.md'), 'utf8'), exported);
    const ports = parseCatalog(SEED_CATALOG).ports;
    expect(readme).not.toMatch(/<!-- (PORTS|TOTAL) -->/);
    expect(readme).toContain(`**${ports.length} ports`);
    for (const p of ports) {
      expect(readme, p.id).toContain(`](https://github.com/${p.source.repo}) |`);
      expect(readme, p.id).toContain(`](https://github.com/${p.source.repo.split('/')[0]}) |`);
    }
    // Uma linha de tabela por port, e cada console uma vez só.
    expect(readme.split('\n').filter((l) => l.startsWith('| [')).length).toBe(ports.length);
    const headings = readme.split('\n').filter((l) => l.startsWith('### '));
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toContain(`### Nintendo 64 (${ports.filter((p) => p.original.platform === 'n64').length})`);
  });

  it('Quiver: todo port embutido tem página, o link fica no site do Quiver e o README mostra cada um', async () => {
    const ports = parseCatalog(SEED_CATALOG).ports;
    expect(ports.filter((p) => !p.quiver).map((p) => p.id)).toEqual([]);
    expect(quiverPageUrl('heretic-ii-heretic2r')).toBe('https://quiverlauncher.com/apps/heretic-ii-heretic2r');
    const exported = await new StoreCatalogService({ cache: new ApiCache(new CacheRepository(openDatabase(':memory:'))), github: {} as GitHubClient, remoteUrl: () => null }).exportJson();
    const readme = renderReadme(readFileSync(path.resolve(__dirname, '../../../../scripts/catalog/template/README.md'), 'utf8'), exported);
    for (const p of ports) expect(readme, p.id).toContain(`[Ver](${quiverPageUrl(p.quiver!)}) |`);
    expect(readme).toContain('[Quiver Launcher](https://quiverlauncher.com)');
  });

  it('Quiver: o catálogo só aceita o slug (nunca um endereço, que tiraria o link do site)', () => {
    const base = parseCatalog(SEED_CATALOG).ports[0]!;
    const { ports, skipped } = parseCatalog({
      schemaVersion: 1,
      ports: [
        { ...base, id: 'ok', source: { type: 'github', repo: 'a/ok' }, quiver: 'jogo-port-2' },
        { ...base, id: 'url', source: { type: 'github', repo: 'a/url' }, quiver: 'https://evil.example/x' },
        { ...base, id: 'barra', source: { type: 'github', repo: 'a/barra' }, quiver: '../apps' },
        { ...base, id: 'maiuscula', source: { type: 'github', repo: 'a/m' }, quiver: 'Jogo' },
      ],
    });
    expect(ports.map((p) => p.id)).toEqual(['ok']);
    expect(skipped).toHaveLength(3);
  });

  it('README: texto do catálogo com | ou quebra de linha não desmonta a tabela', () => {
    const port = { ...parseCatalog(SEED_CATALOG).ports[0]!, name: 'A | B', developer: 'Eu\nmesmo' };
    expect(portsSection([port])).toContain('[A \\| B](https://github.com/');
    expect(portsSection([port])).toContain('[Eu mesmo](');
    expect(() => renderReadme('sem marcas', '{}')).toThrow(/marcas/);
  });

  it('as regex do schema compilam (o editor usaria em silêncio uma regex quebrada)', () => {
    const patterns: string[] = [];
    JSON.stringify(schema, (key, value) => {
      if (key === 'pattern' && typeof value === 'string') patterns.push(value);
      return value;
    });
    expect(patterns.length).toBeGreaterThan(5);
    for (const p of patterns) expect(() => new RegExp(p, 'u'), p).not.toThrow();
  });
});
