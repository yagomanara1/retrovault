import type { InstalledMod } from '@shared/mods';
import type { DB } from '../database';

interface Row {
  mod_id: number;
  file_id: number;
  name: string;
  version: string | null;
  files_json: string;
  installed_at: string;
}

const toMod = (r: Row): InstalledMod => ({
  modId: r.mod_id,
  fileId: r.file_id,
  name: r.name,
  version: r.version,
  files: JSON.parse(r.files_json) as string[],
  installedAt: r.installed_at,
});

/** Mods instalados por port (os arquivos que cada um colocou, relativos à pasta do port). */
export class ModInstallRepository {
  constructor(private readonly db: DB) {}

  list(portId: string): InstalledMod[] {
    return this.db.prepare<[string], Row>('SELECT * FROM mod_installs WHERE port_id = ? ORDER BY installed_at').all(portId).map(toMod);
  }

  get(portId: string, modId: number): InstalledMod | null {
    const row = this.db.prepare<[string, number], Row>('SELECT * FROM mod_installs WHERE port_id = ? AND mod_id = ?').get(portId, modId);
    return row ? toMod(row) : null;
  }

  save(portId: string, mod: Omit<InstalledMod, 'installedAt'>): InstalledMod {
    const installedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mod_installs (port_id, mod_id, file_id, name, version, files_json, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (port_id, mod_id) DO UPDATE SET file_id = excluded.file_id, name = excluded.name, version = excluded.version,
           files_json = excluded.files_json, installed_at = excluded.installed_at`,
      )
      .run(portId, mod.modId, mod.fileId, mod.name, mod.version, JSON.stringify(mod.files), installedAt);
    return { ...mod, installedAt };
  }

  delete(portId: string, modId: number): void {
    this.db.prepare('DELETE FROM mod_installs WHERE port_id = ? AND mod_id = ?').run(portId, modId);
  }
}
