// Normalização de nomes para comparar e buscar (títulos de jogos, consoles, categorias). Fonte única:
// main e interface comparam do mesmo jeito.

/** Sem acentos e em minúsculas: "Pokémon Édition" → "pokemon edition". O resto fica como está. */
export function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Só letras e números, tudo junto: "Crash™ Team Racing" → "crashteamracing". */
export function compactKey(text: string): string {
  return foldDiacritics(text).replace(/[^a-z0-9]/g, '');
}

/** Palavras separadas por um espaço só: "Zelda: Ocarina!" → "zelda ocarina". */
export function wordKey(text: string): string {
  return foldDiacritics(text).replace(/[^a-z0-9]+/g, ' ').trim();
}
