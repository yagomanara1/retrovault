import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AcceptedRom, RomSetupResult, RomStatus, StorePort } from '@shared/store';
import type { StoreInstallRepository } from '../../db/repositories/storeInstallRepository';
import { AppError } from '../../errors';
import { n64ByteOrder, toBigEndianN64, type N64ByteOrder } from '../romHasher';
import type { StoreCatalogService } from './catalogService';
import { safeEntryPath } from './zipExtract';

/** Maior cartucho de N64 tem 64 MB e o de DS 512 MB (raros); a ROM inteira é lida na memória. */
const MAX_ROM_BYTES = 512 * 1024 * 1024;
/** CRC do logo da Nintendo no cabeçalho de toda ROM de DS (offset 0x15C): identifica o formato. */
const NDS_LOGO_CRC = 0xcf56;
/** Pasta (dentro da instalação) da cópia .z64 gerada para ports que pedem a ROM sozinhos. */
const PREPARED_DIR = 'rom-retrovault';

const REGIONS: Record<string, string> = {
  E: 'EUA',
  J: 'Japão',
  P: 'Europa',
  D: 'Alemanha',
  F: 'França',
  I: 'Itália',
  S: 'Espanha',
  U: 'Austrália',
  C: 'China',
};

export interface RomInfo {
  /** z64/v64/n64 = Nintendo 64 nessa ordem de bytes; nds = Nintendo DS; raw = outro console, conferido só pelo hash. */
  format: N64ByteOrder | 'nds' | 'raw';
  /** Conteúdo para conferir e entregar (N64 já em .z64, o formato dos hashes oficiais e dos ports). */
  data: Buffer;
  sha1: string;
  md5: string;
  sha256: string;
  /** Código do cartucho no cabeçalho (ex.: "NBKE") e a revisão. */
  code: string;
  version: number;
  title: string;
}

function hashes(data: Buffer): Pick<RomInfo, 'sha1' | 'md5' | 'sha256'> {
  const hex = (algorithm: string) => createHash(algorithm).update(data).digest('hex');
  return { sha1: hex('sha1'), md5: hex('md5'), sha256: hex('sha256') };
}

const ascii = (b: Buffer) => b.toString('latin1').replace(/\0/g, '').trim();

/** É uma ROM de Nintendo DS? (cabeçalho de 0x200 bytes com o CRC do logo da Nintendo). */
export function isNdsRom(data: Buffer): boolean {
  return data.length >= 0x200 && data.readUInt16LE(0x15c) === NDS_LOGO_CRC;
}

/** ROM de SNES com o cabeçalho de 512 bytes das copiadoras antigas: os hashes oficiais são sem ele. */
function stripCopierHeader(file: string, data: Buffer): Buffer {
  return /\.(sfc|smc|swc|fig)$/i.test(file) && data.length % 1024 === 512 ? data.subarray(512) : data;
}

/**
 * Lê uma ROM de Nintendo 64 (qualquer ordem de bytes, normalizada para .z64) ou de Nintendo DS
 * e calcula o que é preciso para conferir: hashes, código do jogo e revisão do cabeçalho.
 * `anyFile`: para ports de outros consoles (ex.: SNES), que só se conferem pelo hash, qualquer
 * arquivo vira `raw` em vez de ser recusado.
 */
export async function inspectRom(file: string, options: { anyFile?: boolean } = {}): Promise<RomInfo> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new AppError('FILE_MISSING', 'Arquivo não encontrado.');
  if (stat.size > MAX_ROM_BYTES) throw new AppError('VALIDATION', 'Arquivo grande demais para ser uma ROM.');
  const raw = await fs.readFile(file);
  if (options.anyFile && !n64ByteOrder(raw) && !isNdsRom(raw)) {
    const data = stripCopierHeader(file, raw);
    return { format: 'raw', data, ...hashes(data), code: '', version: 0, title: path.basename(file) };
  }
  const format = n64ByteOrder(raw);
  if (format) {
    const data = toBigEndianN64(raw);
    return { format, data, ...hashes(data), code: data.subarray(0x3b, 0x3f).toString('latin1'), version: data[0x3f]!, title: ascii(data.subarray(0x20, 0x34)) };
  }
  if (isNdsRom(raw)) {
    // DS: título em 0x00 (12 bytes), código do jogo em 0x0C (ex.: "AMHE") e revisão em 0x1E.
    return { format: 'nds', data: raw, ...hashes(raw), code: raw.subarray(0x0c, 0x10).toString('latin1'), version: raw[0x1e]!, title: ascii(raw.subarray(0, 12)) };
  }
  throw new AppError('VALIDATION', 'Este arquivo não é uma ROM de Nintendo 64 (.z64, .n64, .v64) nem de Nintendo DS (.nds).');
}

export function matchAccepted(
  info: Pick<RomInfo, 'sha1' | 'md5' | 'code' | 'version'> & Partial<Pick<RomInfo, 'sha256'>>,
  accepted: readonly AcceptedRom[],
): AcceptedRom | null {
  return (
    accepted.find(
      (a) =>
        (a.sha1 && a.sha1 === info.sha1) ||
        (a.md5 && a.md5 === info.md5) ||
        (a.sha256 && a.sha256 === info.sha256) ||
        (a.header && a.header.code === info.code && a.header.version === info.version),
    ) ?? null
  );
}

