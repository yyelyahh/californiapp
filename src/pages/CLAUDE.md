# Storefront — linguagem visual da loja pública

Referência de estilo extraída de `SellerStorePage.tsx`, para que uma tela nova
nasça parecida com ela sem precisar reabrir o arquivo de 1800 linhas.

**Onde isto vale:** só em tela sob a classe `.storefront` — hoje `SellerStorePage`
(`/loja/:sellerId`, a loja pública) e `SellerSalesPage` (`/minhas-vendas`, a visão
do vendedor). As telas do ERP (Dashboard, SalesPage, ProductsPage…) usam o tema
global Nocturne, com outros tokens; nada aqui se aplica a elas. Se a página nova é
do ERP, ignore este arquivo.

As duas telas storefront moram fora do `AppLayout`: o app-shell delas ocupa a
janela inteira e brigaria com a sidebar/barra inferior do ERP por fora.

---

## 1. Regra que não se quebra: nenhuma cor literal

Nada de `#fff`, `text-white`, `bg-slate-800` ou `text-muted-foreground`. Toda cor
sai de um token `--sf-*`, sempre via `style={{ ... }}`.

O motivo é concreto: existe `.storefront-flooded`, um estado que **reescreve os
tokens** para inverter a tela inteira (fundo vira o azul da onda, o accent vira a
tinta funda). Componente que pede `var(--sf-accent)` vira do avesso sozinho;
componente com hex na mão fica ilegível e ninguém descobre até ver a tela.

| token | uso |
|---|---|
| `--sf-bg` | fundo da página e dos sheets |
| `--sf-surface` | cards, inputs, chips inativos, miniaturas, botões-ícone |
| `--sf-surface-2` | pílula sobre o surface (badge "N sabores") |
| `--sf-border` | borda de input e chip |
| `--sf-hairline` | borda de card, divisória, separador de rodapé |
| `--sf-text` | texto principal |
| `--sf-text-muted` | texto secundário, rótulo de campo, descrição |
| `--sf-text-faint` | terciário — ícone de busca, rótulo "Sabor", ícone de lixeira |
| `--sf-text-dim` | placeholder, estado vazio, ícone de produto sem foto |
| `--sf-accent` | **dinheiro e ênfase** — preço, total, marca da casa, botão primário |
| `--sf-accent-ink` | texto escuro sobre o accent |
| `--sf-accent-tint` / `--sf-accent-line` | realce do item selecionado (fundo / borda) |
| `--sf-accent-soft` | preenchimento de botão desabilitado |
| `--sf-warn` | "só restam N" — está acabando |
| `--sf-danger` | recusa, erro de pedido — não deu |

`--sf-warn` e `--sf-danger` são separados de propósito. Não troque um pelo outro.

**Preço é sempre accent.** É o padrão mais consistente da tela: card, carrinho,
total, botão de adicionar. Se um número não é dinheiro, não usa accent.

## 2. Gotcha do Radix: `.storefront` em todo `SheetContent`

O Radix porta o sheet para o `<body>`, fora da árvore da página. Lá os tokens não
chegam por herança e a tela sai com as cores do tema global. **Toda** `SheetContent`
repete a classe:

