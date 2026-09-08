import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { EASE_IN_OUT, EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { formatPhoneDisplay, onlyDigits } from "@/lib/phone";

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
} from "lucide-react";

interface CatalogRow {
  seller_name: string;
  product_id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  sale_price: number;
  available: number;
  image_url?: string | null;
}

interface CartItem {
  product_id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  sale_price: number;
  available: number;
  quantity: number;
  image_url?: string | null;
}

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

function friendlyError(message: string) {
  if (message.includes("nome_invalido")) return "Informe seu nome";
  if (message.includes("whatsapp_invalido")) return "Informe seu WhatsApp";
  if (message.includes("carrinho_vazio")) return "Seu carrinho está vazio";
  if (message.includes("quantidade_invalida")) return "Quantidade inválida";
  if (message.includes("estoque_insuficiente"))
    return "Um dos itens não tem mais estoque suficiente, atualize a página e tente novamente";
  return message || "Não foi possível enviar o pedido. Tente novamente.";
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

interface Loyalty {
  customer_id: string;
  customer_name: string;
  whatsapp: string;
  total_units: number;
  units_until_next_gift: number;
  gifts_earned: number;
  loyalty_tier: string;
}

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
  height = PILL_HEIGHT,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  height?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height,
        background: disabled ? "var(--sf-accent-soft)" : "var(--sf-accent)",
        color: "var(--sf-accent-ink)",
      }}
      className={`flex w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold transition-opacity ${className}`}
    >
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
  if (phase === "idle") return null;
  const draining = phase === "draining";

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
/* Card do catálogo                                                     */
/* ------------------------------------------------------------------ */

