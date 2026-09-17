# Corrigir vulnerabilidades das dependências

## Alterações
- Atualizar somente as dependências diretas necessárias para obter versões corrigidas de `dompurify`, `react-router`, `@remix-run/router`, `lodash` e `xlsx`.
- Para dependências transitivas, renovar o lockfile sem adicionar versões forçadas ao `package.json`.
- Manter `xlsx` na distribuição oficial da SheetJS caso o registro npm não ofereça a versão segura.

## Validação
- Confirmar no lockfile as versões efetivamente resolvidas e registrar qualquer requisito sem versão corrigida disponível.
- Executar a verificação de vulnerabilidades novamente.
- Executar a verificação de tipos, os testes e o build de produção.
