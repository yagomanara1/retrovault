# Avisos de terceiros

O código do RetroVault é distribuído sob a [licença MIT](LICENSE). Este arquivo lista o que veio de outros
projetos e as licenças deles. As bibliotecas instaladas pelo npm trazem as próprias licenças em `node_modules`.

## Código adaptado

### rcheevos

`src/main/testing/rcheevosImages.ts` porta, para TypeScript, os geradores de imagens de teste de
`test/hash/hash_data.c` do [rcheevos](https://github.com/RetroAchievements/rcheevos). Os algoritmos de
identificação de jogos (`src/main/services/romHasher.ts` e `src/main/services/disc/`) seguem o comportamento
documentado do rcheevos e são conferidos contra os valores oficiais dos testes dele.

```
MIT License

Copyright (c) 2018 RetroAchievements.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Ideias (sem código copiado)

- **[Taiga Launcher](https://github.com/GabrielTaiga/Taiga-Launcher-for-Steam)** (GabrielTaiga, Apache-2.0):
  identificação de discos, Discord Rich Presence, troféus do RPCS3 e do Vita3K, emuladores por console,
  importação das lojas instaladas e atalhos não-Steam. Tudo foi reescrito do zero em TypeScript.
- **[BoilR](https://github.com/PhilipK/BoilR)**: inspirou a importação das lojas no Taiga Launcher.

## Serviços e conteúdo

- **Ports da Loja:** cada port é dos seus autores, com a licença do próprio projeto. O RetroVault não distribui
  ports nem jogos: baixa o programa do repositório original. Lista e créditos no
  [catálogo](https://github.com/yagomanara1/retrovault-catalog).
- **[RetroAchievements](https://retroachievements.org)**, **[SteamGridDB](https://www.steamgriddb.com/)** e
  **[GameBanana](https://gamebanana.com/)**: acessados pelas APIs públicas deles, com as chaves do próprio usuário
  quando exigidas.
- **Steam, Epic Games, GOG, Ubisoft Connect, Amazon Games, itch.io, Discord e PlayStation** são marcas dos seus
  donos. O RetroVault não é afiliado a nenhum deles.
