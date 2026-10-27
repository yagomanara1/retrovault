import type { InstalledVersion, InstallKind, StoreInstall } from '@shared/store';
import { z } from 'zod';
import type { DB } from '../database';

interface Row {
  port_id: string;
  kind: InstallKind;
  tag: string;
  asset_name: string;
  sha256: string;
  verified: number;
  install_dir: string;
  exe_path: string;
  size_bytes: number;
  installed_at: string;
  previous_json: string | null;
  game_id: number | null;
}

const SELECT = `
  SELECT i.*, g.game_id
  FROM store_installs i
  LEFT JOIN store_port_games g ON g.port_id = i.port_id`;

const PreviousSchema = z.object({
  // Guardada antes da migração 14: sem "kind" (só existia archive).
  kind: z.enum(['archive', 'portable', 'installer']).default('archive'),
  tag: z.string(),
  assetName: z.string(),
  sha256: z.string(),
  verified: z.boolean(),
  installDir: z.string(),
  exePath: z.string(),
  sizeBytes: z.number(),
  installedAt: z.string(),
}) satisfies z.ZodType<InstalledVersion, unknown>;

function parsePrevious(json: string | null): InstalledVersion | null {
  if (!json) return null;
  try {
    const parsed = PreviousSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // coluna corrompida ou incompleta: só perde o "voltar", a instalação ativa continua valendo
  }
}

function toInstall(r: Row): StoreInstall {
  return {
    portId: r.port_id,
    kind: r.kind,
    tag: r.tag,
    assetName: r.asset_name,
    sha256: r.sha256,
    verified: r.verified === 1,
    installDir: r.install_dir,
    exePath: r.exe_path,
    sizeBytes: r.size_bytes,
    installedAt: r.installed_at,
    gameId: r.game_id,
    previous: parsePrevious(r.previous_json),
  };
}

/** Ports instalados pela Loja, a versão anterior de cada um e o jogo da biblioteca. */
export class StoreInstallRepository {
  constructor(private readonly db: DB) {}

  list(): StoreInstall[] {
    return this.db.prepare<[], Row>(`${SELECT} ORDER BY i.installed_at DESC`).all().map(toInstall);
  }

  get(portId: string): StoreInstall | null {
    const row = this.db.prepare<[string], Row>(`${SELECT} WHERE i.port_id = ?`).get(portId);
    return row ? toInstall(row) : null;
  }

  /** Grava a versão ativa (e a anterior, se houver) e o vínculo com o jogo de uma vez só. */
  save(portId: string, active: InstalledVersion, previous: InstalledVersion | null, gameId: number): StoreInstall {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO store_installs (port_id, kind, tag, asset_name, sha256, verified, install_dir, exe_path, size_bytes, installed_at, previous_json)
           VALUES (@portId, @kind, @tag, @assetName, @sha256, @verified, @installDir, @exePath, @sizeBytes, @installedAt, @previousJson)
           ON CONFLICT (port_id) DO UPDATE SET
             kind = excluded.kind, tag = excluded.tag, asset_name = excluded.asset_name, sha256 = excluded.sha256, verified = excluded.verified,
             install_dir = excluded.install_dir, exe_path = excluded.exe_path, size_bytes = excluded.size_bytes,
             installed_at = excluded.installed_at, previous_json = excluded.previous_json`,
        )
        .run({ portId, ...active, verified: active.verified ? 1 : 0, previousJson: previous ? JSON.stringify(previous) : null });
      this.db
        .prepare('INSERT INTO store_port_games (port_id, game_id) VALUES (?, ?) ON CONFLICT (port_id) DO UPDATE SET game_id = excluded.game_id')
        .run(portId, gameId);
    })();
    return this.get(portId)!;
  }

  /** Remove a instalação; o vínculo com o jogo fica (para reinstalar no mesmo jogo). */
  remove(portId: string): void {
    this.db.prepare('DELETE FROM store_installs WHERE port_id = ?').run(portId);
  }

  /** ROM conferida lembrada para o port (arquivo original do usuário). */
  rom(portId: string): { sourcePath: string; versionName: string } | null {
    const row = this.db
      .prepare<[string], { source_path: string; version_name: string }>('SELECT source_path, version_name FROM store_port_roms WHERE port_id = ?')
      .get(portId);
    return row ? { sourcePath: row.source_path, versionName: row.version_name } : null;
  }

  saveRom(portId: string, sourcePath: string, versionName: string): void {
    this.db
      .prepare(
        `INSERT INTO store_port_roms (port_id, source_path, version_name, configured_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (port_id) DO UPDATE SET source_path = excluded.source_path, version_name = excluded.version_name, configured_at = excluded.configured_at`,
      )
      .run(portId, sourcePath, versionName, new Date().toISOString());
  }

  /** Jogo lembrado para o port, mesmo sem instalação ativa. */
  gameFor(portId: string): number | null {
    return this.db.prepare<[string], { game_id: number }>('SELECT game_id FROM store_port_games WHERE port_id = ?').get(portId)?.game_id ?? null;
  }
}
