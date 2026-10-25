export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Migrations são append-only: nunca edite uma já publicada, crie uma nova versão.
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE games (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT    NOT NULL,
        kind             TEXT    NOT NULL CHECK (kind IN ('retroarch', 'executable')),
        path             TEXT    NOT NULL UNIQUE,
        core_path        TEXT,
        launch_args      TEXT,
        console_id       INTEGER,
        ra_game_id       INTEGER,
        rom_hash         TEXT,
        cover_url        TEXT,
        icon_url         TEXT,
        favorite         INTEGER NOT NULL DEFAULT 0,
        playtime_seconds INTEGER NOT NULL DEFAULT 0,
        last_played_at   TEXT,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_games_ra_game_id ON games (ra_game_id);
      CREATE INDEX idx_games_last_played ON games (last_played_at DESC);

      CREATE TABLE play_sessions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id          INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        started_at       TEXT    NOT NULL,
        ended_at         TEXT,
        duration_seconds INTEGER
      );
      CREATE INDEX idx_play_sessions_game ON play_sessions (game_id, started_at DESC);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE api_cache (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_api_cache_expires ON api_cache (expires_at);
    `,
  },
  {
    version: 2,
    name: 'game_background_art',
    sql: `ALTER TABLE games ADD COLUMN background_url TEXT;`,
  },
  {
    version: 3,
    name: 'local_trophies',
    sql: `
      -- Lista de troféus local por jogo (importada de um .trp do PS4 ou criada à mão).
      CREATE TABLE trophy_sets (
        game_id       INTEGER PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
        source        TEXT    NOT NULL CHECK (source IN ('ps4', 'manual')),
        np_comm_id    TEXT,
        title         TEXT,
        icon_url      TEXT,
        -- Detecção automática: arquivo de log + regex com o id do troféu no grupo 1.
        log_path      TEXT,
        log_pattern   TEXT,
        log_cursor    INTEGER NOT NULL DEFAULT 0,
        log_tail_hash TEXT,
        created_at    TEXT    NOT NULL
      );

      CREATE TABLE trophies (
        game_id       INTEGER NOT NULL REFERENCES trophy_sets (game_id) ON DELETE CASCADE,
        trophy_id     INTEGER NOT NULL,
        name          TEXT    NOT NULL,
        detail        TEXT    NOT NULL DEFAULT '',
        grade         TEXT    NOT NULL DEFAULT 'B' CHECK (grade IN ('P', 'G', 'S', 'B')),
        hidden        INTEGER NOT NULL DEFAULT 0,
        icon_url      TEXT,
        unlocked_at   TEXT,
        unlock_source TEXT CHECK (unlock_source IN ('auto', 'manual')),
        PRIMARY KEY (game_id, trophy_id)
      );
    `,
  },
  {
    version: 4,
    name: 'trophy_auto_import_optout',
    sql: `
      -- Jogos cuja lista de troféus o usuário removeu: a importação automática não a recria.
      CREATE TABLE trophy_auto_import_optout (
        game_id    INTEGER PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: 'trophy_log_disabled',
    sql: `
      -- 1 = o usuário desligou a detecção pelo log; 0 = o log pode ser ligado sozinho quando aparecer
      -- (ports criam user\\last_run.log só na primeira vez que o jogo roda).
      ALTER TABLE trophy_sets ADD COLUMN log_disabled INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: 'trophies_unlocked_index',
    sql: `
      -- Página geral de troféus: "recentes" ordena por data entre todos os jogos.
      CREATE INDEX idx_trophies_unlocked ON trophies (unlocked_at DESC) WHERE unlocked_at IS NOT NULL;
    `,
  },
  {
    version: 7,
    name: 'save_paths',
    sql: `
      -- Locais de save escolhidos pelo usuário: manual = adicionado; ignored = local detectado que ele removeu.
      CREATE TABLE save_paths (
        game_id INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        path    TEXT    NOT NULL,
        mode    TEXT    NOT NULL CHECK (mode IN ('manual', 'ignored')),
        PRIMARY KEY (game_id, path)
      );
    `,
  },
  {
    version: 8,
    name: 'categories',
    sql: `
      -- Categorias criadas pelo usuário (PS4, Nintendo DS…); um jogo pode estar em várias.
      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        sort_order INTEGER NOT NULL,
        created_at TEXT    NOT NULL
      );
      CREATE TABLE game_categories (
        game_id     INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
        PRIMARY KEY (game_id, category_id)
      );
      CREATE INDEX idx_game_categories_category ON game_categories (category_id);
    `,
  },
  {
    version: 9,
    name: 'category_icon',
    sql: `
      -- Ícone escolhido pelo usuário (chave de shared/categoryIcons.ts); NULL = automático pelo nome.
      ALTER TABLE categories ADD COLUMN icon TEXT;
    `,
  },
  {
    version: 10,
    name: 'store_installs',
    sql: `
      -- Ports instalados pela Loja (uma versão ativa por port).
      CREATE TABLE store_installs (
        port_id      TEXT    PRIMARY KEY,
        tag          TEXT    NOT NULL,
        asset_name   TEXT    NOT NULL,
        sha256       TEXT    NOT NULL,
        -- 1 = conferido com o SHA-256 publicado; 0 = o projeto não publicou hash (só o tamanho foi conferido).
        verified     INTEGER NOT NULL CHECK (verified IN (0, 1)),
        install_dir  TEXT    NOT NULL,
        exe_path     TEXT    NOT NULL,
        size_bytes   INTEGER NOT NULL,
        installed_at TEXT    NOT NULL
      );
      -- Jogo da biblioteca de cada port. Sobrevive à desinstalação: reinstalar religa o mesmo jogo
      -- (tempo de jogo, troféus e saves continuam). Some se o jogo for removido da biblioteca.
      CREATE TABLE store_port_games (
        port_id TEXT    PRIMARY KEY,
        game_id INTEGER NOT NULL UNIQUE REFERENCES games (id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 11,
    name: 'store_port_roms',
    sql: `
      -- ROM conferida de cada port (o arquivo do usuário). Sobrevive a desinstalar/atualizar:
      -- a cada instalação nova ela é recolocada (ou a cópia .z64 é refeita) sozinha.
      CREATE TABLE store_port_roms (
        port_id       TEXT PRIMARY KEY,
        source_path   TEXT NOT NULL,
        version_name  TEXT NOT NULL,
        configured_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 12,
    name: 'store_previous_version',
    sql: `
      -- Versão anterior mantida no disco depois de uma atualização (voltar sem baixar de novo).
      -- JSON com os mesmos campos da instalação ativa; NULL = não há versão anterior.
      ALTER TABLE store_installs ADD COLUMN previous_json TEXT;
    `,
  },
  {
    version: 13,
    name: 'store_art',
    sql: `
      -- Artes da Loja (SteamGridDB ou logos dos projetos) já baixadas para o cofre de artes.
      -- A limpeza de artes não apaga o que estiver aqui; source_url evita baixar a mesma imagem de novo.
      CREATE TABLE store_art (
        source_url TEXT PRIMARY KEY,
        local_url  TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 14,
    name: 'store_install_kind',
    sql: `
      -- archive (.zip/.7z) | portable (.exe sozinho) | installer (instalador do projeto, fora da pasta do RetroVault).
      ALTER TABLE store_installs ADD COLUMN kind TEXT NOT NULL DEFAULT 'archive' CHECK (kind IN ('archive', 'portable', 'installer'));
    `,
  },
  {
    version: 15,
    name: 'store_art_reencode',
    sql: `
      -- Capas da Loja passaram a ser guardadas reduzidas em JPEG: esquece as já baixadas (PNG grandes)
      -- para virem de novo no formato leve. Os arquivos antigos saem na limpeza de artes da inicialização.
      DELETE FROM store_art;
      DELETE FROM api_cache WHERE key LIKE 'store:art:%';
    `,
  },
  {
    version: 16,
    name: 'console_categories',
    sql: `
      -- Categoria ligada a um console (chave de shared/consoleCategories.ts); NULL = categoria livre.
      ALTER TABLE categories ADD COLUMN console TEXT;
      CREATE UNIQUE INDEX idx_categories_console ON categories (console) WHERE console IS NOT NULL;
      -- Consoles já oferecidos como categoria: o que o usuário apagar não volta na próxima abertura.
      CREATE TABLE console_categories_seeded (
        console TEXT PRIMARY KEY
      );
    `,
  },
  {
    version: 17,
    name: 'custom_ports',
    sql: `
      -- Ports adicionados pelo usuário a partir de um repositório do GitHub (mesmo formato de um item
      -- do catalog.json, validado ao ler). Entram na Loja junto com o catálogo.
      CREATE TABLE custom_ports (
        id         TEXT PRIMARY KEY,
        json       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 18,
    name: 'mod_installs',
    sql: `
      -- Mods do GameBanana instalados em cada port: os arquivos colocados (relativos à pasta do port),
      -- para remover só eles depois. A pasta de mods vai junto quando o port é atualizado.
      CREATE TABLE mod_installs (
        port_id      TEXT    NOT NULL,
        mod_id       INTEGER NOT NULL,
        file_id      INTEGER NOT NULL,
        name         TEXT    NOT NULL,
        version      TEXT,
        files_json   TEXT    NOT NULL,
        installed_at TEXT    NOT NULL,
        PRIMARY KEY (port_id, mod_id)
      );
    `,
  },
  {
    version: 19,
    name: 'emulator_trophies',
    sql: `
      -- Troféus que o próprio emulador guarda (RPCS3, Vita3K): de qual emulador vêm e onde está o
      -- TROPUSR.DAT com os desbloqueios. Colunas novas, sem recriar a tabela: o CHECK antigo de source
      -- ('ps4' | 'manual') continua valendo, e essas listas ficam como 'ps4' (lista oficial importada).
      ALTER TABLE trophy_sets ADD COLUMN emulator TEXT;
      ALTER TABLE trophy_sets ADD COLUMN progress_path TEXT;
    `,
  },
  {
    version: 20,
    name: 'steam_games',
    sql: `
      -- Jogo importado da Steam: continua sendo um executável (ícone, saves, pasta do jogo), mas abre
      -- pela própria Steam (steam://rungameid/<id>) para o DRM, a nuvem e as conquistas dela funcionarem.
      ALTER TABLE games ADD COLUMN steam_app_id INTEGER;
    `,
  },
];
