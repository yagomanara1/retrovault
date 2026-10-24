# RetroVault

Launcher para Windows no estilo dos consoles: reúne seus jogos de RetroArch, ports e jogos de PC numa
biblioteca só, com conquistas do RetroAchievements, troféus, cofre de saves e uma **Loja de ports** de código aberto.

**[⬇ Baixar a versão mais recente](https://github.com/yagomanara1/retrovault/releases/latest)**: baixe o arquivo
`RetroVault-Setup-<versão>.exe`.

## O que ele faz

- **Biblioteca única:** ROMs (abertas no RetroArch), ports e qualquer `.exe` do seu PC, com capas e categorias por console.
- **Conquistas e troféus:** progresso do RetroAchievements e troféus locais, com notificações durante o jogo.
- **Cofre de saves:** guarda os saves de cada jogo, com backup automático.
- **Loja de ports:** ports e recompilações de código aberto que instalam com um clique. O RetroVault baixa o
  programa direto do projeto original no GitHub e confere o arquivo. **Os jogos não vêm junto:** cada port pede a
  sua própria cópia (ROM ou arquivos do jogo).
- **Atualiza sozinho:** quando sai uma versão nova, ele baixa em segundo plano e pergunta se pode reiniciar.

## Instalar

1. Baixe o `RetroVault-Setup-<versão>.exe` na página de [versões](https://github.com/yagomanara1/retrovault/releases/latest).
2. Abra o arquivo. Na primeira vez, o Windows pode mostrar a tela azul **"O Windows protegeu o computador"**.
   Isso acontece porque o instalador não tem assinatura digital paga. Clique em **Mais informações → Executar assim mesmo**.
3. Escolha a pasta (ou deixe a sugerida) e conclua. Não pede senha de administrador: instala só para o seu usuário.

Requisitos: Windows 10 ou 11, 64 bits. Para jogar ROMs, instale também o [RetroArch](https://www.retroarch.com/).

## Desinstalar

Em **Configurações do Windows → Aplicativos → RetroVault → Desinstalar**. Sua biblioteca, troféus e saves ficam
guardados em `%APPDATA%\RetroVault`. Se reinstalar, está tudo lá. Para apagar de vez, apague essa pasta.

## Segurança

- O código de cada port é dos autores originais; o RetroVault confere que o arquivo baixado é o mesmo que o projeto
  publicou (SHA-256), e avisa antes de baixar projetos gerados por IA.
- As atualizações do RetroVault só vêm desta página e são conferidas (SHA-512) antes de instalar.
- **Nunca rode comandos** que alguém mandar em issues ou comentários dizendo que "corrigem" algo.

## Créditos

- **Ports da Loja:** todo o crédito é de quem fez cada um. A lista, com os links de cada projeto, está no
  [catálogo da Loja](https://github.com/yagomanara1/retrovault-catalog).
- **Seleção dos ports:** baseada no ranking do [Quiver Launcher](https://quiverlauncher.com). O RetroVault não é afiliado a ele.
- **Conquistas:** [RetroAchievements](https://retroachievements.org). **Emulação:** [RetroArch](https://www.retroarch.com/).

Problemas ou sugestões? Abra uma [issue](https://github.com/yagomanara1/retrovault/issues).