/** "BANJO-KAZOOIE (EUA, revisão 0)", para dizer ao usuário o que ele escolheu. */
export function describeRom(info: Pick<RomInfo, 'title' | 'code' | 'version'>): string {
  if (!info.code) return info.title || 'arquivo sem nome'; // raw: não há cabeçalho para ler
  const region = REGIONS[info.code[3] ?? ''] ?? 'região desconhecida';
  return `${info.title || 'ROM sem nome'} (${region}, revisão ${info.version})`;
}

interface RomServiceDeps {
  store: Pick<StoreCatalogService, 'port'>;
  repo: StoreInstallRepository;
}

/**
 * Assistente de ROM da Loja: confere a cópia do usuário com as versões aceitas pelo port e a
 * entrega do jeito que cada um espera (copiada para a pasta do port, ou preparada em .z64 para
 * o port pedir na primeira vez). Nunca baixa jogo nenhum: só trabalha com o arquivo escolhido.
 */
export class RomService {
  constructor(private readonly deps: RomServiceDeps) {}

  async status(portId: string): Promise<RomStatus | null> {
    const port = await this.deps.store.port(portId);
    if (!port.setup) return null;
    const install = this.deps.repo.get(portId);
    const remembered = this.deps.repo.rom(portId);
    const base: RomStatus = { method: port.setup.method, state: 'missing', versionName: remembered?.versionName ?? null, fileToSelect: null };
    if (!install || !remembered) return base;

    if (port.setup.method === 'copy') {
      const target = this.targetPath(port, install.installDir);
      return (await exists(target)) ? { ...base, state: 'ready' } : base;
    }
    const prepared = path.join(install.installDir, PREPARED_DIR, `${port.id}.z64`);
    const fileToSelect = (await exists(prepared)) ? prepared : (await exists(remembered.sourcePath)) ? remembered.sourcePath : null;
    return fileToSelect ? { ...base, state: 'verified', fileToSelect } : base;
  }

  /** Confere o arquivo escolhido e o entrega ao port; lembra a escolha para as próximas instalações. */
  async setup(portId: string, file: string): Promise<RomSetupResult> {
    const port = await this.deps.store.port(portId);
    const setup = port.setup;
    if (!setup?.accepted?.length) throw new AppError('VALIDATION', 'Este port recebe os arquivos do jogo pelo próprio instalador.');
    const install = this.deps.repo.get(portId);
    if (!install) throw new AppError('NOT_FOUND', 'Instale o port antes de escolher a ROM.');

    // N64 e DS têm cabeçalho para reconhecer; os outros consoles só se conferem pelo hash.
    const byHashOnly = !['n64', 'ds'].includes(port.original.platform) && setup.accepted.every((a) => a.sha1 || a.md5 || a.sha256);
    const info = await inspectRom(file, { anyFile: byHashOnly });
    const match = matchAccepted(info, setup.accepted);
    if (!match) {
      const versions = setup.accepted.map((a) => a.name);
      const list = versions.length > 4 ? `${versions.slice(0, 4).join(', ')} e outras ${versions.length - 4}` : versions.join(', ');
      throw new AppError('VALIDATION', `Esta ROM não é aceita pelo ${port.name}. Você escolheu: ${describeRom(info)}. Versões aceitas: ${list}.`);
    }

    const action = await this.deliver(port, install.installDir, info);
    this.deps.repo.saveRom(portId, path.resolve(file), match.name);
    return { status: (await this.status(portId))!, action, detected: describeRom(info) };
  }

  /**
   * Depois de instalar/atualizar: recoloca a ROM lembrada na versão nova (confere de novo, porque
   * o arquivo do usuário pode ter mudado). Sem ROM lembrada ou sem o arquivo, não faz nada.
   */
  async reapply(portId: string): Promise<boolean> {
    const remembered = this.deps.repo.rom(portId);
    if (!remembered || !(await exists(remembered.sourcePath))) return false;
    try {
      await this.setup(portId, remembered.sourcePath);
      return true;
    } catch (err) {
      console.warn('[store] não foi possível recolocar a ROM lembrada', portId, err);
      return false;
    }
  }

  private async deliver(port: StorePort, installDir: string, info: RomInfo): Promise<RomSetupResult['action']> {
    if (port.setup!.method === 'copy') {
      await writeAtomic(this.targetPath(port, installDir), info.data);
      return 'copied';
    }
    // O port pede a ROM sozinho: em .z64 o arquivo original serve; senão, uma cópia convertida.
    const prepared = path.join(installDir, PREPARED_DIR, `${port.id}.z64`);
    // .z64, .nds e as de outros consoles servem como estão; só .v64/.n64 (N64 em outra ordem de bytes) ganham cópia convertida.
    if (info.format === 'z64' || info.format === 'nds' || info.format === 'raw') {
      await fs.rm(prepared, { force: true });
      return 'verified';
    }
    await writeAtomic(prepared, info.data);
    return 'converted';
  }

  private targetPath(port: StorePort, installDir: string): string {
    const target = safeEntryPath(installDir, port.setup!.target!.replace(/\\/g, '/'));
    if (!target) throw new AppError('VALIDATION', 'Destino da ROM inválido no catálogo.');
    return target;
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/** Grava num temporário e renomeia: o port nunca vê uma ROM pela metade. */
async function writeAtomic(target: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
}
