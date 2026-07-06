## Objetivo

Ampliar as opções de forma de pagamento no registro de venda: quando a venda é **pendente** (paidAmount < total), oferecer 4 opções em vez de 2. Quando a venda é registrada como **paga**, manter apenas Pix / Dinheiro.

## Novas opções (venda pendente)

1. `pix_pendente` — "Falta receber Pix"
2. `dinheiro_pendente` — "Falta receber Dinheiro"
3. `dinheiro_com_vendedor` — "Dinheiro com {nome do vendedor}" (cliente já pagou ao vendedor; continua em aberto do ponto de vista do admin, é dívida do vendedor)
4. `pendente` — "Falta receber (sem especificação)"

Para venda **paga**, mantém: `pix` / `dinheiro`.

## Mudanças

### 1. Tipos (`src/types/index.ts`)
Estender `PaymentMethod`:
```ts
export type PaymentMethod =
  | "pix" | "dinheiro"
  | "pix_pendente" | "dinheiro_pendente"
  | "dinheiro_com_vendedor" | "pendente";
```
A coluna `payment_method` (text) já aceita qualquer valor — nenhuma migração necessária.

### 2. Formulário de venda (`src/pages/SalesPage.tsx`)
- Detectar `isPending = Number(paidAmount) < Number(total)` no form.
- Renderizar dinamicamente os botões de método:
  - Se paga → Pix / Dinheiro (como hoje).
  - Se pendente → 4 botões (Falta Pix, Falta Dinheiro, Dinheiro c/ vendedor, Falta receber).
- Se o usuário alterna paid ↔ pendente e o método atual não pertence ao novo conjunto, resetar para o primeiro válido (`pix` ou `pix_pendente`).
- A opção "Dinheiro com vendedor" só fica habilitada quando um vendedor está selecionado no form; caso contrário mostra tooltip/estado desabilitado.

### 3. Exibição na tabela de vendas (`src/pages/SalesPage.tsx`, coluna "Pagto")
Ampliar o mapeamento de rótulos e cores:
- `pix` → "Pix" (primary)
- `dinheiro` → "Dinheiro" (income)
- `pix_pendente` → "Falta Pix" (muted/warning)
- `dinheiro_pendente` → "Falta Dinheiro" (muted/warning)
- `dinheiro_com_vendedor` → "Dinheiro c/ {vendedor}" (warning)
- `pendente` → "Falta receber" (muted)

### 4. Relatório WhatsApp (`src/components/SellerReportDrawer.tsx`)
Na seção de vendas em aberto, substituir a lógica atual de `💠 PIX` / `💵 DINHEIRO` por texto puro (sem emojis extras) conforme o método:
- `pix_pendente` ou `pix` → `Pix`
- `dinheiro_pendente` ou `dinheiro` → `Dinheiro`
- `dinheiro_com_vendedor` → `Dinheiro com {nome do vendedor}`
- `pendente` ou ausente → `A definir`

Formato final da linha:
```
• 27/06 • Strawberry Watermelon · Ice King 40K • Em aberto R$ 159,00 · Dinheiro com João
```

### 5. Compatibilidade
- Vendas antigas com `pix`/`dinheiro` continuam funcionando.
- Nenhuma mudança em cálculo de comissão, estoque ou dívidas — apenas rótulos/tracking do método.

## Arquivos afetados
- `src/types/index.ts`
- `src/pages/SalesPage.tsx`
- `src/components/SellerReportDrawer.tsx`
