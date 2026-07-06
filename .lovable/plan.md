## Objetivo

Transformar a homepage (`/`) em um indicador puro de estoque, sem CTAs de marketing (WhatsApp, "Falar no WhatsApp"), e permitir acessar esse catálogo mesmo estando logado dentro do sistema.

## Mudanças

### 1. `src/pages/LandingPage.tsx` — limpar marketing
- Remover o botão verde "Falar no WhatsApp" da hero.
- Remover o botão flutuante do WhatsApp (canto inferior direito) e o ícone `MessageCircle` do import.
- Manter apenas: header, badge "Catálogo ao vivo", título, subtítulo, botão "Ver Catálogo", stats, seção Marcas, seção Catálogo, footer.
- No header, quando o usuário estiver logado, o botão "Painel" continua levando ao app; adicionar também um link discreto "Voltar ao painel" no footer para reforçar (opcional, o botão do header já resolve).

### 2. Acesso ao catálogo estando logado
Hoje `AuthGate` redireciona `/login` quando logado, mas `/` (LandingPage) já é pública e funciona logado — o problema é que não há entrada visível para ela dentro do app.

- Adicionar item **"Catálogo"** (ícone `Boxes` ou `Sparkles`) na navegação lateral e no menu mobile do `AppLayout.tsx`, disponível para admin e vendedor, apontando para `/` (rota externa ao layout, abre a LandingPage).
- Como `/` fica fora do `ProtectedRoutes`, o `NavLink` usará `to="/"` normalmente; a LandingPage já detecta `user` e mostra "Painel" no header, permitindo voltar.

### 3. Sem mudanças em backend, tipos ou lógica de negócio.

## Arquivos afetados
- `src/pages/LandingPage.tsx`
- `src/components/AppLayout.tsx`
