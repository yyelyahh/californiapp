import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { CSS_EASE_OUT, EASE_IN_OUT, EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { formatPhoneDisplay, isValidPhone, onlyDigits } from "@/lib/phone";
import { orderRef } from "@/lib/order-ref";
import { storeWhatsAppLink } from "@/lib/store-contact";
import { proxiedImage } from "@/lib/image-proxy";
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
  Package,
  Check,
  ArrowLeft,
  X,
  Info,
  Tag,
  Gift,
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

/** Recusa do pedido em frase de gente; `contact` põe o WhatsApp da loja ao lado. */
interface OrderError {
  text: string;
  contact: boolean;
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
  if (message.includes("pedido_muito_grande"))
    return "Pedido grande demais para o catálogo. Chame a California no WhatsApp que a gente monta com você.";
  if (message.includes("muitos_pedidos_pendentes"))
    return "Você já tem pedidos esperando resposta. Fale com a California no WhatsApp antes de mandar outro.";
  if (message.includes("estoque_insuficiente"))
    return "Um dos itens não tem mais estoque suficiente. Ajustamos seu carrinho — confira abaixo e reserve de novo.";
  return "Não foi possível reservar o pedido. Tente de novo.";
}

/**
 * Erro que só se resolve conversando: nesses a mensagem vem com o botão do
 * WhatsApp da loja ao lado. "Fale com a California" sem um jeito de falar era
 * um beco — com o checkout aberto, o botão flutuante fica escondido.
 */
function errorNeedsContact(message: string) {
  return message.includes("pedido_muito_grande") || message.includes("muitos_pedidos_pendentes");
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
    return `Acabou o estoque de ${item.flavor || item.model || "um item"}. Ajustamos seu carrinho — confira abaixo e reserve de novo.`;
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

/**
 * A loja é da empresa, não de cada vendedor: o cabeçalho mostra sempre a marca
 * da casa. O nome do vendedor continua indo na mensagem de WhatsApp do pedido,
 * que é onde ele importa.
 */
const COMPANY = "California Company";

// O WhatsApp da loja (`storeWhatsAppLink`) mora em @/lib/store-contact: o
// pedido finalizado vai direto para esta conversa, o botão flutuante do
// catálogo abre a mesma, e a tela do vendedor também fala com ela.

/**
 * Glifo do WhatsApp desenhado (o lucide não tem marcas). Pinta por
 * `currentColor`, então segue o token de quem o usa.
 */
function WhatsAppIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.23 9.43-9.44 9.43zm8.03-17.46A11.29 11.29 0 0 0 12.05.72C5.8.72.7 5.8.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.28l5.67-1.49a11.3 11.3 0 0 0 5.42 1.38h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.33-8.02z" />
    </svg>
  );
}

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
  /**
   * Os sabores que a BUSCA achou, quando ela casou pelo sabor e não pelo
   * modelo. Buscar "menta" mostrava "V80 · 1 sabor" sem dizer qual — o card
   * agora escreve o nome.
   */
  matches?: string[];
}

/** "1 unidade", "3 unidades" — o "item(ns)" que o leitor de tela soletrava. */
const unitsLabel = (n: number) => `${n} ${n === 1 ? "unidade" : "unidades"}`;

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

/** Abaixo disso (inclusive) o sabor mostra quanto resta; acima, o estoque não limita ninguém. */
const LOW_STOCK = 3;

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
  // não é: ela é navegação, não popup. Só o envio para o WhatsApp usa isto.
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
 * check, e é quem chama que decide se o sheet fecha ou fica para outro sabor.
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
              // O botão volta a "idle" depois do check: quando o sheet fica
              // aberto para outro sabor (ver `keepDetailOpen`), ele precisa
              // aceitar o próximo toque em vez de ficar preso no check.
              timer.current = window.setTimeout(() => {
                onDone();
                setPhase("idle");
              }, CHECK_HOLD_MS);
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
/**
 * `fetchpriority` não está nos tipos do React 18 (entrou no 19) — o atributo
 * passa assim mesmo para o DOM, que é quem o entende. É ele que tira a foto
 * do topo da fila de trás das outras.
 */
const EAGER_ATTRS = { loading: "eager", fetchpriority: "high" } as Record<string, string>;
const LAZY_ATTRS = { loading: "lazy" } as Record<string, string>;

