import { describe, expect, it } from 'vitest';
import type { InstalledVersion, StoreInstall, StoreRelease } from '@shared/store';
import { latestStableTag, releaseAction } from './releaseAction';

const release = (tag: string, sha256: string | null = `sha-${tag}`, over: Partial<StoreRelease> = {}): StoreRelease => ({
  tag,
  name: tag,
  publishedAt: null,
  prerelease: false,
  notes: '',
  htmlUrl: '',
  windowsAsset: { name: `${tag}.zip`, size: 1, downloadUrl: '', sha256 },
  ...over,
});
const version = (tag: string) => ({ tag, sha256: `sha-${tag}` }) as InstalledVersion;
const INSTALLED = { ...version('v2'), previous: version('v1') } as StoreInstall;

describe('releaseAction', () => {
  it('a versão instalada (mesma tag e mesmo arquivo) aparece como instalada', () => {
    expect(releaseAction(release('v2'), INSTALLED)).toBe('active');
  });

  it('sem hash publicado, vale a tag', () => {
    expect(releaseAction(release('v2', null), INSTALLED)).toBe('active');
  });

  it('mesma tag com outro arquivo (compilação republicada) pode ser instalada', () => {
    expect(releaseAction(release('v2', 'sha-outra'), INSTALLED)).toBe('install');
  });

  it('a anterior, guardada no disco, troca sem baixar', () => {
    expect(releaseAction(release('v1'), INSTALLED)).toBe('previous');
  });

  it('qualquer outra pode ser instalada; sem arquivo para Windows, nenhuma ação', () => {
    expect(releaseAction(release('v3'), INSTALLED)).toBe('install');
    expect(releaseAction(release('v3'), null)).toBe('install');
    expect(releaseAction(release('v0', null, { windowsAsset: null }), INSTALLED)).toBeNull();
  });
});

describe('latestStableTag', () => {
  it('a primeira versão que não é prévia (o GitHub lista da mais nova para a mais antiga)', () => {
    expect(latestStableTag([release('v4-beta', null, { prerelease: true }), release('v3'), release('v2')])).toBe('v3');
    expect(latestStableTag([release('v1-beta', null, { prerelease: true })])).toBeUndefined();
    expect(latestStableTag(undefined)).toBeUndefined();
  });
});
