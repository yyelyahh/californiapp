/**
 * As fotos do catálogo são URLs coladas à mão, no tamanho em que foram
 * publicadas: uma foto de 3000px e 2MB é servida inteira para um card de
 * 440px e para a miniatura de 56px do carrinho. Num 4G ruim é isso que faz a
 * loja parecer travada — e nenhum ajuste de front conserta peso.
 *
 * Enquanto não existe upload próprio (o Storage está no roadmap), a foto passa
 * por um redimensionador público: ele baixa a original uma vez, guarda em
 * cache e devolve a versão do tamanho pedido, já em WebP quando o navegador
 * aceita. O banco não muda: continua guardando a URL original, e é dela que
 * esta função monta a outra.
 *
 * Três cuidados, e os três estão nos testes:
 *
 *   · SÓ http(s) PÚBLICO. `data:`, caminho relativo e endereço de rede local
 *     (o `192.168…` do celular olhando o dev server) não têm como ser
 *     buscados de fora — ali a função devolve a URL original e ninguém perde
 *     tempo com uma requisição que já nasce errada.
 *   · NUNCA DUAS VEZES. URL que já é do proxy volta como está.
 *   · A ORIGINAL É O PLANO B. Quem chama (ProductMedia) cai de volta nela no
 *     `onError` antes de desistir e mostrar o ícone: se o serviço sair do ar,
 *     a loja fica lenta como era antes, não sem foto.
 *
 * Para desligar o proxy — quando o Storage entrar, por exemplo — basta
 * `PROXY_HOST = null`: todo mundo volta a receber a URL original.
 */

const PROXY_HOST: string | null = "https://wsrv.nl/";

/** Acima disso não há tela de celular que aproveite, e o cache do proxy só cresce. */
const MAX_WIDTH = 1200;

/** Qualidade do JPEG/WebP de saída. 80 é o ponto em que a diferença some na tela. */
const QUALITY = 80;

const LOCAL_HOSTS = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * A URL da foto no tamanho que a tela vai usar.
 *
 * @param src    a URL como está no banco
 * @param cssPx  a largura que o elemento ocupa na tela, em px de CSS. O dobro
 *               é pedido ao proxy, para a foto não sair borrada em tela 2x —
 *               é o retina que decide, não o layout.
 */
export function proxiedImage(src: string | null | undefined, cssPx: number): string | null {
  const url = (src ?? "").trim();
  if (!url) return null;
  if (!PROXY_HOST) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Caminho relativo, `data:` mal formado, texto solto: nada a fazer aqui.
    // Quem decide se aquilo carrega é o navegador, como antes.
    return url;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
  if (LOCAL_HOSTS.test(parsed.hostname)) return url;
  if (url.startsWith(PROXY_HOST)) return url;

  const w = Math.max(1, Math.min(MAX_WIDTH, Math.round(cssPx * 2)));
  // `we` = without enlargement: foto menor que o pedido volta no tamanho dela,
  // em vez de ser esticada (e ficar mais pesada do que a original).
  //
  // `output=webp` é pedido na mão porque o serviço NÃO negocia pelo header:
  // medido com `Accept: image/webp`, ele devolvia o mesmo JPEG. Forçando, a
  // mesma foto sai 24% menor. Navegador que não abre WebP (Safari anterior ao
  // 14, de 2020) dispara o `onError` da <img> e cai na URL original — lento
  // como era antes, nunca sem foto.
  return `${PROXY_HOST}?url=${encodeURIComponent(url)}&w=${w}&q=${QUALITY}&we&output=webp`;
}
