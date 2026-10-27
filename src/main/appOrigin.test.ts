import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAppUrl } from './appOrigin';

const indexFile = path.resolve('C:\\Programas\\RetroVault\\resources\\app.asar\\out\\renderer\\index.html');
const app = pathToFileURL(indexFile).href;
const prod = { indexFile, devUrl: null };

describe('isAppUrl', () => {
  it('a página do app, com rota e parâmetros, é aceita', () => {
    expect(isAppUrl(app, prod)).toBe(true);
    expect(isAppUrl(`${app}#/game/3`, prod)).toBe(true);
    expect(isAppUrl(`${app}?material=acrylic#/settings?secao=steam`, prod)).toBe(true);
    expect(isAppUrl(app.toUpperCase().replace('FILE:', 'file:'), prod)).toBe(true); // maiúsculas no caminho (Windows)
  });

  it('outro arquivo local, outra página da mesma pasta, sites e lixo são recusados', () => {
    expect(isAppUrl(pathToFileURL('C:\\Users\\x\\Downloads\\pagina.html').href, prod)).toBe(false);
    expect(isAppUrl(pathToFileURL(path.join(path.dirname(indexFile), 'outra.html')).href, prod)).toBe(false);
    expect(isAppUrl(pathToFileURL(`${indexFile}.html`).href, prod)).toBe(false);
    expect(isAppUrl('https://evil.example/', prod)).toBe(false);
    expect(isAppUrl('file:///', prod)).toBe(false);
    expect(isAppUrl('', prod)).toBe(false);
    expect(isAppUrl('não é url', prod)).toBe(false);
  });

  it('em desenvolvimento, só a origem do servidor do electron-vite', () => {
    const dev = { indexFile, devUrl: 'http://localhost:5173/' };
    expect(isAppUrl('http://localhost:5173/#/loja', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isAppUrl('http://localhost:5173.evil.example/', dev)).toBe(false);
    expect(isAppUrl(app, dev)).toBe(false);
  });
});
