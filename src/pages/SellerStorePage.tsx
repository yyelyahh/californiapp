import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { CSS_EASE_OUT, EASE_IN_OUT, EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { formatPhoneDisplay, isValidPhone, onlyDigits } from "@/lib/phone";
import { orderRef } from "@/lib/order-ref";
import { previewCartDiscount, type DiscountPreview } from "@/lib/cart-discount";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

import {
  ShoppingCart,
  Trash2,
  Minus,
  Plus,
  Search,
  MessageCircle,
  Package,
  Check,
  ArrowLeft,
  X,
  Info,
  Tag,
} from "lucide-react";
import { formatCurrency as fmt } from "@/lib/currency";

interface CatalogRow {
  seller_name: string;
  product_id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  sale_price: number;
  /** Quanto esta unidade custa quando é a premiada pela fidelidade. */
  loyalty_price: number;
  /** Quanto esta unidade custa dentro de um combo do modelo. */
  combo_price: number;
  available: number;
  image_url?: string | null;
}

interface CartItem extends CatalogRow {
  quantity: number;
}

/** O que `create_pending_order` devolve — o pedido como ele ficou GRAVADO. */
interface OrderReceipt {
  order_id: string;
  total: number;
  discount_total: number;
  discount_units: number;
}

/**
 * O comprovante já mastigado para a tela.
 *
 * Os números vêm todos do retorno do banco, não do carrinho: a function grava
 * `unit_price` lendo `products.sale_price` por dentro, então um preço alterado
 * entre abrir a loja e confirmar fazia o cliente mandar um total no WhatsApp e
 * o vendedor cobrar outro.
 */
interface SuccessOrder {
  ref: string;
  total: number;
  discountTotal: number;
  discountUnits: number;
  message: string;
}

/**
 * Erro de pedido em frase de gente.
 *
 * É uma lista de PERMISSÃO, não de tradução: o que não está aqui vira a frase
 * genérica. Enquanto o fim era `return message`, qualquer erro fora do mapa
 * chegava cru no cliente — `produto_nao_encontrado:8f3c1a2e-…` num dia ruim do
 * banco, `TypeError: Failed to fetch` numa queda de sinal.
 */
function friendlyError(message: string) {
  if (!navigator.onLine) return "Você está sem internet. Reconecte e tente de novo.";
  if (message.includes("nome_invalido")) return "Informe seu nome";
  if (message.includes("whatsapp_invalido")) return "Confira seu WhatsApp: DDD + número";
  if (message.includes("carrinho_vazio")) return "Seu carrinho está vazio";
  if (message.includes("quantidade_invalida")) return "Quantidade inválida";
  if (message.includes("pedido_muito_grande")) return "Pedido grande demais. Fale direto com o vendedor pelo WhatsApp.";
  if (message.includes("muitos_pedidos_pendentes"))
    return "Você já tem pedidos esperando resposta do vendedor. Fale com ele antes de mandar outro.";
  if (message.includes("estoque_insuficiente"))
    return "Um dos itens não tem mais estoque suficiente. Ajustei seu carrinho — confira e confirme de novo.";
  return "Não foi possível enviar o pedido. Tente novamente.";
}

/**
 * A mesma frase, mas dizendo QUAL item acabou.
 *
 * O banco levanta `estoque_insuficiente:<product_id>` e essa metade depois dos
 * dois-pontos era jogada fora — a pessoa descobria que algo deu errado, não o
 * quê, e era mandada recarregar a página, que é justamente o gesto que apagava
 * o carrinho dela.
 */
function orderErrorMessage(message: string, cart: CartItem[]) {
  const productId = message.split("estoque_insuficiente:")[1]?.trim();
  const item = productId ? cart.find(i => i.product_id === productId) : undefined;
  if (item) {
    return `Acabou o estoque de ${item.flavor || item.model || "um item"}. Ajustei seu carrinho — confira e confirme de novo.`;
  }
  return friendlyError(message);
}

/**
 * Teto da espera pela resposta do banco.
 *
 * Sem ele o `fetch` fica pendurado para sempre quando o sinal cai no meio do
 * envio: a água cobre a tela, o rótulo "Enviando pedido..." não sai mais, o
 * sheet fica trancado pelo `submitting` e a camada engole os toques. A única
 * saída era recarregar a página — que apaga o carrinho.
 *
 * O timeout é do lado de cá: o pedido PODE ter sido gravado. Quem resolve isso
 * é o `p_client_token`, que faz o reenvio devolver o mesmo pedido em vez de
 * criar um segundo.
 */
const ORDER_TIMEOUT_MS = 20_000;

/** Teto da observação de entrega. Espelha o `left(..., 300)` do banco. */
const FREIGHT_MAX = 300;

/**
 * Token do reenvio. `crypto.randomUUID` só existe em contexto seguro, e abrir
 * a loja no celular pelo IP da rede local (http://192.168…) não é um — sem o
 * fallback a página quebraria exatamente no ensaio.
 */
function newClientToken() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------- Carrinho que sobrevive ao reload ---------------- */

/**
 * O carrinho vivia só em `useState`: fechar sem querer, girar a tela num
 * navegador ruim ou voltar do WhatsApp apagava tudo. Ele volta do
 * `localStorage`, e o efeito de reconciliação conserta o que envelheceu
 * (preço, estoque, item que saiu do catálogo) contra o catálogo recém-lido.
 *
 * Por vendedor, porque a atribuição de estoque é por vendedor. O telefone é
 * global: é da pessoa, não da loja.
 */
const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cartKey = (sellerId?: string) => `loja:${sellerId ?? ""}:carrinho`;
const PHONE_KEY = "loja:whatsapp";

function readStoredCart(sellerId?: string): CartItem[] {
  try {
    const raw = localStorage.getItem(cartKey(sellerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { savedAt?: number; items?: CartItem[] };
    if (!Array.isArray(parsed?.items) || parsed.items.length === 0) return [];
    if (Date.now() - (parsed.savedAt ?? 0) > CART_TTL_MS) return [];
    // Duas linhas do MESMO produto não nascem mais aqui (o `addToCart` soma por
    // `product_id`), mas o que volta do storage pode ter sido gravado por uma
    // versão antiga — e duas linhas iguais viram dois blocos com a mesma `key`
    // no sheet, o mesmo sabor repetido e a quantidade partida ao meio.
    // Consolida antes de devolver: o carrinho tem uma linha por produto.
    const merged = new Map<string, CartItem>();
    parsed.items.forEach(item => {
      if (!item?.product_id) return;
      const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
      const prev = merged.get(item.product_id);
      if (prev) prev.quantity += qty;
      else merged.set(item.product_id, { ...item, quantity: qty });
    });
    return Array.from(merged.values()).filter(i => i.quantity > 0);
  } catch {
    // Aba anônima, cota cheia, navegador bloqueando site data: o carrinho só
    // não sobrevive ao reload. Nada aqui pode derrubar a loja.
    return [];
  }
}

function readStoredPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) ?? "";
  } catch {
    return "";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chip "Todos" — valor sentinela do filtro de marca. */
const ALL = "__all__";

/**
 * A loja é da empresa, não de cada vendedor: o cabeçalho mostra sempre a marca
 * da casa. O nome do vendedor continua indo na mensagem de WhatsApp do pedido,
 * que é onde ele importa.
 */
const COMPANY = "California Company";

/** Marca da casa: vem sempre primeiro no catálogo e com a cor de destaque. */
const FEATURED_BRAND = "ignite";

const isFeatured = (brand: string) => (brand || "").trim().toLowerCase() === FEATURED_BRAND;

/** Ordena marcas em ordem alfabética, mas com a marca de destaque no topo. */
function compareBrands(a: string, b: string) {
  const fa = isFeatured(a);
  const fb = isFeatured(b);
  if (fa !== fb) return fa ? -1 : 1;
  return (a || "").localeCompare(b || "", undefined, { numeric: true });
}

interface ModelGroup {
  key: string;
  brand: string;
  model: string;
  flavors: CatalogRow[];
}

interface BrandGroup {
  key: string;
  brand: string;
  models: ModelGroup[];
}

/**
 * O que `get_customer_loyalty` devolve. Só o primeiro nome: a function é
 * aberta a anon e devolvia nome completo, id e o telefone de volta — nada
 * disso era lido aqui.
 *
 * `cycle_units` (hoje 6) vem do banco de propósito: é ele que deixa esta tela
 * prever quantas unidades do carrinho saem premiadas sem repetir o número da
 * regra do lado de cá.
 */
interface Loyalty {
  customer_name: string;
  total_units: number;
  cycle_units: number;
  units_until_next_discount: number;
  discounts_used: number;
  loyalty_tier: string;
}

/**
 * Os números das promoções, lidos do banco (`get_store_rules`).
 *
 * Nenhum deles é digitado aqui pelo mesmo motivo que o ciclo 6 nunca foi: o
 * card da promoção e o tira-dúvidas FALAM esses números, e no dia em que a
 * regra mudar ela muda numa função SQL — a loja passa a dizer o valor novo
 * sozinha, sem tocar em .tsx. Enquanto a consulta não volta (ou se ela
 * falhar), a loja não promete desconto nenhum: o banco continua aplicando o
 * combo no pedido, e o comprovante mostra a economia que a prévia não previu.
 */
interface StoreRules {
  loyalty_cycle: number;
  combo_min_units: number;
  combo_discount: number;
  reservation_hours: number;
}

/**
 * A foto do modelo. Todas as linhas do mesmo modelo devolvem a MESMA url —
 * `get_seller_catalog` lê a foto de `product_model_images`, que é a tabela com
 * a chave certa (marca+modelo), e só cai em `products.image_url` quando não há
 * foto cadastrada.
 *
 * Enquanto a foto vinha da coluna por sabor, esta função era um sorteio: ela
 * pega o primeiro sabor COM imagem, na ordem (brand, flavor) que a function
 * devolve, e bastava um sabor com url velha em ordem alfabética anterior para
 * ele mandar na foto do modelo inteiro. Ver a migration
 * 20260909140000_foto_do_modelo_manda_no_catalogo.
 */
function firstModelImage(rows: CatalogRow[]) {
  for (const r of rows) if (r.image_url) return r.image_url;
  return null;
}

/**
 * A loja é desenhada para o telefone (o cliente chega por um link de WhatsApp).
 * No desktop a coluna fica centralizada nessa largura em vez de esticar.
 */
const COLUMN = "mx-auto w-full max-w-[480px]";

/**
 * Proporção única de toda foto de produto da loja. Antes cada tela travava uma
 * ALTURA em pixels e deixava a largura esticar com a coluna, então o mesmo card
 * era 1,59:1 num celular pequeno e 2,50:1 num grande — a foto ficava recortada
 * diferente em cada aparelho. Com a proporção fixa o quadro só muda de tamanho,
 * nunca de formato.
 */
const MEDIA_RATIO = "4 / 3";

/* ------------------------------------------------------------------ */
/* Peças de UI do tema                                                  */
/* ------------------------------------------------------------------ */

/** Altura padrão das pílulas da loja. As animações precisam dela em número. */
const PILL_HEIGHT = 50;

/**
 * Botão principal da loja: pílula, fundo accent, texto escuro. Desabilitado
 * esmaece o PREENCHIMENTO (não o botão inteiro), como no protótipo — por isso
 * não reaproveita o `Button` do shadcn, que aplica `disabled:opacity-50`.
 */
function PillButton({
  children,
  onClick,
  disabled,
  href,
  height = PILL_HEIGHT,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Quando existe, a pílula vira um link de verdade — ver abaixo. */
  href?: string;
  height?: number;
  className?: string;
}) {
  const style = {
    height,
    background: disabled ? "var(--sf-accent-soft)" : "var(--sf-accent)",
    color: "var(--sf-accent-ink)",
  };
  const cls = `flex w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold transition-opacity ${className}`;

  // Um `window.open` em `onClick` é bloqueado pelo navegador embutido do
  // Instagram e do Facebook — de onde vem boa parte dos links colados. Âncora
  // não é: ela é navegação, não popup. Só o compartilhar usa isto.
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} style={style} className={cls}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style} className={cls}>
      {children}
    </button>
  );
}

