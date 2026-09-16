import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Uma media query lida em JS, e não em classe do Tailwind.
 *
 * Existe para o caso em que as duas versões de um bloco não podem coexistir no
 * DOM: `hidden lg:block` esconde com CSS, mas o React monta as duas mesmo
 * assim — e numa lista sem virtualização (ver o roadmap da SalesPage) isso
 * dobra o número de nós justamente na tela que já pesa. Quando as duas versões
 * são baratas, continue usando as classes do Tailwind; elas não precisam de
 * um re-render para acertar.
 *
 * O estado NASCE com a resposta certa (não `undefined` nem `false`): começar
 * errado faria a tabela de 760px pintar um quadro no celular antes de ser
 * trocada pelos cards.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // A query pode ter mudado entre o primeiro render e este efeito.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
