# RetroVault: guia técnico

Como o RetroVault funciona por dentro, como rodar o projeto e as decisões de cada parte. Para o que o app faz,
veja o [README](../README.md).

Electron 33 + React + TypeScript (electron-vite), SQLite (better-sqlite3) com migrations, IPC validado com zod
(contrato em `src/shared/ipc.ts`) e testes com Vitest.

## Como funciona o vínculo com o RetroArch

Quem desbloqueia as conquistas é o próprio RetroArch, usando a biblioteca **rcheevos**, enquanto você joga. Ele envia cada desbloqueio para a sua conta do **RetroAchievements.org**. O RetroVault cuida do resto:

1. **Inicia o jogo** com `retroarch.exe --appendconfig <override> -L <core> <rom>`. O arquivo de override força `cheevos_enable = "true"` e o modo Hardcore escolhido, sem alterar o seu `retroarch.cfg`.
2. **Identifica a ROM**: calcula o hash MD5 no mesmo formato do rcheevos, removendo cabeçalhos iNES/SNES/Lynx/7800 e normalizando a ordem de bytes de ROMs de N64. Depois procura esse hash na base do RetroAchievements (`API_GetGameList?h=1`).
   - **ROMs dentro de `.zip`:** usa o arquivo de dentro com a extensão do console (`readZipEntry`).
   - **Nintendo DS:** cabeçalho, código ARM9/ARM7 e ícone (`hashNds`).
   - **Jogos de disco** (`services/disc/`):
     - **Leitor** (`discImage.ts`): abre ISO, BIN/IMG crus (2352 ou 2336 por setor), CUE, CSO (PSP) e M3U (primeiro disco). Lê só os setores necessários.
     - **Formato dos setores:** descoberto pelo conteúdo, como no rcheevos, procurando o sincronismo de CD e "CD001" no setor 16. O modo declarado no `.cue` só vale quando o conteúdo não diz nada.
     - **Sistema de arquivos** (`iso9660.ts`): acha os arquivos pelo caminho.
     - **Hashes** (`raDiscHash.ts`):
       - PS1 e PS2: nome + executável do `SYSTEM.CNF`. No PS1, com o tamanho do cabeçalho PS-X EXE e o `PSX.EXE` como alternativa.
       - PSP: `PARAM.SFO` + `EBOOT.BIN`; o PBP é o arquivo inteiro.
       - Sega CD e Saturn: 512 bytes do setor 0.
   - **Console pelo conteúdo do disco** (`detectDiscConsole`): um `.iso`/`.cue` não diz de qual console é. `SYSTEM.CNF` (BOOT → PS1, BOOT2 → PS2), `PSP_GAME` e o cabeçalho da Sega decidem. Vale ao adicionar um jogo e na busca por pastas, onde um `.iso` solto sem pista na pasta passa a entrar quando é reconhecido.
   - **PlayStation 2** entrou no catálogo de consoles (ID 21 do RetroAchievements, cores `pcsx2`/`play`).
   - **Uma regra só** para "dá para identificar este formato?" (`canIdentifyFormat`, em `shared/consoles.ts`), usada no main e na tela de adicionar jogo.
   - **Conferido contra a referência:** `rcheevosVectors.test.ts` porta byte a byte os geradores de imagens dos testes oficiais do rcheevos (`testing/rcheevosImages.ts`) e exige os mesmos hashes. Cobre PS1 (normal, sem `SYSTEM.CNF`, executável em subpasta, barra extra), PS2, PSP (ISO, disco de vídeo sem hash, PBP), Sega CD, Saturn e DS com e sem SuperCard.
   - **Créditos:** algoritmos do rcheevos (MIT) e da documentação "Game Identification" do RetroAchievements. A ideia de trazê-los veio do [Taiga Launcher](https://github.com/GabrielTaiga/Taiga-Launcher-for-Steam), de Taiga (GabrielTaiga, Apache-2.0); o código aqui foi escrito do zero, em TypeScript.
3. **Mostra o progresso** usando a Web API do RetroAchievements, que é só de leitura e autenticada com o seu usuário e a sua Web API Key.
4. **Notifica em tempo real**: enquanto o jogo está aberto, consulta os desbloqueios recentes a cada 30 segundos e mostra um toast e uma notificação do Windows.

## Configuração (primeira vez)

1. Instale o [Node.js 20 LTS ou mais recente](https://nodejs.org).
2. Instale o [RetroArch](https://www.retroarch.com/?page=platforms) e baixe os cores em **Main Menu → Online Updater → Core Downloader**.
3. No RetroArch, abra **Settings → Achievements**, ative as conquistas e entre com o usuário e a senha do RetroAchievements. Isso só precisa ser feito uma vez, porque o RetroArch guarda um token.
4. Pegue a sua **Web API Key** em <https://retroachievements.org/settings>, na seção "Keys".
5. Rode o projeto:

```powershell
git clone https://github.com/yagomanara1/retrovault.git
cd retrovault
npm install
npm run dev
```

6. No app, vá em **Configurações** e informe o usuário e a API Key. O RetroArch é detectado automaticamente; se não for, use "Procurar…".

Para gerar o instalador: `npm run dist`. O arquivo fica em `release/`. Para só empacotar o app, sem instalador:
`npm run package` (gera `release\win-unpacked\RetroVault.exe`). Publicar uma versão: [PUBLICAR.md](PUBLICAR.md).

**Problemas conhecidos no ambiente:**
- O `better-sqlite3` está fixado na versão `12.11.1`, que publica binários prontos para o Electron 33 (ABI 130) e para o Node 24 (ABI 137). Outras versões podem tentar compilar o módulo e exigir Python e o Visual Studio Build Tools.
- Se o app fechar sem mostrar nada ao ser iniciado pelo terminal integrado do VS Code, rode `Remove-Item Env:ELECTRON_RUN_AS_NODE` antes. O VS Code define essa variável, e ela faz o Electron rodar como Node puro.

---

## Testes

```powershell
npm test                                         # roda uma vez (~1 s)
npm test -- src/main/services/trp.test.ts        # um arquivo
npm run test:watch                               # reexecuta ao salvar
```

- **Vitest**, com os testes ao lado do código (`*.test.ts`). O `npm run package` e o `npm run dist` rodam os testes antes de gerar o executável: se algum falhar, nada é empacotado.
- Os testes rodam **dentro do Node do Electron** (`scripts/test.mjs` define `ELECTRON_RUN_AS_NODE=1`). O `better-sqlite3` é compilado para o ABI do Electron e não carrega no Node do sistema, então os testes de banco usam o mesmo binário do app.
- **Cobertura:**
  - Parser e criptografia do `.trp`, com pacote e chave sintéticos (nenhuma chave real).
  - Localizador do dump (game-path, argumentos, nearby e config do launcher, inclusive o falso positivo).
  - Árvore de processos (órfãos, reuso de PID, heurística de pasta).
  - Busca de jogos movidos e scanner de pastas (auxiliares, `.cue`/`.m3u`, emuladores, dumps).
  - Hash de ROMs (cabeçalhos NES/SNES, ordem de bytes do N64).
  - Nível e percentual de troféus.
  - Banco: migrations com backup prévio, opt-out, log desativado, visão geral, cascata, exportar/importar progresso, backup, restauração, poda e path traversal.
- `src/main/testing/tempDir.ts`: pastas temporárias por teste, com árvores de arquivos descritas em objeto.

## Arquitetura

```
┌──────────────────────────── Electron ─────────────────────────────┐
│                                                                   │
│  Renderer (React, sandbox)          Main (Node.js)                │
│  ┌───────────────────────┐   IPC    ┌──────────────────────────┐  │
│  │ Pages / Components    │ ───────▶ │ ipc.ts (zod + whitelist) │  │
│  │ react-query (cache L0)│ ◀─────── │        │                 │  │
│  └───────────────────────┘  events  │   Services (domínio)     │  │
│            ▲                        │   ├ GameService          │  │
│     preload (contextBridge)         │   ├ LauncherService ─────┼──┼─▶ retroarch.exe / jogo.exe
│     só canais da whitelist          │   ├ AchievementWatcher   │  │
│                                     │   ├ RetroArchService     │  │
│                                     │   └ RetroAchievements    │──┼─▶ retroachievements.org/API
│                                     │       Client             │  │
│                                     │   ApiCache (L1 mem + L2) │  │
│                                     │   Repositories           │  │
│                                     │        │                 │  │
│                                     │   SQLite (WAL)           │  │
│                                     └──────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

**Camadas (dependências apontam para dentro):**

| Camada | Responsabilidade | Não conhece |
|---|---|---|
| `renderer/` | UI, estado de tela, cache de UI (react-query) | Node, SQLite, HTTP |
| `preload/` | Ponte mínima e tipada (`window.bridge`) | Regras de negócio |
| `main/ipc.ts` | Validação da entrada (zod), autorização do sender, mapeamento de erros | SQL, HTTP |
| `main/services/` | Regras de negócio, processos, integração externa | Electron IPC |
| `main/db/` | Persistência (repositórios, migrations) | Regras de negócio |
| `shared/` | Contrato IPC, tipos de domínio e catálogo de consoles | Runtime específico |

### Fluxo de dados: jogar e desbloquear

```
[Jogar] → games:launch → LauncherService.spawn(retroarch -L core rom)
        → play_sessions INSERT → evento session:started
        → AchievementWatcher.start() ── a cada 30s ──▶ API_GetUserRecentAchievements(m=10)
              novo desbloqueio → invalida cache → evento achievements:unlocked → toast + notificação
[Fecha]  → processo termina → play_sessions UPDATE + playtime → evento session:ended
        → renderer invalida ['games'], ['ra'] → telas recarregam com os dados novos
```

### Estratégia de cache

| Nível | Onde | Dados | TTL |
|---|---|---|---|
| L0 | react-query (renderer) | tudo que a UI consome | 1–5 min de `staleTime` |
| L1 | `Map` LRU (main) | respostas já normalizadas | igual ao L2 |
| L2 | tabela `api_cache` (SQLite) | catálogo de consoles | 30 dias |
| | | lista de jogos e hashes por console | 7 dias |
| | | perfil / completion | 10 min |
| | | progresso de um jogo | 5 min |
| | | desbloqueios recentes | 2 min |

- **Stale-if-error:** se a API falhar, o app usa o último valor salvo, mesmo que já tenha expirado. Isso permite usar o app offline.
- **Deduplicação:** requisições simultâneas para a mesma chave compartilham uma única promise.
- **Invalidação por eventos:** fim de sessão, novo desbloqueio e troca de conta limpam as chaves do usuário (`u:<user>:*`).
- **Rate limit:** no mínimo 250 ms entre o início de duas requisições, com retry e backoff exponencial em 429, 5xx e erros de rede.

## Estrutura de arquivos

```
retrovault/
├─ electron.vite.config.ts      # build de main, preload e renderer
├─ package.json
├─ tsconfig.json                # main + preload + shared
└─ src/
   ├─ shared/                   # código isomórfico (sem Node/DOM)
   │  ├─ ipc.ts                 # contrato IPC tipado + whitelist de canais
   │  ├─ types.ts               # modelos de domínio
   │  └─ consoles.ts            # catálogo de consoles, extensões, cores e métodos de hash
   ├─ main/
   │  ├─ index.ts               # bootstrap, janela, segurança
   │  ├─ container.ts           # composition root (injeção de dependência)
   │  ├─ ipc.ts                 # rotas IPC + validação zod
   │  ├─ errors.ts              # AppError → IpcError
   │  ├─ db/
   │  │  ├─ database.ts         # conexão + migrator
   │  │  ├─ migrations.ts
   │  │  └─ repositories/       # game, settings, cache
   │  └─ services/
   │     ├─ gameService.ts      # adicionar / identificar / vincular jogos
   │     ├─ launcherService.ts  # processos + tempo de jogo
   │     ├─ achievementWatcher.ts
   │     ├─ retroarchService.ts # detecção, cores, cfg, argumentos de execução
   │     ├─ romHasher.ts        # hash compatível com o rcheevos
   │     ├─ artworkService.ts   # capa/fundo/ícone personalizados (protocolo rv-media://)
   │     ├─ peIcon.ts           # extrai o ícone de 256px direto dos recursos do .exe
   │     ├─ settingsService.ts  # API key cifrada (safeStorage/DPAPI)
   │     ├─ apiCache.ts
   │     ├─ fsUtils.ts
   │     └─ retroachievements/  # client, mappers, rawTypes
   ├─ preload/index.ts
   └─ renderer/
      ├─ index.html             # CSP restritiva
      └─ src/
         ├─ main.tsx / App.tsx
         ├─ lib/                # api (call tipado), format, cx
         ├─ hooks/              # queries (react-query), eventos, debounce
         ├─ pages/              # LibraryHome, GameDetail, Profile, RaGame, Settings
         ├─ components/
         │  ├─ ui/              # Button, Modal, Toast, Form, ProgressBar, States…
         │  ├─ layout/          # TopNav, GameSidebar, LibraryLayout
         │  ├─ library/         # GameCard, AddGame, LinkRaGame, GameSettings
         │  └─ achievements/    # AchievementPanel, Row, Summary, utils
         └─ styles/global.css
```

## Esquema do banco (SQLite)

```sql
games (
  id INTEGER PK, title TEXT, kind TEXT CHECK IN ('retroarch','executable'),
  path TEXT UNIQUE, core_path TEXT, launch_args TEXT,
  console_id INTEGER,            -- ConsoleID do RetroAchievements
  ra_game_id INTEGER,            -- vínculo com o jogo no RA (índice)
  rom_hash TEXT, cover_url TEXT, background_url TEXT, icon_url TEXT,  -- background_url: migration 2
  favorite INTEGER, playtime_seconds INTEGER, last_played_at TEXT, created_at TEXT
)
play_sessions (id PK, game_id FK→games ON DELETE CASCADE, started_at, ended_at, duration_seconds)
settings      (key PK, value JSON)
api_cache     (key PK, value JSON, expires_at INTEGER)   -- índice em expires_at
schema_migrations (version PK, name, applied_at)
```

As migrations são versionadas e append-only (`db/migrations.ts`). O banco usa WAL e `foreign_keys = ON`.

## API (contrato IPC)

Todas as chamadas retornam `{ ok: true, data } | { ok: false, error: { code, message } }`.

| Canal | Entrada | Saída |
|---|---|---|
| `games:list` | – | `Game[]` |
| `games:inspect` | `{ path, kind }` | `GameInspection` (título, console e core sugeridos) |
| `games:add` | `NewGameInput` | `{ game, match }` |
| `games:update` | `UpdateGameInput` | `Game` |
| `games:remove` | `id` | – |
| `games:rematch` | `id` | `{ game, match }` |
| `games:set-artwork` | `{ id, slot: 'cover' \| 'background' \| 'icon', action: 'pick' \| 'reset' }` | `Game \| null` (null = cancelado) |
| `games:launch` | `id` | – |
| `games:running` | – | `number[]` |
| `dialog:open-file` | `{ kind: 'rom' \| 'executable' \| 'retroarch' }` | `string \| null` |
| `settings:get` / `settings:update` | `SettingsUpdate` | `Settings` |
| `retroarch:status` | – | `RetroArchStatus` |
| `ra:profile` / `ra:recent` / `ra:completion` | `{ force? }` | perfil / desbloqueios / progresso |
| `ra:game-progress` | `{ raGameId, force? }` | `GameProgress` |
| `ra:consoles` | – | `ConsoleInfo[]` |
| `ra:search` | `{ consoleId, query }` | `RaGameSearchResult[]` |
| `app:open-external` | URL https | – |

**Eventos (main → renderer):** `session:started`, `session:ended`, `achievements:unlocked`.

## Importar das lojas instaladas (`services/storeLibraries.ts`)

- **Onde fica:** "Adicionar pasta" → **Importar das lojas instaladas**. A revisão é a mesma da varredura de pastas (caixinhas, nome editável, executável alternativo), agrupada por loja (`ScanResult.source = 'stores'`).
- **Só leitura dos registros locais, sem login:**
  - **Steam** (`services/steam/steamLibrary.ts`): pasta pelo registro (`HKCU\Software\Valve\Steam` → `SteamPath`, depois `HKLM` → `InstallPath`, depois o local padrão), bibliotecas de `steamapps\libraryfolders.vdf` e um `appmanifest_<id>.acf` por jogo. Entram só os totalmente instalados (`StateFlags` com o bit 4). Ferramentas da Steam ficam de fora (Redistributables, Proton, Steam Linux Runtime, SteamVR, servidores dedicados, SDKs).
  - **Epic Games:** `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item`. Ignora o que não é jogo (`AppCategories` sem `games`) e instalações incompletas.
  - **GOG:** `HKLM\…\GOG.com\Games`. Ignora DLCs (`dependsOn`).
  - **Ubisoft Connect:** `HKLM\…\Ubisoft\Launcher\Installs`. Só a pasta; o executável é escolhido como na varredura.
  - **Amazon Games:** `GameInstallInfo.sqlite`, com o executável do `fuel.json`.
  - **itch.io:** `butler.db`.

  Os dois bancos SQLite são abertos só para leitura.
- **Registro:** lido com `reg export` para um arquivo temporário apagado logo depois. O arquivo sai em UTF-16 e preserva acentos; o `reg query` sai no código de página antigo do console.
- **Executável:**
  - vale o indicado pela loja, se existir;
  - senão, o mais provável da pasta, até 3 níveis, sem instaladores, auxiliares e redistribuíveis (`rankExecutables`).
- **Sem repetição:** o mesmo jogo aparece uma vez; os que já estão na biblioteca vêm marcados; registros de jogos desinstalados (pasta sumiu) ficam de fora.
- **Fora:**
  - Xbox/Microsoft Store: os jogos não abrem por um `.exe` comum;
  - EA, Battle.net e Rockstar: não guardam os dados num lugar padronizado.
- **Aviso:** alguns jogos pedem a loja aberta para iniciar, por proteção da própria loja.
- **Testes:** `storeLibraries.test.ts`, com cada loja no formato real (manifestos, `.reg` exportado, bancos SQLite).
- **Validado no app empacotado:**
  - no PC do usuário, a lista veio vazia em 0,5 s, e isso está correto: nenhuma das lojas está instalada (a chave da Ubisoft existe, mas sem jogos);
  - com manifestos da Epic de teste, os 3 jogos apareceram com o executável certo, e o plugin e o auxiliar de crash ficaram de fora.
- Ideia trazida do Taiga Launcher (GabrielTaiga, Apache-2.0), que se inspirou no BoilR; código escrito do zero.

### Jogos da Steam na biblioteca

- **Formato:** continuam sendo executáveis (ícone do .exe, saves, categoria "PC"), com a coluna `steam_app_id` (migração 20). A sigla do título ajuda a escolher o executável ("Counter-Strike 2" → `cs2.exe`, não `vconsole2.exe`).
- **Abrir:** `steam://rungameid/<id>`, pela própria Steam. Assim DRM, overlay, nuvem e conquistas dela continuam valendo. Os argumentos de inicialização do RetroVault não se aplicam: ficam nas propriedades do jogo na Steam.
- **Tempo de jogo:** o processo do jogo é filho da Steam, não do RetroVault. A sessão (`LauncherService.launchViaSteam`):
  - espera até 3 min um processo aparecer na pasta `steamapps\common\<jogo>`;
  - conta a partir de quando ele aparece e termina quando o último processo da sessão fecha;
  - se nada aparece, é descartada (não conta como jogado);
  - clicar em Jogar durante a espera pede de novo à Steam, sem abrir outra sessão.
- **Ao adicionar:**
  - capa (`library_600x900` / `library_capsule`) e fundo (`library_hero`) vêm do cache local da Steam (`appcache\librarycache`), antes do SteamGridDB e só onde ainda não há arte;
  - o tempo de jogo e o "jogado por último" vêm da conta dona do jogo (`LastOwner` → `userdata\<conta>\config\localconfig.vdf`), e fica o maior. Desse arquivo só `Playtime` e `LastPlayed` do jogo são lidos, e nada dele vai para o log.
- **Nada é escrito na Steam** por essa importação. Para levar jogos do RetroVault para a Steam, veja a seção seguinte.
- **Testes:** `steam/steamLibrary.test.ts` (VDF, bibliotecas, ferramentas, arte nos formatos novo e antigo, tempo de jogo, registro) e `launcherService.steam.test.ts` (sessão pela pasta, espera, descarte, Steam ausente).
- **Validado no app empacotado, com a Steam real do usuário (só leitura):**
  - 9 jogos em 0,5 s, das bibliotecas do C: e do D:; Redistributables, Proton e Linux Runtime ficaram de fora;
  - o Bloons TD 6 adicionado recebeu capa e fundo do cache e 65 h de tempo de jogo da Steam.
  - Nenhum jogo foi aberto no teste.

### Jogos do RetroVault na Steam (Configurações → Steam)

- **O que faz:** cria atalhos "jogo não-Steam" (`userdata\<conta>\config\shortcuts.vdf`). Os jogos aparecem na biblioteca e no Big Picture, com Steam Input e overlay.
- **Para onde o atalho aponta:** direto para o que abre o jogo (`LauncherService.launchSpecFor`): o executável, o RetroArch com o core, ou o emulador próprio. A Steam acompanha o processo, então Steam Input e overlay funcionam. O preço é que o tempo jogado por ali é contado pela Steam, não pelo RetroVault.
- **A lista marcada é o que fica na Steam:** salvar adiciona os novos, atualiza os existentes (caminho, argumentos, artes) e remove os desmarcados. Opcionalmente adiciona também o próprio RetroVault (só no app empacotado).
- **Segurança:**
  - Steam fechada: aberta, ela regrava o arquivo ao sair. Se estiver aberta, a tela avisa e oferece "Fechar a Steam" (`steam://exit`). A verificação compara pela pasta da Steam.
  - Fidelidade: o VDF binário (`steam/binaryVdf.ts`) só é aceito se, regravado sem mudanças, der o mesmo arquivo byte a byte; senão nada é gravado. Tipos que o RetroVault não conhece (64 bits etc.) são copiados como estão.
  - Backup do `shortcuts.vdf` anterior em `<userData>\steam-backups\<conta>\`, guardando os últimos 10.
  - Gravação atômica: arquivo temporário e depois troca.
  - Só os atalhos com ids registrados pelo RetroVault (configuração `steam.shortcuts`, por conta) são trocados ou removidos; os do usuário ficam intactos. Tirar tudo devolve o arquivo original byte a byte.
  - Confirmação em dois cliques, com o resumo do que vai acontecer.
- **Ids:** a Steam atual respeita o `appid` gravado (os que ela mesma cria são sorteados). O RetroVault usa um id fixo por jogo (`crc32("retrovault:game:<id>") | 0x80000000`), para regravar sempre o mesmo atalho e as mesmas artes.
- **Artes em `grid\`:** capa (`<id>p`), fundo (`<id>_hero`) e ícone (`<id>_icon`, referenciado no atalho). Só PNG e JPG, que é o que a Steam garante; arte .webp fica de fora e o ícone volta a ser o do .exe. Capas do RetroAchievements são baixadas (https, até 15 MB, assinatura conferida).
- **Bloqueados:** jogos da própria Steam (com `steamAppId` ou instalados em `steamapps\common`) e jogos que o usuário já pôs na Steam à mão (mesmo executável).
- **Contas:** pastas em `userdata`, com os nomes do `config\loginusers.vdf`; vem escolhida a usada por último.
- **Teste numa cópia:** `RETROVAULT_STEAM_DIR=<pasta>` faz o app usar outra pasta da Steam.
- **Testes:** `steam/steamShortcuts.test.ts` (fidelidade byte a byte, tipos desconhecidos, linha de comando, contas, bloqueios, adicionar/atualizar/remover, restauração exata, Steam aberta, formato desconhecido, .webp).
- **Validado no app empacotado, numa cópia da pasta da Steam do usuário e do perfil do RetroVault:**
  - o atalho do God of War III criado pelo usuário foi reconhecido e bloqueado, e o Onimusha ficou de fora por ser jogo da Steam;
  - 8 jogos e o RetroVault foram adicionados, com artes;
  - desmarcar tudo devolveu o arquivo idêntico ao original;
  - o arquivo real não foi tocado (hash conferido antes e depois).

## Adicionar uma pasta inteira (`services/libraryScanner.ts`)

O botão de pasta ao lado de "Adicionar jogo" varre uma pasta e mostra os jogos encontrados para revisão. A varredura usa limites de 8 níveis, 50 mil pastas, 60 s e 5 mil resultados, mostra o progresso e pode ser cancelada.

- **Jogos de PC e ports:** a primeira pasta com um executável válido é a raiz do jogo, e o scanner não desce mais nela. Assim, `bin\*-probe.exe` e `_internal\` ficam de fora.
  - Instaladores, desinstaladores, crash handlers, runtimes e auxiliares de ports são excluídos por padrões específicos, para não esconder `CrashBandicoot.exe` ou `Bejeweled3.exe`.
  - O executável principal é escolhido pela semelhança com o nome das pastas e pelo tamanho. O launcher real vence o `Play X.exe`, e os outros ficam como alternativas na revisão.
  - Nomes genéricos (`main.exe`, `game.exe`) recebem o título da pasta.
- **ROMs:** extensões específicas definem o console. As genéricas (`.bin`, `.iso`, `.zip`, `.7z`, `.img`) só entram quando o console pode ser deduzido do nome da pasta (`PS1`, `SNES`, `Arcade`…), porque em pastas de jogos de PC são dados.
  - Faixas de `.cue`/`.gdi` e discos listados num `.m3u` não aparecem separados.
  - Discos sem console definido aparecem desmarcados.
- **Ignorados:** pastas de emuladores e frontends (RetroArch, PCSX2, shadPS4…), inclusive as ROMs dentro delas, e dumps de PS4. O port ao lado do dump é o que roda, e ele recebe troféus e arte do dump.
- **Adição em lote (`games:add-many`):** sequencial, por causa do limite de requisições do RetroAchievements e da leitura das ROMs. Mostra o progresso, uma falha não interrompe os outros itens, e cada jogo passa pela mesma rotina de troféus e arte do "Adicionar jogo".

## Jogos movidos de pasta (`services/relocationService.ts`)

Mover a pasta de um jogo não exige readicioná-lo, então tempo de jogo, troféus, arte e histórico continuam na mesma linha do banco.

- **Ao abrir o app:** jogos cujo arquivo sumiu são procurados por nome. A busca é em largura, limitada a 6 níveis, 20 mil pastas e 8 s, e parte da pasta antiga mais próxima que ainda existe e de até 3 níveis acima de cada outro jogo da biblioteca. A raiz do disco e a pasta do usuário nunca são usadas como ponto de partida.
- **Pontuação:** conta quantas partes finais do caminho coincidem com o antigo (`Gow\gow3-windows\gow3-windows\God of War III.exe` = 4). O reparo automático só acontece com pontuação ≥ 2 (pasta + arquivo) e sem empate.
- **Na página do jogo:** um aviso com "Procurar automaticamente" (aceita só o nome igual, sem empate) e "Localizar…" (seletor aberto perto do local antigo). O botão Jogar fica desativado enquanto o arquivo estiver ausente.
- **Log de troféus:** se o log vigiado ficava dentro da pasta do jogo, ele é remapeado para a pasta nova.
- **IPC:** `games:missing`, `games:relocate { id, action: 'pick' | 'auto' }` e o evento `games:relocated`.

## Tela inicial estilo PlayStation 5 (`pages/ConsoleHome.tsx`)

A Biblioteca abre numa tela de console. A grade continua disponível no botão de grade, e a escolha fica em `?view=` e é lembrada em `localStorage` (`hooks/useLibraryView.ts`).

- **Biblioteca vazia (instalação nova):** a tela de console só existe com jogos. Sem jogos, aparece a grade com "Sua biblioteca está vazia" e a barra de cima com o menu (Loja, Configurações, Conquistas…).
  - A Biblioteca e o `App.tsx`, que esconde essa barra quando a tela de console tem o próprio menu, decidem pela mesma função, `showsConsoleHome`.
  - Antes, o `App.tsx` olhava só a preferência de visão e escondia a barra mesmo sem a tela de console, e uma instalação nova ficava sem menu nenhum (corrigido na 0.1.1).

- **Layout:**
  - arte do jogo selecionado em tela cheia, com transição cruzada entre duas camadas. Sem arte de fundo, usa a capa ampliada e desfocada;
  - fileira de blocos no topo (mais recentes primeiro), com o selecionado maior, contornado e com o nome embaixo;
  - abas de categoria e relógio;
  - título grande com plataforma e tempo de jogo, botão Jogar em pílula (fica branca em foco, como no PS5) e "•••" para os detalhes;
  - cartões da capa e de troféus (locais ou do RetroAchievements).
- **Modo imersivo:** nessa tela, a barra lateral some (`.app--immersive`) e a barra de título fica transparente sobre a arte (`.app__main--immersive`).
- **Menu do canto superior (`components/home/HomeMenu.tsx`),** como no PS5:
  - Buscar abre um campo ali mesmo, que filtra a fileira enquanto você digita; Esc fecha;
  - Adicionar jogo, Adicionar pasta, Categorias e Grade abrem os mesmos diálogos que estavam na barra lateral;
  - Conquistas, Configurações, o avatar do RetroAchievements e o relógio.
  - Nas outras telas, a barra lateral continua sendo a navegação.
- **Teclado:** a fileira usa roving tabindex. ← → trocam o jogo, Home/End vão às pontas, Enter (no selecionado) joga e duplo clique joga.
- **Controle (`hooks/useGamepadNavigation.ts`):** direcional ou analógico trocam o jogo (segurar repete), ✕/A joga e △/Y abre os detalhes.
  - O loop só roda com um controle conectado (`gamepadconnected`).
  - O controle é ignorado com a janela sem foco (o jogo aberto por cima) ou com um diálogo aberto.
- **Desempenho:** as artes dos vizinhos são pré-carregadas, os blocos são `memo` com callback estável, e o título usa `aria-live` para anunciar a troca a leitores de tela.

### Telas de sistema no estilo PS5

- **Sem barra lateral no app inteiro.** O `components/layout/TopMenu.tsx` fica no topo de todas as telas.
  - Ícones: busca, 🏠 Início, adicionar jogo/pasta, categorias, grade, Conquistas, Configurações, avatar e relógio.
  - O ícone da tela atual fica marcado (`aria-current="page"`).
  - Fora da Início, a lupa leva até ela com a busca aberta.
- **Fundo de ambiente (`AmbientBackdrop.tsx`):** a arte do jogo em foco (ou do último jogado) desfocada e escurecida. É uma imagem estática, então o desfoque é calculado uma vez. Os cartões são vidro escuro opaco o suficiente para dispensar `backdrop-filter`.
- **Cascata (`components/ui/Cascade.tsx`, reutilizável):** lista grande à esquerda e conteúdo à direita, que desliza ao trocar.
  - Semântica de abas verticais: ↑ ↓ Home End navegam e ativam.
  - O item ativo vira um cartão claro, como o foco do PS5.
  - Usada em **Configurações** (seções, com `?secao=` na URL) e em **Troféus** ("Troféus recentes" + jogos com o percentual; à direita, o painel completo de troféus do jogo).
- **Abas em texto** (Troféus · RetroAchievements), iguais às da tela inicial.

## Categorias (`services/categoryService.ts`, `services/platform.ts`)

As categorias são criadas pelo usuário (PlayStation 4, Nintendo DS…), e um jogo pode estar em várias (tabelas `categories` e `game_categories`, migration 8). O `Game.categoryIds` vem na mesma consulta da lista de jogos, por uma subconsulta agregada, sem N+1.

- **Detecção de plataforma (`detectPlatform`, função pura),** do sinal mais forte para o mais fraco:
  1. ROM com console conhecido;
  2. troféus de um dump de PS4;
  3. emulador pelo nome do executável ou dos argumentos (RPCS3 → PS3, Citra/Lime3DS/Azahar → 3DS, PCSX2 → PS2, shadPS4 → PS4, Ryujinx/Yuzu → Switch…);
  4. arquivo de jogo nos argumentos (`.3ds`/`.cia`, `.nds`, `.nsp`…);
  5. pistas no caminho (`PS3_GAME`, `BLUS…`, `CUSA…`);
  6. arquivo de jogo ao lado do executável, se apontar para uma única plataforma (Pokémon Platinum: `main.exe` + `.nds`).
  - Sem sinal, devolve `null` e não chuta "PC": um port de PS4 também é um `.exe`.
- **Ícones (`shared/categoryIcons.ts` + `components/categories/CategoryIcon.tsx`):** são 23 símbolos **desenhados para o app** que remetem a cada console (△○✕□ para PlayStation, duas telas para DS/3DS, Joy-Con para Switch…). Não são os logotipos oficiais, que são marcas registradas.
  - Cada ícone é um quadrado arredondado com a cor do console, no estilo macOS.
  - Por padrão, o ícone vem do nome da categoria (`autoCategoryIcon`, com regras do mais específico para o mais geral: PSP antes de PlayStation, 3DS antes de DS).
  - O usuário pode escolher outro na grade de "Gerenciar categorias" (`categories.icon`, migration 9; `NULL` = automático).
- **Organizar automaticamente:** cria uma categoria por plataforma e coloca nela só os jogos ainda sem categoria. Rodar de novo não duplica nada.
- **Jogo novo** entra na categoria da sua plataforma se ela já existir. Isso acontece depois da importação de troféus, que é o que revela um port de PS4.
- **UI:**
  - barra lateral agrupada por categoria, com grupos que abrem e fecham (lembrados em `localStorage`);
  - filtro na biblioteca (`/?categoria=<id>` ou `nenhuma`);
  - etiquetas e o seletor na página do jogo;
  - "Gerenciar categorias" (criar, renomear, reordenar, apagar e organizar).

## Loja de ports (`services/store/`, `pages/StorePage.tsx`)

A Loja reúne ports de PC (decompilações e recompilações) de código aberto. **Ela nunca distribui jogos:** baixa só o programa que cada projeto publica no GitHub, e o jogo vem da cópia do próprio usuário (ROM ou arquivos do disco).

**Feito na Etapa 1 (só leitura):** a rota `/loja`, em cascata, com busca, detalhes, requisitos e a lista de versões.

**Catálogo:**
- `catalogSchema.ts`:
  - valida item a item com zod: um port mal escrito é ignorado sem derrubar os outros;
  - recusa formatos mais novos (`schemaVersion`), repositórios fora do padrão `dono/nome`, regex que não compila e links sem https.
- `seedCatalog.ts`: o catálogo embutido, com 9 ports:
  - Ship of Harkinian, 2 Ship 2 Harkinian, Zelda 64: Recompiled, Banjo: Recompiled, Starship, SpaghettiKart, sm64coopdx, Perfect Dark e Unleashed Recompiled;
  - os padrões de arquivo de Windows foram conferidos nas versões reais e são testados.
- `catalogService.ts`:
  - usa um catálogo remoto (`catalog.json` em https) quando houver URL, com cache de 6 h, e volta ao embutido se ele falhar;
  - por enquanto a URL é `null` em `container.ts`.

**Formato de cada item do catálogo:**
```json
{
  "id": "shipwright",
  "name": "Ship of Harkinian",
  "original": { "title": "The Legend of Zelda: Ocarina of Time", "platform": "n64" },
  "developer": "HarbourMasters",
  "summary": "…",
  "description": "…",
  "tags": ["Zelda"],
  "source": { "type": "github", "repo": "HarbourMasters/Shipwright" },
  "assets": { "windows": "Win64\\.zip$" },
  "requires": { "kind": "rom", "label": "ROM de Ocarina of Time (Nintendo 64 ou GameCube)" }
}
```
O campo `platform` usa as chaves de ícone das categorias (`n64`, `xbox`…).

**Versões (`githubClient.ts`):**
- usa a API pública do GitHub, que sem conta permite **60 consultas por hora**;
- cache de 1 h com stale-if-error;
- revalida com **ETag**: a resposta `304`, quando nada mudou, não conta no limite;
- busca as versões só quando o port é aberto;
- o arquivo de Windows de cada versão é escolhido pela regex do catálogo e vem com o SHA-256 publicado pelo GitHub (`digest`), que será usado para conferir o download.

**Feito na Etapa 2 (baixar e instalar):** o botão "Baixar · tamanho" instala a versão estável mais nova com arquivo de Windows (`chooseRelease`, em `shared/store.ts`, o mesmo usado pela tela).

**Fluxo de instalação (`installService.ts`):**
1. **Baixar** (`downloader.ts`):
   - só aceita hosts do GitHub, inclusive depois dos redirecionamentos;
   - grava em fluxo num `.part` e calcula o SHA-256 no caminho;
   - interrompe se vier mais que o tamanho publicado, ou se ficar 60 s sem dados.
2. **Conferir:** tamanho exato e, quando o projeto publicou, o SHA-256 (`digest` do GitHub). A instalação guarda `verified`, e a tela mostra "conferido (SHA-256)" ou "conferido pelo tamanho".
3. **Extrair** (`zipExtract.ts`, com yauzl) numa pasta temporária (`Ports\.staging`):
   - recusa caminhos que saem da pasta (zip slip), links simbólicos, mais de 100 mil arquivos ou mais de 16 GB;
   - nunca sobrescreve um arquivo (`wx`);
   - grava até 8 arquivos ao mesmo tempo.
4. **Achar o executável:** o campo `executable` do catálogo (lido do índice de cada zip). Se uma versão nova o renomear, o instalador escolhe o .exe mais raso e maior, ignorando atualizadores e desinstaladores.
5. **Trocar de forma atômica:** `rename` para `%LOCALAPPDATA%\RetroVault\Ports\<port>\<versão>`, então a pasta só aparece completa. Se o zip tem uma pasta única no topo, ela vira a raiz.
6. **Registrar na biblioteca:**
   - instalação nova: `games.add`, com ícone, troféus e categoria em segundo plano;
   - reinstalação: o jogo lembrado em `store_port_games` é religado com `relocate`, mantendo tempo de jogo, troféus e saves.

**Regras de segurança da instalação:**
- **Antes de trocar ou apagar uma versão:** o save vai para o cofre. Muitos ports salvam na própria pasta, e o cofre guarda esses saves relativos à pasta do jogo, então eles podem ser restaurados na versão nova.
- **Desinstalar:**
  - guarda o save no cofre;
  - manda a pasta para a **Lixeira** (`shell.trashItem`, recuperável);
  - apaga a linha de `store_installs`;
  - **mantém o jogo** na biblioteca.
- **Jogo aberto:** instalar ou desinstalar é recusado.

**Outras garantias:**
- **Cancelar:** a qualquer momento antes do fim. O `.part` e a pasta temporária são apagados.
- **Restos de uma instalação interrompida** (app fechado no meio): limpos na inicialização (`cleanupLeftovers`).
- **Progresso:** evento `store:install-progress` (no máximo a cada 150 ms), guardado no cache do react-query. A barra continua certa mesmo saindo e voltando à Loja.
- **Banco (migração 10):**
  - `store_installs`: versão ativa, pasta, executável, hash e `verified`;
  - `store_port_games`: port → jogo, sobrevive à desinstalação e some se o jogo for removido.

**Medido no app (perfil isolado):**
- Perfect Dark (24,5 MB, 10 arquivos): 1,5 s no total.
- Ship of Harkinian (69,6 MB, 20.358 arquivos): 2 s de download e cerca de 25 s de extração.

**Sobre a extração:** criar cada arquivo no Windows (e o antivírus inspecionar cada um) é o limite. Medido no mesmo zip:

| Etapa | Tempo |
|---|---|
| Ler o índice | 0,1 s |
| Descomprimir | 2 s |
| Gravar | ~16 s |

- **Gravação em paralelo:** reduziu de 20,4 s para 18 s.
- **Experimentos descartados:** ler o zip da memória e descomprimir os arquivos pequenos de uma vez deram 1 s ou menos. Ficaram de fora por não compensarem o código e a memória a mais.
- **Comparação:** o `tar.exe` nativo leva cerca de 10 s no mesmo zip.

**Feito na Etapa 3 (assistente de ROM):** `romService.ts` e o painel "ROM do jogo" (`components/store/RomPanel.tsx`) no port instalado.
- **Catálogo:** campo `setup` de cada port, com dados tirados das fontes oficiais de cada projeto, citadas em `seedCatalog.ts`.
  - `method: 'copy'`: o RetroVault coloca a ROM conferida onde o port procura.
    - Perfect Dark: `data/pd.ntsc-final.z64` (README).
    - sm64coopdx: `baserom.us.z64`, porque o `rom_checker.cpp` também procura na pasta do executável.
  - `method: 'in-app'`: o port pede a ROM na primeira vez que abre (SoH, 2Ship, Starship, SpaghettiKart, Zelda64 e Banjo Recompiled, Unleashed). O RetroVault confere antes (opcional) e mostra qual arquivo selecionar.
  - `accepted`: as versões aceitas.
    - SHA-1 do `supportedHashes.json` (SoH, 2Ship), do README ou `config.yml` (Starship, SpaghettiKart);
    - MD5 do README (Perfect Dark) ou do código (sm64coopdx);
    - Banjo: sem hash publicado, usa o **código do cartucho** no cabeçalho (`NBKE`, revisão 0).
- **Conferência:** detecta `.z64`, `.v64` e `.n64` (`n64ByteOrder`, em `romHasher.ts`), converte para `.z64` e calcula SHA-1 e MD5 sobre o `.z64`, que é o formato de todos os hashes oficiais. Se a versão estiver errada, a mensagem diz o que foi escolhido (nome interno, região e revisão, lidos do cabeçalho) e o que é aceito.
- **Entrega:**
  - `copy`: grava o `.z64` no destino de forma atômica (arquivo temporário + `rename`);
  - `in-app` com ROM `.z64`: o próprio arquivo serve;
  - `in-app` com ROM em outro formato: cria uma cópia convertida em `rom-retrovault\<port>.z64`, dentro da pasta do port.
- **Lembrar:** `store_port_roms` (migração 11) guarda a ROM de cada port. Depois de instalar, atualizar ou reinstalar, `afterInstall → roms.reapply` confere e recoloca a ROM sozinho.
- **Privacidade:** o RetroVault nunca baixa ROM. Só trabalha com o arquivo escolhido pelo usuário, no próprio PC.

**Feito na Etapa 4 (atualizações e versões):**
- **Detecção** (`availableUpdate`, em `shared/store.ts`, a mesma regra no main e na tela):
  - tag estável mais nova na lista do GitHub;
  - **mesma tag republicada com outro arquivo** (SHA-256 publicado diferente do instalado), que é o caso do `ci-dev-build` do Perfect Dark.
  - Uma prévia instalada mais nova que a estável não vira "atualização".
  - `store:updates` checa só os ports instalados, com as versões em cache, e aparece a etiqueta "Atualização" na lista.
- **Dados do usuário seguem a versão** (`userFiles.ts`):
  - cada instalação grava `.retrovault-files.json` com os arquivos do pacote;
  - tudo o que não está nele (saves, configurações, o `.o2r` gerado da ROM, mods) é copiado para a versão nova ao atualizar, e de volta ao voltar;
  - arquivos do pacote de destino nunca são substituídos;
  - pastas de antes do manifesto usam como critério "o que não vem no pacote novo".
- **Versão anterior guardada** (`previous_json`, migração 12):
  - atualizar mantém a versão que estava ativa no disco;
  - só a de antes dela vai para a Lixeira;
  - a mesma tag com arquivo novo ganha uma pasta própria (`<tag>-<sha8>`), então as duas compilações convivem.
- **Voltar** (`rollback`):
  - troca instantânea, sem download (cerca de 1 s no teste, contando a tela);
  - leva os saves mais novos;
  - pode ser desfeito, porque a versão atual vira a guardada;
  - pedir a versão guardada pela lista ("Usar esta (já baixada)") também usa o rollback.
- **Tela:**
  - "Atualizar para X · tamanho", ou "Atualizar para X (já baixada)" quando ela é a versão guardada;
  - "Voltar para Y";
  - em cada versão da lista: "Instalada", "Usar esta" ou "Instalar esta versão".
  - Avisos e ações ficam centralizados em `usePortInstaller`.
- **Desinstalar:** manda para a Lixeira a versão ativa e a guardada.

**Feito na Etapa 5 (capas e catálogo online):** Configurações → Loja de ports.
- **Artes** (`storeArt.ts`):
  - **com chave do SteamGridDB** (API v2): busca o jogo original (`artQuery` ou `original.title`; prefere o nome idêntico) e pega a imagem mais votada de cada tipo:
    - capa 600×900;
    - banner (hero);
    - logo;
    - ícone.
    - O filtro `nsfw=false&humor=false` vai em todas as buscas.
  - **sem chave:** o logo que o projeto publica (`art.logo` no catálogo; SoH, SpaghettiKart, sm64coopdx e Unleashed).
- **Segurança das imagens:**
  - o main só baixa de `cdn2.steamgriddb.com` e `raw.githubusercontent.com`, inclusive depois de redirecionamentos;
  - limite de 10 MB e formato conferido pela assinatura dos bytes;
  - as imagens ficam no cofre de artes e são servidas por `rv-media:`. A tela nunca carrega imagem da internet (a CSP continua fechada).
- **Cache:**
  - 7 dias por port;
  - a chave do cache inclui o logo e o nome de busca, então mudar o catálogo atualiza a arte;
  - **falhas não ficam em cache** (sem internet, SteamGridDB fora do ar), e na próxima vez tenta de novo.
  - O SteamGridDB às vezes responde 200 com HTML vazio quando está instável; isso é tratado como "fora do ar", não como resposta.
- **Limpeza:** `store_art` (migração 13) lista as imagens da Loja, para a limpeza de artes não apagá-las.
- **Biblioteca:**
  - ao instalar, o jogo ganha capa e fundo da Loja, mas só se ainda não tiver (`applyArtworkIfMissing`; a arte escolhida pelo usuário nunca é trocada);
  - conectar a chave depois também aplica aos ports já instalados.
- **Chave do SteamGridDB:** conferida numa busca real antes de salvar (erro `SGDB_AUTH` se recusada) e cifrada com DPAPI.
- **Catálogo online:**
  - **Exportar catalog.json:** gera o catálogo atual, com ida e volta testada;
  - **guia:** criar o repositório público, enviar o arquivo e copiar o link "Raw";
  - **URL testada antes de salvar:** só salva se devolver um catálogo válido. Se o usuário colar o endereço da página do arquivo (`github.com/.../blob/...`), ele vira o endereço "Raw" sozinho;
  - mensagens claras para 404, página HTML e JSON que não é catálogo;
  - trocar a URL limpa o cache do catálogo.
- **Erros de validação de um valor só** (token, chave, URL): `toIpcError` mostra a frase do schema, sem o prefixo técnico "Dados inválidos — entrada:".

**Capas sem chave e visual dos ports:**
- **Capa:** `art.boxart` no catálogo aponta para a capa do jogo original no **libretro-thumbnails** (`raw.githubusercontent.com/libretro-thumbnails/<sistema>/master/Named_Boxarts/<nome No-Intro>.png`, as mesmas capas que o RetroArch usa). Sem chave do SteamGridDB, ela é a capa do port; com a chave, cobre o que faltar no SteamGridDB.
- **Ladrilho** (`PortTile`): quadrado escuro com a capa inteira dentro, na lista e na página.
- **Cabeçalho:** "PLATAFORMA · PORT/RECOMPILAÇÃO", o título e o selo "Baseado em <jogo original>".
- **Biblioteca:** os ports instalados ganham essa capa.

**Formatos de instalação** (`installKind`, em `shared/store.ts`, ou o campo `install` no catálogo):
- **archive**:
  - `.zip`, extraído com yauzl;
  - `.7z`, pelo `tar.exe` do Windows (bsdtar/libarchive, em `archive7z.ts`): a listagem é conferida antes de extrair (`checkListing`; nada de `..`, unidade ou `/`), e links simbólicos são recusados depois.
  - Versões, manifesto e "voltar", como sempre.
- **portable** (`.exe` sozinho): vira um pacote de um arquivo, com versões e "voltar".
- **installer** (`setup.exe`, `.msi`, `.msi.zip`):
  - `runInstaller` abre o instalador com `Start-Process -Wait` (pede UAC quando ele exige) e o usuário segue os passos;
  - depois o RetroVault procura o jogo em `installedExe` (ex.: `%LOCALAPPDATA%\Programs\X\x.exe`) ou pede para o usuário apontar;
  - fica fora da pasta do RetroVault: sem "voltar", e desinstalar só tira da Loja (`{ manual: true }`), porque os arquivos são removidos pelo Windows.
- **Banco:** a coluna `kind` (migração 14). Versões anteriores salvas antes dela contam como `archive`.

**Lote 4 (N64, GameCube e Wii)**, 10 ports, cada um pesquisado nas fontes oficiais:
- Conker: BFD Reloaded, Dusklight (Twilight Princess), Ghostship (Mario 64), Donkey Kong 64: Recompiled, Golden Balloon (Diddy Kong Racing), Project Midas (GoldenEye, `.7z` com ROM no tipo "copy"), Metroid Prime Port, Strikers, Recharged e SMS Launcher (`.exe` portátil).
- **Versões aceitas:** SHA-1 publicados (Conker, Ghostship, GoldenEye); código do cartucho e revisão quando não há hash (DK64 `NDOE`; Diddy Kong Racing `NDYE`/`NDYP` rev. 1); os jogos de disco (GameCube/Wii) só explicam o que o port pede.
- **Testes:** a regex de cada port é testada contra os nomes reais dos arquivos publicados, com armadilhas reais (`arm64`, `.zip.sha256`, `Setup.exe`).
- **Capas:**
  - o libretro-thumbnails guarda capas repetidas como **links simbólicos do git**: o arquivo bruto é só o nome da capa de verdade;
  - `gitSymlinkTarget` segue esse link uma vez, só dentro da mesma pasta;
  - a assinatura de imagem continua sendo conferida.
- **Capas leves:**
  - capas e banners são guardados reduzidos (máximo de 600 px de altura) e em JPEG 85 (`ArtworkService.savePhoto`); logos e ícones mantêm a transparência;
  - a migração 15 esquece as capas antigas, para elas virem de novo no formato leve;
  - medido: as capas da Loja apareciam em 1.000 ms e agora em 51 ms (do cache), com média de 63 KB por capa em vez de 300 a 800 KB.

**Lote 5 (PlayStation, PS2, Xbox 360 e PC)**, 9 ports:
- SymphonyRecomp, MediEvilRecomp, Castlevania Chronicles Recomp, Tenkaichi3Decomp, TRX (Tomb Raider I–III, instalador), UZDoom, OpenGOAL (Jak, `.msi`), Lost Odyssey Recompiled e Bloodborne for Windows.
- **Fora:** o **Cut the Rope DX**, porque o pacote traz os arquivos do jogo original (os direitos são da ZeptoLab), e a Loja nunca distribui jogo.
- **Requisitos extras:** Symphony e MediEvil precisam do **.NET 10** instalado (está nas notas da versão). O Tenkaichi tem um passo de preparação (`Tenkaichi3Decomp-setup.exe`) que confere o `.iso` e extrai os dados.
- **Caminho do OpenGOAL depois de instalado:** lido do próprio `.msi` por extração administrativa (`msiexec /a`, que não instala nada): `%PROGRAMFILES%\OpenGOAL-Launcher\OpenGOAL-Launcher.exe`. O TRX deixa o usuário escolher a pasta, então o RetroVault pede para apontar o `TRX.exe`.
- **`original.system`:** o nome exato do console no cabeçalho (ex.: "PlayStation 2"), quando o ícone é o da família.

**Lote 6 (instaladores e casos especiais)**, 7 ports:
- Takedawn (Burnout 3, instalador), Ring Out (SoulCalibur II), P.T. para PC, OCTR (CTR Nitro-Fueled), King Kong Recompiled, Yakumo (Monster Hunter Portable 3rd HD) e Lantern Engine (Bloodborne).
- Todos pedem a cópia do próprio usuário e declaram não incluir arquivos do jogo. O P.T. aceita o dump da versão americana (CUSA01127) que o usuário já tenha.
- **Gerados por IA** (Ring Out, OCTR, King Kong, Yakumo e Lantern Engine): o aviso aparece antes de qualquer download. Isso foi conferido na instalação real.
- **Executável:** passou a aceitar símbolos e acentos (ex.: `Crash™ Team Racing Nitro-Fueled.exe`). Continuam proibidos `..`, unidade, barra inicial e os caracteres inválidos no Windows.
- **Ring Out:** usa o `.zip` (11.629 arquivos, porque traz o compilador que recompila o jogo no PC), e não o `setup.exe`. Assim o port fica com versões e "voltar".

**Lote 7 (ports gerados por IA)**, 9 ports. Com ele o catálogo embutido chega a **44 ports**:
- Wind Waker HD Recomp, WWE All Stars Recomp, Yu-Gi-Oh! Forbidden Memories Recompiled, OpenCMR2, Verdite2 (King's Field), Hydro Thunder Port, Uncharted NDC, Second Hunt (Metroid Prime Hunters) e GoldenEye 007 PC Port.
- **Todos com `ai: 'generated'`:** o aviso aparece antes de qualquer download. Isso foi conferido na instalação real.
- **ROM de Nintendo DS:**
  - o assistente de ROM (`inspectRom`) reconhece `.nds` pelo CRC do logo da Nintendo (`0xCF56` em `0x15C`);
  - lê o código do jogo (`0x0C`) e a revisão (`0x1E`);
  - o Second Hunt aceita só a versão americana (`AMHE`, revisões 0 e 1). A `.nds` serve como está, sem conversão.
- **Armadilha do Yu-Gi-Oh!:** a mesma versão publica o jogo e um editor (`fm-editor`). A regex só pega `yfm-redecomp-v…-windows.zip`.
- **GoldenEye PC Port:** recebe a ROM do tipo "copy" em `data/ge007.ntsc-final.z64` (o mesmo SHA-1 do Project Midas).

**Lote 8 (posições 52 a 75 do ranking)**, 18 ports. Com ele o catálogo chega a **62 ports**:
- SpartanPort (God of War III), EdgeOfTimeRecompiled, reNut (Nuts & Bolts), Nebula (Super Mario Galaxy, instalador), AlienReRecomp, Tekken Tag Tournament 2 PC (instalador), DekUI (Majora's Mask 3D), New Super Paper Bros., NSMBU Recomp, Athelas (Senhor dos Anéis), Rush 2: Recompiled, Fukami (Ridge Racer V), ClayFighter 64, DBZ Burst Limit Recompiled, ico-pc, Earthworm Jim HD, OpenTTD (JGR's Patch Pack) e OpenTyrian.
- **Fora:**
  - Super Mario World Remastered e Remastered Plus, porque o pacote já traz o jogo;
  - Project Reignition, que não pede a cópia do usuário e não dá para garantir que o pacote não traga conteúdo da SEGA;
  - Ace Combat 3, que vem em `.rar` e precisa ser compilado;
  - SWROTS (sem versão publicada) e Goemon64 (só Android).
- **Jogos gratuitos (`requires.kind: 'none'`):**
  - para OpenTTD e OpenTyrian (Tyrian 2.1 é freeware dos próprios autores), não há cópia a fornecer;
  - a página mostra o aviso em verde, sem o "você precisa da sua cópia", e esses ports não têm assistente de ROM.
- **SHA-256 nas versões aceitas:** o ClayFighter 64 só publica SHA-256 (das duas ROMs, 63⅓ e Sculptor's Cut). Por isso `accepted[].sha256` passou a valer, e o `inspectRom` também o calcula.
- **Armadilhas de arquivo cobertas por teste:**
  - o servidor da comunidade do TTT2 (`ttt2-server-*.zip`) não é o jogo;
  - o DBZ não tem sufixo no zip de Windows (lookahead exclui o `-linux.zip`);
  - o Athelas tem pacote `-arm64`;
  - o `-win-portable.zip` do ICO não é escolhido.
- **Executável em subpasta:** o ICO usa `x64/ico_pc_x64.exe`. O SpartanPort tem caminhos com `\` dentro do zip (normalizados na extração).

**Lote 9 (posições 76 a 100 do ranking)**, 20 ports. Com ele o catálogo chega a **82 ports**:
- Rocket-R, OpenRCT2, Open Nectar (Pikmin), re:Blue (Blue Dragon), Zelda 3 Launcher, Viva Piñata: TiP Recompiled, Weltall (Xenogears), Jet Force Gemini Recomp, Virtua Fighter 2 Recomp, Geometry Wars: Retro Evolved 2, Birdman64 (Pilotwings 64), Snap64 Recomp, Silent Hill PC Port, ApeEscapeRecomp, Hyrule Warriors DE Recomp, LAS Recomp, Pinyon Shift (Forza Horizon), DevilutionX (Diablo), WWE 2K14 PC e Project Picori (Minish Cap).
- **Fora:**
  - CannonBall DX, porque o pacote traz `roms/outrun.zip`, o jogo do arcade;
  - Drakengard 3 (sem versão publicada) e RalliSport Challenge 2 (só Linux);
  - sm64coopdx e Starship, que já estavam no catálogo.
- **`.tar.gz`:** o Project Picori só publica o Windows nesse formato. O mesmo `tar.exe` do `.7z` o abre (`TAR_FORMATS`), com a listagem conferida antes.
  - A checagem de formato do `InstallService` também teve de aceitá-lo. Um teste de instalação completa cobre isso: a instalação real tinha travado aí.
- **ROMs de outros consoles (SNES, GBA):**
  - quando o port não é de N64 nem de DS e só aceita por hash, o assistente confere o arquivo pelo hash direto (`format: 'raw'`);
  - nas ROMs de SNES, o cabeçalho de copiadora de 512 bytes sai antes;
  - o Zelda 3 recebe `zelda3.sfc` (tipo "copy", SHA-256) e o Snap64 recebe `pokemonsnap.z64`;
  - o filtro da janela de escolha segue o console do port.
- **Jet Force Gemini:** o projeto não publica hash, então a ROM é conferida pelo código do cartucho (`NJFE`).

**Todos os ports de PlayStation 4** (16 no Quiver), **5 novos**. Com eles o catálogo chega a **87 ports**:
- Dragon's Crown Pro PC Port, DriveClub Recomp, inFAMOUS Second Son PC, ShadowOfTheColossus-PC e The Last Guardian PC.
- **Repetidos:** entra só o port de versão mais recente de cada jogo.
  - **Shadow of the Colossus:** AjncSystem v0.60.6, de 22/10, e não o fork do Oussama268, v0.57 de 20/10.
  - **Bloodborne:** os dois que já estavam na Loja são os mais recentes; o fork do Mrsuss60 não entra, e o bbport é só para Linux.
  - **CTR:** o OCTR, que já estava na Loja, é mais novo que o original do GetLostIn.
  - **Uncharted:** por escolha do usuário, fica o do bc160201983, mais bem avaliado. O do Supermedo é dois dias mais novo, mas tem 0 de 7 recomendações.
- **Teste:** o mesmo repositório não pode entrar duas vezes no catálogo.
- **Arquivos do firmware:** Shadow of the Colossus e The Last Guardian precisam de módulos de som do firmware do PS4 (`libSceNgs2.sprx`, e no SotC também `libSceUlt.sprx`), que o usuário fornece. Isso está em `requires.note`.

**Lote 10 (posições 101 a 125 do ranking)**, 12 ports. Com ele o catálogo chega a **99 ports**:
- ShaolinMonksRecomp (Mortal Kombat: Shaolin Monks, Xbox), OpenMW (Morrowind), Atomic Bomberman — Modern, The Urbz Recomp (Xbox), Tony Was A Pro Skater (THPS, PS1), CyberMage: Darklight Re-Awakening, UrbanRecomp Enhanced (SimCity, SNES), WWE SmackDown vs. Raw 2011 PC (Xbox 360), Power Dozer (Blast Corps), Snowboard Kids: Recompiled, Aerofoil (Glider PRO) e Heretic2R.
- **Fora:**
  - DOAXVB Recomp, que não publica executável (o usuário compila);
  - re3 e reVC, retirados por DMCA da Take-Two;
  - ares, que é emulador;
  - os que já estavam na Loja, sem versão publicada ou só para Android.
- **Arquivos certos de cada versão:** o servidor dedicado do Atomic Bomberman, o pacote de mods do SvR2011, o x86 do THPS e o `.msi`, as ferramentas e os símbolos do Aerofoil não são escolhidos. O UrbanRecomp é um `.exe` portátil e o OpenMW usa o instalador do projeto.
- **ROMs conferidas por hash:** Power Dozer (Blast Corps EUA Rev 1) e Snowboard Kids (EUA). A ROM de SimCity não tem hash publicado e é reconhecida pelo próprio UrbanRecomp.
- **Jogam direto:** Aerofoil (o autor liberou os recursos do Glider PRO) e Atomic Bomberman — Modern (gráficos livres próprios; os originais são opcionais).
- **Ícone do Windows em bitmap:** o `pngFromIco` agora também converte o bitmap de 32 bits (BGRA, de baixo para cima) de um `.ico` em PNG, sem depender do `nativeImage`. O PNG embutido continua com preferência, a não ser que o bitmap seja maior. Bitmaps de paleta continuam fora. Foi assim que o Heretic2R ganhou ícone, e também o DriveClub e o Viva Piñata, que estavam sem imagem.

**Créditos ao Quiver Launcher (só texto e link, sem logo nem marca):**
- **Topo da Loja:** "Seleção baseada no ranking do Quiver Launcher. Todo o crédito é de quem fez cada port." O nome é um link para `quiverlauncher.com`.
- **Página do port:** botão "Ver no Quiver" ao lado de "Página do projeto". Os 99 ports do catálogo embutido têm página lá; os slugs foram ligados pelo repositório do GitHub de cada app na API do Quiver.
- **Catálogo:** campo opcional `quiver`, só com o slug (`QUIVER_SLUG`: minúsculas, números e hífens). O endereço é montado por `quiverPageUrl` em `shared/store.ts`, então um catálogo online não consegue apontar o botão para outro site. Um slug com URL, barra ou maiúscula faz o port ser ignorado, como qualquer campo inválido.

**Mods do GameBanana (painel "Mods" na página do port):**
- **Catálogo:** campo `mods` (`gamebanana`, `folder`, `extensions`), validado pelo `portSchema` e espelhado no schema do editor. Na primeira versão:
  - Ship of Harkinian (`.otr`/`.o2r`), 2 Ship 2 Harkinian, Starship e SpaghettiKart (só `.o2r`), todos na pasta `mods` do port;
  - Zelda 64 e Banjo: Recompiled ficam de fora porque os mods deles estão no Thunderstore, e o Unleashed Recompiled também, porque exige o Hedge Mod Manager.
- **API** (`GameBananaClient`, apiv11 pública, em cache):
  - lista com busca (`_aFilters[Generic_Name]=contains,…`) e ordenação (mais curtidos, mais baixados, recentes);
  - detalhe com arquivos, MD5, análise de vírus, imagens e texto (HTML convertido em texto simples);
  - mods com conteúdo adulto, obsoletos ou removidos não aparecem.
- **Imagens:** só de `images.gamebanana.com`, baixadas pelo main para o cofre (`importRemote` com `host`), sem registro em `store_art`.
- **Instalar** (`ModService`):
  - baixa só do GameBanana: `gamebanana.com` e subdomínios, porque o download passa por `files.` e termina em `filecacheNN.`;
  - confere tamanho e MD5, e recusa o arquivo que não passou na análise de vírus;
  - extrai `.zip`, `.7z` ou `.rar` numa pasta temporária e copia para a pasta de mods só os arquivos com as extensões do port;
  - registra cada arquivo em `mod_installs` (migração 18), para que "Remover" apague só esses;
  - recusa sobrescrever um arquivo de outro mod ou colocado à mão, e não instala com o port fechado ou o jogo aberto;
  - a pasta `mods` acompanha as atualizações do port, porque os arquivos do usuário são carregados de uma versão para a outra.
- **Limitação conhecida:** um pacote com várias opções (ex.: "Opção A" e "Opção B") instala todos os arquivos do formato certo. O mod testado trazia o principal e dois complementos, e os três foram juntos.
- Testado de verdade: Starship instalado, "Craft's Mugshots" (3 `.o2r`) instalado pela Loja na pasta `mods` e removido.

**Ports adicionados pelo usuário ("Adicionar do GitHub…" na Loja):**
- **Inspecionar** (`CustomPortService.inspect`):
  - aceita o link do repositório, o de uma versão ou `dono/repo`;
  - lê a versão mais recente (`GitHubClient.latestAssets`, no mesmo cache com ETag das versões);
  - lista os arquivos de Windows, descartando Linux, Mac, Android, ARM, hashes, assinaturas e código-fonte, com o mais provável primeiro;
  - recusa projeto que já está no catálogo.
- **Regra do arquivo** (`patternFromAssetName`): o nome escapado, com números trocados por `\d+` e as arquiteturas (`x64`, `win64`, `x86_64`…) fixas. Ex.: `^Rocket-R-\d+\.\d+\.\d+-Windows-x64\.zip$`.
- **Sugestões:** nome a partir do repositório (também em CamelCase), e "jogo original" sem palavras de port (Launcher, Port, PC, Recomp…), porque é o nome buscado para a capa.
- **Adicionar:**
  - vira um item do catálogo validado pelo mesmo `portSchema`, com id `meu-…`, gravado na tabela `custom_ports` (migração 17);
  - o console vem da lista das categorias (`platform` = ícone, `system` = nome), então o jogo instalado cai na categoria certa;
  - sem `executable`, o instalador escolhe o `.exe` principal;
  - a regra precisa achar um arquivo na versão mais recente.
- **Na Loja:** os adicionados entram depois do catálogo, com o selo "Seu" e o aviso "sem curadoria". O catálogo vence se passar a trazer o mesmo projeto ou id.
  - "Remover da Loja" só funciona com o port desinstalado e sem instalação em andamento.
  - "Exportar catalog.json" leva os adicionados sem a marca `custom`, que é o jeito de passá-los para o repositório do catálogo.
- Testado de verdade: `RadzPrower/Super-Metroid-Launcher` foi adicionado pela tela, instalado (o `.exe` foi achado sozinho) e caiu na categoria SNES.

**Repositório do catálogo online (`npm run catalog:repo`):**
- **O que gera:** monta (ou atualiza) `../retrovault-catalog`, pronto para `git init` e push, com:
  - `catalog.json`, gerado do catálogo embutido, com `$schema`;
  - `tools/validate.mjs`, o `parseCatalog` do app empacotado com o esbuild num arquivo só, sem `npm install` no repositório. Ele também recusa o mesmo repositório em dois ids e tolera BOM;
  - `catalog.schema.json` (draft-07), para o VS Code sugerir campos e marcar erros;
  - `.github/workflows/validate.yml`, que valida a cada push e pull request;
  - `README.md` público: aviso de que nada é hospedado ali, crédito em texto ao Quiver Launcher (sem logo nem marca) e a lista de ports por console. Cada linha tem o link do projeto e do autor, o que o port pede e se foi feito com IA;
  - a lista sai de `scripts/catalog/readme.ts` (`renderReadme`), lida do `catalog.json` **da pasta** e não do catálogo embutido, para que uma edição feita no repositório também apareça nos créditos;
  - coluna "No Quiver", com o link da página de cada port no Quiver Launcher;
  - `MANUTENCAO.md` com o passo a passo (publicar pelo site do GitHub ou com Git, link raw, Configurações → Loja → "Testar e usar", campos de um port).
- **Proteção:** nunca sobrescreve um `catalog.json` existente sem `--force`. O validador, o schema, o workflow, o guia e o README são sempre atualizados.
- **Testes** (`catalogRepo.test.ts`):
  - o schema do editor tem os mesmos campos, obrigatórios e plataformas que o app;
  - o catálogo embutido passa no schema (`ajv`);
  - o arquivo exportado volta inteiro pelo caminho online, com `$schema` e BOM.
- **Exportar:** "Exportar catalog.json" (Configurações) gera o mesmo formato, com `$schema`.

**Atualizações dos ports:**
- **Verificação de fundo** (`checkPortUpdates` no container): 1 min depois de abrir e a cada 6 h. Usa as versões em cache (1 h, com ETag) e emite `store:updates-changed`.
  - Notificação do Windows uma vez por versão nova de cada port. A versão avisada fica em `notified-update:<port>` no cache por 1 ano.
  - A notificação pode ser desligada em Configurações → Loja (`notifyPortUpdates`, ligada por padrão).
- **"Atualizar tudo"** (`InstallService.updateAll`, `store:update-all`): instala um port de cada vez, com o progresso pelo mesmo evento da instalação avulsa.
  - Ficam de fora os ports de instalador, que pedem interação, e os abertos agora.
  - Uma falha vira item da lista, sem interromper os outros. A versão anterior de cada um continua guardada para voltar.
- **Tela:**
  - selo com o número de atualizações no ícone da Loja;
  - "Atualizar tudo (N)" no topo da Loja, com um resumo do que ficou de fora e por quê;
  - aviso "Versão nova do port" na página do jogo, com atalho para a página do port.
- Testado de verdade: OpenTyrian instalado na versão anterior apareceu nos três lugares, e o "Atualizar tudo" levou à versão nova e apagou o selo.

**Arte da biblioteca (busca online e enquadramento):**
- **SteamGridDB:** o cliente saiu da Loja para `store/steamGridDb.ts` (busca, melhor resultado, imagens por tipo) e é usado pela Loja e pelo `GameArtService`.
- **Busca em "Editar arte":** várias opções de capa, fundo (hero) e ícone, com a lista de jogos parecidos para trocar se o primeiro não for o certo.
  - As miniaturas são baixadas pelo main para o cofre, sem registro em `store_art`: o que não for escolhido sai na limpeza de artes.
  - Aplicar só aceita imagens de `cdn2.steamgriddb.com`.
- **Automático:** jogo de PC adicionado à biblioteca ganha capa, fundo e ícone se houver chave.
  - Só preenche o que está vazio, e o ícone só se for o padrão do `.exe`.
  - ROMs ficam com a arte do RetroAchievements.
  - Ports da Loja ficam com a arte da Loja (`gameAdded(id, 'store')`).
  - A grade da biblioteca ganhou "Buscar artes (N)" para os jogos de PC sem capa.
- **Editor de enquadramento (`FramingEditor`):** "Ajustar…" em cada arte do cofre.
  - Modos: preencher (arrastar ou setas e zoom, com o recorte sempre dentro da imagem), caber inteira com fundo desfocado, ou caber com fundo escuro.
  - Monta num canvas no tamanho final (capa 900×1200, fundo 1920×840, ícone 512×512) e envia em base64 (`games:set-artwork-data`). O main confere a assinatura (PNG/JPEG) e guarda leve.
  - **Protocolo:** o `rv-media` passou a ter `corsEnabled` e responde com `Access-Control-Allow-Origin`, senão o canvas não exportaria.
- **Sem chave:** a busca explica e leva a Configurações → Loja; o enquadramento funciona sem chave.

**Imagens dos ports sem capa:** 81 dos 87 ports têm imagem sem precisar da chave do SteamGridDB.
- **De onde vem:** o próprio repositório de cada projeto (logo, ícone, banner ou capa da Steam do projeto), escolhida a mão e posta em `art.logo`. O logo não vira capa do jogo instalado, porque um banner largo cortado em 3:4 ficaria ruim.
- **Ícone do Windows:** `.ico` vale como logo; a Loja usa o PNG de 256 px de dentro dele (`pngFromIco`), ou converte o maior bitmap de 32 bits. Ícones só com bitmap de paleta não servem.
- **Peso:** logos e ícones grandes são guardados reduzidos para no máximo 512 px, mantendo a transparência (`ArtworkService.saveGraphic`).
- **Lista da Loja:** sem ícone nem capa, o bloco mostra o logo. A regra `.cascade__icon > img` deixou de cortar em quadrado as capas e logos do bloco.
- **Arquivo apagado do cofre:** a arte em cache confere se os arquivos ainda existem (`ArtworkService.has`) e, se algum sumiu, baixa de novo em vez de mostrar imagem quebrada.
- **Ainda sem imagem:** NSMBU (só o ícone padrão do SDL), Geometry Wars RE2 e Dragon's Crown Pro (ícone de controle genérico), e Hyrule Warriors DE (nenhuma imagem). DriveClub e Viva Piñata saíram dessa lista quando o `pngFromIco` passou a converter bitmaps de 32 bits. Eles dependem da chave do SteamGridDB.

**Categorias de console:**
- **Uma pronta para cada console** (`shared/consoleCategories.ts`, 42 consoles), com o nome que a detecção de plataforma devolve e os seus apelidos ("PS4", "SNES"…).
- **Migração 16:** cria a coluna `categories.console` e a tabela `console_categories_seeded`.
  - Cada console é oferecido só uma vez: o que o usuário apagar não volta.
  - Uma categoria que ele já tinha com o nome ou apelido do console é **ligada** a ele, sem duplicar. O nome continua o dele.
- **Ícones:** cada console tem o seu.
  - Desenhos próprios: Vita, Wii U, Xbox 360, Virtual Boy, Saturn, Sega CD, PC Engine, Lynx, Neo Geo Pocket, WonderSwan, ColecoVision, Vectrex, MSX e Pokémon Mini.
  - Gerações de uma família usam o desenho da família com um selo no canto: PS2/3/4, GBC "C", Master System "MS", Game Gear "GG", 32X, PC Engine CD, Atari 7800.
  - A categoria ligada a um console usa o ícone dele, mesmo renomeada.
- **Ports da Loja** entram na categoria do console original. "PlayStation 2" no `system` vence a família, e os ports já instalados são categorizados ao abrir o app.
- **Tela inicial e grade:**
  - só mostram categorias com algum jogo (a escolhida fica mesmo se esvaziar);
  - a faixa de abas é uma linha só, que rola com a roda do mouse, esmaece na borda e rola até a aba escolhida;
  - "Gerenciar categorias" continua mostrando todas, e o seletor de categorias do jogo ganhou busca.

**Marcação de IA** (`ai` no catálogo): `generated` mostra o selo "Gerado por IA" e pede confirmação antes de qualquer download (`useAiGuard`, explicando o risco); `assisted` mostra um selo discreto.

**Conta do GitHub** (Configurações → Conta do GitHub). É o mesmo vínculo que o Quiver Launcher oferece; o Quiver não tem conta própria, só tokens do GitHub, GitLab e Codeberg.
- **Para que serve:** com um token, o limite sobe de 60 para **5.000 consultas por hora**.
- **Que token:** fine-grained, só com acesso a "Public repositories" e nenhuma permissão. A tela traz o passo a passo e um atalho para a página do GitHub.
- **Validação:** `github:connect` confere o token em `/user` antes de guardar, então um token recusado nunca é salvo e dá erro `GITHUB_AUTH`.
- **Armazenamento:** o token é cifrado com DPAPI (`safeStorage`), como a API key do RA. A tela só recebe o usuário (`Settings.githubLogin`).
- **Token revogado ou expirado depois:** a consulta é refeita sem conta, então a Loja continua funcionando.
- **Contador:** a seção mostra quantas consultas restam e quando o limite renova (`/rate_limit`, que não gasta consulta).
- **Atalho na Loja:** se o limite sem conta acabar, a Loja mostra o botão "Conectar conta do GitHub".

**Segurança:** o renderer pede tudo pelo id do port (`store:releases`). O repositório e as URLs saem do catálogo no main, então o renderer nunca escolhe para onde o app se conecta.

## Cofre de saves (`services/saves/`)

Os saves de cada jogo são copiados para uma pasta **separada dos jogos**. O padrão é `Documentos\RetroVault\Saves`, e ela pode ser trocada em Configurações por uma pasta do OneDrive ou do Google Drive. Se o jogo for apagado e reinstalado, o save continua lá.

- **Detecção (`saveLocator.ts`):**
  - ports de PS4: `<exe>\user\savedata`;
  - na pasta do jogo: `save*.bin/.sav/.dat`, `*.sav`, `*.srm` e pastas `saves`/`SaveGames`. Não pega `game.bin`, que costuma ser dado do jogo;
  - pastas do Windows: `Documentos\My Games\<jogo>`, `Saved Games\<jogo>` e o padrão da Unreal (`LocalAppData\<jogo>\Saved\SaveGames`);
  - ROMs: `.srm`/`.state*` com o nome da ROM nas pastas do RetroArch (inclusive subpastas por core) ou ao lado da ROM.
  - O usuário pode adicionar locais ou ignorar os detectados (tabela `save_paths`, migration 7).
- **Cofre (`saveVault.ts`):** `<cofre>\<Título>\identity.json` + `<AAAAMMDD-HHMMSS-motivo>\manifest.json` + `data\N\…`.
  - Cada versão é gravada numa pasta temporária e renomeada no fim, então nunca fica pela metade.
  - Uma impressão digital (tamanho + data de cada arquivo) evita versões repetidas. Ficam as últimas 15.
  - Limite de 2 GB / 50 mil arquivos, para não copiar o jogo inteiro por engano.
- **Reinstalação:** o jogo é reconhecido por título + nome do exe/ROM. Se o nome do arquivo for genérico (`main.exe`), o título é obrigatório, para que dois jogos diferentes não dividam o mesmo save.
  - Os caminhos são guardados relativos à pasta do jogo (ou do RetroArch), então a restauração funciona numa reinstalação em outro lugar.
  - A página do jogo mostra "Encontramos N backups de uma instalação anterior" com o botão **Restaurar o mais recente**.
- **Quando faz backup:** ao fechar o jogo (fim da árvore de processos), a cada 15 min (pega jogos abertos fora do RetroVault), na inicialização e manualmente. Os automáticos só gravam se o save mudou.
- **Restaurar:** recusado com o jogo aberto. Antes, o save atual vira uma versão "antes de restaurar". Nunca apaga a pasta do jogo nem algo acima dela.
- **Trocar a pasta do cofre (`moveVaultRoot`):** move os backups (renomeia no mesmo disco, copia e apaga entre discos). Recusa pastas não vazias e pastas uma dentro da outra.

### Nuvem (`services/cloudService.ts`)

A nuvem usa o **aplicativo de sincronização que já está no PC**, sem OAuth nem tokens no RetroVault. O cofre passa a ficar em `<pasta sincronizada>\RetroVault\Saves`, e o OneDrive, o Google Drive ou o Dropbox envia, guarda o histórico de versões e leva para outros PCs.

- **Detecção:**
  - OneDrive: `reg query HKCU\Software\Microsoft\OneDrive\Accounts` (conta pessoal primeiro) e `%OneDrive%`;
  - Google Drive: unidade virtual `X:\Meu Drive`/`My Drive` ou a pasta espelhada;
  - Dropbox: `info.json`.
  - O estado do aplicativo vem do `tasklist`. Se ele estiver fechado, a UI avisa e oferece "Abrir" (o OneDrive abre com `/background`).
- **Conectar:** `mergeVaultInto(local, nuvem)`. Num segundo PC, a pasta já tem o cofre do primeiro: entram só jogos e versões que faltam, nada é sobrescrito, e o cofre local é removido no fim.
  - No OneDrive, `attrib +P -U` ("Manter sempre neste dispositivo") impede que o Files On-Demand deixe os backups só na nuvem, o que faria a restauração falhar com o OneDrive fechado.
- **Desconectar:** copia de volta para `Documentos\RetroVault\Saves` e **mantém** a cópia na nuvem.
- **Progresso também:** `retrovault-progresso.json` (troféus e tempo de jogo) é exportado em `<cofre>\..\Progresso` na inicialização, diariamente e ao fechar cada jogo, então sobe junto.

## Backup e progresso

Troféus e tempo de jogo só existem no banco local, então ele é protegido em três camadas.

- **Backups do banco (`services/backupService.ts`):** ficam em `%APPDATA%\RetroVault\backups` e são gerados com `VACUUM INTO`, que faz uma cópia consistente mesmo com WAL e compacta o arquivo.
  - **Diário:** na inicialização e a cada 6 h. Ficam os últimos 7.
  - **Manual:** ficam os últimos 10.
  - **Antes de atualizar:** é feito quando há migrations pendentes num banco existente (gancho `beforeMigrate` de `openDatabase`).
  - **Antes de restaurar:** guarda o estado atual quando um backup é restaurado.
- **Restaurar em duas fases:** o backup é validado (tabelas e `integrity_check`) e copiado para `retrovault.db.restore`, e o app reinicia. No início, *antes de abrir o banco*, `applyPendingRestore` guarda o estado atual e troca o arquivo. Um SQLite aberto nunca é substituído.
- **Arte:** a limpeza de arte preserva imagens referenciadas pelos backups. Sem isso, restaurar traria ícones quebrados.
- **Exportar/importar progresso (`services/progressService.ts`):** um JSON versionado (`format: "retrovault-progress"`, `version: 1`) com tempo de jogo e troféus obtidos, para levar a outro PC ou sobreviver a uma reinstalação.
  - A importação **mescla**: fica o maior tempo de jogo, e os troféus que faltam são desbloqueados com a data original. Nada é apagado.
  - Os jogos são casados pelo NPCommID, depois pelo caminho e depois pelo título único, então um jogo movido de pasta continua sendo reconhecido.
- **IPC:** `backup:list`, `backup:create`, `backup:restore`, `backup:open-folder`, `progress:export` e `progress:import`. Os diálogos de arquivo rodam no main.

## Arte dos jogos

- **Ícone de executáveis:** o `peIcon.ts` lê a seção de recursos do PE (`RT_GROUP_ICON` / `RT_ICON`) e extrai o maior ícone, geralmente de 256px. Ícones antigos em bitmap são embrulhados em um `.ico` e convertidos para PNG com o `nativeImage`. Se não houver ícone embutido, usa o ícone do shell. Nos atalhos `.lnk`, usa o ícone ou o alvo do atalho.
- **Capa, fundo e ícone personalizados:** ficam em `%APPDATA%\RetroVault\artwork\<md5>.<ext>` e são servidos por `rv-media://artwork/...`. O nome é o hash do conteúdo, o que deduplica imagens repetidas e evita cache desatualizado. Arquivos que nenhum jogo usa mais são apagados ao iniciar o app.
- **Arte do dump de PS4 (`trophies/dumpArtwork.ts`):** o dump é localizado pelo mesmo `TrpLocator` dos troféus. Dele vêm o `sce_sys/icon0.png` (512×512) como ícone e o `sce_sys/pic1.png` (1920×1080) como fundo. Isso é aplicado ao adicionar o jogo, ao mudar os argumentos e ao abrir o app.
  - O fundo só é preenchido se estiver vazio.
  - O ícone só substitui o ícone extraído do `.exe`. Como a arte é endereçada pelo hash do conteúdo, basta comparar as URLs, sem coluna de origem no banco.
  - A capa não é tocada: o `icon0` é quadrado e seria cortado no formato retrato. Sem capa, o card mostra o ícone inteiro sobre um fundo desfocado.
  - O serviço devolve só caminhos, e a imagem é importada apenas quando é aplicada. Assim a limpeza de arte não fica apagando e regravando ~3 MB por jogo a cada inicialização.
- **Prioridade:** uma arte personalizada nunca é sobrescrita, nem pelo dump de PS4 nem pelo vínculo com o RetroAchievements. Ao restaurar o padrão, volta a arte do dump, depois a do RetroAchievements ou o ícone do executável.

## Troféus locais (estilo PS4/shadPS4)

São para jogos que não estão no RetroAchievements, como ports nativos de PS4 e jogos de PC.

- **PS3 (RPCS3) e PS Vita (Vita3K)** (`trophies/emulatorTrophies.ts`): o emulador já guarda a lista e os desbloqueios, e o RetroVault só lê, sem escrever nada nas pastas dele.
  - **Onde acha:**
    - **RPCS3:** o jogo é o `rpcs3.exe` com o `EBOOT.BIN` (ou a pasta do jogo) nos argumentos. O ID (`NPWR…`) vem de `PS3_GAME\TROPDIR` ou `<ID>\TROPDIR`; a lista fica em `dev_hdd0\home\<usuário>\trophy\NPWR…`, respeitando o `vfs.yml`. Sem o jogo nos argumentos (ex.: ISO), vale o nome, se um único conjunto bater.
    - **Vita3K:** o jogo é o `Vita3K.exe -r <ID>`. O ID dos troféus vem de `ux0\app\<ID>\sce_sys\trophy`; a pasta de dados vem do `pref-path` do `config.yml`, da pasta portátil ou de `%APPDATA%\Vita3K\Vita3K`.
  - **Lista:** `TROPCONF.SFM` mais o idioma (`TROP_17` = português do Brasil, depois `TROP_07` e `TROP`), em XML sem criptografia, sem trophy key; e os ícones `TROPnnn.PNG`/`ICON0.PNG`.
  - **`TROPUSR.DAT`**, com o formato conferido no código de cada emulador:
    - RPCS3: big-endian, tabela tipo 6 de 112 bytes por troféu, data em `CellRtcTick` (µs desde o ano 1);
    - Vita3K: 128 bits de desbloqueio e datas em segundos Unix a partir do byte 112.
  - **Sincronização:**
    - ao importar e ao abrir o app, sem notificação;
    - a cada 3 s enquanto o jogo roda, pela data de modificação, com notificação na hora;
    - uma última leitura ao fechar.

    Usa a data do emulador. Nunca rebloqueia, e não dá para marcar à mão.
  - **Primeira vez:** o emulador só cria a pasta quando o jogo roda nele. Ao fechar o jogo, a importação automática tenta de novo.
  - **Banco (migração 19):** colunas `emulator` e `progress_path`, sem recriar a tabela. Recriar apagaria os troféus em cascata, e o `CHECK` antigo de `source` continua.
    - No banco, a lista fica `'ps4'` + o emulador. O repositório devolve `source: 'rpcs3' | 'vita3k'`.
    - A busca de log de ports ignora essas listas.
  - **Testes:** `emulatorTrophies.test.ts`, com pastas no layout dos emuladores (`testing/emulatorTrophyFixtures.ts`).
  - **Validado no app empacotado** com um RPCS3 de teste: importação sozinha em português, com a data do emulador; um troféu gravado no `TROPUSR.DAT` com o jogo aberto virou aviso na hora.
  - Ideia trazida do [Taiga Launcher](https://github.com/GabrielTaiga/Taiga-Launcher-for-Steam) (GabrielTaiga, Apache-2.0); código escrito do zero a partir dos formatos dos emuladores.

- **Importação (`trophies/trp.ts`):** lê o `sce_sys/trophy/trophy00.trp` do dump.
  - Os PNGs de ícone (`TROPxxx.PNG`, `ICON0.PNG`) estão abertos.
  - Os XMLs (`TROPCONF`, `TROP`, `TROP_17` = pt-BR) vêm como `.ESFM` cifrados e são decifrados como no shadPS4: `trpKey = AES-CBC(trophyKey, iv=0)(NPCommID)` e depois `XML = AES-CBC(trpKey, iv=16 primeiros bytes)`.
  - O NPCommID vem do `sce_sys/npbind.dat`.
  - A trophy key é do console do usuário, fica cifrada com DPAPI e nunca vai para o renderer.
- **Importação automática (`trophies/trpLocator.ts`):** ao adicionar um jogo, ao abrir o app e ao cadastrar a trophy key, o RetroVault procura o `trophy00.trp` sozinho, nesta ordem:
  1. o arquivo do jogo está dentro do dump (`eboot.bin`, exe dentro da pasta `CUSAxxxxx`);
  2. um argumento de inicialização aponta para o dump (`shadPS4.exe -g "…\eboot.bin"`);
  3. há um dump ao lado do executável (`<port>\..\CUSAxxxxx`);
  4. o launcher do port guardou a pasta em `%APPDATA%\<launcher>\settings.json` (ex.: `gow3-launcher` → `game_dir`), ou o shadPS4 em `installDirs`.
  - As estratégias 3 e 4 só são aceitas quando o Title ID do dump (lido do `param.sfo`) aparece perto do executável (`user\savedata\1\CUSAxxxxx`, `user\last_run.log`) ou quando o nome do launcher bate com um arquivo do port (`gow3-launcher` ↔ `gow3.ini`). Isso evita colocar troféus de outro jogo.
  - Se o usuário remover a lista, o jogo entra em `trophy_auto_import_optout` (migration 4) e a lista não é recriada. Importar ou criar uma lista de novo tira o jogo dessa tabela.
- **Detecção automática (`trophies/trophyLogWatcher.ts`):** vigia o log do jogo a cada 2 s e procura `trophy (\d+) unlocked`. Ports no padrão bloodborne_pc/gow3_pc escrevem `Runtime: trophy N unlocked` em `user/last_run.log`, e esse caminho é detectado sozinho.
  - O vigia não depende do processo do jogo, então funciona mesmo se o jogo for aberto fora do RetroVault ou por um launcher intermediário (o `God of War III.exe` e o `Bloodborne.exe` abrem o `*-probe.exe`, que é quem escreve o log).
  - O port só cria a pasta `user\` na primeira vez que roda. Por isso, a cada ~30 s o vigia procura logs de listas que ainda não têm um e liga a detecção sozinho. Se você clicar em "Desativar", a detecção não é religada (`trophy_sets.log_disabled`, migration 5).
  - O port trunca o log a cada partida, sem mudar a data de criação nem o cabeçalho. Por isso o vigia guarda um cursor e o hash do último 1 KB lido para detectar quando o arquivo foi reescrito, e só processa linhas completas.
- **Platina:** como no PS4, é concedida automaticamente quando todos os outros troféus são obtidos.
- **Página geral (Conquistas → aba Troféus):** mostra o nível no estilo PSN, a contagem de platinas, ouros, pratas e bronzes, os jogos com progresso e os 30 troféus mais recentes.
  - O endpoint `trophies:overview` agrega tudo em duas consultas: um `GROUP BY` por jogo e grau, e os recentes pelo índice parcial `idx_trophies_unlocked` (migration 6). A lista de cada jogo não é carregada.
  - O percentual é ponderado por pontos, como no PS4: B 15, P 30, O 90, Platina 300.
  - O nível segue a tabela da PSN de 2020: 60 pontos por nível até o 99, 90 até o 199, 450 até o 299, depois +450 a cada centena, até o 999.
  - A aba escolhida fica na URL (`/profile?tab=ra`). As abas seguem o padrão WAI-ARIA (`components/ui/Tabs.tsx`).
- **Modo manual:** dá para marcar e desmarcar qualquer troféu, ou criar uma lista própria (nome, descrição, grau, oculto) para jogos sem `.trp`.
- **Tabelas (migration 3):** `trophy_sets` (fonte, NPCommID, log monitorado, cursor) e `trophies` (grau P/G/S/B, oculto, ícone, `unlocked_at`, `unlock_source` auto/manual).

## Visual (macOS Sonoma, modo escuro)

- **Janela:** a barra de título fica integrada ao conteúdo (`titleBarStyle: 'hidden'`), com os botões nativos do Windows por cima (`titleBarOverlay` com fundo transparente, para escurecerem junto quando uma janela modal abre).
  - No Windows 11 22H2 ou mais novo, o material **Acrylic** do sistema aparece através da barra lateral, como a "vibrancy" do macOS. O main avisa o renderer por `?material=acrylic`; sem suporte, a barra lateral fica sólida.
- **Estrutura:** barra lateral única no estilo Finder/Música (navegação, busca, jogos e perfil no rodapé) e uma barra de título com ‹ › (voltar/avançar) e o título da tela (`components/layout/AppSidebar.tsx` e `Titlebar.tsx`).
- **CSS por camada** (`src/renderer/src/styles/`), importado por `index.css` nesta ordem:
  - `tokens.css`: cores do sistema, raios, sombras e fontes. **Todo o tema sai daqui.**
  - `base.css`: reset, tipografia, barras de rolagem finas e utilitários.
  - `layout.css`: janela, barra lateral e barra de título.
  - `controls.css`: botões, campos, interruptor, controle segmentado e abas.
  - `feedback.css`: carregamento, estados, progresso, notificações e janelas (folhas).
  - `features.css`: as telas.
- **Fonte:** Inter (variável), embutida no app via `@fontsource-variable/inter`, então funciona offline e respeita a CSP `font-src 'self'`. Fora do Mac é a mais próxima da San Francisco.
- **Animações:** só `transform` e `opacity` são animados (a GPU compõe, sem redesenhar a cada quadro). Curvas e durações vêm de `tokens.css` (`--ease-out`, `--ease-spring`, `--dur-*`).
  - **Grade:** ao passar o mouse, a capa sobe, a imagem aproxima de leve e uma sombra pronta (`.game-card::before`) aparece por opacidade.
  - **Tela inicial:** o bloco tem sempre 136px e é reduzido por `scale`. Só a caixa externa muda de largura para empurrar os vizinhos. O contorno e o brilho do selecionado ficam numa camada (`::after`) que só muda a opacidade. Título, subtítulo e cartões entram de novo a cada jogo (`key`), e o fundo faz uma transição cruzada de 0,9s.
  - **Preferência "Animações"** (Configurações → Preferências, guardada em `localStorage` `rv.motion`), aplicada no `<html data-motion>` antes do primeiro render:
    - *Seguir o Windows* (padrão): com "Efeitos de animação" desligado no Windows, o Chromium informa `prefers-reduced-motion` e o app troca de estado sem animar.
    - *Sempre suaves*: anima mesmo assim. Muitos PCs desligam esses efeitos para "otimizar".
    - *Reduzidas*: nunca anima.

## Emuladores próprios por console (`services/emulatorService.ts`, `shared/emulators.ts`)

- **Catálogo:** DuckStation (PS1), PCSX2 (PS2), PPSSPP (PSP), Dolphin (GameCube/Wii), melonDS (DS), mGBA (GB/GBC/GBA) e Flycast (Dreamcast). Os parâmetros foram conferidos no código de cada um:
  - PCSX2/DuckStation: `-batch [-fullscreen] -- <rom>`;
  - Dolphin: `-b [-C Dolphin.Display.Fullscreen=True] -e <rom>`;
  - PPSSPP: `[--fullscreen --escape-exit] <rom>`;
  - melonDS/mGBA: `[-f] <rom>`.

  O modo batch fecha o emulador junto com o jogo, o que mantém o tempo de jogo certo.
- **Quem abre cada console** (Configurações → Emuladores): "Automático", "RetroArch" ou um emulador do catálogo.
  - O automático fica no RetroArch, exceto quando ele não tem core para o console e um emulador próprio está instalado.
  - Emulador escolhido e não instalado dá erro claro (`EMULATOR_NOT_FOUND`), em vez de abrir em outro.
  - Tela cheia é uma opção só (ligada por padrão).
  - A configuração fica em `settings`, na chave `emulators.config`.
- **Encontrar:** só nas pastas de instalação conhecidas (Arquivos de Programas, `%LOCALAPPDATA%\Programs` e Scoop), sem varrer o disco, ou por "Procurar…" (seletor no main). Um caminho indicado e apagado volta a usar o encontrado sozinho.
- **Abrir:** o `LauncherService` pergunta ao `EmulatorService` antes do RetroArch, e o resto da sessão é igual: tempo de jogo, Discord e conquistas. As conquistas dependem da conta do RetroAchievements configurada no próprio emulador; melonDS e mGBA não têm.
- **GameCube (16) e Wii (19)** entraram no catálogo de consoles, com IDs do `rc_consoles.h`. São reconhecidos:
  - pela extensão (`.gcm`/`.gcz`, `.wbfs`/`.wad`);
  - pela assinatura do disco num `.iso` (`0xC2339F3D` em 0x1C, `0x5D1C9EA3` em 0x18);
  - pela pasta (`GameCube`, `Wii`).

  `.rvz`/`.ciso` precisam da pista da pasta.
- **Página do jogo:** "PlayStation 2 · abre no PCSX2".
- **Validado no app empacotado** com um "PCSX2" de teste que registra os argumentos:
  - o executável foi escolhido pela janela nativa;
  - recebeu `-batch -fullscreen -- "<rom com espaços>"`;
  - a sessão contou os 15 s e terminou quando ele fechou.
- Lista inspirada no Taiga Launcher (GabrielTaiga, Apache-2.0); código escrito do zero.

## Discord: "Jogando RetroVault" no perfil (`services/discord/`)

- **O que aparece:** enquanto um jogo aberto pelo RetroVault roda, o perfil do Discord mostra:
  - o nome do jogo;
  - a plataforma, a mesma das categorias, ou "PC";
  - há quanto tempo a pessoa joga;
  - uma imagem pública.

  Ao fechar o jogo, a atividade some.
- **Imagem:** o Discord só mostra imagens da internet (`isDiscordImage`: https, png/jpg/gif/webp). Vale, nesta ordem:
  - a capa do RetroAchievements, nas ROMs vinculadas;
  - a capa ou o logo do catálogo, nos ports da Loja;
  - o `icon.png` do repositório de versões, que o `release:check` copia para lá.

  Quando o jogo tem capa, o ícone do RetroVault aparece pequeno no canto.
- **Protocolo** (`discordRpc.ts`): o Rich Presence pelo canal local do app do Discord (`\\?\pipe\discord-ipc-0…9`), com quadros `[operação int32][tamanho int32][JSON]`:
  - aperto de mão com o ID do aplicativo;
  - `SET_ACTIVITY` com nonce, que espera a resposta;
  - responde aos pings.

  Nada sai pela internet a partir do RetroVault.
- **Nunca atrapalha o jogo** (`discordPresence.ts`): sem Discord aberto, desligado ou sem ID, não faz nada.
  - Se o Discord abrir depois do jogo, tenta de novo a cada 60 s.
  - Os envios saem em fila, e abrir e fechar rápido não inverte a ordem.
  - Ao sair do app, a conexão é fechada.
- **Configuração:** Configurações → Preferências → "Mostrar no Discord o que estou jogando" (`discordPresence`, ligada por padrão).
- **ID do aplicativo** (`discordConfig.ts`): `1563711410733846598`, público, do aplicativo "RetroVault" no portal de desenvolvedores do Discord. `RETROVAULT_DISCORD_CLIENT_ID` troca o ID nos testes.
- **Validado ao vivo:**
  - O Discord aceitou o ID e as imagens por URL; ele mesmo as serve, por `mp:external/…`.
  - No app empacotado, um "jogo" de 20 s apareceu como "Teste do RetroVault (PC)" e a atividade foi limpa uns 2 s depois de fechar.
  - O registro mostra `[discord] mostrando …` e `[discord] atividade limpa`.
- **Testes:** um Discord falso no mesmo protocolo, num canal de teste (`discord.test.ts`), cobre:
  - aperto de mão, atividade e limpeza;
  - ID recusado;
  - Discord fechado e aberto depois;
  - desligar e religar no meio do jogo;
  - quadros pela metade.
- Ideia trazida do [Taiga Launcher](https://github.com/GabrielTaiga/Taiga-Launcher-for-Steam) (GabrielTaiga, Apache-2.0); código escrito do zero.

## Instalador e atualização automática

- **Instalador** (`npm run dist`): NSIS em português, só para o usuário (sem administrador), com escolha de pasta e atalhos
  na Área de Trabalho e no Menu Iniciar. Gera `release/RetroVault-Setup-<versão>.exe`, o `.blockmap` e o `latest.yml`.
  Desinstalar mantém `%APPDATA%\RetroVault` (`deleteAppDataOnUninstall: false`).
- **Ícone:** `build/icon.svg` (cartucho com fechadura) → `build/icon.png` por `npm run icon` (renderizado pelo Chromium
  do Electron). O electron-builder gera o `.ico` do instalador e do `.exe`.
- **winCodeSign no Windows sem administrador:** o pacote traz links simbólicos de macOS que o Windows não deixa criar,
  e o build falha. Solução usada: extrair `winCodeSign-2.6.0.7z` em `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`
  com `-xr!darwin`. Isso é feito uma vez por máquina.
- **Atualização** (`services/appUpdateService.ts`, electron-updater 6.3.9): procura nas Releases de
  `github.com/yagomanara1/retrovault` 30 s depois de abrir e a cada 6 h; baixa sozinho (confere o SHA-512 do
  `latest.yml`). A faixa "Reiniciar e atualizar" (`AppUpdateBanner`) e a seção "Atualizações do RetroVault" nas Configurações
  chamam `quitAndInstall(true, true)`: instalação silenciosa e app reaberto. Fechar o app também instala, sem reabrir.
  - **Só no app instalado:** a pasta `win-unpacked` e o modo dev ficam em `disabled`. O teste é se o desinstalador está
    ao lado do `.exe`, e assim o electron-updater nem é carregado.
  - **Não reinicia no meio de uma instalação de port** (`busyReason`).
  - **Teste local:** `RETROVAULT_UPDATE_FEED` aponta para um servidor no próprio PC (só aceita `127.0.0.1`/`localhost`);
    `RETROVAULT_USER_DATA_DIR` troca a pasta de dados, inclusive quando o instalador reabre o app.
  - Validado de ponta a ponta: 0.1.0 instalado → achou a 0.1.1 → baixou → "Reiniciar e atualizar" → reabriu na 0.1.1
    em cerca de 10 s → desinstalação limpa (pasta, atalhos, registro), com os dados preservados.
- **Publicar** (`npm run release:check`): confere que o `latest.yml` é desta versão e que o hash e o tamanho são os
  do instalador, recusando se não forem, e que o `icon.png` da raiz (usado pelo Discord) é o mesmo do app. O código
  e as versões ficam no mesmo repositório; passo a passo em [PUBLICAR.md](PUBLICAR.md).

## Segurança

- `contextIsolation` e `sandbox` ligados, `nodeIntegration` desligado. O preload expõe apenas os canais da whitelist.
- Todas as entradas IPC são validadas com zod. O main recusa chamadas de qualquer frame que não seja o do próprio app.
- A CSP permite imagens somente de `media.retroachievements.org`. Navegação para fora do app é bloqueada e links externos abrem no navegador.
- A Web API Key é cifrada com `safeStorage` (DPAPI no Windows) e nunca volta para o renderer.

## Limitações conhecidas (MVP)

- **Executáveis de PC não têm conquistas no RetroAchievements.** Funciona apenas com emuladores que têm RetroAchievements integrado (PCSX2, DuckStation, PPSSPP, Dolphin…): adicione o emulador ou um `.bat` e vincule o jogo manualmente.
- **Identificação automática:** ainda não funciona para CHD e PBP de PS1 (discos compactados), Dreamcast, PC Engine CD e `.7z`/`.rar`. Esses precisam ser vinculados manualmente, por busca ou pelo ID. Cartuchos (também dentro de `.zip`), Arcade, Nintendo DS e os discos de PS1, PS2, PSP, Sega CD e Saturn são identificados sozinhos.
- **Tempo de jogo:** vale enquanto a árvore de processos do jogo estiver viva (`services/processTree.ts`), então funciona com launchers que abrem o executável real (`God of War III.exe` → `gow3-probe.exe`) e fecham em seguida.
  - Um único PowerShell de longa duração lista os processos a cada 2 s, só enquanto há sessão ativa, e termina sozinho se o RetroVault morrer.
  - Um processo entra na sessão se descende dela (o PPID de órfãos continua valendo) ou se o executável está na pasta do jogo e foi criado enquanto o launcher estava aberto.
  - Se o PowerShell não estiver disponível, a medição volta a usar só o processo inicial.
  - Jogos abertos fora do RetroVault não contam tempo, mas os troféus continuam sendo detectados.
- **Atraso das notificações:** depende do envio do RetroArch e do intervalo de consulta de 30 s.

## Próximos passos para escalar

- Hash de CHD (zlib/LZMA/FLAC/Huffman por bloco), Dreamcast (GDI) e PC Engine CD.
- Detecção da árvore de processos (para launchers que abrem filhos) no cálculo do tempo de jogo.
- Varredura de pastas em lote com fila de workers (`worker_threads`) para calcular hashes.
- Virtualização da lista da sidebar (`@tanstack/react-virtual`) para bibliotecas com mais de 5 mil jogos.
