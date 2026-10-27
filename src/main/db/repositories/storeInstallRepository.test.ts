import { describe, expect, it } from 'vitest';
import type { InstalledVersion } from '@shared/store';
import { openDatabase } from '../database';
import { GameRepository } from './gameRepository';
import { StoreInstallRepository } from './storeInstallRepository';

const version = (tag: string): InstalledVersion => ({
  kind: 'archive',
  tag,
  assetName: `${tag}.zip`,
  sha256: `sha-${tag}`,
  verified: true,
  installDir: `C:\\Ports\\demo\\${tag}`,
  exePath: `C:\\Ports\\demo\\${tag}\\demo.exe`,
  sizeBytes: 1,
  installedAt: '2026-10-01T00:00:00.000Z',
});

/** Instalação com versão anterior; `previousJson` substitui o que ficou gravado na coluna. */
function setup(previousJson?: string) {
  const db = openDatabase(':memory:');
  const game = new GameRepository(db).create({ title: 'Demo', kind: 'executable', path: 'C:\\demo.exe', corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
  const repo = new StoreInstallRepository(db);
  repo.save('demo', version('v2'), version('v1'), game.id);
  if (previousJson !== undefined) db.prepare('UPDATE store_installs SET previous_json = ? WHERE port_id = ?').run(previousJson, 'demo');
  return repo;
}

describe('StoreInstallRepository: versão anterior', () => {
  it('volta como foi gravada', () => {
    expect(setup().get('demo')!.previous).toEqual(version('v1'));
  });

  it('gravada antes da migração 14 (sem "kind") vale como archive', () => {
    const { kind: _kind, ...old } = version('v1');
    expect(setup(JSON.stringify(old)).get('demo')!.previous).toEqual(version('v1'));
  });

  it('coluna corrompida ou incompleta: só perde o "voltar"; a instalação ativa continua', () => {
    for (const broken of ['{"tag": "v1"', '{"tag":"v1"}', 'null', '[]', JSON.stringify({ ...version('v1'), installDir: 5 })]) {
      const install = setup(broken).get('demo')!;
      expect(install.previous, broken).toBeNull();
      expect(install.tag).toBe('v2');
    }
  });
});
