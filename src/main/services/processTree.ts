import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Acompanha a árvore de processos de uma sessão de jogo.
// Launchers (ex.: "God of War III.exe", "Bloodborne.exe") abrem o jogo de verdade em outro processo
// (gow3-probe.exe, bb-probe.exe) e às vezes fecham logo depois; o tempo de jogo deve valer
// enquanto QUALQUER processo da sessão estiver vivo.

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** Epoch ms (0 = desconhecido). */
  createdAt: number;
  exe: string | null;
}

export interface ProcessSnapshot {
  /** Quando a listagem COMEÇOU: processos criados depois disso podem não estar nela. */
  at: number;
  processes: ProcessInfo[];
}

/** Tolerância entre o relógio do snapshot e o início da sessão. */
const CREATED_SLACK_MS = 2000;

export interface TreeState {
  startedAt: number;
  /** Todo PID que já pertenceu à sessão: no Windows o PPID de um órfão continua apontando para o pai morto. */
  known: Set<number>;
  alive: Set<number>;
  /** Pasta do jogo (com separador no fim) ou null para não usar a heurística de pasta. */
  gameDir: string | null;
  /** Quando o processo raiz fechou (null = ainda aberto). Limita a heurística de pasta. */
  rootExitedAt: number | null;
}

export function createTreeState(rootPid: number, startedAt: number, gameDir: string | null): TreeState {
  return {
    startedAt,
    known: new Set([rootPid]),
    alive: new Set([rootPid]),
    gameDir: gameDir && isSpecificDir(gameDir) ? withSep(path.resolve(gameDir).toLowerCase()) : null,
    rootExitedAt: null,
  };
}

/**
 * Atualiza a árvore com um snapshot e devolve os PIDs vivos da sessão.
 * Um processo entra na sessão se foi criado depois do início dela e (a) descende de um processo
 * da sessão ou (b) o executável fica dentro da pasta do jogo e foi criado enquanto o processo raiz
 * estava aberto (o launcher pode abrir o jogo e fechar antes de o filho aparecer em algum snapshot).
 * O limite de (b) evita adotar processos alheios que rodam da mesma pasta mais tarde.
 */
export function updateTree(state: TreeState, processes: readonly ProcessInfo[]): Set<number> {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const alive = new Set([...state.alive].filter((pid) => byPid.has(pid)));
  const isNew = (p: ProcessInfo) => p.createdAt >= state.startedAt - CREATED_SLACK_MS;
  const dirCutoff = state.rootExitedAt === null ? Infinity : state.rootExitedAt + CREATED_SLACK_MS;
  const inGameDir = (p: ProcessInfo) =>
    !!state.gameDir && !!p.exe && p.createdAt <= dirCutoff && p.exe.toLowerCase().startsWith(state.gameDir);

  // Ponto fixo: netos entram na mesma passada que os filhos.
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of processes) {
      if (alive.has(p.pid) || !isNew(p)) continue;
      if (state.known.has(p.ppid) || inGameDir(p)) {
        alive.add(p.pid);
        state.known.add(p.pid);
        grew = true;
      }
    }
  }
  state.alive = alive;
  return alive;
}

const withSep = (dir: string) => (dir.endsWith(path.sep) ? dir : dir + path.sep);
/** Pastas rasas (C:\, C:\Jogos) pegariam processos alheios. */
const isSpecificDir = (dir: string) => path.resolve(dir).split(/[\\/]+/).filter(Boolean).length >= 3;

// ---------- Snapshots (Windows) ----------

const SNAPSHOT_INTERVAL_SECONDS = 2;

// Linhas "P|pid|ppid|criadoMs|exe" e "E|inícioMs" ao fim de cada snapshot. Termina sozinho se o
// processo dono ($owner) morrer, para não sobrar PowerShell órfão se o app travar.
const SNAPSHOT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$owner = __OWNER__
$epoch = [datetime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
while ($true) {
  if (-not (Get-Process -Id $owner)) { exit }
  $started = [long]([datetime]::UtcNow - $epoch).TotalMilliseconds
  $sb = [Text.StringBuilder]::new()
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,ExecutablePath) {
    $c = 0
    if ($p.CreationDate) { $c = [long]($p.CreationDate.ToUniversalTime() - $epoch).TotalMilliseconds }
    [void]$sb.Append('P|').Append($p.ProcessId).Append('|').Append($p.ParentProcessId).Append('|').Append($c).Append('|').Append($p.ExecutablePath).Append("\`n")
  }
  [void]$sb.Append('E|').Append($started).Append("\`n")
  [Console]::Out.Write($sb.ToString())
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${SNAPSHOT_INTERVAL_SECONDS}
}
`;

type SnapshotListener = (snapshot: ProcessSnapshot) => void;

/**
 * Um único PowerShell de longa duração emitindo a lista de processos (sem abrir um processo por consulta).
 * Só roda enquanto houver inscritos.
 */
export class ProcessSnapshotter {
  private proc: ChildProcess | null = null;
  private readonly listeners = new Set<SnapshotListener>();
  private broken = process.platform !== 'win32';

  /** false = sem snapshots (outro SO ou PowerShell indisponível): usar só o processo raiz. */
  get available(): boolean {
    return !this.broken;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    this.ensureRunning();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  stop(): void {
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  private ensureRunning(): void {
    if (this.proc || this.broken) return;
    const script = SNAPSHOT_SCRIPT.replace('__OWNER__', String(process.pid));
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    this.proc = proc;

    let batch: ProcessInfo[] = [];
    createInterface({ input: proc.stdout! }).on('line', (raw) => {
      const line = raw.replace(/^\uFEFF/, '');
      if (line.startsWith('P|')) {
        const [, pid, ppid, created, ...exe] = line.split('|');
        batch.push({ pid: Number(pid), ppid: Number(ppid), createdAt: Number(created) || 0, exe: exe.join('|') || null });
      } else if (line.startsWith('E|')) {
        const snapshot = { at: Number(line.slice(2)) || Date.now(), processes: batch };
        batch = [];
        for (const listener of [...this.listeners]) listener(snapshot);
      }
    });

    const fail = (reason: unknown) => {
      if (this.proc !== proc) return; // parada intencional
      console.warn('[process-tree] snapshots indisponíveis; usando só o processo raiz', reason);
      this.proc = null;
      this.broken = true;
      // Avisa os inscritos com um snapshot vazio: sessões cujo processo raiz já fechou são encerradas.
      for (const listener of [...this.listeners]) listener({ at: Date.now(), processes: [] });
    };
    proc.once('error', fail);
    proc.once('exit', (code) => fail(`powershell saiu com código ${code}`));
  }
}