/** Duração da varredura do preenchimento do botão "Adicionar". */
const FILL_SECONDS = 0.7;

/** Quanto tempo o check fica na tela antes de o sheet fechar. */
const CHECK_HOLD_MS = 450;

/** Cor da fumaça: a mesma da borda quente da tinta e das plumas. */
const SMOKE_RGB = "245,243,238";

/**
 * Geometria da tinta que varre o botão, em px.
 *
 * O ruído que rasga a frente empurra TODAS as bordas da peça. Se ela terminasse
 * exatamente na área visível, o deslocamento abriria entalhes na esquerda e nas
 * laterais de cima e de baixo do botão. Por isso ela nasce maior que o botão
 * nos quatro lados: o rasgo acontece na sobra, que o `overflow-hidden` da
 * pílula corta fora.
 *
 * `LEAD` é maior que `FADE` de propósito. Quando a varredura termina, a faixa
 * que está se desfazendo já saiu inteira pela direita, então o botão fica com a
 * cor cheia em vez de terminar com um borrão claro na ponta.
 */
const INK_BLEED = 14;
const INK_LEAD = 34;
const INK_FADE = 28;

/** Largura da tinta (e da carruagem de fumaça) em relação ao botão. */
const INK_WIDTH = `calc(100% + ${INK_BLEED + INK_LEAD}px)`;

/**
 * Plumas que se desprendem da frente enquanto ela se desfaz.
 *
 * Nascem espalhadas pela ALTURA da borda, não num ponto só: é a faixa inteira
 * que está virando vapor, então a fumaça tem que sair de toda a frente. Os
 * atrasos diferentes fazem as gerações se sobreporem, em vez de piscarem todas
 * no mesmo compasso.
 */
const WISPS = [
  { top: "6%", size: 24, delay: 0, opacity: 0.5 },
  { top: "30%", size: 33, delay: 0.11, opacity: 0.6 },
  { top: "54%", size: 27, delay: 0.05, opacity: 0.54 },
  { top: "76%", size: 35, delay: 0.17, opacity: 0.48 },
  { top: "44%", size: 20, delay: 0.26, opacity: 0.64 },
];

/** Uma pluma nasce, sobe e some nesse tempo; várias gerações cabem na varredura. */
const WISP_CYCLE = 0.52;

/**
 * Botão "Adicionar" com a confirmação embutida: ao tocar, a tinta accent varre
 * o botão da esquerda para a direita sobre o fundo esmaecido, e a frente dessa
 * varredura não é uma borda reta — ela se DESFAZ. Os últimos px de tinta viram
 * um degradê que o ruído rasga, e desse esgarçado saem as plumas. Quando a
 * varredura chega ao fim, o rótulo dá lugar a um check no meio.
 *
 * O item entra no carrinho já no toque (`onPress`) — se a pessoa fechar o
 * sheet no meio da animação, nada se perde. O `onDone` só roda depois do
 * check, e é ele que fecha o sheet.
 */