function ProductCard({ model, onOpen }: { model: ModelGroup; onOpen: () => void }) {
  const allRows = model.flavors;
  const inStock = allRows.filter(r => r.available > 0);
  const prices = (inStock.length ? inStock : allRows).map(r => r.sale_price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const samePrice = prices.every(p => p === prices[0]);
  const flavorCount = allRows.length;
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

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [freight, setFreight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
  /** Mensagem pronta do pedido aceito, esperando a água escoar para virar tela. */
  const pendingMessage = useRef<string | null>(null);
  /** Erro a mostrar depois que a água sair da frente. */
  const pendingError = useRef<string | null>(null);
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
  const [phoneInput, setPhoneInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);

  const phoneDigits = onlyDigits(phoneInput);
  const phoneComplete = phoneDigits.length >= 10 && phoneDigits.length <= 11;
  const customerName = (loyalty?.customer_name ?? nameInput).trim();

  useEffect(() => {
    if (!phoneComplete) {
      setLoyalty(null);
      setLookupDone(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    (async () => {
      const { data } = await supabase.rpc("get_customer_loyalty", { p_whatsapp: phoneDigits });
      if (cancelled) return;
      // Sem aviso de erro aqui: a busca é um extra, e a falha já tem saída
      // visível — sem cadastro, o campo de nome aparece e o pedido segue igual.
      const row = ((data as unknown as Loyalty[] | null) ?? [])[0] ?? null;
      setLoyalty(row);
      setLookupDone(true);
      setLookupLoading(false);
    })();
    return () => {
      cancelled = true;
    };
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

  const total = useMemo(() => cart.reduce((a, i) => a + i.sale_price * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.quantity, 0), [cart]);

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
  const clampedQty = Math.min(Math.max(1, qty), Math.max(available, 1));

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

  const buildMessage = () => {
    const lines: string[] = [];
    lines.push(`🛒 Novo pedido`);
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
    lines.push(`💰 Total: ${fmt(total)}`);
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
    setSuccessMessage(pendingMessage.current);
    setCart([]);
    setCheckout(false);
    setFreight("");
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

    try {
      const { error } = await supabase.rpc("create_pending_order", {
        p_seller_id: sellerId,
        p_customer_name: customerName,
        p_customer_whatsapp: phoneDigits,
        p_freight_notes: freight.trim() || null,
        p_items: cart.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.sale_price,
        })) as any,
      });
      if (error) throw error;
      pendingMessage.current = buildMessage();
      orderAccepted.current = true;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      pendingError.current = friendlyError(msg);
      if (msg.includes("estoque_insuficiente")) load();
      orderAccepted.current = false;
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
    setSuccessMessage(null);
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

  if (successMessage) {
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
            <h2 className="mb-2 text-[21px] font-extrabold">Pedido confirmado!</h2>
            {/* O WhatsApp NÃO abre sozinho: em celular isso troca de aplicativo
                sem aviso, e quem só queria conferir o resumo se perde. O envio
                é um toque, e o botão fica aqui até a pessoa querer. */}
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              Falta mandar para o vendedor: toque abaixo e escolha a conversa dele no WhatsApp.
            </p>
          </motion.div>
          <motion.div variants={fadeUp} className="mt-2.5 flex w-full flex-col gap-2.5">
            <PillButton
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(successMessage)}`, "_blank")}
            >
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
                    const urgent = !out && f.available <= 2;
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
                              style={{
                                color: out
                                  ? "var(--sf-text-dim)"
                                  : urgent
                                    ? "var(--sf-warn)"
                                    : "var(--sf-text-faint)",
                              }}
                            >
                              {out ? "Esgotado" : urgent ? `Só restam ${f.available}` : `${f.available} em estoque`}
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
                  qty={available <= 0 ? 0 : clampedQty}
                  onDec={() => setQty(Math.max(1, clampedQty - 1))}
                  onInc={() => setQty(Math.min(available, clampedQty + 1))}
                  decDisabled={available <= 0 || clampedQty <= 1}
                  incDisabled={clampedQty >= available}
                />
                <AddToCartButton
                  disabled={!selectedFlavor || available <= 0}
                  label={
                    available <= 0 ? "Esgotado" : `Adicionar · ${fmt((selectedFlavor?.sale_price ?? 0) * clampedQty)}`
                  }
                  onPress={() => selectedFlavor && addToCart(selectedFlavor, clampedQty)}
                  onDone={() => setDetailKey(null)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------- 4. Carrinho ---------------- */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[76vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar title="Seu carrinho" onClose={() => setCartOpen(false)} />
          <SheetDescription className="sr-only">{cartCount} item(ns) selecionado(s).</SheetDescription>

          <div className="flex-1 overflow-y-auto px-5 pt-2">
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
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Total
              </span>
              <span className="text-[19px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                {fmt(total)}
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
                <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  {loyalty.units_until_next_gift === 0
                    ? `Você já garantiu ${loyalty.gifts_earned > 1 ? `${loyalty.gifts_earned} brindes` : "um brinde"}! 🎁`
                    : `Faltam ${loyalty.units_until_next_gift} ${
                        loyalty.units_until_next_gift === 1 ? "unidade" : "unidades"
                      } para o próximo brinde`}
                </p>
              </div>
            )}

            {!lookupLoading && lookupDone && !loyalty && (
              <Field id="cliente-nome" label="Seu nome">
                <Input
                  id="cliente-nome"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  placeholder="ex: Jordan Lee"
                  className={`h-[50px] px-4 ${FIELD_CLASS}`}
                  style={FIELD_STYLE}
                />
              </Field>
            )}

            <Field id="cliente-frete" label="Observações de entrega">
              <Textarea
                id="cliente-frete"
                value={freight}
                onChange={e => setFreight(e.target.value)}
                placeholder="Opcional — horário, endereço, etc."
                rows={3}
                className={`resize-none px-3.5 py-3 text-sm ${FIELD_CLASS}`}
                style={FIELD_STYLE}
              />
            </Field>

            <div
              className="flex items-center justify-between pt-3.5"
              style={{ borderTop: "1px solid var(--sf-hairline)" }}
            >
              <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Total
              </span>
              <span className="text-lg font-extrabold" style={{ color: "var(--sf-accent)" }}>
                {fmt(total)}
              </span>
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
