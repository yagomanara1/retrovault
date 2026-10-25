# Manutenção do catálogo

Guia de quem cuida deste repositório. A página de apresentação, com os créditos de cada port, é o
[README](README.md).

Este repositório guarda o `catalog.json` que a **Loja de ports** do RetroVault lê pela internet.
Com ele publicado, dá para adicionar, corrigir ou tirar ports **sem lançar uma versão nova do app**:
quem usa o catálogo online recebe a mudança em até 6 horas (ou na hora, em Configurações → Loja → Testar).

> A Loja nunca distribui jogos. Cada port aqui é um programa de código aberto que pede a cópia do
> próprio usuário (ROM ou arquivos do jogo). Não adicione projetos que já trazem o jogo no pacote.

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `catalog.json` | O catálogo em si: a lista de ports. É o único arquivo que você edita no dia a dia. |
| `README.md` | Apresentação e créditos. A lista de ports é gerada a partir do `catalog.json`; não edite a lista à mão. |
| `MANUTENCAO.md` | Este guia. |
| `catalog.schema.json` | Ajuda do editor: o VS Code sugere os campos e marca erros enquanto você digita. |
| `tools/validate.mjs` | Confere o catálogo com **as mesmas regras do app**. Gerado pelo RetroVault; não edite. |
| `.github/workflows/validate.yml` | Roda o validador no GitHub a cada push e pull request. |

## Publicar (uma vez)

1. Crie um repositório **público** no GitHub (ex.: `retrovault-catalog`).
2. Envie os arquivos desta pasta, pelo site (sem Git) ou com o Git.

### Pelo site do GitHub (sem instalar nada)

1. Na página do repositório novo, clique em **uploading an existing file** (ou **Add file → Upload files**).
2. Arraste `catalog.json`, `catalog.schema.json`, `README.md`, `MANUTENCAO.md` e a pasta `tools` e clique em **Commit changes**.
3. A verificação automática fica numa pasta que começa com ponto (`.github`), e o navegador costuma pular essas pastas.
   Por isso ela é criada pelo próprio site:
   1. Clique em **Add file → Create new file**.
   2. No nome, digite `.github/workflows/validate.yml` (as barras criam as pastas).
   3. Cole o conteúdo do `validate.yml` desta pasta e clique em **Commit changes**.

   Esse passo é opcional: sem ele, o catálogo funciona igual, só não há conferência automática a cada mudança.
4. Para editar depois, abra o `catalog.json` no site e use o lápis (**Edit this file**). Antes de salvar,
   confira no seu PC com `node tools/validate.mjs catalog.json`, ou deixe a aba **Actions** conferir.

### Com o Git

Nesta pasta:
```bash
git init
git add .
git commit -m "Catálogo da Loja de ports"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/retrovault-catalog.git
git push -u origin main
```

### O endereço do catálogo

Fica assim (troque `SEU_USUARIO`):
```
https://raw.githubusercontent.com/SEU_USUARIO/retrovault-catalog/main/catalog.json
```
Também serve colar o link da página do arquivo (`https://github.com/.../blob/main/catalog.json`):
o app converte sozinho.

## Ligar no RetroVault

**Configurações → Loja de ports → Catálogo online**: cole o endereço e clique em **Testar e usar**.
O app baixa, confere e diz quantos ports leu (e quais ignorou, se algum tiver erro).
Para voltar ao catálogo que vem dentro do app, apague o endereço e clique em **Testar e usar**.

## Editar o catálogo

1. Edite o `catalog.json` (no VS Code, as sugestões do `catalog.schema.json` aparecem sozinhas).
2. Confira antes de publicar:
   ```bash
   node tools/validate.mjs catalog.json
   ```
3. `git commit` e `git push`. O GitHub roda a mesma conferência (aba **Actions**).

### Campos de um port

```jsonc
{
  "id": "zelda64recomp",                    // único, minúsculas e hífens; não mude depois de publicado
  "name": "Zelda 64: Recompiled",
  "original": { "title": "The Legend of Zelda: Majora's Mask", "platform": "n64" },
  "developer": "Zelda64Recomp",
  "summary": "Uma frase que aparece na lista.",
  "description": "Texto da página do port.",
  "tags": ["Aventura"],
  "source": { "type": "github", "repo": "Zelda64Recomp/Zelda64Recomp" },
  "assets": { "windows": "Windows\\.zip$" },  // regex do arquivo de Windows na release
  "executable": "Zelda64Recompiled.exe",    // caminho do .exe dentro do pacote
  "ai": "none",                             // none | assisted | generated (mostra aviso antes de baixar)
  "requires": { "kind": "rom", "label": "ROM americana de Majora's Mask (Nintendo 64)" },
  "setup": {
    "method": "in-app",                     // copy (o app põe a ROM em "target") | in-app (o port pede)
    "instructions": "Na primeira vez, o port pede a ROM.",
    "accepted": [{ "name": "EUA", "sha1": "d6133ace5afaa0882cf214cf88daba39e266c078" }]
  },
  "art": { "boxart": "https://raw.githubusercontent.com/..." }, // só raw.githubusercontent.com ou SteamGridDB
  "quiver": "thelegendofzeldamajorasmaskandocarinaoftime-zelda64recompiled" // opcional: o que vem depois de quiverlauncher.com/apps/
}
```

Dicas que evitam problema:

- **Regex do arquivo**: teste contra os nomes reais da release. Cuidado com armadilhas
  comuns: versões `arm64`, arquivos `.sha256`, instaladores `Setup.exe` e pacotes de Linux.
- **Formatos aceitos**: `.zip`, `.7z`, `.tar.gz`, `.exe` portátil e instaladores (`.exe`/`.msi`).
- **`platform`**: o ícone da família; para gerações, use também `"system"` (ex.: `"platform": "playstation", "system": "PlayStation 4"`). É isso que põe o jogo na categoria certa.
- **Projetos gerados por IA**: marque `"ai": "generated"`; o app avisa o usuário antes de baixar.
- **`quiver`**: só o final do endereço da página do port no Quiver (`quiverlauncher.com/apps/<isto>`). O app monta o link
  e mostra o botão "Ver no Quiver"; o README ganha o link na coluna "No Quiver".
- **`schemaVersion`**: deixe `1`. Campos novos e opcionais não mudam a versão.

## Atualizar a partir do app

Se o catálogo embutido no RetroVault mudar e você quiser trazer as mudanças para cá, no projeto do app:

```bash
npm run catalog:repo -- ../retrovault-catalog --force   # regera o catalog.json (sobrescreve as suas edições!)
npm run catalog:repo -- ../retrovault-catalog           # só atualiza o validador, o schema, o README e este guia
```

Nos dois casos, a lista de ports do README é refeita a partir do `catalog.json` da pasta.
Depois de mudar o `catalog.json`, suba também o `README.md`, para os créditos acompanharem.
