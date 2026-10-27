import type { StoreInstall, StoreRelease } from '@shared/store';

/** O que dá para fazer com cada versão: é a instalada, é a anterior (guardada no disco) ou instalar esta. */
export type ReleaseAction = 'active' | 'previous' | 'install';

/** null = a versão não tem arquivo para Windows. */
export function releaseAction(release: StoreRelease, installed: StoreInstall | null): ReleaseAction | null {
  const asset = release.windowsAsset;
  if (!asset) return null;
  // Mesma tag com outro arquivo é uma compilação republicada: dá para instalar (sem hash publicado, vale a tag).
  if (installed?.tag === release.tag && (!asset.sha256 || asset.sha256 === installed.sha256)) return 'active';
  if (installed?.previous?.tag === release.tag) return 'previous';
  return 'install';
}

/** "Mais recente" = a primeira versão estável (o GitHub lista da mais nova para a mais antiga). */
export function latestStableTag(releases: readonly StoreRelease[] | undefined): string | undefined {
  return releases?.find((r) => !r.prerelease)?.tag;
}