function ProductMedia({
  src,
  alt,
  iconSize,
  fit = "contain",
  priority = false,
  cssWidth = 440,
}: {
  src: string | null;
  alt: string;
  iconSize: number;
  fit?: "contain" | "cover";
  /** Foto que a pessoa já está olhando: entra na frente da fila, sem lazy. */
  priority?: boolean;
  /** Quanto o elemento ocupa na tela — é o que decide o tamanho pedido ao proxy. */
  cssWidth?: number;
}) {
  // Link quebrado cai no mesmo placeholder do produto sem foto, em vez de
  // mostrar o ícone de imagem partida do navegador.
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // O proxy falhou (fora do ar, recusou aquela URL, formato que ele não abre):
  // a foto original vira o plano B ANTES de desistir e mostrar o ícone. Sem
  // isso, um dia ruim do serviço seria uma loja inteira sem foto.
  const [rawFallback, setRawFallback] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const reduce = useReducedMotion();

  const proxied = useMemo(() => proxiedImage(src, cssWidth), [src, cssWidth]);
  const shown = rawFallback ? src : proxied;
  const temPlanoB = !rawFallback && !!src && !!proxied && proxied !== src;

  // Num 4G ruim a foto demora, e o que ficava no lugar dela era o mesmo bloco
  // de `--sf-surface` do card: nada dizia se estava vindo, se tinha falhado ou
  // se aquele produto simplesmente não tem foto. O esqueleto responde isso
  // enquanto a rede não responde.
  //
  // A verificação de `complete` é para a foto que JÁ está no cache (voltar do
  // sheet, segunda visita): ali o `onLoad` pode ter disparado antes de o React
  // pendurar o handler, e o esqueleto ficaria para sempre por cima de uma foto
  // pronta. Roda também na troca de `src`, depois de o DOM já ter a nova.
  useEffect(() => {
    setFailed(false);
    setRawFallback(false);
    setLoaded(imgRef.current?.complete ?? false);
  }, [src]);

  const attrs = priority ? EAGER_ATTRS : LAZY_ATTRS;

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "var(--sf-surface)" }}
    >
      {shown && !failed ? (
        <>
          {fit === "contain" && loaded && (
            // Decoração: o alt de verdade está na imagem da frente. É a mesma
            // URL da imagem da frente, então o navegador serve do cache em vez de
            // baixar duas vezes. `scale-110` cobre o halo transparente que o
            // blur deixa na borda.
            //
            // Só entra DEPOIS de a foto carregar: antes disso ela disputaria a
            // mesma rede e a mesma decodificação com a imagem que importa.
            <img
              src={shown}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
              style={{ opacity: 0.5 }}
              loading="lazy"
              decoding="async"
            />
          )}
          <img
            ref={imgRef}
            src={shown}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => {
              // Primeiro tenta a original; só depois dela falhar é que o
              // produto passa a não ter foto.
              if (temPlanoB) setRawFallback(true);
              else setFailed(true);
            }}
            className={`relative h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
            style={{
              opacity: loaded ? 1 : 0,
              transition: reduce ? undefined : `opacity 0.3s ${CSS_EASE_OUT}`,
            }}
            decoding="async"
            {...attrs}
          />
          {!loaded && <span aria-hidden className="sf-shimmer absolute inset-0" />}
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
    { key: "combo", Icon: Tag, label: "Combo de modelo", units: preview.comboUnits, amount: preview.comboTotal },
    { key: "fidelidade", Icon: Gift, label: "Fidelidade", units: preview.loyaltyUnits, amount: preview.loyaltyTotal },
  ].filter(l => l.amount > 0);

  if (linhas.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {linhas.map(l => (
        <div key={l.key} className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-1.5" style={{ color: "var(--sf-text-muted)" }}>
            <l.Icon size={13} aria-hidden style={{ color: "var(--sf-accent)" }} />
            {l.label} · {unitsLabel(l.units)}
          </span>
          <span className="font-extrabold" style={{ color: "var(--sf-accent)" }}>
            −{fmt(l.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Cabeçalho comum aos sheets. Com `backLabel`, o botão é uma seta à esquerda
 * e não um X: o checkout VOLTA para o carrinho em vez de fechar tudo — quem
 * sai dali quase sempre quer mexer num item, não recomeçar pelo catálogo.
 */
function SheetTopBar({ title, onClose, backLabel }: { title: string; onClose: () => void; backLabel?: string }) {
  const button = (
    <button
      type="button"
      onClick={onClose}
      aria-label={backLabel ?? "Fechar"}
      className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
      style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
    >
      {backLabel ? <ArrowLeft size={16} /> : <X size={16} />}
    </button>
  );
  return (
    <div
      className={`flex flex-shrink-0 items-center gap-3 px-5 pb-3 pt-4 ${backLabel ? "" : "justify-between"}`}
      style={{ borderBottom: "1px solid var(--sf-hairline)" }}
    >
      {backLabel && button}
      <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
        {title}
      </SheetTitle>
      {!backLabel && button}
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
  label,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
  compact?: boolean;
  /** O que está sendo contado ("Menta Gelada"): entra no nome dos botões. */
  label?: string;
}) {
  // 44px de alvo nos dois tamanhos: o `compact` só encolhe o desenho. Antes o
  // botão do carrinho tinha 31×23 e o polegar acertava o vizinho.
  const btn = `flex h-11 ${compact ? "w-10" : "w-11"} items-center justify-center disabled:opacity-40`;
  const icon = compact ? 12 : 13;
  const de = label ? ` de ${label}` : "";
  return (
    <div
      className="flex w-fit items-center rounded-full"
      style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
    >
      <button type="button" onClick={onDec} disabled={decDisabled} aria-label={`Diminuir quantidade${de}`} className={btn}>
        <Minus size={icon} />
      </button>
      <span
        className={`text-center font-bold ${compact ? "w-[22px] text-[12.5px]" : "w-6 text-sm"}`}
        aria-live="polite"
      >
        {qty}
      </span>
      <button type="button" onClick={onInc} disabled={incDisabled} aria-label={`Aumentar quantidade${de}`} className={btn}>
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
 *
 * São um ÍNDICE, não um filtro: tocar leva à seção da marca, e o chip aceso
 * acompanha a rolagem. Como filtro, "Todos" ficava aceso enquanto a pessoa
 * olhava a Oxbar, e o chip mentia sobre o que estava na tela.
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
  const navRef = useRef<HTMLElement>(null);

  // A linha rola na horizontal: sem isso, a marca acesa pela rolagem ficaria
  // fora da área visível e o pill viajaria pra fora da tela. `scrollTo` na
  // própria linha, não `scrollIntoView`: este roda JUNTO com a rolagem suave
  // da lista, e no Chrome um `scrollIntoView` suave cancela o outro.
  useEffect(() => {
    const el = activeRef.current;
    const nav = navRef.current;
    if (!el || !nav) return;
    nav.scrollTo({
      left: el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active, reduce]);

  return (
    // overscroll-x-contain: sem isso, arrastar os chips até o fim dispara
    // o gesto de "voltar" do navegador no celular.
    // layoutScroll: avisa o motion que este container rola, senão ele mede a
    // posição do pill sem descontar o scroll e a peça pousa no lugar errado.
    <motion.nav
      ref={navRef}
      layoutScroll
      aria-label="Marcas"
      // `relative`: é o que faz o `offsetLeft` dos chips ser medido a partir daqui.
      className="sf-no-scrollbar relative mt-3.5 flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5"
    >
      {chips.map(c => {
        const isActive = c.key === active;
        return (
          <button
            key={c.key}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onChange(c.key)}
            aria-current={isActive ? "true" : undefined}
            className="relative h-10 flex-none rounded-full px-4 text-[12.5px] font-bold transition-colors duration-200"
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
    </motion.nav>
  );
}

/* ------------------------------------------------------------------ */
/* Avisos da loja                                                       */
/* ------------------------------------------------------------------ */

/**
 * Quanto cada aviso fica na frente antes de o próximo entrar.
 *
 * O tempo é POR AVISO, não do trilho: a promoção tem três linhas de texto e um
 * número que a pessoa precisa guardar ("R$ 7,00, dois do mesmo modelo"), e
 * três segundos é o tempo de ler uma vez sem terminar. O aviso do tira-dúvidas
 * é uma frase que se lê de relance e não muda nada se for relida depois.
 */
const NOTICE_MS = 3000;
const NOTICE_MS_FEATURED = 6000;
/** Largura do card no trilho. O resto é a espiada do próximo. */
const NOTICE_WIDTH = "86%";
const NOTICE_GAP = "10px";
/** Pontinhos do trilho, em px: o ponto, o vão e a pílula do aviso atual. */
const DOT = 5;
const DOT_GAP = 6;
const DOT_ACTIVE = 14;

interface Notice {
  key: string;
  icon: typeof Tag;
  eyebrow: string;
  title: string;
  body: string;
  /** O primeiro aviso é a promoção: fundo accent e a luz correndo na borda. */
  featured?: boolean;
  /** Quanto ESTE aviso fica na frente. Sem isto, `NOTICE_MS`. */
  ms?: number;
}

/** Raio do card de aviso, e a espessura da luz que corre nele. */
const NOTICE_RADIUS = 18;
const TRACE_STROKE = 2;
/** Quanto do contorno a luz ocupa. Curta demais vira cursor, longa vira borda. */
const TRACE_SHARE = 0.24;

/** O contorno do card como um caminho só, para a luz ter por onde correr. */
function roundedRectPath(w: number, h: number, r: number, inset: number) {
  const x = inset;
  const y = inset;
  const ww = w - inset * 2;
  const hh = h - inset * 2;
  const rr = Math.min(r - inset, ww / 2, hh / 2);
  return `M${x + rr},${y} H${x + ww - rr} A${rr},${rr} 0 0 1 ${x + ww},${y + rr} V${y + hh - rr} A${rr},${rr} 0 0 1 ${x + ww - rr},${y + hh} H${x + rr} A${rr},${rr} 0 0 1 ${x},${y + hh - rr} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y}Z`;
}

/**
 * A luz que dá a volta na borda do card da promoção.
 *
 * É um traço só — `stroke-dasharray` com UM risco e um vão do tamanho do
 * resto do contorno — andando por `stroke-dashoffset`. O caminho é medido
 * (ResizeObserver), não desenhado em porcentagem: `pathLength` em `<rect>`
 * ainda é irregular no WebKit, e esticar um viewBox quadrado num card
 * retangular deixaria os cantos ovais e o traço mais grosso nas laterais.
 *
 * Fica fora do fluxo (`pointer-events-none`, `aria-hidden`): quem lê por
 * leitor de tela já recebe o "Promoção" no sobretítulo, e para o toque o alvo
 * continua sendo o card inteiro.
 */
function NoticeTrace() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inset = TRACE_STROKE / 2;
  const rr = Math.max(0, NOTICE_RADIUS - inset);
  // Perímetro do retângulo arredondado: os quatro lados retos mais o círculo
  // que os quatro cantos formam juntos.
  const perimeter = box
    ? 2 * (box.w - 2 * inset - 2 * rr) + 2 * (box.h - 2 * inset - 2 * rr) + 2 * Math.PI * rr
    : 0;
  const risco = perimeter * TRACE_SHARE;

  return (
    <svg ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
      {box && perimeter > 0 && (
        <path
          className="sf-trace"
          d={roundedRectPath(box.w, box.h, NOTICE_RADIUS, inset)}
          fill="none"
          stroke="var(--sf-accent)"
          strokeWidth={TRACE_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${risco} ${perimeter - risco}`}
          style={{ ["--sf-trace-end" as string]: `${-perimeter}px` }}
        />
      )}
    </svg>
  );
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
function StoreNotices({ notices, active = true }: { notices: Notice[]; active?: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const total = notices.length;

  // Recolhido (a lista rolou), o trilho para de girar e volta ao primeiro
  // card: quem sobe de novo lá no topo recebe a promoção, não o aviso do meio
  // de uma volta que aconteceu fora da tela.
  useEffect(() => {
    if (!active) setI(0);
  }, [active]);

  // Um `setTimeout` por índice, não um `setInterval`: assim o toque também
  // reinicia a contagem, em vez de o próximo aviso entrar logo depois de a
  // pessoa ter acabado de trocar na mão.
  //
  // Com movimento reduzido o trilho NÃO anda sozinho: trocar o texto embaixo
  // do olho de quem pediu menos movimento é pior que animar: sem transição
  // nem sequer há o rastro que explica a troca. Ali ele vira o que já é no
  // toque — um card por vez, e a pessoa passa quando quiser.
  useEffect(() => {
    if (total < 2 || reduce || !active) return;
    // O tempo é do aviso que está na frente AGORA — por isso o efeito depende
    // de `i` e não de um intervalo fixo do trilho.
    const espera = notices[i]?.ms ?? NOTICE_MS;
    const t = window.setTimeout(() => setI(v => (v + 1) % total), espera);
    return () => window.clearTimeout(t);
  }, [i, total, reduce, active, notices]);

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
                className="relative flex flex-none flex-col gap-0.5 rounded-[18px] px-3.5 py-3"
                style={{
                  width: NOTICE_WIDTH,
                  background: n.featured ? "var(--sf-accent-tint)" : "var(--sf-surface)",
                  border: `1px solid ${n.featured ? "var(--sf-accent-line)" : "var(--sf-hairline)"}`,
                }}
              >
                {/* Só na promoção, só enquanto ela está na frente e o trilho
                    está de pé: luz correndo num card que ninguém está vendo é
                    bateria gasta, e em dois cards ao mesmo tempo vira enfeite.
                    Com movimento reduzido a borda accent parada já basta. */}
                {n.featured && k === i && active && !reduce && <NoticeTrace />}
                <span
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
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
        // Os pontos ficam parados e uma pílula só desliza por cima do atual —
        // `transform`, não `width`: animar a largura de cada ponto recalculava
        // o layout da linha a cada quadro. A pílula (14px) centrada num ponto
        // não encosta nos vizinhos, que estão a 11px de distância.
        <div className="mt-2 flex justify-center">
          <div aria-hidden className="relative flex" style={{ gap: DOT_GAP }}>
            {notices.map(n => (
              <span
                key={n.key}
                className="rounded-full"
                style={{ width: DOT, height: DOT, background: "var(--sf-text-dim)" }}
              />
            ))}
            <span
              className="absolute left-0 top-0 rounded-full"
              style={{
                width: DOT_ACTIVE,
                height: DOT,
                background: "var(--sf-accent)",
                transform: `translateX(${i * (DOT + DOT_GAP) - (DOT_ACTIVE - DOT) / 2}px)`,
                transition: reduce ? undefined : `transform 0.3s ${CSS_EASE_OUT}`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card do catálogo                                                     */
/* ------------------------------------------------------------------ */

/**
 * O preço de combo de um modelo, para ANUNCIAR no sheet — quem cobra é o banco.
 *
 * `combo_price` vem por linha de `get_seller_catalog`, já com a trava de custo
 * aplicada; aqui só se escolhe o que dizer. Sem regra carregada, ou quando a
 * trava comeu o desconto inteiro, não há combo para prometer.
 */
function comboOffer(rows: CatalogRow[], minUnits: number | undefined) {
  if (!minUnits || minUnits < 2) return null;
  const withDiscount = rows.filter(r => r.available > 0 && r.combo_price < r.sale_price);
  if (withDiscount.length === 0) return null;
  const prices = withDiscount.map(r => r.combo_price);
  const price = Math.min(...prices);
  return { minUnits, price, varies: prices.some(p => p !== price) };
}

/**
 * O card diz o essencial para decidir abrir: foto, modelo, quantos sabores e
 * preço. O combo NÃO mora aqui — era a mesma regra repetida em todos os cards;
 * a regra está no aviso do topo, e o preço de combo DAQUELE modelo aparece no
 * sheet, que é onde a pessoa escolhe o segundo sabor.
 */
function ProductCard({
  model,
  onOpen,
  priority = false,
}: {
  model: ModelGroup;
  onOpen: () => void;
  priority?: boolean;
}) {
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

  const body = (
    <>
      <div className="relative w-full" style={{ aspectRatio: MEDIA_RATIO }}>
        <ProductMedia
          src={firstModelImage(allRows)}
          alt={model.model || "Produto"}
          iconSize={56}
          priority={priority}
        />

        {allOut ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--sf-text-muted)" }}>
              Esgotado
            </span>
          </div>
        ) : (
          // Desenho, não botão: o card inteiro já é o botão, e um botão dentro
          // de outro deixava o leitor de tela com dois alvos para a mesma ação.
          <span
            aria-hidden
            className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
            style={{
              background: "var(--sf-accent)",
              color: "var(--sf-accent-ink)",
              border: "2px solid var(--sf-bg)",
            }}
          >
            <Plus size={15} strokeWidth={2.4} />
          </span>
        )}
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <p className="truncate text-base font-bold">{model.model || "Sem modelo"}</p>
        {model.matches && model.matches.length > 0 && (
          <p className="mt-0.5 line-clamp-2 text-[12.5px]" style={{ color: "var(--sf-text-muted)" }}>
            {model.matches.join(" · ")}
          </p>
        )}
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
    </>
  );

  const frame = "overflow-hidden rounded-[20px]";
  const frameStyle = { background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" };

  // Esgotado não abre nada: o sheet só mostraria uma lista de linhas mortas.
  // O card fica (a pessoa sabe que o modelo existe e pode perguntar por ele),
  // mas sem fingir que é tocável.
  if (allOut) {
    return (
      <div className={frame} style={{ ...frameStyle, opacity: 0.7 }}>
        {body}
      </div>
    );
  }

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
      className={`cursor-pointer ${frame}`}
      style={frameStyle}
    >
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function SellerStorePage() {
  /**
   * O endereço traz o uuid do vendedor OU o apelido dele (`/loja/ivoti`).
   *
   * As duas formas na mesma rota porque link já enviado não pode parar de
   * funcionar: o uuid é o que está colado em conversa de WhatsApp desde o
   * começo, e ninguém tem como avisar quem guardou. Quando não é uuid, o
   * apelido vira id por uma function (`get_seller_by_slug`) — a tabela de
   * vendedores não é alcançável por quem não está logado, e nem deve ser.
   */
  const { sellerId: handle } = useParams<{ sellerId: string }>();
  const handleIsId = !!handle && UUID_RE.test(handle);
  const [sellerId, setSellerId] = useState<string | undefined>(handleIsId ? handle : undefined);
  /** Enquanto o apelido não virou id, a tela está CARREGANDO, não inválida. */
  const [resolving, setResolving] = useState(!handleIsId);
  /** O banco não respondeu. Diferente de "esse apelido não existe". */
  const [resolveFailed, setResolveFailed] = useState(false);
  const validId = !!sellerId;
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
  /** A marca cuja seção está no topo da lista — é ela que o chip acende. */
  const [activeBrand, setActiveBrand] = useState<string>("");
  /** Os números das promoções, vindos do banco. Ver StoreRules. */
  const [rules, setRules] = useState<StoreRules | null>(null);

  /**
   * O trilho de avisos só fica de pé no TOPO da lista.
   *
   * O cabeçalho não rola (só o `<main>` rola, ver o app-shell), então o aviso
   * ficava na tela para sempre: ~105px do celular ocupados por promoção
   * enquanto a pessoa procura produto lá embaixo. Ele recolhe assim que a
   * lista anda e volta quando ela volta ao topo — a busca e os chips, que são
   * ferramenta e não recado, continuam parados onde estavam.
   *
   * Os dois números são diferentes de propósito (histerese): recolhe passando
   * de 40px, só volta abaixo de 8px. Com um limite só, parar o dedo em cima
   * dele faria o aviso piscar abrindo e fechando.
   */
  const [noticesOpen, setNoticesOpen] = useState(true);
  /**
   * O botão flutuante do WhatsApp some enquanto a pessoa DESCE a lista e volta
   * quando ela sobe. Parado no canto, ele pousava justo em cima do preço do
   * card de baixo — e é descendo que se lê preço.
   */
  const [fabHidden, setFabHidden] = useState(false);
  const scrollWatch = useRef<{ el: HTMLElement; fn: () => void } | null>(null);
  const mainEl = useRef<HTMLElement | null>(null);
  /** As seções de marca montadas, para o índice de chips saber onde cada uma está. */
  const sectionEls = useRef(new Map<string, HTMLElement>());
  /**
   * Até quando a rolagem é NOSSA (o toque num chip). Enquanto a lista desliza
   * até a marca escolhida ela passa por cima das outras, e o chip aceso
   * piscaria por todas elas no caminho.
   */
  const spyLock = useRef(0);
  const lastScrollTop = useRef(0);

  /** Acende o chip da marca que ocupa o topo da lista. */
  const spyBrand = useCallback((el: HTMLElement) => {
    if (Date.now() < spyLock.current || sectionEls.current.size === 0) return;
    const top = el.getBoundingClientRect().top;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    let current: { key: string; y: number } | null = null;
    let first: { key: string; y: number } | null = null;
    let last: { key: string; y: number } | null = null;
    for (const [key, s] of sectionEls.current) {
      const y = s.getBoundingClientRect().top - top;
      if (!first || y < first.y) first = { key, y };
      if (!last || y > last.y) last = { key, y };
      if (y <= 24 && (!current || y > current.y)) current = { key, y };
    }
    // No fim da lista a última marca pode nunca chegar ao topo: se ela está à
    // vista, é ela que a pessoa está olhando.
    const pick = atBottom ? last : current ?? first;
    if (pick) setActiveBrand(pick.key);
  }, []);

  // Ref de callback em vez de efeito: a tela de comprovante troca a árvore
  // inteira, e na volta o <main> é outro elemento. O efeito com `[]` ficaria
  // ouvindo um nó que não existe mais.
  const mainRef = useCallback(
    (el: HTMLElement | null) => {
      if (scrollWatch.current) {
        scrollWatch.current.el.removeEventListener("scroll", scrollWatch.current.fn);
        scrollWatch.current = null;
      }
      mainEl.current = el;
      if (!el) return;
      const fn = () => {
        const y = el.scrollTop;
        setNoticesOpen(open => (open ? y <= 40 : y < 8));
        // Só conta o movimento que passa de alguns px: o repique do fim da
        // lista e o dedo parado não podem ficar acendendo e apagando o botão.
        const dy = y - lastScrollTop.current;
        if (y <= 40) setFabHidden(false);
        else if (Math.abs(dy) > 6) setFabHidden(dy > 0);
        if (Math.abs(dy) > 6 || y <= 40) lastScrollTop.current = y;
        spyBrand(el);
      };
      el.addEventListener("scroll", fn, { passive: true });
      scrollWatch.current = { el, fn };
      // A lista pode nascer rolada (voltar do comprovante, restaurar posição):
      // o estado tem que sair certo já na montagem.
      fn();
    },
    [spyBrand],
  );

  // A chave do carrinho é o que está NO ENDEREÇO, não o id resolvido: por
  // apelido, o id só existe depois de uma ida ao banco, e ler o carrinho com
  // `undefined` no meio apagaria o que a pessoa tinha deixado. O endereço é
  // estável desde o primeiro render, nas duas formas.
  const [cart, setCart] = useState<CartItem[]>(() => readStoredCart(handle));
  /** O que a reconciliação com o catálogo mexeu no carrinho guardado. */
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  /**
   * QUAIS itens a reconciliação mexeu. "Confira" sem dizer onde mandava a
   * pessoa comparar o carrinho com a memória; as linhas marcadas dizem.
   */
  const [changedIds, setChangedIds] = useState<Map<string, string>>(() => new Map());
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
  const pendingError = useRef<OrderError | null>(null);
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
  const [orderError, setOrderError] = useState<OrderError | null>(null);
  /**
   * "Combo ativado" por alguns segundos acima da barra do carrinho. Sem ele o
   * total caía de R$ 220 para R$ 206 sem explicação, com o card dizendo R$ 110.
   * Só dispara quando a PESSOA mexe no carrinho (`userTouchedCart`): o
   * carrinho que volta do localStorage já com combo não é novidade para ninguém.
   */
  const [comboFlash, setComboFlash] = useState<number | null>(null);
  const userTouchedCart = useRef(false);
  const prevComboTotal = useRef(0);

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

  /** Apelido → id. Roda uma vez, antes de qualquer consulta do catálogo. */
  useEffect(() => {
    if (handleIsId || !handle) {
      setResolving(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // `get_seller_by_slug` ainda não está no types.ts gerado (ele nasceu na
        // migration 20260916140000), então o tipo vem daqui.
        //
        // O cast é no CLIENTE, não no método: `const rpc = supabase.rpc` destaca
        // a função do objeto, e chamada assim ela roda sem `this` e estoura na
        // primeira linha. Foi o que deixou esta tela em "Abrindo a loja…" para
        // sempre — a exceção matava a função antes do `setResolving(false)`.
        const client = supabase as unknown as {
          rpc(fn: "get_seller_by_slug", args: { p_slug: string }): Promise<{
            data: string | null;
            error: { message: string } | null;
          }>;
        };
        const { data, error } = await client.rpc("get_seller_by_slug", { p_slug: handle });
        if (cancelled) return;
        // Erro do banco não é endereço errado: uma coisa se resolve tentando de
        // novo, a outra pedindo o link certo ao vendedor. Dizer "Link inválido"
        // quando o banco não respondeu manda a pessoa embora à toa.
        if (error) setResolveFailed(true);
        else setSellerId(data ?? undefined);
      } catch {
        if (!cancelled) setResolveFailed(true);
      } finally {
        // Sai do "Abrindo a loja…" ACONTEÇA O QUE ACONTECER: uma tela que pode
        // ficar carregando para sempre é pior que qualquer mensagem de erro.
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, handleIsId]);

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
    /** product_id → o que mudou, dito na própria linha do carrinho. */
    const mexidos = new Map<string, string>();
    const next = cart.flatMap<CartItem>(item => {
      const fresh = rows.find(r => r.product_id === item.product_id);
      if (!fresh || fresh.available <= 0) {
        saiu.push(item.flavor || item.model || "um item");
        mexidos.set(item.product_id, "");
        return [];
      }
      const quantity = Math.min(item.quantity, fresh.available);
      if (quantity !== item.quantity) mexidos.set(item.product_id, `Só ${fresh.available} em estoque agora`);
      else if (fresh.sale_price !== item.sale_price) mexidos.set(item.product_id, "Preço atualizado");
      return [{ ...fresh, quantity }];
    });
    if (mexidos.size === 0) return;
    setCart(next);
    setChangedIds(mexidos);
    setCartNotice(
      saiu.length > 0
        ? `Tiramos do carrinho: ${saiu.join(", ")} — acabou o estoque.`
        : "Atualizamos seu carrinho com o estoque e os preços de agora — veja as linhas marcadas.",
    );
  }, [rows, cart]);

  /** Guarda o carrinho para a próxima visita. Ver readStoredCart. */
  useEffect(() => {
    try {
      if (cart.length === 0) localStorage.removeItem(cartKey(handle));
      else localStorage.setItem(cartKey(handle), JSON.stringify({ savedAt: Date.now(), items: cart }));
    } catch {
      // Nada a fazer: o carrinho só não sobrevive ao reload.
    }
  }, [cart, handle]);

  const sellerName = rows[0]?.seller_name ?? "";

  /** Todos os modelos, com todos os sabores — o sheet de detalhe lê daqui. */
  const allModels = useMemo(() => {
    const modelMap = new Map<string, ModelGroup>();
    rows.forEach((r, idx) => {
      const hasKey = (r.brand || "").trim() !== "" || (r.model || "").trim() !== "";
      const key = hasKey ? `${r.brand}|||${r.model}` : `__sem_modelo__${idx}`;
      if (!modelMap.has(key)) modelMap.set(key, { key, brand: r.brand, model: r.model, flavors: [] });
      modelMap.get(key)!.flavors.push(r);
    });
    const models = Array.from(modelMap.values());
    models.forEach(m =>
      m.flavors.sort((a, b) => (a.flavor || "").localeCompare(b.flavor || "", undefined, { numeric: true })),
    );
    return models;
  }, [rows]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const has = (v: string | null | undefined) => (v || "").toLowerCase().includes(q);

    let models = allModels;
    if (q) {
      // Busca que casa com a marca ou o modelo traz o modelo inteiro. A que só
      // casa com o sabor traz os sabores achados, e o card escreve quais são.
      models = models.flatMap(m => {
        if (has(m.brand) || has(m.model)) return [m];
        const flavors = m.flavors.filter(r => has(r.flavor) || has(r.name));
        if (flavors.length === 0) return [];
        const partial = flavors.length < m.flavors.length;
        return [{ ...m, flavors, matches: partial ? flavors.map(f => f.flavor || f.name) : undefined }];
      });
    }
    // Esgotado vai para o fim da marca: ele fica à vista (a pessoa pode
    // perguntar por ele), mas não empurra para baixo o que dá para comprar.
    const soldOut = (m: ModelGroup) => (m.flavors.some(f => f.available > 0) ? 0 : 1);
    models = [...models].sort(
      (a, b) =>
        soldOut(a) - soldOut(b) || (a.model || "").localeCompare(b.model || "", undefined, { numeric: true }),
    );

    const brandMap = new Map<string, BrandGroup>();
    models.forEach(m => {
      const bKey = (m.brand || "").trim() || "__sem_marca__";
      if (!brandMap.has(bKey)) brandMap.set(bKey, { key: bKey, brand: m.brand, models: [] });
      brandMap.get(bKey)!.models.push(m);
    });

    return Array.from(brandMap.values()).sort((a, b) => compareBrands(a.brand, b.brand));
  }, [allModels, query]);

  /**
   * Leva a lista até a seção da marca. O chip acende na hora, e a vigia da
   * rolagem fica quieta enquanto a lista desliza (ver `spyLock`).
   */
  const jumpToBrand = (key: string) => {
    const main = mainEl.current;
    const section = sectionEls.current.get(key);
    if (!main || !section) return;
    const top = section.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 8;
    setActiveBrand(key);
    spyLock.current = Date.now() + 800;
    main.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
  };

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

  // Ver `comboFlash`. A ordem dos dois efeitos importa: o primeiro lê se foi a
  // pessoa que mexeu, o segundo zera a marca depois de QUALQUER mudança do
  // carrinho — senão um toque sem combo ficaria "armado" até a próxima.
  useEffect(() => {
    const antes = prevComboTotal.current;
    prevComboTotal.current = preview.comboTotal;
    if (userTouchedCart.current && antes === 0 && preview.comboTotal > 0) setComboFlash(preview.comboTotal);
  }, [preview.comboTotal]);
  useEffect(() => {
    userTouchedCart.current = false;
  }, [cart]);
  useEffect(() => {
    if (comboFlash === null) return;
    const t = window.setTimeout(() => setComboFlash(null), 3500);
    return () => window.clearTimeout(t);
  }, [comboFlash]);

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
    // Loja sem produto não anuncia promoção: "leve dois do mesmo modelo" em
    // cima de uma lista vazia é oferta de coisa que não existe.
    if (rules && rules.combo_discount > 0 && rules.combo_min_units > 1 && rows.length > 0) {
      list.push({
        key: "combo",
        icon: Tag,
        eyebrow: "Promoção",
        title: "Combo de modelo",
        body: `Leve ${rules.combo_min_units} ou mais unidades do mesmo modelo — pode misturar os sabores — e cada uma sai ${fmt(rules.combo_discount)} mais barata.`,
        featured: true,
        ms: NOTICE_MS_FEATURED,
      });
    }
    list.push({
      key: "ajuda",
      icon: Info,
      eyebrow: "Tira-dúvidas",
      title: "Ficou com dúvida?",
      body: "Toque no i ao lado do carrinho: fidelidade, combo, pagamento e entrega.",
    });
    return list;
  }, [rules, rows.length]);

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
        ? `Você reserva aqui e manda o pedido no WhatsApp da California. O estoque fica guardado para você por ${rules.reservation_hours} horas, até a gente confirmar e combinar a entrega.`
        : "Você reserva aqui e manda o pedido no WhatsApp da California. O estoque fica guardado para você até a gente confirmar e combinar a entrega.",
    });
    list.push({
      q: "Como eu pago?",
      a: "Pix ou dinheiro, na entrega. Nada é cobrado por aqui.",
    });
    list.push({
      q: "O preço pode mudar depois que eu enviar?",
      a: "Não. Vale o valor do pedido gravado — é ele que aparece no comprovante e na mensagem do WhatsApp.",
    });
    return list;
  }, [rules]);

  /**
   * Modelo aberto no sheet de detalhe — sempre COM TODOS os sabores, mesmo
   * que a busca tenha achado um só: é no sheet que se monta o combo, e ele
   * se monta misturando sabores.
   */
  const detailModel = useMemo(
    () => (detailKey ? allModels.find(m => m.key === detailKey) ?? null : null),
    [detailKey, allModels],
  );

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

  /** Um preço só no modelo: ele vai no título, não repetido em cada sabor. */
  const detailPrices = detailModel?.flavors.filter(f => f.available > 0).map(f => f.sale_price) ?? [];
  const detailSamePrice = detailPrices.every(p => p === detailPrices[0]);
  const detailCombo = detailModel ? comboOffer(detailModel.flavors, rules?.combo_min_units) : null;
  /** Unidades DESTE modelo no carrinho — é o que decide se o combo já vale. */
  const modelUnitsInCart = detailModel
    ? detailModel.flavors.reduce((a, f) => a + (cartQtyById.get(f.product_id) ?? 0), 0)
    : 0;
  /**
   * O sheet fica aberto depois de adicionar quando ainda há outro sabor para
   * escolher: fechar a cada item obrigava a reabrir o modelo para montar o
   * combo, que é justamente misturar sabores. Com um sabor só, fecha como antes.
   */
  const keepDetailOpen = (detailModel?.flavors.filter(f => f.available > 0).length ?? 0) > 1;

  const openDetail = (model: ModelGroup) => {
    const first = model.flavors.find(f => f.available > 0) ?? model.flavors[0];
    setSelectedId(first?.product_id ?? "");
    setQty(1);
    setDetailKey(model.key);
  };

  const addToCart = (row: CatalogRow, requested = 1) => {
    const qtyToAdd = Math.min(Math.max(1, requested), row.available);
    userTouchedCart.current = true;
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
    userTouchedCart.current = true;
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
      // O recibo do banco devolve UM número, que pode ser fidelidade, combo de
      // modelo ou os dois juntos. Quando a prévia desta tela chegou exatamente
      // ao mesmo valor, a divisão dela é a do banco e dá para nomear cada
      // regra. Se as contas divergem, fica o genérico: nomear a regra errada
      // na mensagem que vai para a loja é pior que não nomear.
      const bate = Math.abs(preview.discountTotal - recibo.discountTotal) < 0.005;
      if (bate) {
        if (preview.comboTotal > 0)
          lines.push(`🏷️ Combo de modelo (${unitsLabel(preview.comboUnits)}): -${fmt(preview.comboTotal)}`);
        if (preview.loyaltyTotal > 0)
          lines.push(`🎁 Fidelidade (${unitsLabel(preview.loyaltyUnits)}): -${fmt(preview.loyaltyTotal)}`);
      } else {
        lines.push(`🎁 Desconto (${unitsLabel(recibo.discountUnits)}): -${fmt(recibo.discountTotal)}`);
      }
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

  /**
   * Por que o botão está apagado, dito ao lado dele. Desligado e mudo, ele
   * parecia quebrado para quem ainda não tinha digitado o nome.
   */
  const blockReason =
    cart.length === 0
      ? "Seu carrinho está vazio."
      : !phoneComplete
        ? "Informe seu WhatsApp com DDD para reservar."
        : lookupLoading
          ? "Buscando seu cadastro…"
          : customerName.length <= 1
            ? "Falta seu nome para reservar."
            : null;

  /** Checkout → carrinho. É "voltar", não "fechar": o carrinho continua ali. */
  const backToCart = () => {
    if (submitting) return;
    setOrderError(null);
    setCheckout(false);
    setCartOpen(true);
  };

  /** Troca a página para o comprovante. Roda com a tela coberta pela água. */
  const revealSuccess = () => {
    setSuccess(pendingSuccess.current);
    setCart([]);
    setCartNotice(null);
    setChangedIds(new Map());
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
        ? {
            text: "A conexão demorou demais. Toque em reservar de novo — se o pedido já tiver entrado, ele não duplica.",
            contact: false,
          }
        : { text: orderErrorMessage(msg, cart), contact: errorNeedsContact(msg) };
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
    <FloodLayer phase={flood} busyLabel="Reservando seu pedido…" onCovered={onFloodCovered} onGone={onFloodGone} />
  );

  /* ---------------- Link inválido ---------------- */

  // Enquanto o apelido não virou id não dá para dizer que o link é inválido:
  // a tela piscaria "Link inválido" em toda loja que abre por apelido.
  if (resolving) {
    return (
      <main className="storefront flex h-[100dvh] items-center justify-center overflow-hidden p-6">
        <p role="status" className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
          Abrindo a loja…
        </p>
      </main>
    );
  }

  // Falha de rede ou de banco: o link pode estar certíssimo, então a saída é
  // tentar de novo — não mandar a pessoa pedir outro endereço ao vendedor.
  if (resolveFailed) {
    return (
      <main className="storefront flex h-[100dvh] items-center justify-center overflow-hidden p-6">
        <div className={`${COLUMN} space-y-3 text-center`}>
          <h1 className="text-xl font-bold">Não foi possível abrir a loja</h1>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>
            O catálogo não respondeu agora. Tente de novo em instantes.
          </p>
          <PillButton onClick={() => window.location.reload()}>Tentar de novo</PillButton>
        </div>
      </main>
    );
  }

  if (!validId) {
    return (
      <main className="storefront flex h-[100dvh] items-center justify-center overflow-hidden p-6">
        <div className={`${COLUMN} flex flex-col items-center gap-3 text-center`}>
          <h1 className="text-xl font-bold">Link inválido</h1>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>
            Peça o link certo a quem te enviou, ou chame a California no WhatsApp.
          </p>
          {/* Endereço errado não é beco: o WhatsApp da loja é o mesmo em todo
              link, então dá para pedir o catálogo direto. */}
          <PillButton href={storeWhatsAppLink()} className="mt-2">
            <WhatsAppIcon size={16} />
            Falar no WhatsApp
          </PillButton>
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
            {/* "Confirmado" era mentira: o pedido nasce PENDENTE e ainda pode
                ser recusado. "Enviado" também era: o pedido só chega à loja
                quando a pessoa manda a mensagem, e quem lia o título e fechava
                a aba deixava a reserva vencer sem conversa nenhuma. O título
                diz o que aconteceu E o que falta. */}
            <h2 className="mb-2 text-[21px] font-extrabold">Pedido reservado — falta enviar</h2>
            {/* O WhatsApp NÃO abre sozinho: em celular isso troca de aplicativo
                sem aviso, e quem só queria conferir o resumo se perde. O envio
                é um toque, e o botão fica aqui até a pessoa querer. */}
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              O pedido <span className="font-bold">{success.ref}</span> está guardado. Mande no WhatsApp para a gente
              confirmar e combinar a entrega.
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
              <p className="flex items-center justify-center gap-1.5 font-bold">
                <Gift size={15} aria-hidden />
                {success.discountUnits === 1 ? "Uma unidade saiu" : `${success.discountUnits} unidades saíram`} com
                desconto
              </p>
              <p className="mt-0.5" style={{ color: "var(--sf-text-muted)" }}>
                Você economizou {fmt(success.discountTotal)} neste pedido.
              </p>
            </motion.div>
          )}

          <motion.div variants={fadeUp} className="mt-2.5 flex w-full flex-col gap-2.5">
            {/* Vai direto para a conversa da loja, já com a mensagem escrita.
                Antes o wa.me sem número fazia a pessoa escolher o contato, e
                o pedido podia parar em qualquer conversa. */}
            <PillButton href={storeWhatsAppLink(success.message)}>
              <WhatsAppIcon size={16} />
              Enviar pedido no WhatsApp
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
  // Os chips seguem as seções que estão NA TELA: com uma busca ativa, marca
  // sem resultado não vira um chip que leva a lugar nenhum.
  const chips = groups.map(g => ({ key: g.key, label: g.brand || "Sem marca" }));
  const shownBrand = chips.some(c => c.key === activeBrand) ? activeBrand : chips[0]?.key ?? "";

  return (
    // App-shell: a raiz ocupa exatamente a altura da janela e não rola. Só o
    // <main> rola, então o cabeçalho fica parado sem precisar de `sticky`, e o
    // documento não tem o que arrastar — nem na horizontal nem no repique
    // vertical. `dvh` acompanha a barra de endereço recolhendo no celular.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
        <div className="flex items-center justify-between gap-2.5">
          {/* Só a marca da casa. O subtítulo "Escolha seu produto" não dizia
              nada que a lista logo abaixo não diga, e a versão "Oi, <nome>"
              cumprimentava pelo nome de quem usou o celular antes — o telefone
              fica guardado no aparelho. O cumprimento mora no checkout, depois
              que a pessoa digita o próprio WhatsApp. */}
          <h1 className="min-w-0 truncate text-sm font-extrabold tracking-[0.03em]" style={{ color: "var(--sf-accent)" }}>
            {COMPANY.toUpperCase()}
          </h1>

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
              aria-label={`Abrir carrinho${cartCount > 0 ? ` com ${unitsLabel(cartCount)}` : ""}`}
              className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
            >
              <ShoppingCart size={17} />
              {cartCount > 0 && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-extrabold"
                  style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
                >
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* A altura é que anima, não a opacidade sozinha: o espaço precisa
            devolver os px para a lista subir junto, senão o aviso some e fica
            um buraco onde ele estava. */}
        <motion.div
          initial={false}
          animate={{ height: noticesOpen ? "auto" : 0, opacity: noticesOpen ? 1 : 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
          style={{ overflow: "hidden" }}
        >
          <StoreNotices notices={notices} active={noticesOpen} />
        </motion.div>

        <div className="relative mt-3.5">
          <Search
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--sf-text-faint)" }}
          />
          <Input
            aria-label="Buscar modelo ou sabor"
            placeholder="Buscar modelo ou sabor…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-[42px] rounded-full border-0 pl-[38px] pr-4 text-[13.5px]"
            style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
          />
        </div>

        {chips.length > 1 && <BrandChips chips={chips} active={shownBrand} onChange={jumpToBrand} />}
        </div>
      </header>

      {/* O <main> que rola ocupa a LARGURA INTEIRA; só o conteúdo dele fica
          na coluna de 480px. Com a coluna no próprio <main>, no computador a
          rodinha do mouse sobre as margens não rolava nada. */}
      <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className={`${COLUMN} px-5 pb-[100px] pt-1.5`}>
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
          // Cards-fantasma no formato dos de verdade, com o mesmo brilho das
          // fotos: num 4G ruim a espera ganha forma em vez de uma frase solta
          // no meio da tela. A frase continua, para o leitor de tela.
          <div role="status" className="mt-5 flex flex-col gap-4">
            <span className="sr-only">Carregando catálogo…</span>
            <span aria-hidden className="sf-shimmer h-[18px] w-24 rounded-full" />
            {[0, 1].map(k => (
              <div
                key={k}
                aria-hidden
                className="overflow-hidden rounded-[20px]"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
              >
                <div className="sf-shimmer w-full" style={{ aspectRatio: MEDIA_RATIO }} />
                <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
                  <span className="sf-shimmer h-4 w-28 rounded-full" />
                  <span className="sf-shimmer h-5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
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
        ) : groups.length === 0 && query.trim() ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
              Nenhum produto encontrado para "{query.trim()}".
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="h-11 rounded-full px-5 text-[13px] font-bold"
              style={{ background: "var(--sf-surface)", color: "var(--sf-accent)" }}
            >
              Limpar busca
            </button>
          </div>
        ) : groups.length === 0 ? (
          // Loja sem estoque não é "nenhum produto encontrado" — isso soava
          // como busca errada, e a pessoa ficava sem ter o que fazer. Aqui ela
          // ganha o motivo e a conversa com a loja.
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <p className="text-[15px] font-bold">A loja está sem produtos agora</p>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              Chame a California no WhatsApp para saber quando chega mais.
            </p>
            <div className="mt-2 w-full max-w-[280px]">
              <PillButton href={storeWhatsAppLink()}>
                <WhatsAppIcon size={16} />
                Falar no WhatsApp
              </PillButton>
            </div>
          </div>
        ) : (
          groups.map((g, gi) => (
            <section
              key={g.key}
              // A vigia da rolagem (`spyBrand`) mede daqui onde cada marca está.
              ref={el => {
                if (el) sectionEls.current.set(g.key, el);
                else sectionEls.current.delete(g.key);
              }}
              className="mt-5"
            >
              <h2
                className="mb-3 text-[15px] font-extrabold uppercase tracking-[0.06em]"
                style={{ color: isFeatured(g.brand) ? "var(--sf-accent)" : "var(--sf-text)" }}
              >
                {g.brand || "Sem marca"}
              </h2>
              <div className="flex flex-col gap-4">
                {g.models.map((m, mi) => (
                  // As duas primeiras fotos são as que estão na tela quando a
                  // página abre: `loading="lazy"` nelas atrasa justamente o que
                  // a pessoa está olhando, porque o navegador só começa a
                  // baixar depois de calcular o layout. Da terceira em diante o
                  // lazy volta a valer e segura o resto da lista.
                  <ProductCard
                    key={m.key}
                    model={m}
                    onOpen={() => openDetail(m)}
                    priority={gi === 0 && mi < 2}
                  />
                ))}
              </div>
            </section>
          ))
        )}
        </div>
      </main>

      {/* Barra do carrinho — some enquanto um sheet está aberto. */}
      {cartCount > 0 && !overlayOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40"
          style={{ background: "linear-gradient(to top, var(--sf-bg) 70%, transparent)" }}
        >
          <div className={`${COLUMN} px-5 pb-[26px] pt-3`}>
            {/* O total da barra acabou de cair sem ninguém explicar: por
                alguns segundos a barra diz de onde veio. */}
            <AnimatePresence>
              {comboFlash !== null && (
                <motion.p
                  role="status"
                  className="mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
                  style={{
                    background: "var(--sf-accent-tint)",
                    border: "1px solid var(--sf-accent-line)",
                    color: "var(--sf-text)",
                  }}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 6 }}
                  transition={{ duration: 0.28, ease: EASE_OUT }}
                >
                  <Tag size={13} aria-hidden style={{ color: "var(--sf-accent)" }} />
                  Combo ativado · <span style={{ color: "var(--sf-accent)" }}>−{fmt(comboFlash)}</span>
                </motion.p>
              )}
            </AnimatePresence>
            <PillButton height={52} onClick={() => setCartOpen(true)} className="shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <ShoppingCart size={15} />
              Ver carrinho · {cartCount} · {fmt(total)}
            </PillButton>
          </div>
        </div>
      )}

      {/* Atalho para a conversa da loja, no canto direito de baixo. Some com
          sheet aberto, como a barra do carrinho, e sobe acima dela quando ela
          aparece. A camada fixa segue a coluna de 480px, para o botão não
          fugir para a borda da janela no computador. */}
      {!overlayOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
          <div
            className={`${COLUMN} flex justify-end px-5`}
            style={{ paddingBottom: cartCount > 0 ? 96 : 26 }}
          >
            {/* Some DESCENDO a lista e volta subindo (ver `fabHidden`). Sai
                por `transform`/`opacity`, sem mexer no layout, e fica fora do
                alcance do toque e do Tab enquanto está escondido. */}
            <a
              href={storeWhatsAppLink()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Falar com a California no WhatsApp"
              aria-hidden={fabHidden || undefined}
              tabIndex={fabHidden ? -1 : undefined}
              className={`${fabHidden ? "pointer-events-none" : "pointer-events-auto"} flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.4)]`}
              style={{
                background: "var(--sf-accent)",
                color: "var(--sf-accent-ink)",
                opacity: fabHidden ? 0 : 1,
                transform: fabHidden ? "translateY(16px) scale(0.9)" : "none",
                transition: reduceMotion ? undefined : `opacity 0.24s ${CSS_EASE_OUT}, transform 0.24s ${CSS_EASE_OUT}`,
              }}
            >
              <WhatsAppIcon size={26} />
            </a>
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
                  // O sheet abre por cima da foto que a pessoa acabou de tocar:
                  // ou ela já está no cache, ou é a única coisa que importa
                  // agora. Nos dois casos não é hora de esperar na fila.
                  priority
                />
                <button
                  type="button"
                  onClick={() => setDetailKey(null)}
                  aria-label="Voltar ao catálogo"
                  className="absolute left-3.5 top-3.5 flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md"
                  style={{ background: "rgba(20,20,26,0.7)", color: "var(--sf-text)" }}
                >
                  <ArrowLeft size={16} />
                </button>
                {/* O carrinho no canto oposto da seta, com o mesmo desenho do
                    cabeçalho: com o sheet aberto a barra de baixo some, e quem
                    terminou de escolher os sabores só saía pela seta. No canto
                    da foto ele não rouba altura da lista de sabores. */}
                {cartCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailKey(null);
                      setCartOpen(true);
                    }}
                    aria-label={`Ver carrinho com ${unitsLabel(cartCount)}, ${fmt(total)}`}
                    className="absolute right-3.5 top-3.5 flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md"
                    style={{ background: "rgba(20,20,26,0.7)", color: "var(--sf-text)" }}
                  >
                    <ShoppingCart size={16} />
                    <span
                      className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-extrabold"
                      style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
                    >
                      {cartCount}
                    </span>
                  </button>
                )}
              </div>

              {/* layoutScroll: avisa o motion que este bloco rola, senão ele mede
                  a posição do realce do sabor sem descontar o scroll e a peça
                  pousa fora do lugar. Mesmo cuidado do `BrandChips`. */}
              <motion.div layoutScroll className="flex-1 overflow-y-auto px-5 pb-3 pt-5">
                {/* Marca e modelo num título só: modelo não tem identidade
                    sozinho ("10K" da Elfbar ≠ "10K" da Ignite), e o sobretítulo
                    com a marca era um rótulo a mais em cima do título. O preço
                    único do modelo fica na mesma linha, dito uma vez em vez de
                    repetido em cada sabor; só quando os sabores custam
                    diferente é que cada linha mostra o seu. */}
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="min-w-0 text-[22px] font-extrabold leading-tight">
                    {detailModel.brand && (
                      <span style={{ color: "var(--sf-text-muted)" }}>{detailModel.brand} </span>
                    )}
                    {detailModel.model || "Sem modelo"}
                  </h2>
                  {detailPrices.length > 0 && (
                    <p className="flex-none text-[15px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                      {detailSamePrice ? fmt(detailPrices[0]) : `A partir de ${fmt(Math.min(...detailPrices))}`}
                    </p>
                  )}
                </div>

                {/* O realce do sabor escolhido é uma peça única: só o item ativo
                    renderiza o `motion.span` com `layoutId`, então o motion
                    desliza a caixinha da opção antiga para a nova em vez de
                    apagar aqui e acender ali. Mesmo padrão do `BrandChips`.
                    Sem rótulo "Sabor" visível: uma lista de sabores embaixo de
                    um modelo não precisa de título; o leitor de tela recebe o
                    nome do grupo. */}
                <div role="group" aria-label="Sabor" className="mt-[18px] flex flex-col gap-2">
                  {detailModel.flavors.map(f => {
                    const out = f.available <= 0;
                    const active = f.product_id === (selectedFlavor?.product_id ?? "");
                    const noCarrinho = cartQtyById.get(f.product_id) ?? 0;
                    // Estoque só quando ele limita: "8 em estoque" em toda
                    // linha era um número que ninguém usava para decidir.
                    const pouco = !out && f.available <= LOW_STOCK;
                    const detalhe = out
                      ? "Esgotado"
                      : [
                          noCarrinho > 0 ? `${noCarrinho} no carrinho` : null,
                          pouco ? (noCarrinho > 0 ? `só ${f.available}` : `Só ${f.available} em estoque`) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                    return (
                      <button
                        key={f.product_id}
                        type="button"
                        aria-pressed={active}
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
                            {/* Duas linhas, não reticências: nome de sabor longo
                                é cortado justo na parte que o diferencia
                                ("Pêssego Manga Maracujá com …"). */}
                            <p className="line-clamp-2 text-sm font-semibold">{f.flavor || "Sem sabor"}</p>
                            {detalhe && (
                              <p
                                className="mt-0.5 text-[11.5px]"
                                // `--sf-warn` é "está acabando" — o mesmo papel que
                                // ele tem na tela do vendedor.
                                style={{
                                  color: out ? "var(--sf-text-dim)" : pouco ? "var(--sf-warn)" : "var(--sf-text-faint)",
                                }}
                              >
                                {detalhe}
                              </p>
                            )}
                          </span>
                        </div>
                        {!detailSamePrice && (
                          <span className="relative z-10 flex-none text-sm font-bold">{fmt(f.sale_price)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              <div
                className="flex flex-shrink-0 flex-col gap-3 px-5 pb-7 pt-3.5"
                style={{ borderTop: "1px solid var(--sf-hairline)", background: "var(--sf-bg)" }}
              >
                {/* O combo dito onde ele se monta: quanto falta, ou que já vale.
                    A frase troca com um fade curto quando o estado muda — é a
                    confirmação de que o segundo sabor ativou o desconto. */}
                {detailCombo && (() => {
                  const preco = `${detailCombo.varies ? "a partir de " : ""}${fmt(detailCombo.price)}`;
                  const nome = detailModel.model || "modelo";
                  const falta = detailCombo.minUnits - modelUnitsInCart;
                  const estado = modelUnitsInCart === 0 ? "convite" : falta > 0 ? "falta" : "ativo";
                  return (
                    <motion.p
                      key={estado}
                      role="status"
                      className="flex items-start gap-2 text-[12.5px] leading-snug"
                      style={{ color: estado === "ativo" ? "var(--sf-text)" : "var(--sf-text-muted)" }}
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.28, ease: EASE_OUT }}
                    >
                      <Tag size={13} aria-hidden className="mt-px flex-none" style={{ color: "var(--sf-accent)" }} />
                      <span>
                        {estado === "convite" &&
                          `${detailCombo.minUnits} ou mais do ${nome}, misturando sabores: ${preco} cada.`}
                        {estado === "falta" && `Mais ${falta} do ${nome}, de qualquer sabor, e cada um sai por ${preco}.`}
                        {estado === "ativo" && (
                          <>
                            <span className="font-bold">Combo ativo:</span> {preco} cada {nome}.
                          </>
                        )}
                      </span>
                    </motion.p>
                  );
                })()}

                <div className="flex items-center gap-2.5">
                  <QtyStepper
                    qty={room <= 0 ? 0 : clampedQty}
                    onDec={() => setQty(Math.max(1, clampedQty - 1))}
                    onInc={() => setQty(Math.min(room, clampedQty + 1))}
                    decDisabled={room <= 0 || clampedQty <= 1}
                    incDisabled={clampedQty >= room}
                    label={selectedFlavor?.flavor || undefined}
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
                    onDone={() => {
                      if (!keepDetailOpen) {
                        setDetailKey(null);
                        return;
                      }
                      setQty(1);
                      // O sabor escolhido esgotou no carrinho: deixar ele
                      // marcado era um beco (quantidade 0, botão apagado). A
                      // seleção passa para o próximo sabor que ainda cabe; se
                      // nenhum cabe mais, não há o que escolher e o sheet fecha.
                      const cabe = (f: CatalogRow) => f.available > (cartQtyById.get(f.product_id) ?? 0);
                      if (selectedFlavor && !cabe(selectedFlavor)) {
                        const next = detailModel.flavors.find(cabe);
                        if (next) setSelectedId(next.product_id);
                        else setDetailKey(null);
                      }
                    }}
                  />
                </div>
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
          if (!o) {
            setCartNotice(null);
            setChangedIds(new Map());
          }
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
          <SheetDescription className="sr-only">{unitsLabel(cartCount)} no carrinho.</SheetDescription>

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
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
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
                    {/* 56px na tela: sem o `cssWidth` a miniatura baixaria a
                        mesma foto de 3000px que o card usa. */}
                    <ProductMedia src={i.image_url ?? null} alt={i.model} iconSize={22} fit="cover" cssWidth={56} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold">{i.model || "Sem modelo"}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                      {i.flavor || "Sem sabor"}
                    </p>
                    {/* A linha que o estoque mexeu diz isso nela mesma: o
                        "ajustamos" do aviso aponta para algum lugar. */}
                    {changedIds.get(i.product_id) && (
                      <p className="mt-0.5 text-xs font-semibold" style={{ color: "var(--sf-warn)" }}>
                        {changedIds.get(i.product_id)}
                      </p>
                    )}
                    <div className="mt-1.5">
                      <QtyStepper
                        compact
                        qty={i.quantity}
                        onDec={() => setItemQty(i.product_id, i.quantity - 1)}
                        onInc={() => setItemQty(i.product_id, i.quantity + 1)}
                        decDisabled={i.quantity <= 1}
                        incDisabled={i.quantity >= i.available}
                        label={i.flavor || i.model}
                      />
                    </div>
                  </div>

                  <div className="flex flex-none flex-col items-end gap-1">
                    <span className="text-[13.5px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                      {fmt(i.sale_price * i.quantity)}
                    </span>
                    {/* 44px de alvo em volta de um ícone pequeno; a margem
                        negativa devolve o espaço para a linha não crescer. */}
                    <button
                      type="button"
                      onClick={() => removeItem(i.product_id)}
                      aria-label={`Remover ${i.flavor || i.model}`}
                      className="-mr-3 flex h-11 w-11 items-center justify-center rounded-full"
                      style={{ color: "var(--sf-text-faint)" }}
                    >
                      <Trash2 size={16} />
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
                  <span className="text-[13px] line-through" style={{ color: "var(--sf-text-faint)" }}>
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
          // Fechar o checkout (arrastar, tocar fora, Esc) VOLTA ao carrinho —
          // o mesmo que a seta. Ia direto para o catálogo, e quem só queria
          // tirar um item precisava achar o carrinho de novo. O aviso de erro
          // morre junto: reabrir o checkout é um recomeço, não a continuação
          // da tentativa que deu errado.
          if (!o) backToCart();
          else setCheckout(true);
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
          <SheetTopBar title="Finalizar pedido" onClose={backToCart} backLabel="Voltar ao carrinho" />
          <SheetDescription className="sr-only">Confira o pedido, informe seus dados e reserve.</SheetDescription>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            {/* O que está sendo reservado, à vista no passo que decide. Antes o
                checkout era só formulário: a pessoa confirmava sem ver os
                itens, e depois de uma recusa por estoque o "confira" não tinha
                o que conferir. As linhas que o estoque mexeu dizem isso nelas. */}
            <section
              aria-labelledby="checkout-itens"
              className="pb-4"
              style={{ borderBottom: "1px solid var(--sf-hairline)" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 id="checkout-itens" className="text-[13.5px] font-bold">
                  Seu pedido · {unitsLabel(cartCount)}
                </h3>
                <button
                  type="button"
                  onClick={backToCart}
                  className="-mr-2 h-10 rounded-full px-2 text-[13px] font-bold"
                  style={{ color: "var(--sf-accent)" }}
                >
                  Editar
                </button>
              </div>
              {cartNotice && (
                <p
                  className="mb-2 rounded-2xl px-3.5 py-2.5 text-[12.5px]"
                  style={{ background: "var(--sf-surface)", color: "var(--sf-text-muted)" }}
                >
                  {cartNotice}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {cart.map(i => (
                  <li key={i.product_id} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="min-w-0" style={{ color: "var(--sf-text-muted)" }}>
                      <span className="font-bold" style={{ color: "var(--sf-text)" }}>
                        {i.quantity}×
                      </span>{" "}
                      {i.model} · {i.flavor || "Sem sabor"}
                      {changedIds.get(i.product_id) && (
                        <span className="block text-xs font-semibold" style={{ color: "var(--sf-warn)" }}>
                          {changedIds.get(i.product_id)}
                        </span>
                      )}
                    </span>
                    <span className="flex-none font-semibold">{fmt(i.sale_price * i.quantity)}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* O WhatsApp é a chave do cliente: assim que fica completo, o
                efeito de fidelidade dispara e o resto do formulário se decide
                sozinho — cartão de boas-vindas se já é cadastrado, campo de
                nome se é a primeira compra. */}
            <Field id="cliente-whats" label="Seu WhatsApp">
              <Input
                id="cliente-whats"
                inputMode="numeric"
                autoComplete="tel-national"
                value={formatPhoneDisplay(phoneInput)}
                onChange={e => setPhoneInput(onlyDigits(e.target.value))}
                placeholder="(11) 90000-0000"
                className={`h-[50px] px-4 ${FIELD_CLASS}`}
                style={FIELD_STYLE}
              />
            </Field>

            {lookupLoading && (
              <p role="status" className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Buscando seu cadastro…
              </p>
            )}

            {!lookupLoading && loyalty && (
              <div
                className="rounded-2xl p-4"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
              >
                <p className="text-[15px] font-bold">Oi, {loyalty.customer_name}!</p>
                {/* "Cliente Frequente", não "Nível Frequente": o nome do nível é
                    um adjetivo de quem compra, e sem o "Cliente" a palavra
                    solta parecia código do sistema. O nome vem cru do banco. */}
                <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  Cliente <span style={{ color: "var(--sf-accent)" }}>{loyalty.loyalty_tier}</span> ·{" "}
                  {unitsLabel(loyalty.total_units)} {loyalty.total_units === 1 ? "comprada" : "compradas"}
                </p>
                {/* Três frases possíveis, e a ordem importa: o desconto que JÁ
                    entrou neste carrinho vem antes do que ainda falta. Quem
                    acabou de ganhar não quer ler quanto falta para o próximo. */}
                <p className="mt-1 flex items-start gap-1.5 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  <Gift size={14} aria-hidden className="mt-0.5 flex-none" style={{ color: "var(--sf-accent)" }} />
                  {preview.loyaltyUnits > 0 ? (
                    <span className="font-bold" style={{ color: "var(--sf-accent)" }}>
                      {preview.loyaltyUnits === 1 ? "Uma unidade" : `${preview.loyaltyUnits} unidades`} deste
                      pedido{preview.loyaltyUnits === 1 ? " sai" : " saem"} com desconto!
                    </span>
                  ) : loyalty.units_until_next_discount === 1 ? (
                    <span>Falta 1 unidade para a próxima sair com desconto</span>
                  ) : (
                    <span>Faltam {loyalty.units_until_next_discount} unidades para a próxima sair com desconto</span>
                  )}
                </p>
              </div>
            )}

            {!lookupLoading && lookupDone && !loyalty && (
              <>
                {/* Quem ainda não é cliente é exatamente quem a fidelidade
                    precisa convencer, e para essa pessoa ela era invisível: o
                    cartão só existia para quem já tinha cadastro. */}
                {/* O ciclo vem de `get_store_rules`, como em todo o resto da
                    loja: o "6" digitado aqui era o único número de regra que
                    não mudaria junto com a função SQL. Sem as regras, a frase
                    promete a fidelidade sem inventar o número. */}
                <p
                  className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px]"
                  style={{ background: "var(--sf-surface)", color: "var(--sf-text-muted)" }}
                >
                  <Gift size={14} aria-hidden className="mt-0.5 flex-none" style={{ color: "var(--sf-accent)" }} />
                  <span>
                    <span className="font-bold" style={{ color: "var(--sf-text)" }}>
                      Primeira compra?
                    </span>{" "}
                    {rules
                      ? `A cada ${rules.loyalty_cycle} unidades compradas, uma sai com metade do preço.`
                      : "Suas compras aqui passam a contar para a fidelidade."}
                  </span>
                </p>
                <Field id="cliente-nome" label="Seu nome">
                  <Input
                    id="cliente-nome"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    placeholder="ex: Pedro"
                    autoComplete="given-name"
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
                    <span className="text-[13px] line-through" style={{ color: "var(--sf-text-faint)" }}>
                      {fmt(fullTotal)}
                    </span>
                  )}
                  <span className="text-lg font-extrabold" style={{ color: "var(--sf-accent)" }}>
                    {fmt(total)}
                  </span>
                </span>
              </div>
              {/* A pergunta de quem está prestes a apertar o botão é "vou
                  pagar agora?". A resposta morava só no tira-dúvidas. */}
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                Pagamento na entrega, em Pix ou dinheiro. Depois de reservar, é só mandar no WhatsApp.
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 px-5 pb-7 pt-3.5" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
            {/* O motivo da recusa fica colado no botão que a pessoa vai apertar
                de novo — é o único lugar em que ele muda o que ela faz. Quando
                só uma conversa resolve, o WhatsApp da loja vem junto: com o
                checkout aberto o botão flutuante fica escondido. */}
            {orderError ? (
              <div className="mb-3 flex flex-col gap-2">
                <p role="alert" className="text-[13px] font-semibold" style={{ color: "var(--sf-danger)" }}>
                  {orderError.text}
                </p>
                {orderError.contact && (
                  <a
                    href={storeWhatsAppLink()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 w-fit items-center gap-2 rounded-full px-4 text-[13px] font-bold"
                    style={{ background: "var(--sf-surface)", color: "var(--sf-accent)" }}
                  >
                    <WhatsAppIcon size={15} />
                    Falar com a California
                  </a>
                )}
              </div>
            ) : (
              blockReason &&
              !submitting && (
                <p className="mb-3 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  {blockReason}
                </p>
              )
            )}
            <PillButton onClick={confirmOrder} disabled={!canSubmit || submitting}>
              Reservar pedido
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>

      {floodLayer}
    </div>
  );
}
