import { Component, type ReactNode } from "react";

/**
 * A rede embaixo de cada tela do ERP.
 *
 * Sem ela, qualquer erro durante o desenho de uma tela desmonta o app INTEIRO
 * e deixa a janela em branco — foi o que acontecia ao digitar à mão a data do
 * período personalizado (ver `parseDay` em src/lib/date-utils.ts). Com ela, a
 * sidebar continua de pé, a tela diz o que houve e oferece tentar de novo; e
 * trocar de tela limpa o erro, porque o AppLayout a monta com `key` na rota.
 *
 * Não é conserto de bug nenhum — é o que impede o próximo bug de virar tela em
 * branco. O erro continua no console para quem for investigar.
 */
export default class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Erro ao desenhar a tela:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="nocturne flex flex-1 items-center justify-center p-6">
        <div className="nc-card flex max-w-sm flex-col items-center gap-3 p-6 text-center">
          <p className="text-[15px]">Esta tela encontrou um erro</p>
          <p className="text-[12.5px]" style={{ color: "var(--nc-text-3)" }}>
            Tente de novo. Se o erro voltar, troque de tela e volte.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="nc-btn nc-btn--solid nc-btn--md"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
}
