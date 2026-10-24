# Como publicar uma versão do RetroVault

Guia de quem mantém o repositório. Tudo pelo site do GitHub; não precisa de Git.

## Uma vez: criar o repositório

1. No GitHub, crie um repositório **público** chamado exatamente **`retrovault`** (o app procura as atualizações
   em `github.com/yagomanara1/retrovault`).
2. Clique em **uploading an existing file** e envie o `README.md` e este `PUBLICAR.md`. **Commit changes**.

## Cada versão

### 1. No PC (projeto do app)

1. Suba o número da versão no `package.json` (ex.: `0.1.0` → `0.1.1`). Quem já tem o app só recebe a atualização
   se o número for **maior** que o dele.
2. Gere o instalador e confira:
   ```bash
   npm run dist
   npm run release:check
   ```
   O `release:check` confere que os três arquivos batem entre si e mostra onde eles estão (pasta `release`).

### 2. No GitHub

1. Na página do repositório, clique em **Releases → Draft a new release**.
2. **Choose a tag:** digite `v` + a versão (ex.: `v0.1.1`) e clique em **Create new tag**.
3. **Release title:** `RetroVault 0.1.1`. Na descrição, escreva o que mudou: aparece para quem clicar em
   "Notas das versões" no app.
4. Arraste os **três** arquivos da pasta `release`:
   - `RetroVault-Setup-<versão>.exe`: o instalador;
   - `RetroVault-Setup-<versão>.exe.blockmap`: deixa as atualizações menores;
   - `latest.yml`: **sem ele, ninguém recebe a atualização automática**.
5. Deixe **desmarcado** "Set as a pre-release" e clique em **Publish release**.

Em até 6 horas, todo RetroVault instalado baixa a versão nova sozinho e oferece "Reiniciar e atualizar"
(ou na hora, em Configurações → Atualizações do RetroVault → Procurar agora).

## Se algo der errado

- **Publicou com problema:** publique outra versão, com número maior, corrigida. Apagar a versão ruim não desfaz
  quem já atualizou.
- **Esqueceu o `latest.yml`:** edite a versão no GitHub (lápis) e anexe o arquivo. Até lá, o app mostra
  "ainda não tem os arquivos de atualização".
- **Aviso azul do Windows ("O Windows protegeu o computador"):** é esperado sem assinatura digital. Quanto mais
  pessoas baixam, menos ele aparece. Uma assinatura de código (certificado pago) o remove de vez.
