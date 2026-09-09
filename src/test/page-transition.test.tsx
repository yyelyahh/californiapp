import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import PageTransition from "@/components/motion/PageTransition";

/**
 * Regressão do bug "troquei de página e a tela não apareceu; precisei clicar no
 * ícone do menu de novo".
 *
 * A causa era o `AnimatePresence mode="wait"` do `PageTransition` (ver o
 * comentário lá). Os dois sintomas que estes testes travam:
 *
 * - a página de destino montava DUAS vezes por navegação;
 * - se um re-render do pai caísse dentro da janela da animação de saída, a tela
 *   nova ficava presa em `opacity: 0` — no DOM, invisível.
 */

const mounts: string[] = [];

function Page({ name }: { name: string }) {
  useEffect(() => {
    mounts.push(name);
  }, [name]);
  return <div data-testid={`page-${name}`}>conteúdo {name}</div>;
}

/**
 * `ticking` reproduz o que o app real tem por baixo: um pai que re-renderiza
 * sozinho durante a navegação (o poll de pedidos pendentes, o StoreContext).
 */
function Shell({ ticking = false }: { ticking?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setTick(t => t + 1), 16);
    return () => clearInterval(id);
  }, [ticking]);

  return (
    <>
      <Link to="/a">ir A</Link>
      <Link to="/b">ir B</Link>
      <Link to="/c">ir C</Link>
      <PageTransition>
        <Routes>
          <Route path="/b" element={<Page name="b" />} />
          <Route path="/c" element={<Page name="c" />} />
          <Route path="*" element={<Page name="a" />} />
        </Routes>
      </PageTransition>
    </>
  );
}

/** Espera bem mais que os 280ms da entrada, para pegar a tela já parada. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 600)); });

/** Quantas vezes a tela de destino montou (o `initial` da rota "*" também conta). */
const mountsOf = (name: string) => mounts.filter(n => n === name);

/** O invólucro animado é o pai direto da página. */
const wrapperOf = (name: string) => screen.getByTestId(`page-${name}`).parentElement!;

describe("PageTransition", () => {
  // O jsdom guarda a URL entre os testes, e o `BrowserRouter` lê dela. Sem
  // voltar para /a, o teste seguinte começaria já na rota que o anterior
  // deixou — e o clique não seria navegação nenhuma.
  beforeEach(() => {
    window.history.pushState({}, "", "/a");
    mounts.length = 0;
  });

  it("monta a página de destino uma vez só", async () => {
    render(<BrowserRouter><Shell /></BrowserRouter>);

    fireEvent.click(screen.getByText("ir B"));
    await settle();

    expect(mountsOf("b")).toEqual(["b"]);
    expect(wrapperOf("b")).toHaveStyle({ opacity: "1" });
  });

  it("mostra a tela mesmo com re-render do pai durante a troca", async () => {
    render(<BrowserRouter><Shell ticking /></BrowserRouter>);

    fireEvent.click(screen.getByText("ir B"));
    await settle();

    expect(mountsOf("b")).toEqual(["b"]);
    expect(wrapperOf("b")).toHaveStyle({ opacity: "1" });
  });

  it("mostra a tela quando a pessoa clica em dois itens do menu seguidos", async () => {
    render(<BrowserRouter><Shell /></BrowserRouter>);

    fireEvent.click(screen.getByText("ir B"));
    await act(async () => { await new Promise(r => setTimeout(r, 40)); });
    fireEvent.click(screen.getByText("ir C"));
    await settle();

    expect(screen.queryByTestId("page-b")).toBeNull();
    expect(wrapperOf("c")).toHaveStyle({ opacity: "1" });
  });
});