```tsx
<SheetContent
  side="bottom"
  hideClose
  className={`storefront ${COLUMN} inset-x-0 flex h-[84vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
  style={{ background: "var(--sf-bg)" }}
>
```

Vale para qualquer coisa portada: Dialog, Popover, Tooltip, Toast.

**Peça compartilhada com o ERP: a classe sozinha não basta.** `.storefront` só
define os `--sf-*` — não reescreve `--background`, `--foreground` nem
`--destructive`. Num componente shadcn que pinta por esses tokens (o
`AlertDialogContent` do `ConfirmProvider`, por exemplo) repetir a classe não
muda nada: ele continua saindo com o Nocturne. E o tema não dá para deduzir do
DOM, porque o Radix já tirou o elemento da árvore da página. Quem sabe é a tela
que chama, e ela avisa: `useConfirm` aceita `storefront: true`, e
`usePendingOrders({ storefront: true })` repassa isso no diálogo de recusar
pedido. Peça nova compartilhada entre os dois temas segue esse caminho — um
sinalizador vindo de quem chama, não uma adivinhação no componente.

## 3. Esqueleto da página

```tsx
<div className="storefront flex h-[100dvh] flex-col overflow-hidden">
  <header className="flex-shrink-0">…</header>
  <main className={`${COLUMN} flex-1 overflow-y-auto overscroll-contain px-5 pb-[100px] pt-1.5`}>…</main>
</div>
```

App-shell: a raiz ocupa a janela e **não rola**; só o `<main>` rola. Assim o
cabeçalho fica parado sem `sticky` e o documento não tem o que arrastar — nem na
horizontal, nem no repique vertical do iOS. `dvh` acompanha a barra de endereço
recolhendo no celular; `vh` não.

- `COLUMN = "mx-auto w-full max-w-[480px]"` — a loja é desenhada para o telefone
  (o link chega pelo WhatsApp). No desktop a coluna centraliza em vez de esticar.
  Vai no header, no main, no `SheetContent` e na barra fixa de baixo.
- Gutter horizontal é `px-5` em tudo. Rodapé de sheet fecha em `pb-7`.
- `pb-[100px]` no main existe para a barra fixa do carrinho não cobrir o último card.
- `MEDIA_RATIO = "4 / 3"` em **toda** foto de produto, via `aspectRatio`. Travar
  altura em px em vez da proporção já causou o mesmo card sair 1,59:1 num celular
  pequeno e 2,50:1 num grande.

## 4. Escala tipográfica

Fonte é Manrope (definida em `.storefront`). Só três pesos aparecem:
`font-semibold`, `font-bold`, `font-extrabold` — não use `font-medium` para dar ênfase.

| papel | classe |
|---|---|
| título de tela / sheet | `text-[19px]`–`text-[22px] font-extrabold` |
| seção (marca) | `text-[15px] font-extrabold uppercase tracking-[0.06em]` |
| sobretítulo (eyebrow) | `text-[11px]`–`text-[11.5px] font-bold uppercase tracking-[0.06em]`–`[0.08em]` |
| título de card | `text-base font-bold` |
| item de lista | `text-[13.5px] font-bold` + sublinha `text-xs` muted |
| preço | `text-[13.5px]`–`text-[15px] font-extrabold`, accent |
| corpo / descrição | `text-[13px]`–`text-[13.5px]`, muted, `leading-relaxed` em bloco |
| rótulo de campo | `text-xs font-semibold`, muted |
| texto de input | `text-[15px]` (`FIELD_CLASS`) |
| botão pílula | `text-sm font-extrabold` |
| chip | `text-[12.5px] font-bold` |
| estado vazio/carregando | `text-[13px]`, dim, `py-16 text-center` |

Tamanhos quebrados (`[13.5px]`, `[11.5px]`) são intencionais — a escala do Tailwind
pula degraus demais nessa faixa. Copie o valor exato em vez de arredondar.

## 5. Raio e altura

| raio | onde |
|---|---|
| `rounded-full` | pílulas, chips, botões-ícone, badges, campo de busca |
| `rounded-t-[28px]` | topo do sheet |
| `rounded-[20px]` | card de produto |
| `rounded-2xl` | linha de sabor, cartão de fidelidade |
| `rounded-[14px]` | inputs (`FIELD_CLASS`) |
| `rounded-xl` | miniatura 56px do carrinho |

Alturas: pílula primária `50` (`PILL_HEIGHT`), pílula da barra fixa `52`, botão de
texto secundário `h-11`, input `h-[50px]`, busca `h-[42px]`. Botões-ícone:
`h-10 w-10` no header, `h-9 w-9` sobre foto, `h-8 w-8` no topo do sheet.
Sheets: detalhe `88vh`, carrinho `76vh`, checkout `84vh` (mais alto porque tem
formulário e o teclado do celular sobe por cima).

## 6. Peças prontas — reutilize, não reescreva

Estão dentro de `SellerStorePage.tsx`. Se a página nova precisar de alguma, **mova
para `src/components/storefront/` e importe nas duas**, em vez de copiar.

- `PillButton` — botão primário. Não reaproveita o `Button` do shadcn de propósito:
  o shadcn aplica `disabled:opacity-50` no botão inteiro, e aqui o desabilitado
  esmaece só o **preenchimento** (`--sf-accent-soft`), mantendo o texto legível.
- `AddToCartButton` — a confirmação por varredura de tinta com fumaça. Peça cara e
  específica; não replique em outra tela sem motivo forte.
- `QtyStepper` — quantidade em pílula, com variante `compact` para lista.
- `Field` — rótulo + controle, com `htmlFor` amarrado.
- `SheetTopBar` — título + botão de fechar, com `border-bottom` hairline.
- `BrandChips` — filtro horizontal com o realce deslizante.
- `ProductMedia` — foto com fallback. `contain` + cópia borrada por trás para foto
  grande (as URLs são coladas à mão e vêm em qualquer proporção); `cover` em
  miniatura. Link quebrado cai no ícone `Package`, não no ícone quebrado do navegador.
- `DrawnCheck` — check que se desenha, para confirmação.

Campos de texto usam sempre as duas constantes juntas:

```tsx
<Input className={`h-[50px] px-4 ${FIELD_CLASS}`} style={FIELD_STYLE} />
```

## 7. Movimento

Tudo vem de `@/lib/motion` — `EASE_OUT`, `EASE_IN_OUT`, `fadeUp`, `stagger`,
`transitionBase`. **Não invente curva nem duração nova.**

- `EASE_OUT` é o padrão. `EASE_IN_OUT` só para percurso longo com velocidade
  constante (barra que enche, faixa que varre): o `EASE_OUT` é quase exponencial e
  em animação de meio segundo pra cima parece disparar e travar.
- **Realce de seleção é peça única, não estado por item.** Só o item ativo renderiza
  o `motion.span` com `layoutId`, e o motion desliza a peça do antigo para o novo em
  vez de apagar aqui e acender ali. É assim nos chips de marca e na lista de sabores
  — repita esse padrão em qualquer seleção nova.
- **Container que rola e hospeda um `layoutId` precisa de `layoutScroll`.** Sem isso
  o motion mede a posição sem descontar o scroll e a peça pousa fora do lugar. Já
  pegou duas vezes (`BrandChips` e a lista de sabores).
- `useReducedMotion()` é obrigatório e tem que **desligar de verdade**: passe
  `layoutId={reduce ? undefined : id}`, entre com `initial="visible"`, e pule a
  animação de confirmação chamando o callback final direto.
- Entrada de tela: `stagger(0.08, 0.14)` no container, `fadeUp` nos filhos.
- Transição de realce: `{ duration: 0.28, ease: EASE_OUT }`.

## 8. Estados de lista — sempre os três

Toda lista trata carregando, erro e vazio, com a mesma moldura
(`py-16 text-center text-[13px]`):

- **Carregando** — texto em `--sf-text-dim`.
- **Erro** — ocupa o lugar da lista (não flutua por cima) e traz botão "Tentar de
  novo". Sem catálogo não há nada embaixo para o aviso atrapalhar, e o botão precisa
  estar onde a pessoa está olhando.
- **Vazio** — a cópia muda se há busca ativa: `Nenhum produto encontrado para "x".`

Erro de ação (não de carga) fica **colado no botão que a pessoa vai apertar de
novo**, em `--sf-danger`, e some quando o sheet fecha — reabrir é um recomeço, não a
continuação da tentativa que falhou.

## 9. Acessibilidade — o que já é padrão aqui

- Todo botão-ícone tem `aria-label` descritivo (inclui o contexto: `Remover ${sabor}`).
- Sheet sem título visível mesmo assim tem `SheetTitle` + `SheetDescription` em `sr-only`.
- Seleção usa `aria-pressed`; contador de quantidade usa `aria-live="polite"`.
- Card clicável tem `role="button"`, `tabIndex={0}` e trata Enter/Espaço.
- Foco: já resolvido globalmente por `.storefront :focus-visible`. Não adicione anel
  próprio. O `--ring` foi redefinido dentro de `.storefront` porque o foco do shadcn
  saía roxo do tema global.

## 10. Voz da cópia

pt-BR, segunda pessoa, direta e curta. Frase de ação no infinitivo no botão
("Finalizar pedido", "Confirmar pedido", "Tentar de novo"). Sem ponto final em
rótulo; ponto final em frase de estado. Exclamação só na confirmação.

Erro de banco **nunca** aparece cru: passa por um mapa tipo `friendlyError`, que
traduz o código (`estoque_insuficiente`) numa frase que diz o que fazer.

---

**Ao mexer em qualquer coisa desta lista, atualize este arquivo junto.** Ele só
serve enquanto descreve o que o código realmente faz.
