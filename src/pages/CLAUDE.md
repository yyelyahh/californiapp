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
| `--sf-warn` | valor em aberto, ainda a receber (SellerSalesPage) |
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
formulário e o teclado do celular sobe por cima), tira-dúvidas `64vh` (é só
leitura: quem abre quer entender uma regra e voltar para o catálogo).

## 6. Peças prontas — reutilize, não reescreva

Estão dentro de `SellerStorePage.tsx`. Se a página nova precisar de alguma, **mova
para `src/components/storefront/` e importe nas duas**, em vez de copiar.

- `PillButton` — botão primário. Não reaproveita o `Button` do shadcn de propósito:
  o shadcn aplica `disabled:opacity-50` no botão inteiro, e aqui o desabilitado
  esmaece só o **preenchimento** (`--sf-accent-soft`), mantendo o texto legível.
  Com `href` ele vira uma âncora com a mesma cara: navegador embutido do
  Instagram e do Facebook bloqueia `window.open`, e é de lá que vem boa parte
  dos links colados. Ação que SAI da página (compartilhar no WhatsApp) usa
  `href`; ação que muda a própria tela continua botão.
- `AddToCartButton` — a confirmação por varredura de tinta com fumaça. Peça cara e
  específica; não replique em outra tela sem motivo forte. **Quem chama subtrai o
  que já está no carrinho** (`cartQtyById`) antes de decidir o teto e o rótulo: o
  sheet abria sempre em "1" sem dizer que o sabor já tinha sido escolhido, e com o
  estoque todo no carrinho o toque virava varredura + check sem mexer em nada
  (o `addToCart` trava a soma no estoque), como se o item entrasse de novo a cada
  toque. Confirmação que não confirma nada é pior que botão desligado.
- `QtyStepper` — quantidade em pílula, com variante `compact` para lista.
- `Field` — rótulo + controle, com `htmlFor` amarrado.
- `SheetTopBar` — título + botão de fechar, com `border-bottom` hairline.
- `BrandChips` — filtro horizontal com o realce deslizante.
- `ProductMedia` — foto com fallback. `contain` + cópia borrada por trás para foto
  grande (as URLs são coladas à mão e vêm em qualquer proporção); `cover` em
  miniatura. Link quebrado cai no ícone `Package`, não no ícone quebrado do navegador.
  **Três estados, não dois:** enquanto a rede não responde entra o esqueleto
  (`.sf-shimmer`, em `src/index.css` — a única animação em laço da loja, porque é
  a única espera que dura dez segundos num 4G ruim), a foto entra com fade no
  `onLoad`, e a cópia borrada só nasce DEPOIS disso, para não disputar rede e
  decodificação com a imagem que importa. Foto em cache pode ficar `complete`
  antes de o React pendurar o `onLoad`: o efeito relê `imgRef.current.complete`,
  senão o esqueleto fica para sempre por cima de uma foto pronta.
  `priority` tira o `lazy` e manda `fetchpriority="high"` — vale para as DUAS
  primeiras fotos da lista e para o hero do detalhe. `loading="lazy"` na foto que
  está na tela atrasa justamente o que a pessoa está olhando.
- `DrawnCheck` — check que se desenha, para confirmação.
- `DiscountLines` — as linhas de desconto acima do total, **uma por REGRA**
  (combo de modelo, fidelidade), nunca as duas somadas num número só: quem
  ganha pelos dois lados não confere um "−R$ 44,00" sem origem. Some a linha
  sem desconto — "R$ 0,00 de desconto" só lembra o que a pessoa não ganhou.
  Aparece no carrinho E no checkout, a mesma peça nos dois, porque é o mesmo
  número e ele não pode ser escrito de dois jeitos.
- `StoreNotices` — o trilho de avisos acima da busca. Cards a 86% da largura
  com o próximo aparecendo pela borda; anda sozinho a cada 3s e passa NO
  TOQUE, nunca no arraste (a tela já rola na vertical, e um trilho arrastável
  disputaria esse gesto e o de voltar do iOS). É a única peça que anima por
  `transition` do CSS em vez do motion — o passo é `calc(86% + 10px)` e o
  motion não interpola `calc` com porcentagem; a curva vem de `CSS_EASE_OUT`
  em `@/lib/motion`, que é o MESMO `EASE_OUT` de todo mundo, derivado dos
  mesmos números. Com `useReducedMotion()` ele para de andar sozinho em vez de
  trocar o texto sem transição nenhuma debaixo do olho de quem pediu menos
  movimento.

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

Erro de banco **nunca** aparece cru, e o mapa (`friendlyError`) é uma lista de
**permissão**, não de tradução: o que não está nele vira a frase genérica.
Enquanto ele terminava em `return message`, qualquer erro fora do mapa chegava
literal no cliente — `produto_nao_encontrado:8f3c1a2e-…`, `TypeError: Failed to
fetch`. Quando o código carrega um dado útil, use-o: `estoque_insuficiente:<id>`
vira o nome do sabor que acabou (`orderErrorMessage`), em vez de "um dos itens".

Ação que depende da rede tem **teto de espera** (`ORDER_TIMEOUT_MS`, via
`AbortController` + `.abortSignal()`) e o desfecho dela nunca pendura só num
`onAnimationComplete` — aba em segundo plano congela o `requestAnimationFrame`,
e trocar para o WhatsApp no meio do envio é o que a pessoa faz neste fluxo. A
`FloodLayer` tem um `setTimeout` de mesma duração chamando o mesmo callback.

---

**Ao mexer em qualquer coisa desta lista, atualize este arquivo junto.** Ele só
serve enquanto descreve o que o código realmente faz.
