/**
 * ID do aplicativo "RetroVault" no portal de desenvolvedores do Discord (discord.com/developers/applications).
 * É público (vai em todo cliente de Rich Presence); o nome do aplicativo é o que aparece em "Jogando …".
 * A variável de ambiente serve para testar com outro aplicativo.
 */
export const DISCORD_CLIENT_ID: string = process.env.RETROVAULT_DISCORD_CLIENT_ID?.trim() || '1563711410733846598';

/** Ícone do RetroVault quando o jogo não tem uma imagem pública (publicado no repositório de versões). */
export const DISCORD_FALLBACK_IMAGE = 'https://raw.githubusercontent.com/yagomanara1/retrovault/main/icon.png';

/** Só imagens que o Discord consegue mostrar (o .ico de alguns ports, não). */
export function isDiscordImage(url: string | null | undefined): url is string {
  return !!url && /^https:\/\//i.test(url) && /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url);
}
