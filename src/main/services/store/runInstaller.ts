import { spawn } from 'node:child_process';

/** Texto entre aspas simples do PowerShell (aspas internas dobradas). */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Abre o instalador de um port e espera fechar. Pelo Start-Process do PowerShell porque ele pede
 * elevação (UAC) quando o instalador exige e espera o processo terminar. O código de saída é
 * ignorado de propósito: cada instalador usa os seus, e quem decide se deu certo é achar o jogo
 * instalado depois. Cancelar mata a espera (o instalador aberto continua com o usuário).
 */
export function runInstaller(file: string, signal: AbortSignal): Promise<void> {
  const command = /\.msi$/i.test(file)
    ? `Start-Process -FilePath msiexec.exe -ArgumentList '/i', ${psQuote(`"${file}"`)} -Wait`
    : `Start-Process -FilePath ${psQuote(file)} -Wait`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true });
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}
