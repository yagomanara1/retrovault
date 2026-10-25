# Como publicar uma versão do RetroVault

Guia de quem mantém o repositório. O código fica em `github.com/yagomanara1/retrovault`, e as versões são as
Releases desse mesmo repositório: é delas que o app instalado baixa as atualizações.

## Enviar mudanças do código

Com o [GitHub Desktop](https://desktop.github.com/), na pasta do projeto:

1. Confira a lista de arquivos alterados à esquerda (pastas como `node_modules`, `out` e `release` não aparecem:
   o `.gitignore` as deixa de fora).
2. Escreva um resumo em **Summary** (ex.: "Importação da Steam") e clique em **Commit to main**.
3. Clique em **Push origin**.

## Cada versão

### 1. No PC

1. Suba o número da versão no `package.json` (ex.: `0.1.2` → `0.1.3`). Quem já tem o app só recebe a atualização
   se o número for **maior** que o dele.
2. Rode os testes, gere o instalador e confira:
   ```bash
   npm test
   npm run dist
   npm run release:check
   ```
   O `release:check` confere que os três arquivos batem entre si e mostra onde eles estão (pasta `release`).
3. Envie o código da versão pelo GitHub Desktop (commit + push, como acima).

### 2. No GitHub

1. Na página do repositório, clique em **Releases → Draft a new release**.
2. **Choose a tag:** digite `v` + a versão, **sem ponto depois do v** (ex.: `v0.1.3`), e clique em **Create new tag**.
3. **Release title:** `RetroVault 0.1.3`. Na descrição, escreva o que mudou: aparece para quem clicar em
   "Notas das versões" no app.
4. Arraste os **três** arquivos da pasta `release`:
   - `RetroVault-Setup-<versão>.exe`: o instalador;
   - `RetroVault-Setup-<versão>.exe.blockmap`: deixa as atualizações menores;
   - `latest.yml`: **sem ele, ninguém recebe a atualização automática**.
5. Deixe **desmarcado** "Set as a pre-release" e clique em **Publish release**.

Em até 6 horas, todo RetroVault instalado baixa a versão nova sozinho e oferece "Reiniciar e atualizar"
(ou na hora, em Configurações → Atualizações do RetroVault → Procurar agora).

## Arquivos que precisam ficar na raiz do repositório

- `icon.png`: é a imagem que o Discord mostra quando o jogo não tem capa na internet (o app aponta para ela).
  Tem que ser igual ao `build/icon.png`; o `release:check` confere.
- `imagens/`: os prints do README.

## Se algo der errado

- **Publicou com problema:** publique outra versão, com número maior, corrigida. Apagar a versão ruim não desfaz
  quem já atualizou.
- **Esqueceu o `latest.yml`:** edite a versão no GitHub (lápis) e anexe o arquivo. Até lá, o app mostra
  "ainda não tem os arquivos de atualização".
- **Aviso azul do Windows ("O Windows protegeu o computador"):** é esperado sem assinatura digital. Quanto mais
  pessoas baixam, menos ele aparece. Uma assinatura de código (certificado pago) o remove de vez.