function AddToCartButton({
  label,
  disabled,
  onPress,
  onDone,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "filling" | "done">("idle");
  const timer = useRef<number | null>(null);
  const edgeId = useId();
  const smokeId = useId();

  // O `onDone` desmonta este botão junto com o sheet: sem a limpeza, o timer
  // do check dispararia com o componente já fora da árvore.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const press = () => {
    // Ignora toque repetido: durante a animação o botão já está comprometido
    // com um item, e um segundo clique adicionaria em dobro.
    if (disabled || phase !== "idle") return;
    onPress();
    if (reduce) {
      onDone();
      return;
    }
    setPhase("filling");
  };

  // A tinta e a carruagem de fumaça andam com a MESMA geometria, a MESMA
  // duração e a MESMA curva — é um movimento só, visto de duas camadas. Se
  // fossem duas animações parecidas, a fumaça descolaria da borda no meio do
  // caminho. Anda em `x` (transform) em vez de crescer em `width`: assim o
  // filtro de ruído é rasterizado uma vez e só é deslocado a cada quadro, em
  // vez de ser remontado; e a porcentagem do transform é do próprio elemento,
  // então nada precisa medir o botão em JS.
  const sweep = {
    initial: { x: "-100%" },
    animate: { x: "0%" },
    transition: { duration: FILL_SECONDS, ease: EASE_IN_OUT },
  };

  return (
    // O botão precisa de `overflow-hidden` para recortar a tinta no formato da
    // pílula, e isso decapitaria qualquer pluma que subisse acima da borda. Por
    // isso a fumaça mora neste wrapper, fora do botão.
    <div className="relative flex-1">
      {phase !== "idle" && (
        // Dois ruídos, um para cada trabalho: o de baixo rasga a borda da tinta
        // (deslocamento curto e alongado na vertical, senão a faixa vira poça);
        // o de cima esgarça as plumas. Estáticos de propósito — animar o
        // `baseFrequency` remonta o filtro a cada quadro e engasga em celular
        // fraco.
        <svg aria-hidden width="0" height="0" className="absolute">
          <filter id={edgeId} x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.014 0.06" numOctaves="3" seed="4" result="ruido" />
            <feDisplacementMap in="SourceGraphic" in2="ruido" scale="17" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id={smokeId} x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.04" numOctaves="2" seed="7" result="ruido" />
            <feDisplacementMap in="SourceGraphic" in2="ruido" scale="26" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}

      <button
        type="button"
        onClick={press}
        disabled={disabled}
        style={{
          height: PILL_HEIGHT,
          background: disabled || phase !== "idle" ? "var(--sf-accent-soft)" : "var(--sf-accent)",
          color: "var(--sf-accent-ink)",
        }}
        className="relative w-full overflow-hidden rounded-full text-sm font-extrabold"
      >
        <span className="relative z-10 flex h-full items-center justify-center gap-2">{label}</span>

        {phase !== "idle" && (
          // Fica ACIMA do rótulo (z-20), não atrás: a tinta é opaca, então vai
          // encobrindo o texto conforme avança — é o preenchimento que confirma,
          // não o texto que some sozinho.
          //
          // A frente não termina numa linha reta: os últimos `INK_FADE` px
          // deixam de ser tinta, passam por uma faixa quente cor de fumaça e
          // acabam em transparente. É esse degradê que o filtro de ruído rasga,
          // e é por isso que a borda parece esfarelar em vez de avançar como um
          // retângulo.
          <motion.span
            aria-hidden
            className="absolute z-20"
            style={{
              left: -INK_BLEED,
              top: -INK_BLEED,
              bottom: -INK_BLEED,
              width: INK_WIDTH,
              background: `linear-gradient(to right,
                var(--sf-accent) 0,
                var(--sf-accent) calc(100% - ${INK_FADE}px),
                rgba(${SMOKE_RGB},0.42) calc(100% - ${Math.round(INK_FADE * 0.45)}px),
                rgba(${SMOKE_RGB},0) 100%)`,
              filter: `url(#${edgeId})`,
            }}
            {...sweep}
            onAnimationComplete={() => {
              setPhase("done");
              timer.current = window.setTimeout(onDone, CHECK_HOLD_MS);
            }}
          />
        )}

        {phase === "done" && (
          <motion.span
            className="absolute inset-0 z-30 flex items-center justify-center"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
          >
            <Check size={20} strokeWidth={3} />
          </motion.span>
        )}
      </button>

      {phase !== "idle" && (
        // `-top-14` é o céu por onde a fumaça sobe; `pointer-events-none` para
        // a camada não roubar toque de nada que fique embaixo.
        <div className="pointer-events-none absolute inset-x-0 -top-14 bottom-0 z-40">
          <div className="absolute inset-0" style={{ filter: `url(#${smokeId})` }}>
            {/* Carruagem: mesma caixa e mesmo percurso da tinta, mas com a
                altura do botão, para as plumas se distribuírem pela altura da
                borda que está se desfazendo. */}
            <motion.div
              className="absolute bottom-0"
              style={{ left: -INK_BLEED, width: INK_WIDTH, height: PILL_HEIGHT }}
              {...sweep}
            >
              {WISPS.map(w => (
                <motion.span
                  key={`${w.top}-${w.delay}`}
                  className="absolute rounded-full"
                  style={{
                    top: w.top,
                    // Ancorada logo atrás da ponta transparente, ou seja, em
                    // cima da faixa que está se desmanchando — a pluma sai da
                    // tinta, não do vazio à frente dela.
                    right: 22,
                    width: w.size * 1.2,
                    height: w.size,
                    marginTop: -w.size / 2,
                    marginRight: -w.size * 0.6,
                    // O gradiente já entrega a borda macia, então não precisa de
                    // `blur()` por cima — seriam cinco filtros a mais rodando
                    // junto com os dois de ruído.
                    background: `radial-gradient(closest-side, rgba(${SMOKE_RGB},${w.opacity}), rgba(${SMOKE_RGB},0) 72%)`,
                  }}
                  initial={{ opacity: 0, scale: 0.25, x: 0, y: 0 }}
                  // O `x` negativo é o rastro: a pluma recua enquanto a
                  // carruagem avança, então ela fica para trás no caminho já
                  // percorrido em vez de viajar rígida com a frente.
                  animate={{ opacity: [0, 1, 0], scale: [0.25, 1, 2], x: [0, -14, -38], y: [0, -12, -40] }}
                  transition={{
                    duration: WISP_CYCLE,
                    delay: w.delay,
                    ease: "easeOut",
                    times: [0, 0.28, 1],
                    // Repete só o suficiente para cobrir a varredura. Com
                    // `Infinity` as plumas continuavam brotando depois que a
                    // faixa parava, e o que era rastro virava um chafariz preso
                    // na ponta do botão. Assim a última geração termina de subir
                    // durante o check e a fumaça se dissipa sozinha.
                    repeat: Math.max(0, Math.round((FILL_SECONDS - w.delay) / WISP_CYCLE)),
                  }}
                />
              ))}
            </motion.div>

            {/* Sopro final, mais largo, na ponta onde a varredura terminou. */}
            {phase === "done" && (
              <motion.span
                className="absolute rounded-full"
                style={{
                  left: "100%",
                  bottom: 6,
                  width: 110,
                  height: 88,
                  marginLeft: -68,
                  background: `radial-gradient(closest-side, rgba(${SMOKE_RGB},0.5), rgba(${SMOKE_RGB},0) 70%)`,
                }}
                initial={{ opacity: 0, scale: 0.45, y: 4 }}
                animate={{ opacity: [0, 0.9, 0], scale: [0.45, 1.25, 2.1], x: [0, -16, -40], y: [4, -22, -58] }}
                transition={{ duration: 0.95, ease: "easeOut", times: [0, 0.24, 1] }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Quanto tempo a água leva para cobrir a tela, e para escoar depois. */
const FLOOD_RISE = 0.95;
const FLOOD_DRAIN = 0.7;

/**
 * Batida de tela cheia antes de a água escoar. É debaixo dela que a página
 * troca de conteúdo, então esse instante não pode ser zero: sem ele dá para
 * flagrar a troca acontecendo.
 */
const FLOOD_HOLD = 0.2;

/** Altura da crista da frente, em px. A de trás é um pouco mais alta. */
const CREST_HEIGHT = 26;

/**
 * Crista da onda: uma faixa de SVG do DOBRO da largura do botão, deslizando
 * para o lado em laço.
 *
 * O caminho tem dois períodos idênticos e o deslize é de exatos -50%, então no
 * instante em que ele reinicia o desenho está no mesmo lugar de onde saiu — o
 * laço não tem emenda. `preserveAspectRatio="none"` deixa a onda esticar até a
 * largura do botão sem achatar a altura junto.
 */
function WaveCrest({ opacity, height, duration }: { opacity: number; height: number; duration: number }) {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      className="absolute left-0"
      // O `+1` encosta a base da crista dentro do corpo da água: sem essa
      // sobreposição sobra um fio de 1px do fundo entre as duas peças.
      style={{ top: 1 - height, height, width: "200%", opacity, fill: "var(--sf-flood)" }}
      initial={{ x: "0%" }}
      animate={{ x: "-50%" }}
      transition={{ duration, ease: "linear", repeat: Infinity }}
    >
      <path d="M0,20 V12 Q25,2 50,12 T100,12 T150,12 T200,12 V20 Z" />
    </motion.svg>
  );
}

/**
 * Check que se desenha em vez de aparecer pronto: o traço sai da ponta
 * esquerda, desce até o vértice e sobe para a direita — o gesto de riscar o
 * certinho, não o símbolo já feito.
 *
 * O caminho é o do `Check` do lucide ESCRITO AO CONTRÁRIO. O de lá começa na
 * ponta direita (`M20 6 9 17l-5-5`), e `pathLength` corre na ordem em que o
 * caminho foi escrito — desenhado assim, o traço nasceria à direita e desceria
 * para a esquerda, de trás para frente.
 */
function DrawnCheck({ size = 18, strokeWidth = 3 }: { size?: number; strokeWidth?: number }) {
  const reduce = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <motion.path
        d="M4 12l5 5L20 6"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        // A perna curta (esquerda) e a longa (direita) levam o mesmo tempo em
        // `pathLength`, então a subida sai mais rápida que a descida sozinha —
        // que é como a mão risca de verdade.
        transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.08 }}
      />
    </svg>
  );
}

/**
 * Fases da onda que confirma o pedido.
 *
 * `rising` cobre a tela, `waiting` é a água cheia enquanto o banco ainda não
 * respondeu, `draining` escoa e revela o que ficou embaixo.
 */
type FloodPhase = "idle" | "rising" | "waiting" | "draining";

/**
 * A onda de confirmação. Toma a TELA inteira, de baixo para cima, e não só o
 * botão: é o pedido acontecendo, não um detalhe de um controle.
 *
 * Por isso ela mora na página e não dentro do botão — precisa passar por cima
 * do sheet do checkout (que é `z-50`) e continuar na tela depois que a página
 * troca para o comprovante. Como a raiz da loja não cria contexto de
 * empilhamento, um `fixed` com z acima do sheet basta.
 *
 * O ciclo é sempre o mesmo, dê certo ou não: sobe, cobre, escoa. O que muda é
 * o que a página põe embaixo da água enquanto ela está cheia — a tela de
 * compartilhar, se o pedido foi aceito; o próprio checkout, se não foi.
 */
function FloodLayer({
  phase,
  busyLabel,
  onCovered,
  onGone,
}: {
  phase: FloodPhase;
  busyLabel: string;
  onCovered: () => void;
  onGone: () => void;
}) {
  const draining = phase === "draining";

  /**
   * Rede de segurança do desfecho.
   *
   * Todo o fim do pedido — mostrar o comprovante, limpar o carrinho, destrancar
   * o sheet — pendura no `onAnimationComplete` lá embaixo. E ele pode não
   * chegar: aba em segundo plano congela o `requestAnimationFrame`, e trocar
   * para o WhatsApp logo depois de confirmar é justamente o que a pessoa faz
   * neste fluxo. O pedido ficaria gravado no banco sem ninguém ver.
   *
   * O timer é o MESMO desfecho por um caminho que o navegador não congela. Os
   * dois callbacks são seguros de chamar duas vezes (`settleFlood` reconfere as
   * condições), então disparar junto com a animação não faz mal.
   *
   * O callback fica num ref porque ele nasce de novo a cada render da página:
   * como dependência do efeito, reiniciaria o timer para sempre.
   */
  const done = useRef<() => void>(() => {});
  done.current = draining ? onGone : onCovered;
  useEffect(() => {
    if (phase === "idle" || phase === "waiting") return;
    const ms = ((draining ? FLOOD_DRAIN + FLOOD_HOLD : FLOOD_RISE) + 0.4) * 1000;
    const t = setTimeout(() => done.current(), ms);
    return () => clearTimeout(t);
  }, [phase, draining]);

  if (phase === "idle") return null;

  return (
    // A moldura que recorta. As cristas têm o DOBRO da largura da tela e moram
    // acima da linha d'água, então precisam de algo aparando as sobras: sem
    // isto elas vazariam pelos lados e apareceriam sobrando por cima quando a
    // água enche. O recorte não pode estar na própria água — ele decapitaria a
    // crista, que fica fora do quadro dela.
    //
    // Também é esta camada que engole os toques: com o pedido em trânsito,
    // nada atrás dela deve responder.
    <div
      // O rótulo de espera é a única pista de que algo está acontecendo; num
      // pedido lento ele precisa ser lido em voz alta.
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] overflow-hidden"
    >
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        // `--sf-flood`, e não `--sf-accent`: esta cor tem que ser a mesma do
        // fundo do comprovante nos dois lados da troca, e o accent vira outra
        // coisa no tema invertido.
        style={{ background: "var(--sf-flood)", color: "var(--sf-flood-ink)" }}
        // Montar já em `draining` é como se sai do comprovante: a tela ali já
        // é deste mesmo accent, então a água aparece coberta (invisível) e
        // escoa levando o comprovante embora, em vez de cortar seco para o
        // catálogo escuro.
        initial={{ y: draining ? "0%" : "100%" }}
        animate={{ y: draining ? "100%" : "0%" }}
        transition={{
          duration: draining ? FLOOD_DRAIN : FLOOD_RISE,
          delay: draining ? FLOOD_HOLD : 0,
          ease: EASE_IN_OUT,
        }}
        // A mesma peça sobe e desce, então o desfecho depende de qual dos dois
        // percursos acabou de terminar.
        onAnimationComplete={() => (draining ? onGone() : onCovered())}
      >
        {/* Duas cristas em velocidades diferentes: é o descompasso entre elas
            que dá volume à água. A de trás é mais alta e translúcida. */}
        <WaveCrest opacity={0.4} height={CREST_HEIGHT + 12} duration={2.4} />
        <WaveCrest opacity={1} height={CREST_HEIGHT} duration={1.6} />

        {phase === "waiting" && (
          // A água chegou ao topo e o banco ainda não respondeu. Sem isto a
          // tela ficaria azul e muda, parecendo travada.
          <motion.span
            className="text-sm font-extrabold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
          >
            {busyLabel}
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}
/**
 * Foto do produto. Preenche o quadro que o pai definir.
 *
 * `contain` (padrão) é para as fotos grandes: as URLs são coladas à mão no
 * ModelImagesDialog e vêm em qualquer proporção, então cortar (`cover`)
 * decepava justamente os packshots verticais. O que sobra da moldura é
 * preenchido por uma cópia ampliada e borrada da própria foto — antes ficava
 * uma tarja cinza chapada denunciando a diferença de proporção.
 *
 * `cover` é para miniatura: em 56px não cabe tarja, e o corte central não
 * atrapalha o reconhecimento.
 */
function ProductMedia({
  src,
  alt,
  iconSize,
  fit = "contain",
}: {
  src: string | null;
  alt: string;
  iconSize: number;
  fit?: "contain" | "cover";
}) {
  // Link quebrado cai no mesmo placeholder do produto sem foto, em vez de
  // mostrar o ícone de imagem partida do navegador.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "var(--sf-surface)" }}
    >
      {src && !failed ? (
        <>
          {fit === "contain" && (
            // Decoração: o alt de verdade está na imagem da frente. É a mesma
            // URL da outra <img>, então o navegador serve do cache em vez de
            // baixar duas vezes. `scale-110` cobre o halo transparente que o
            // blur deixa na borda.
            <img
              src={src}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
              style={{ opacity: 0.5 }}
              loading="lazy"
              decoding="async"
            />
          )}
          <img
            src={src}
            alt={alt}
            onError={() => setFailed(true)}
            className={`relative h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
            loading="lazy"
            decoding="async"
          />
        </>
      ) : (
        <Package size={iconSize} style={{ color: "var(--sf-text-dim)" }} />
      )}
    </div>
  );
}

/** Aparência dos campos de texto da loja (WhatsApp, nome, observações). */
const FIELD_CLASS = "rounded-[14px] text-[15px]";
const FIELD_STYLE = {
  background: "var(--sf-surface)",
  border: "1px solid var(--sf-border)",
  color: "var(--sf-text)",
};

/** Campo rotulado. `htmlFor` amarrado ao `id` do controle que vem como filho. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold" style={{ color: "var(--sf-text-muted)" }}>
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Cabeçalho comum aos sheets de carrinho e checkout. */
/**
 * A linha do desconto da fidelidade, acima do total.
 *
 * Aparece no carrinho e no checkout — a mesma peça nos dois, porque é o mesmo
 * número e ele não pode ser escrito de dois jeitos. Some quando não há
 * desconto: linha de "R$ 0,00 de desconto" só ocupa espaço lembrando o que a
 * pessoa não ganhou.
 */
/**
 * As linhas de desconto acima do total — UMA POR REGRA, nunca as duas somadas
 * num número só. Quem leva 6 unidades do mesmo modelo ganha pelos dois lados,
 * e "−R$ 44,00" sem dizer de onde veio é um número que ninguém confere; com as
 * duas linhas a pessoa vê o que o combo deu e o que a fidelidade deu.
 *
 * Some a linha que não tem desconto: "R$ 0,00 de desconto" só lembra o que a
 * pessoa não ganhou. A mesma peça serve o carrinho e o checkout, porque é o
 * mesmo número e ele não pode ser escrito de dois jeitos.
 */
function DiscountLines({ preview }: { preview: DiscountPreview }) {
  const linhas = [
    { key: "combo", icon: "🏷️", label: "Combo de modelo", units: preview.comboUnits, amount: preview.comboTotal },
    { key: "fidelidade", icon: "🎁", label: "Fidelidade", units: preview.loyaltyUnits, amount: preview.loyaltyTotal },
  ].filter(l => l.amount > 0);

  if (linhas.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {linhas.map(l => (
        <div key={l.key} className="flex items-center justify-between text-[13px]">
          <span style={{ color: "var(--sf-text-muted)" }}>
            {l.icon} {l.label} · {l.units === 1 ? "1 unidade" : `${l.units} unidades`}
          </span>
          <span className="font-extrabold" style={{ color: "var(--sf-accent)" }}>
            −{fmt(l.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SheetTopBar({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-between px-5 pb-3.5 pt-5"
      style={{ borderBottom: "1px solid var(--sf-hairline)" }}
    >
      <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
        {title}
      </SheetTitle>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Controle de quantidade em pílula. `compact` é a versão do carrinho. */
function QtyStepper({
  qty,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
  compact = false,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-2.5 py-1.5" : "px-3.5 py-[11px]";
  const icon = compact ? 11 : 13;
  return (
    <div
      className="flex w-fit items-center rounded-full"
      style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
    >
      <button type="button" onClick={onDec} disabled={decDisabled} className={`${pad} disabled:opacity-40`}>
        <Minus size={icon} />
      </button>
      <span
        className={`text-center font-bold ${compact ? "w-[22px] text-[12.5px]" : "w-7 text-sm"}`}
        aria-live="polite"
      >
        {qty}
      </span>
      <button type="button" onClick={onInc} disabled={incDisabled} className={`${pad} disabled:opacity-40`}>
        <Plus size={icon} />
      </button>
    </div>
  );
}

/**
 * Chips de marca com o preenchimento accent como peça única: em vez de cada
 * chip pintar o próprio fundo, só o ativo renderiza o `motion.span` com
 * `layoutId`, então o motion anima a peça deslizando do chip antigo pro novo.
 * Mesmo padrão do `SegmentedToggle`, adaptado ao tema da loja.
 */
function BrandChips({
  chips,
  active,
  onChange,
}: {
  chips: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();
  const activeRef = useRef<HTMLButtonElement>(null);

  // A linha rola na horizontal: sem isso, tocar numa marca fora da área
  // visível faz o pill viajar pra fora da tela.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [active, reduce]);

  return (
    // overscroll-x-contain: sem isso, arrastar os chips até o fim dispara
    // o gesto de "voltar" do navegador no celular.
    // layoutScroll: avisa o motion que este container rola, senão ele mede a
    // posição do pill sem descontar o scroll e a peça pousa no lugar errado.
    <motion.div layoutScroll className="mt-3.5 flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
      {chips.map(c => {
        const isActive = c.key === active;
        return (
          <button
            key={c.key}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={isActive}
            className="relative flex-none rounded-full px-4 py-2 text-[12.5px] font-bold transition-colors duration-200"
            style={{
              background: "var(--sf-surface)",
              color: isActive ? "var(--sf-accent-ink)" : "var(--sf-text-muted)",
            }}
          >
            {isActive && (
              <motion.span
                layoutId={reduce ? undefined : pillId}
                className="absolute inset-0 rounded-full"
                style={{ background: "var(--sf-accent)" }}
                transition={{ duration: 0.28, ease: EASE_OUT }}
              />
            )}
            <span className="relative z-10">{c.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Avisos da loja                                                       */
/* ------------------------------------------------------------------ */

/** Quanto cada aviso fica na frente antes de o próximo entrar. */
const NOTICE_MS = 3000;
/** Largura do card no trilho. O resto é a espiada do próximo. */
const NOTICE_WIDTH = "86%";
const NOTICE_GAP = "10px";

interface Notice {
  key: string;
  icon: typeof Tag;
  eyebrow: string;
  title: string;
  body: string;
  /** O primeiro aviso é a promoção e usa o fundo accent. */
  featured?: boolean;
}

/**
 * O trilho de avisos acima da busca.
 *
 * Ele ANDA SOZINHO a cada 3s e passa ao próximo NO TOQUE — não no arraste. A
 * loja inteira é uma coluna que rola na vertical; um trilho que responde ao
 * arraste horizontal roubaria o gesto de rolar sempre que o dedo encostasse
 * torto, e no iOS ainda disputaria o gesto de voltar. A espiada do próximo
 * card (os 14% que sobram) é o que conta que há mais coisa ali — é ela que faz
 * o toque acontecer, e o pontinho embaixo confirma quantos são.
 *
 * Um aviso só não gira nem mostra pontinho: não há para onde ir.
 *
 * O passo é `calc(86% + 10px)` — a largura do card mais o vão. Por isso quem
 * anima é o CSS e não o motion: `x` do motion não interpola `calc` com
 * porcentagem, e a porcentagem aqui é indispensável (ela é da largura do
 * trilho, então o mesmo código serve de 320px a 480px sem medir nada em JS).
 */
function StoreNotices({ notices }: { notices: Notice[] }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const total = notices.length;

  // Um `setTimeout` por índice, não um `setInterval`: assim o toque também
  // reinicia a contagem, em vez de o próximo aviso entrar logo depois de a
  // pessoa ter acabado de trocar na mão.
  //
  // Com movimento reduzido o trilho NÃO anda sozinho: trocar o texto embaixo
  // do olho de quem pediu menos movimento é pior que animar: sem transição
  // nem sequer há o rastro que explica a troca. Ali ele vira o que já é no
  // toque — um card por vez, e a pessoa passa quando quiser.
  useEffect(() => {
    if (total < 2 || reduce) return;
    const t = window.setTimeout(() => setI(v => (v + 1) % total), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [i, total, reduce]);

  // O catálogo muda e o aviso some (a promoção depende das regras do banco):
  // sem isto o índice ficaria apontando para um card que não existe mais.
  useEffect(() => {
    setI(v => (v < total ? v : 0));
  }, [total]);

  if (total === 0) return null;

  return (
    <div className="mt-3.5">
      <button
        type="button"
        onClick={() => setI(v => (v + 1) % total)}
        aria-label={total > 1 ? `Ver o próximo aviso (${i + 1} de ${total})` : undefined}
        disabled={total < 2}
        className="block w-full overflow-hidden text-left"
      >
        <div
          className="flex"
          style={{
            gap: NOTICE_GAP,
            transform: `translateX(calc(${-i} * (${NOTICE_WIDTH} + ${NOTICE_GAP})))`,
            transition: reduce ? undefined : `transform 0.42s ${CSS_EASE_OUT}`,
          }}
        >
          {notices.map((n, k) => {
            const Icon = n.icon;
            return (
              <article
                key={n.key}
                aria-hidden={k !== i}
                className="flex flex-none flex-col gap-0.5 rounded-[18px] px-3.5 py-3"
                style={{
                  width: NOTICE_WIDTH,
                  background: n.featured ? "var(--sf-accent-tint)" : "var(--sf-surface)",
                  border: `1px solid ${n.featured ? "var(--sf-accent-line)" : "var(--sf-hairline)"}`,
                }}
              >
                <span
                  className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--sf-accent)" }}
                >
                  <Icon size={12} />
                  {n.eyebrow}
                </span>
                <span className="text-[13.5px] font-extrabold">{n.title}</span>
                <span className="text-xs leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                  {n.body}
                </span>
              </article>
            );
          })}
        </div>
      </button>

      {total > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {notices.map((n, k) => (
            <span
              key={n.key}
              className="h-[5px] rounded-full transition-all duration-300"
              style={{
                width: k === i ? 14 : 5,
                background: k === i ? "var(--sf-accent)" : "var(--sf-text-dim)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card do catálogo                                                     */
/* ------------------------------------------------------------------ */

function ProductCard({ model, onOpen }: { model: ModelGroup; onOpen: () => void }) {
  const allRows = model.flavors;
  const inStock = allRows.filter(r => r.available > 0);
  const prices = (inStock.length ? inStock : allRows).map(r => r.sale_price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const samePrice = prices.every(p => p === prices[0]);
  // Conta o que dá para comprar, não o que existe: um modelo de oito sabores
  // com seis zerados anunciava "8 sabores" e abria com seis desabilitados.
  // Quando não sobrou nenhum, a foto já está marcada como esgotada e o número
  // volta a ser o do catálogo inteiro.
  const flavorCount = inStock.length || allRows.length;
  const allOut = inStock.length === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer overflow-hidden rounded-[20px]"
      style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
    >
      <div className="relative w-full" style={{ aspectRatio: MEDIA_RATIO }}>
        <ProductMedia src={firstModelImage(allRows)} alt={model.model || "Produto"} iconSize={56} />

        {allOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--sf-text-muted)" }}>
              Esgotado
            </span>
          </div>
        )}

        {/* Abre o mesmo sheet do card: o sabor sempre tem que ser escolhido,
            então não existe "adicionar às cegas". */}
        <button
          type="button"
          aria-label={`Ver opções de ${model.model || "produto"}`}
          onClick={e => {
            e.stopPropagation();
            onOpen();
          }}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          style={{
            background: "var(--sf-accent)",
            color: "var(--sf-accent-ink)",
            border: "2px solid var(--sf-bg)",
          }}
        >
          <Plus size={15} strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <p className="truncate text-base font-bold">{model.model || "Sem modelo"}</p>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span
            className="flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-faint)" }}
          >
            {flavorCount} {flavorCount === 1 ? "sabor" : "sabores"}
          </span>
          <span className="text-[15px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
            {samePrice ? fmt(minPrice) : `A partir de ${fmt(minPrice)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function SellerStorePage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const validId = !!sellerId && UUID_RE.test(sellerId);
  // Realce flutuante da lista de sabores. Ficam aqui em cima porque abaixo há
  // returns antecipados (link inválido, identificação, sucesso) e hook não
  // pode ficar depois de um return.
  const reduceMotion = useReducedMotion();
  const flavorPillId = useId();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Falha ao carregar o catálogo — ocupa o lugar da lista. */
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeBrand, setActiveBrand] = useState<string>(ALL);
  /** Os números das promoções, vindos do banco. Ver StoreRules. */
  const [rules, setRules] = useState<StoreRules | null>(null);

  const [cart, setCart] = useState<CartItem[]>(() => readStoredCart(sellerId));
  /** O que a reconciliação com o catálogo mexeu no carrinho guardado. */
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [freight, setFreight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** O pedido que o banco gravou. Enquanto existe, a tela é o comprovante. */
  const [success, setSuccess] = useState<SuccessOrder | null>(null);

  // A onda de confirmação e o encontro dela com a resposta do banco.
  //
  // Os três valores abaixo ficam em ref, e não em state, porque cada lado
  // termina no seu próprio callback e precisa ler o que o OUTRO acabou de
  // escrever — não a cópia congelada do render em que ele nasceu.
  const [flood, setFlood] = useState<FloodPhase>("idle");
  /** A água já cobriu a tela. */
  const floodCovered = useRef(false);
  /** `null` = banco ainda não respondeu. */
  const orderAccepted = useRef<boolean | null>(null);
  /** Pedido aceito, pronto, esperando a água escoar para virar tela. */
  const pendingSuccess = useRef<SuccessOrder | null>(null);
  /** Erro a mostrar depois que a água sair da frente. */
  const pendingError = useRef<string | null>(null);
  /**
   * O token que faz "tentar de novo" continuar sendo O MESMO pedido.
   *
   * Nasce no primeiro envio e só é trocado depois de um pedido aceito. É ele
   * que impede o timeout de virar pedido duplicado: se a primeira tentativa
   * chegou no banco e a resposta é que se perdeu, a segunda devolve o pedido
   * que já existe em vez de criar outro.
   */
  const clientToken = useRef<string | null>(null);
  /** Recusa do pedido, mostrada dentro do checkout — a água devolve a pessoa nele. */
  const [orderError, setOrderError] = useState<string | null>(null);

  // Detalhe do produto: um único sheet na página, não um por card.
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [qty, setQty] = useState(1);

  // Identificação do cliente. Mora no CHECKOUT, não na entrada: o link chega
  // pelo WhatsApp e muita gente abre só para dar uma olhada — pedir telefone
  // antes de mostrar um preço perde essa pessoa na primeira tela. O dado só é
  // necessário no momento em que o pedido vai virar um registro no banco.
  //
  // O nome só é perguntado quando o WhatsApp não acha cadastro; se acha, ele
  // vem de lá junto com a fidelidade e o campo nem aparece.
  //
  // O telefone volta do `localStorage`: quem já comprou uma vez abre o
  // checkout com o campo preenchido, a fidelidade dele carrega sozinha e não
  // sobra nada para digitar.
  const [phoneInput, setPhoneInput] = useState(readStoredPhone);
  const [nameInput, setNameInput] = useState("");
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);

  const phoneDigits = onlyDigits(phoneInput);
  // A mesma régua do banco e do resto do app, de um lugar só.
  const phoneComplete = isValidPhone(phoneDigits);
  const customerName = (loyalty?.customer_name ?? nameInput).trim();

  useEffect(() => {
    if (!phoneComplete) {
      setLoyalty(null);
      setLookupDone(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    // Espera a digitação parar. Um telefone de 11 dígitos ficava completo aos
    // 10 e de novo aos 11: duas consultas por número digitado.
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("get_customer_loyalty", { p_whatsapp: phoneDigits });
      if (cancelled) return;
      // Sem aviso de erro aqui: a busca é um extra, e a falha já tem saída
      // visível — sem cadastro, o campo de nome aparece e o pedido segue igual.
      const row = ((data as unknown as Loyalty[] | null) ?? [])[0] ?? null;
      setLoyalty(row);
      setLookupDone(true);
      setLookupLoading(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [phoneDigits, phoneComplete]);

  /** O telefone é da pessoa, não da loja: fica guardado para a próxima visita. */
  useEffect(() => {
    if (!phoneComplete) return;
    try {
      localStorage.setItem(PHONE_KEY, phoneDigits);
    } catch {
      // Ver readStoredCart: guardar é conveniência, nunca requisito.
    }
  }, [phoneDigits, phoneComplete]);

  const load = useCallback(async () => {
    if (!validId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_seller_catalog", { p_seller_id: sellerId });
    setLoadError(!!error);
    setRows((data as CatalogRow[]) ?? []);
    setLoading(false);
  }, [sellerId, validId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * As regras das promoções. Consulta separada do catálogo de propósito: ela
   * não depende do vendedor, não muda entre um load e outro, e uma falha aqui
   * não pode derrubar a lista de produtos — sem elas a loja só deixa de
   * PROMETER o desconto na tela; o banco continua aplicando no pedido.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_store_rules");
      if (cancelled) return;
      setRules(((data as unknown as StoreRules[] | null) ?? [])[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * O carrinho segue o catálogo.
   *
   * Cada item guardava a foto do momento em que entrou — preço e estoque
   * congelados. Como a function grava `unit_price` lendo a tabela, o total na
   * tela podia divergir do que ficava gravado; e a quantidade só era conferida
   * contra o estoque no último toque, virando `estoque_insuficiente` em cima
   * do "Confirmar". Aqui o carrinho é reconciliado toda vez que o catálogo
   * chega: no primeiro load, no recarregar depois de um pedido e no
   * `load()` que a recusa por estoque dispara.
   *
   * É também o que torna seguro devolver um carrinho de ontem do
   * `localStorage`: o que envelheceu é corrigido antes de a pessoa ver.
   */
  useEffect(() => {
    if (rows.length === 0 || cart.length === 0) return;
    const saiu: string[] = [];
    let mudou = false;
    const next = cart.flatMap<CartItem>(item => {
      const fresh = rows.find(r => r.product_id === item.product_id);
      if (!fresh || fresh.available <= 0) {
        saiu.push(item.flavor || item.model || "um item");
        mudou = true;
        return [];
      }
      const quantity = Math.min(item.quantity, fresh.available);
      if (quantity !== item.quantity || fresh.sale_price !== item.sale_price) mudou = true;
      return [{ ...fresh, quantity }];
    });
    if (!mudou) return;
    setCart(next);
    setCartNotice(
      saiu.length > 0
        ? `Tiramos do carrinho: ${saiu.join(", ")} — acabou o estoque.`
        : "Ajustamos as quantidades do seu carrinho ao estoque de agora.",
    );
  }, [rows, cart]);

  /** Guarda o carrinho para a próxima visita. Ver readStoredCart. */
  useEffect(() => {
    try {
      if (cart.length === 0) localStorage.removeItem(cartKey(sellerId));
      else localStorage.setItem(cartKey(sellerId), JSON.stringify({ savedAt: Date.now(), items: cart }));
    } catch {
      // Nada a fazer: o carrinho só não sobrevive ao reload.
    }
  }, [cart, sellerId]);

  const sellerName = rows[0]?.seller_name ?? "";

  /** Marcas para os chips — do catálogo inteiro, não do resultado filtrado. */
  const brands = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      const b = (r.brand || "").trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort(compareBrands);
  }, [rows]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const modelMap = new Map<string, ModelGroup>();
    rows.forEach((r, idx) => {
      const hasKey = (r.brand || "").trim() !== "" || (r.model || "").trim() !== "";
      const key = hasKey ? `${r.brand}|||${r.model}` : `__sem_modelo__${idx}`;
      if (!modelMap.has(key)) modelMap.set(key, { key, brand: r.brand, model: r.model, flavors: [] });
      modelMap.get(key)!.flavors.push(r);
    });

    let models = Array.from(modelMap.values());
    if (activeBrand !== ALL) models = models.filter(m => (m.brand || "").trim() === activeBrand);
    if (q) {
      models = models
        .map(m => ({
          ...m,
          flavors: m.flavors.filter(r =>
            [r.brand, r.model, r.flavor, r.name].some(v => (v || "").toLowerCase().includes(q)),
          ),
        }))
        .filter(m => m.flavors.length > 0);
    }
    models.forEach(m =>
      m.flavors.sort((a, b) => (a.flavor || "").localeCompare(b.flavor || "", undefined, { numeric: true })),
    );
    models.sort((a, b) => (a.model || "").localeCompare(b.model || "", undefined, { numeric: true }));

    const brandMap = new Map<string, BrandGroup>();
    models.forEach(m => {
      const bKey = (m.brand || "").trim() || "__sem_marca__";
      if (!brandMap.has(bKey)) brandMap.set(bKey, { key: bKey, brand: m.brand, models: [] });
      brandMap.get(bKey)!.models.push(m);
    });

    return Array.from(brandMap.values()).sort((a, b) => compareBrands(a.brand, b.brand));
  }, [rows, query, activeBrand]);

  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.quantity, 0), [cart]);

  /**
   * Quanto de cada produto JÁ está no carrinho.
   *
   * O sheet de detalhe abria sempre em "1" e não dizia nada sobre o que já
   * tinha sido escolhido: a pessoa apertava "Adicionar" de novo achando que
   * não tinha funcionado. Com o estoque cheio no carrinho o toque virava
   * confirmação (a varredura de tinta e o check) sem mexer em nada, porque o
   * `addToCart` trava a soma no estoque — parecia que o item entrava toda vez.
   */
  const cartQtyById = useMemo(() => new Map(cart.map(i => [i.product_id, i.quantity] as const)), [cart]);

  /**
   * O total com os dois descontos já dentro. A conta (e o porquê de ela
   * precisar bater com a do banco) mora em `src/lib/cart-discount.ts`.
   *
   * O COMBO não espera ninguém: ele depende só do que está no carrinho, então
   * aparece antes de o WhatsApp ser digitado. A FIDELIDADE só entra quando o
   * cadastro é encontrado — é a posição do cliente no ciclo que decide, e ela
   * não existe antes disso.
   */
  const preview = useMemo(
    () =>
      previewCartDiscount(cart, {
        comboMinUnits: rules?.combo_min_units,
        loyalty: loyalty ? { historyUnits: loyalty.total_units, cycleUnits: loyalty.cycle_units } : null,
      }),
    [cart, loyalty, rules],
  );
  const { total, fullTotal, discountTotal } = preview;

  /**
   * Os avisos que giram acima da busca.
   *
   * A promoção só entra quando as regras chegam do banco: é dali que saem o
   * "2 ou mais" e o valor do desconto, e um card que anuncia promoção sem
   * dizer o tamanho dela não vale a tela que ocupa. O tira-dúvidas não depende
   * de nada e está sempre lá — é ele que apresenta o botão novo.
   */
  const notices = useMemo<Notice[]>(() => {
    const list: Notice[] = [];
    if (rules && rules.combo_discount > 0 && rules.combo_min_units > 1) {
      list.push({
        key: "combo",
        icon: Tag,
        eyebrow: "Promoção",
        title: "Combo de modelo",
        body: `Leve ${rules.combo_min_units} ou mais unidades do mesmo modelo — pode misturar os sabores — e cada uma sai ${fmt(rules.combo_discount)} mais barata.`,
        featured: true,
      });
    }
    list.push({
      key: "ajuda",
      icon: Info,
      eyebrow: "Tira-dúvidas",
      title: "Ficou com dúvida?",
      body: "Toque no i ao lado do carrinho: fidelidade, combo e como o pedido chega ao vendedor.",
    });
    return list;
  }, [rules]);

  /**
   * As perguntas do tira-dúvidas.
   *
   * Resposta que precisa de número só aparece com as regras carregadas — é
   * preferível uma pergunta a menos a uma frase com buraco no meio. O texto é
   * daqui mesmo, sem banco: mudar uma resposta é mudar uma string.
   */
  const faq = useMemo(() => {
    const list: { q: string; a: string }[] = [];
    if (rules) {
      list.push({
        q: "Como funciona a fidelidade?",
        a: `A cada ${rules.loyalty_cycle} unidades compradas, uma sai pela metade do preço. O desconto já entra no total do pedido — não precisa pedir.`,
      });
      if (rules.combo_discount > 0 && rules.combo_min_units > 1) {
        list.push({
          q: "O que é o combo de modelo?",
          a: `Levando ${rules.combo_min_units} ou mais unidades do mesmo modelo, misturando os sabores ou não, cada uma sai ${fmt(rules.combo_discount)} mais barata. O desconto aparece no carrinho, antes de você confirmar.`,
        });
        list.push({
          q: "Dá para juntar o combo com a fidelidade?",
          a: "Na unidade premiada vale o melhor dos dois preços, nunca os dois somados. As outras unidades do modelo continuam com o desconto do combo.",
        });
      }
    }
    list.push({
      q: "Como o pedido é confirmado?",
      a: rules
        ? `Você finaliza aqui e manda a mensagem no WhatsApp. O estoque fica guardado para você por ${rules.reservation_hours} horas, até o vendedor confirmar.`
        : "Você finaliza aqui e manda a mensagem no WhatsApp. O estoque fica guardado para você até o vendedor confirmar.",
    });
    list.push({
      q: "Como eu pago?",
      a: "Pix ou dinheiro, direto com o vendedor na entrega. Nada é cobrado por aqui.",
    });
    list.push({
      q: "O preço pode mudar depois que eu enviar?",
      a: "Não. Vale o valor do pedido gravado — é ele que aparece no comprovante e na mensagem do WhatsApp.",
    });
    return list;
  }, [rules]);

  /** Modelo aberto no sheet de detalhe, achado entre os grupos já montados. */
  const detailModel = useMemo(() => {
    if (!detailKey) return null;
    for (const g of groups) {
      const m = g.models.find(mm => mm.key === detailKey);
      if (m) return m;
    }
    return null;
  }, [detailKey, groups]);

  const selectedFlavor =
    detailModel?.flavors.find(f => f.product_id === selectedId) ??
    detailModel?.flavors.find(f => f.available > 0) ??
    detailModel?.flavors[0] ??
    null;
  const available = selectedFlavor?.available ?? 0;
  /** O que esse sabor já ocupa no carrinho, e o que ainda cabe além disso. */
  const inCart = selectedFlavor ? cartQtyById.get(selectedFlavor.product_id) ?? 0 : 0;
  const room = Math.max(0, available - inCart);
  const clampedQty = Math.min(Math.max(1, qty), Math.max(room, 1));

  const openDetail = (model: ModelGroup) => {
    const first = model.flavors.find(f => f.available > 0) ?? model.flavors[0];
    setSelectedId(first?.product_id ?? "");
    setQty(1);
    setDetailKey(model.key);
  };

  const addToCart = (row: CatalogRow, requested = 1) => {
    const qtyToAdd = Math.min(Math.max(1, requested), row.available);
    setCart(prev => {
      const existing = prev.find(i => i.product_id === row.product_id);
      if (existing) {
        return prev.map(i =>
          i.product_id === row.product_id ? { ...i, quantity: Math.min(i.quantity + qtyToAdd, row.available) } : i,
        );
      }
      return [...prev, { ...row, quantity: qtyToAdd }];
    });
    // Sem toast aqui: quem confirma agora é o próprio botão (`AddToCartButton`),
    // que preenche e vira um check antes de o sheet fechar. Um toast por cima
    // seria a mesma confirmação duas vezes, e ainda por cima da animação.
  };

  const setItemQty = (productId: string, q: number) => {
    setCart(prev =>
      prev.map(i => (i.product_id === productId ? { ...i, quantity: Math.min(Math.max(1, q), i.available) } : i)),
    );
  };

  const removeItem = (productId: string) => setCart(prev => prev.filter(i => i.product_id !== productId));

  /**
   * A mensagem que o cliente encaminha ao vendedor.
   *
   * O TOTAL e o DESCONTO vêm do recibo do banco, não do carrinho: é o pedido
   * gravado que o vendedor vai confirmar. Os itens continuam saindo do
   * carrinho, que é de onde vêm as quantidades.
   *
   * A referência curta é o que amarra esta mensagem ao card em /minhas-vendas
   * e à nota da venda ("Pedido via catálogo #<uuid>", da qual ela é o começo).
   * Sem ela, cliente que pede duas vezes no mesmo dia virava adivinhação.
   */
  const buildMessage = (recibo: Pick<SuccessOrder, "ref" | "total" | "discountTotal" | "discountUnits">) => {
    const lines: string[] = [];
    lines.push(`🛒 Novo pedido ${recibo.ref}`);
    lines.push(``);
    if (sellerName) lines.push(`👤 Vendedor: ${sellerName}`);
    lines.push(`🙋 Cliente: ${customerName}`);
    lines.push(``);
    lines.push(`📦 ITENS`);
    cart.forEach(i => {
      lines.push(
        `• ${i.flavor} · ${i.model} (${i.quantity}x) • ${fmt(i.sale_price)} = ${fmt(i.sale_price * i.quantity)}`,
      );
    });
    lines.push(`──────────────────────────────`);
    if (recibo.discountTotal > 0) {
      // "Desconto", não "Fidelidade": o recibo do banco devolve UM número, que
      // hoje pode ser fidelidade, combo de modelo ou os dois juntos. Nomear a
      // regra errada na mensagem que vai para o vendedor é pior que não nomear.
      const un = recibo.discountUnits === 1 ? "unidade" : "unidades";
      lines.push(`🎁 Desconto (${recibo.discountUnits} ${un}): -${fmt(recibo.discountTotal)}`);
    }
    lines.push(`💰 Total: ${fmt(recibo.total)}`);
    if (freight.trim()) {
      lines.push(``);
      lines.push(`🚚 Frete/Entrega: ${freight.trim()}`);
    }
    return lines.join("\n");
  };

  /**
   * O pedido só pode sair com cliente identificado — é ele que vira a linha em
   * `customers` e amarra a fidelidade. Como a identificação agora acontece aqui
   * no checkout, e não mais na porta da loja, esta é a única barreira.
   */
  const canSubmit = cart.length > 0 && phoneComplete && !lookupLoading && customerName.length > 1;

  /** Troca a página para o comprovante. Roda com a tela coberta pela água. */
  const revealSuccess = () => {
    setSuccess(pendingSuccess.current);
    setCart([]);
    setCartNotice(null);
    setCheckout(false);
    setFreight("");
    // Pedido aceito fecha o ciclo do token: o PRÓXIMO pedido tem que ser um
    // pedido novo, não um reenvio deste.
    clientToken.current = null;
    load();
  };

  /**
   * Fecha o ciclo da onda. O desfecho não é anunciado por cima: quando aceito,
   * o comprovante JÁ é a tela inteira (mesmo título, mesmo check) — um toast
   * repetiria palavra por palavra o que está embaixo dele. Quando recusado, o
   * motivo vai para dentro do checkout, que é para onde a água devolve a pessoa.
   */
  const announce = () => {
    if (!orderAccepted.current && pendingError.current) setOrderError(pendingError.current);
    pendingError.current = null;
    orderAccepted.current = null;
    floodCovered.current = false;
  };

  /**
   * Só age quando a água cobriu a tela E o banco respondeu — a onda não é
   * enfeite em cima de um pedido já resolvido, ela É a espera.
   *
   * Os dois desfechos são opostos de propósito:
   *
   * Aceito — a água NÃO escoa, ela VIRA a tela. O comprovante é desenhado com
   * as cores invertidas (`storefront-flooded`), de fundo accent, exatamente a
   * cor em que a água está. Por isso a camada pode sair no mesmo quadro em que
   * o comprovante entra, sem piscar nada: o que some e o que aparece são o
   * mesmo campo de cor. É essa virada que dá sentido à onda — ela entrega uma
   * tela em vez de passar por cima e ir embora.
   *
   * Recusado — nada mudou, então a água escoa e devolve o checkout como estava.
   */
  const settleFlood = () => {
    if (!floodCovered.current || orderAccepted.current === null) return;
    if (!orderAccepted.current) {
      setFlood("draining");
      return;
    }
    revealSuccess();
    setFlood("idle");
    setSubmitting(false);
    announce();
  };

  const confirmOrder = async () => {
    // Trava muda de propósito: são exatamente as três condições de `canSubmit`,
    // que já deixam o botão desabilitado. Quem chega aqui sem elas não clicou —
    // não há o que avisar, só o que não fazer.
    if (!canSubmit) return;

    floodCovered.current = false;
    orderAccepted.current = null;
    pendingError.current = null;
    setOrderError(null);
    // Tranca o sheet durante todo o fluxo, não só até a resposta do banco: se
    // desse para fechar no meio da onda, o pedido ficaria criado sem que a
    // pessoa chegasse a ver a tela de compartilhar.
    setSubmitting(true);
    if (!reduceMotion) setFlood("rising");

    // O token nasce no primeiro envio e sobrevive às tentativas seguintes: é
    // ele que faz "tentar de novo" ser o MESMO pedido do lado do banco.
    if (!clientToken.current) clientToken.current = newClientToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);

    try {
      const { data, error } = await supabase
        .rpc("create_pending_order", {
          p_seller_id: sellerId,
          p_customer_name: customerName,
          p_customer_whatsapp: phoneDigits,
          p_freight_notes: freight.trim() || null,
          // Sem `unit_price`: quem precifica é a function, lendo
          // products.sale_price por dentro. Mandar um preço daqui só fingia
          // que o carrinho tinha voz nisso.
          p_items: cart.map(item => ({ product_id: item.product_id, quantity: item.quantity })) as unknown as Json,
          p_client_token: clientToken.current,
        })
        .abortSignal(controller.signal);
      if (error) throw error;

      const recibo = (data ?? {}) as unknown as OrderReceipt;
      const resumo = {
        ref: orderRef(recibo.order_id),
        total: Number(recibo.total ?? 0),
        discountTotal: Number(recibo.discount_total ?? 0),
        discountUnits: Number(recibo.discount_units ?? 0),
      };
      pendingSuccess.current = { ...resumo, message: buildMessage(resumo) };
      orderAccepted.current = true;
    } catch (err) {
      const msg = String((err as { message?: string } | null)?.message ?? "");
      // `signal.aborted` em vez de ler o texto do erro: a mensagem do
      // AbortError muda entre navegador e versão do supabase-js, o sinal não.
      pendingError.current = controller.signal.aborted
        ? "A conexão demorou demais. Toque em confirmar de novo — se o pedido já tiver entrado, ele não duplica."
        : orderErrorMessage(msg, cart);
      if (msg.includes("estoque_insuficiente")) load();
      orderAccepted.current = false;
    } finally {
      clearTimeout(timer);
    }

    if (reduceMotion) {
      if (orderAccepted.current) revealSuccess();
      setSubmitting(false);
      announce();
      return;
    }
    settleFlood();
  };

  /** A água cobriu a tela. */
  const onFloodCovered = () => {
    floodCovered.current = true;
    // Banco ainda pensando: a tela cheia ganha um rótulo em vez de ficar muda.
    if (orderAccepted.current === null) setFlood("waiting");
    else settleFlood();
  };

  /** A água escoou; o que estava embaixo dela está à mostra. */
  const onFloodGone = () => {
    setFlood("idle");
    setSubmitting(false);
    announce();
  };

  /**
   * Sai do comprovante pela mesma porta por onde entrou. A tela do comprovante
   * já é do accent da água, então a camada monta coberta — invisível — e escoa
   * levando-o embora. Sem isso, o salto do azul cheio para o catálogo escuro é
   * um corte seco.
   */
  const leaveSuccess = () => {
    setSuccess(null);
    if (!reduceMotion) setFlood("draining");
  };

  const floodLayer = (
    <FloodLayer phase={flood} busyLabel="Enviando pedido..." onCovered={onFloodCovered} onGone={onFloodGone} />
  );

  /* ---------------- Link inválido ---------------- */

  if (!validId) {
    return (
      <main className="storefront flex h-[100dvh] items-center justify-center overflow-hidden p-6">
        <div className={`${COLUMN} space-y-2 text-center`}>
          <h1 className="text-xl font-bold">Link inválido</h1>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>
            Este endereço de loja não é válido. Peça ao vendedor o link correto do catálogo.
          </p>
        </div>
      </main>
    );
  }

  /* ---------------- 6. Sucesso (tela cheia) ---------------- */

  if (success) {
    return (
      // `storefront-flooded` troca os tokens de cor: esta tela é a loja do lado
      // avesso, de fundo accent — a mesma cor em que a onda encheu a tela. É o
      // que faz a água ter ido a algum lugar em vez de só passar por cima.
      //
      // A camada da onda NÃO é renderizada aqui: no caminho do sucesso ela sai
      // no mesmo quadro em que esta tela entra (ver `settleFlood`), então nunca
      // chega a ser pintada sobre este fundo.
      <main className="storefront storefront-flooded flex h-[100dvh] flex-col items-center overflow-y-auto overscroll-contain px-[30px] py-10 text-center">
        {/* O conteúdo emerge depois que a água assenta, em vez de já estar
            pronto no instante da troca — é o que amarra esta tela ao fim do
            movimento. */}
        <motion.div
          className={`${COLUMN} my-auto flex flex-col items-center gap-[18px]`}
          variants={stagger(0.08, 0.14)}
          initial={reduceMotion ? "visible" : "hidden"}
          animate="visible"
        >
          <motion.div
            variants={fadeUp}
            className="flex h-[68px] w-[68px] items-center justify-center rounded-full"
            style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
          >
            {/* O traço se desenha na frente da pessoa — é a única confirmação
                que sobrou, então ela acontece aqui, não num card por cima. */}
            <DrawnCheck size={30} strokeWidth={2.6} />
          </motion.div>
          <motion.div variants={fadeUp}>
            {/* "Confirmado" era mentira: o pedido nasce PENDENTE e o vendedor
                ainda pode recusar. Quem lia isso e depois recebia uma recusa
                tinha recebido uma confirmação que nunca existiu. */}
            <h2 className="mb-2 text-[21px] font-extrabold">Pedido enviado!</h2>
            {/* O WhatsApp NÃO abre sozinho: em celular isso troca de aplicativo
                sem aviso, e quem só queria conferir o resumo se perde. O envio
                é um toque, e o botão fica aqui até a pessoa querer. */}
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              Seu pedido <span className="font-bold">{success.ref}</span> está reservado. Toque abaixo e escolha a
              conversa do vendedor no WhatsApp — ele confirma e fala com você.
            </p>
          </motion.div>

          {/* O prêmio da fidelidade aparece no momento em que ele acontece.
              Antes, a pessoa completava o ciclo e nada dizia nada. */}
          {success.discountTotal > 0 && (
            <motion.div
              variants={fadeUp}
              className="w-full rounded-2xl px-4 py-3 text-[13px]"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
            >
              <p className="font-bold">
                🎁 {success.discountUnits === 1 ? "Uma unidade saiu" : `${success.discountUnits} unidades saíram`} com
                desconto
              </p>
              <p className="mt-0.5" style={{ color: "var(--sf-text-muted)" }}>
                Você economizou {fmt(success.discountTotal)} neste pedido.
              </p>
            </motion.div>
          )}

          <motion.div variants={fadeUp} className="mt-2.5 flex w-full flex-col gap-2.5">
            <PillButton href={`https://wa.me/?text=${encodeURIComponent(success.message)}`}>
              <MessageCircle size={15} />
              Compartilhar no WhatsApp
            </PillButton>
            <button
              type="button"
              onClick={leaveSuccess}
              className="h-11 text-[13.5px] font-bold"
              style={{ color: "var(--sf-accent)" }}
            >
              Voltar ao catálogo
            </button>
          </motion.div>
        </motion.div>
      </main>
    );
  }

  /* ---------------- 2. Catálogo ---------------- */

  const overlayOpen = detailKey !== null || cartOpen || checkout;
  const chips = [{ key: ALL, label: "Todos" }, ...brands.map(b => ({ key: b, label: b }))];

  return (
    // App-shell: a raiz ocupa exatamente a altura da janela e não rola. Só o
    // <main> rola, então o cabeçalho fica parado sem precisar de `sticky`, e o
    // documento não tem o que arrastar — nem na horizontal nem no repique
    // vertical. `dvh` acompanha a barra de endereço recolhendo no celular.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-[0.03em]" style={{ color: "var(--sf-accent)" }}>
              {COMPANY.toUpperCase()}
            </p>
            {/* Só cumprimenta pelo nome depois que ele existe — hoje isso só
                acontece se a pessoa já passou pelo checkout uma vez. */}
            <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
              {customerName ? `Oi, ${customerName} — escolha seu produto` : "Escolha seu produto"}
            </p>
          </div>

          {/* O tira-dúvidas mora ao LADO do carrinho, com o mesmo desenho: são
              as duas coisas que a pessoa procura no alto da tela. O aviso que
              gira logo abaixo é quem conta que ele existe. */}
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Tira-dúvidas: fidelidade, combo e pedidos"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
            >
              <Info size={17} />
            </button>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label={`Abrir carrinho${cartCount > 0 ? ` com ${cartCount} item(ns)` : ""}`}
              className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
            >
              <ShoppingCart size={17} />
              {cartCount > 0 && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold"
                  style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
                >
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <StoreNotices notices={notices} />

        <div className="relative mt-3.5">
          <Search
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--sf-text-faint)" }}
          />
          <Input
            placeholder="Buscar produtos..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-[42px] rounded-full border-0 pl-[38px] pr-4 text-[13.5px]"
            style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
          />
        </div>

        {chips.length > 1 && <BrandChips chips={chips} active={activeBrand} onChange={setActiveBrand} />}
        </div>
      </header>

      <main className={`${COLUMN} flex-1 overflow-y-auto overscroll-contain px-5 pb-[100px] pt-1.5`}>
        {/* Quando a reconciliação esvazia o carrinho, a barra de baixo some
            junto e o aviso ficaria escondido num sheet que a pessoa não tem
            mais motivo para abrir. Aqui ele encontra quem precisa dele. */}
        {cartNotice && cart.length === 0 && (
          <p
            className="mb-1 mt-2 rounded-2xl px-3.5 py-2.5 text-[12.5px]"
            style={{ background: "var(--sf-surface)", color: "var(--sf-text-muted)" }}
          >
            {cartNotice}
          </p>
        )}
        {loading ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
            Carregando catálogo...
          </p>
        ) : loadError ? (
          // A falha ocupa o lugar da lista em vez de flutuar por cima dela: sem
          // catálogo não há nada embaixo para o aviso atrapalhar, e o botão de
          // tentar de novo precisa estar onde a pessoa está olhando.
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
              Não foi possível carregar o catálogo.
            </p>
            <button
              type="button"
              onClick={load}
              className="h-10 rounded-full px-5 text-[13px] font-bold"
              style={{ background: "var(--sf-surface)", color: "var(--sf-accent)" }}
            >
              Tentar de novo
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
            {query.trim() ? `Nenhum produto encontrado para "${query.trim()}".` : "Nenhum produto encontrado."}
          </p>
        ) : (
          groups.map(g => (
            <section key={g.key} className="mt-5">
              <h2
                className="mb-3 text-[15px] font-extrabold uppercase tracking-[0.06em]"
                style={{ color: isFeatured(g.brand) ? "var(--sf-accent)" : "var(--sf-text)" }}
              >
                {g.brand || "Sem marca"}
              </h2>
              <div className="flex flex-col gap-4">
                {g.models.map(m => (
                  <ProductCard key={m.key} model={m} onOpen={() => openDetail(m)} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Barra do carrinho — some enquanto um sheet está aberto. */}
      {cartCount > 0 && !overlayOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40"
          style={{ background: "linear-gradient(to top, var(--sf-bg) 70%, transparent)" }}
        >
          <div className={`${COLUMN} px-5 pb-[26px] pt-3`}>
            <PillButton height={52} onClick={() => setCartOpen(true)} className="shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <ShoppingCart size={15} />
              Ver carrinho · {cartCount} · {fmt(total)}
            </PillButton>
          </div>
        </div>
      )}

      {/* ---------------- 3. Detalhe do produto ---------------- */}
      <Sheet open={detailKey !== null} onOpenChange={o => !o && setDetailKey(null)}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[88vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          {detailModel && (
            <>
              <SheetTitle className="sr-only">{detailModel.model || "Produto"}</SheetTitle>
              <SheetDescription className="sr-only">Escolha o sabor e a quantidade.</SheetDescription>

              {/* Mesma proporção do card, sem teto de altura. O `max-h-[34vh]`
                  que existia aqui cortava a ALTURA sem encolher a largura, então
                  a moldura virava ~1,47:1 em vez de 4:3 e a foto `contain`
                  aparecia com faixa dos dois lados. O hero em 4:3 ocupa ~37vh
                  dos 88vh do sheet; a lista de sabores rola no resto. */}
              <div
                className="relative w-full flex-shrink-0 overflow-hidden rounded-t-[28px]"
                style={{ aspectRatio: MEDIA_RATIO }}
              >
                <ProductMedia
                  src={firstModelImage(detailModel.flavors)}
                  alt={detailModel.model || "Produto"}
                  iconSize={72}
                />
                <button
                  type="button"
                  onClick={() => setDetailKey(null)}
                  aria-label="Voltar"
                  className="absolute left-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md"
                  style={{ background: "rgba(20,20,26,0.7)", color: "var(--sf-text)" }}
                >
                  <ArrowLeft size={16} />
                </button>
              </div>

              {/* layoutScroll: avisa o motion que este bloco rola, senão ele mede
                  a posição do realce do sabor sem descontar o scroll e a peça
                  pousa fora do lugar. Mesmo cuidado do `BrandChips`. */}
              <motion.div layoutScroll className="flex-1 overflow-y-auto px-5 pb-3 pt-5">
                <p
                  className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.06em]"
                  style={{ color: "var(--sf-accent)" }}
                >
                  {detailModel.brand || "Sem marca"}
                </p>
                <h2 className="mb-[18px] text-[22px] font-extrabold leading-tight">
                  {detailModel.model || "Sem modelo"}
                </h2>

                <p
                  className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--sf-text-faint)" }}
                >
                  Sabor
                </p>
                {/* O realce do sabor escolhido é uma peça única: só o item ativo
                    renderiza o `motion.span` com `layoutId`, então o motion
                    desliza a caixinha da opção antiga para a nova em vez de
                    apagar aqui e acender ali. Mesmo padrão do `BrandChips`. */}
                <div className="flex flex-col gap-2">
                  {detailModel.flavors.map(f => {
                    const out = f.available <= 0;
                    const active = f.product_id === (selectedFlavor?.product_id ?? "");
                    const noCarrinho = cartQtyById.get(f.product_id) ?? 0;
                    return (
                      <button
                        key={f.product_id}
                        type="button"
                        disabled={out}
                        onClick={() => {
                          setSelectedId(f.product_id);
                          setQty(1);
                        }}
                        className="relative flex w-full items-center justify-between gap-2.5 rounded-2xl px-3.5 py-3 text-left"
                        style={{
                          border: "1px solid var(--sf-border)",
                          opacity: out ? 0.4 : 1,
                        }}
                      >
                        {active && (
                          // `-inset-px` cobre a borda cinza do próprio botão em
                          // vez de desenhar uma segunda linha por dentro dela.
                          <motion.span
                            layoutId={reduceMotion ? undefined : flavorPillId}
                            className="absolute -inset-px rounded-[17px]"
                            style={{
                              background: "var(--sf-accent-tint)",
                              border: "1px solid var(--sf-accent-line)",
                            }}
                            transition={{ duration: 0.28, ease: EASE_OUT }}
                          />
                        )}
                        <div className="relative z-10 flex min-w-0 items-center gap-[11px]">
                          <span
                            className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full transition-colors duration-300"
                            style={{
                              background: active ? "var(--sf-accent)" : "transparent",
                              border: `1.5px solid ${active ? "var(--sf-accent)" : "var(--sf-text-dim)"}`,
                              color: "var(--sf-accent-ink)",
                            }}
                          >
                            {active && (
                              <motion.span
                                className="flex"
                                initial={{ scale: 0.3, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.2, ease: EASE_OUT }}
                              >
                                <Check size={10} strokeWidth={3} />
                              </motion.span>
                            )}
                          </span>
                          <span className="min-w-0">
                            <p className="truncate text-sm font-semibold">{f.flavor || "Sem sabor"}</p>
                            <p
                              className="mt-0.5 text-[11.5px]"
                              style={{ color: out ? "var(--sf-text-dim)" : "var(--sf-text-faint)" }}
                            >
                              {out
                                ? "Esgotado"
                                : noCarrinho > 0
                                  ? `${noCarrinho} no carrinho · ${f.available} em estoque`
                                  : `${f.available} em estoque`}
                            </p>
                          </span>
                        </div>
                        <span className="relative z-10 flex-none text-sm font-bold">{fmt(f.sale_price)}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              <div
                className="flex flex-shrink-0 items-center gap-2.5 px-5 pb-7 pt-3.5"
                style={{ borderTop: "1px solid var(--sf-hairline)", background: "var(--sf-bg)" }}
              >
                <QtyStepper
                  qty={room <= 0 ? 0 : clampedQty}
                  onDec={() => setQty(Math.max(1, clampedQty - 1))}
                  onInc={() => setQty(Math.min(room, clampedQty + 1))}
                  decDisabled={room <= 0 || clampedQty <= 1}
                  incDisabled={clampedQty >= room}
                />
                {/* O botão fala do que ainda cabe, não do estoque cru: com tudo
                    já no carrinho ele desliga em vez de confirmar um toque que
                    não muda nada, e com o item já escolhido ele diz "mais". */}
                <AddToCartButton
                  disabled={!selectedFlavor || available <= 0 || room <= 0}
                  label={
                    available <= 0
                      ? "Esgotado"
                      : room <= 0
                        ? `${inCart} no carrinho`
                        : `${inCart > 0 ? "Adicionar mais" : "Adicionar"} · ${fmt(
                            (selectedFlavor?.sale_price ?? 0) * clampedQty,
                          )}`
                  }
                  onPress={() => selectedFlavor && addToCart(selectedFlavor, clampedQty)}
                  onDone={() => setDetailKey(null)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------- 3b. Tira-dúvidas ---------------- */}
      {/* Sheet de leitura, sem ação nenhuma no rodapé: quem abre aqui quer
          entender uma regra e voltar para o catálogo. Por isso ele é mais
          baixo que o carrinho (64vh) e fecha só pelo X. */}
      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[64vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar title="Tira-dúvidas" onClose={() => setHelpOpen(false)} />
          <SheetDescription className="sr-only">
            Como funcionam os descontos, o pedido e o pagamento nesta loja.
          </SheetDescription>

          <div className="flex-1 overflow-y-auto px-5 pb-7">
            {faq.map((f, k) => (
              <div
                key={f.q}
                className="py-3.5"
                style={{ borderBottom: k === faq.length - 1 ? undefined : "1px solid var(--sf-hairline)" }}
              >
                <p className="text-[13.5px] font-bold">{f.q}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------- 4. Carrinho ---------------- */}
      <Sheet
        open={cartOpen}
        onOpenChange={o => {
          // O aviso já foi lido quando o carrinho fecha: mantê-lo faria a
          // próxima abertura falar de uma correção de dias atrás.
          if (!o) setCartNotice(null);
          setCartOpen(o);
        }}
      >
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[76vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar title="Seu carrinho" onClose={() => setCartOpen(false)} />
          <SheetDescription className="sr-only">{cartCount} item(ns) selecionado(s).</SheetDescription>

          <div className="flex-1 overflow-y-auto px-5 pt-2">
            {/* O carrinho volta do localStorage e é reconciliado com o catálogo
                antes de a pessoa ver. Mexer no carrinho de alguém em silêncio
                seria pior que o estoque velho: o aviso diz o que mudou. */}
            {cartNotice && (
              <p
                className="mb-1 mt-1 rounded-2xl px-3.5 py-2.5 text-[12.5px]"
                style={{ background: "var(--sf-surface)", color: "var(--sf-text-muted)" }}
              >
                {cartNotice}
              </p>
            )}
            {cart.length === 0 ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                Seu carrinho está vazio.
              </p>
            ) : (
              cart.map(i => (
                <div
                  key={i.product_id}
                  className="flex items-start gap-3 py-3.5"
                  style={{ borderBottom: "1px solid var(--sf-hairline)" }}
                >
                  <div className="h-14 w-14 flex-none overflow-hidden rounded-xl">
                    <ProductMedia src={i.image_url ?? null} alt={i.model} iconSize={22} fit="cover" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold">{i.model || "Sem modelo"}</p>
                    <p className="mb-2 mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                      {i.flavor || "Sem sabor"}
                    </p>
                    <QtyStepper
                      compact
                      qty={i.quantity}
                      onDec={() => setItemQty(i.product_id, i.quantity - 1)}
                      onInc={() => setItemQty(i.product_id, i.quantity + 1)}
                      decDisabled={i.quantity <= 1}
                      incDisabled={i.quantity >= i.available}
                    />
                  </div>

                  <div className="flex flex-none flex-col items-end gap-3">
                    <span className="text-[13.5px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                      {fmt(i.sale_price * i.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(i.product_id)}
                      aria-label={`Remover ${i.flavor || i.model}`}
                      style={{ color: "var(--sf-text-faint)" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            className="flex flex-shrink-0 flex-col gap-3 px-5 pb-7 pt-4"
            style={{ borderTop: "1px solid var(--sf-hairline)" }}
          >
            <DiscountLines preview={preview} />
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Total
              </span>
              <span className="flex items-baseline gap-2">
                {discountTotal > 0 && (
                  <span className="text-[13px] line-through" style={{ color: "var(--sf-text-dim)" }}>
                    {fmt(fullTotal)}
                  </span>
                )}
                <span className="text-[19px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                  {fmt(total)}
                </span>
              </span>
            </div>
            <PillButton
              disabled={cart.length === 0}
              onClick={() => {
                setCartOpen(false);
                setCheckout(true);
              }}
            >
              Finalizar pedido
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------- 5. Checkout ---------------- */}
      <Sheet
        open={checkout}
        onOpenChange={o => {
          if (submitting) return;
          // O aviso morre junto com o sheet: reabrir o checkout é um recomeço,
          // não a continuação da tentativa que deu errado.
          if (!o) setOrderError(null);
          setCheckout(o);
        }}
      >
        <SheetContent
          side="bottom"
          hideClose
          // Mais alto que antes: este sheet deixou de ser um resumo e virou o
          // formulário de identificação, então precisa caber telefone, nome e
          // observações com o teclado do celular aberto por cima.
          className={`storefront ${COLUMN} inset-x-0 flex h-[84vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar
            title="Finalizar pedido"
            onClose={() => {
              if (submitting) return;
              setOrderError(null);
              setCheckout(false);
            }}
          />
          <SheetDescription className="sr-only">Confirme seus dados e envie o pedido.</SheetDescription>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            {/* O WhatsApp é a chave do cliente: assim que fica completo, o
                efeito de fidelidade dispara e o resto do formulário se decide
                sozinho — cartão de boas-vindas se já é cadastrado, campo de
                nome se é a primeira compra. */}
            <Field id="cliente-whats" label="Seu WhatsApp">
              <Input
                id="cliente-whats"
                inputMode="numeric"
                value={formatPhoneDisplay(phoneInput)}
                onChange={e => setPhoneInput(onlyDigits(e.target.value))}
                placeholder="(11) 90000-0000"
                className={`h-[50px] px-4 ${FIELD_CLASS}`}
                style={FIELD_STYLE}
              />
            </Field>

            {lookupLoading && (
              <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Buscando seu cadastro...
              </p>
            )}

            {!lookupLoading && loyalty && (
              <div
                className="rounded-2xl p-4"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
              >
                <p className="text-[15px] font-bold">Oi, {loyalty.customer_name}!</p>
                <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  Nível <span style={{ color: "var(--sf-accent)" }}>{loyalty.loyalty_tier}</span> ·{" "}
                  {loyalty.total_units} {loyalty.total_units === 1 ? "unidade" : "unidades"} compradas
                </p>
                {/* Três frases possíveis, e a ordem importa: o desconto que JÁ
                    entrou neste carrinho vem antes do que ainda falta. Quem
                    acabou de ganhar não quer ler quanto falta para o próximo. */}
                <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  {preview.loyaltyUnits > 0 ? (
                    <>
                      🎁{" "}
                      <span className="font-bold" style={{ color: "var(--sf-accent)" }}>
                        {preview.loyaltyUnits === 1 ? "Uma unidade" : `${preview.loyaltyUnits} unidades`} deste
                        pedido{preview.loyaltyUnits === 1 ? " sai" : " saem"} com desconto!
                      </span>
                    </>
                  ) : loyalty.units_until_next_discount === 1 ? (
                    "Falta 1 unidade para a próxima sair com desconto 🎁"
                  ) : (
                    `Faltam ${loyalty.units_until_next_discount} unidades para a próxima sair com desconto`
                  )}
                </p>
              </div>
            )}

            {!lookupLoading && lookupDone && !loyalty && (
              <>
                {/* Quem ainda não é cliente é exatamente quem a fidelidade
                    precisa convencer, e para essa pessoa ela era invisível: o
                    cartão só existia para quem já tinha cadastro. */}
                <p
                  className="rounded-2xl px-4 py-3 text-[13px]"
                  style={{ background: "var(--sf-surface)", color: "var(--sf-text-muted)" }}
                >
                  🎁 <span className="font-bold" style={{ color: "var(--sf-text)" }}>Primeira compra?</span> A cada 6
                  unidades compradas, uma sai com metade do preço.
                </p>
                <Field id="cliente-nome" label="Seu nome">
                  <Input
                    id="cliente-nome"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    placeholder="ex: Pedro"
                    maxLength={80}
                    className={`h-[50px] px-4 ${FIELD_CLASS}`}
                    style={FIELD_STYLE}
                  />
                </Field>
              </>
            )}

            <Field id="cliente-frete" label="Observações de entrega">
              <Textarea
                id="cliente-frete"
                value={freight}
                onChange={e => setFreight(e.target.value)}
                placeholder="Opcional — horário, endereço, etc."
                rows={3}
                // Espelha o left(..., 300) do banco: cortar só lá deixaria a
                // pessoa escrever o endereço inteiro e perder metade sem aviso.
                maxLength={FREIGHT_MAX}
                className={`resize-none px-3.5 py-3 text-sm ${FIELD_CLASS}`}
                style={FIELD_STYLE}
              />
            </Field>

            <div className="flex flex-col gap-2 pt-3.5" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
              <DiscountLines preview={preview} />
              <div className="flex items-center justify-between">
                <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  Total
                </span>
                <span className="flex items-baseline gap-2">
                  {discountTotal > 0 && (
                    <span className="text-[13px] line-through" style={{ color: "var(--sf-text-dim)" }}>
                      {fmt(fullTotal)}
                    </span>
                  )}
                  <span className="text-lg font-extrabold" style={{ color: "var(--sf-accent)" }}>
                    {fmt(total)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 px-5 pb-7 pt-3.5" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
            {/* O motivo da recusa fica colado no botão que a pessoa vai apertar
                de novo — é o único lugar em que ele muda o que ela faz. */}
            {orderError && (
              <p className="mb-3 text-[13px] font-semibold" style={{ color: "var(--sf-danger)" }}>
                {orderError}
              </p>
            )}
            <PillButton onClick={confirmOrder} disabled={!canSubmit || submitting}>
              Confirmar pedido
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>

      {floodLayer}
    </div>
  );
}
