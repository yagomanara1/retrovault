import { ZodError } from 'zod';
import type { ErrorCode, IpcError } from '@shared/ipc';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

function isSqliteUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/** Converte qualquer erro em um payload seguro para o renderer (sem stack traces). */
export function toIpcError(err: unknown): IpcError {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  if (err instanceof ZodError) {
    // Valor único inválido (ex.: um token ou uma URL): a mensagem do schema já é a frase para o usuário.
    const [first] = err.issues;
    if (err.issues.length === 1 && first && first.path.length === 0) {
      const message = first.message;
      return { code: 'VALIDATION', message: message.charAt(0).toUpperCase() + message.slice(1) + (/[.!?]$/.test(message) ? '' : '.') };
    }
    const details = err.issues
      .map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`)
      .join('; ');
    return { code: 'VALIDATION', message: `Dados inválidos — ${details}` };
  }
  if (isSqliteUniqueViolation(err)) {
    return { code: 'DUPLICATE', message: 'Este arquivo já está na sua biblioteca.' };
  }
  console.error('[ipc] erro inesperado', err);
  return {
    code: 'INTERNAL',
    message: err instanceof Error ? err.message : 'Erro inesperado.',
  };
}
