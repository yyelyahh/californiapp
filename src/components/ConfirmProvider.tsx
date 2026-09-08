import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /**
   * Pinta o diálogo com os tokens da loja (`--sf-*`) em vez do Nocturne.
   *
   * Não dá para deduzir do DOM: o Radix porta o diálogo para fora da árvore da
   * página, então herança não chega nele — e `.storefront` só define os
   * `--sf-*`, não os tokens do shadcn (`--background`, `--destructive`), então
   * repetir a classe sozinha também não bastaria. Quem sabe em que tema está é
   * a tela que chama, e ela avisa aqui. Ver src/pages/CLAUDE.md §2.
   */
  storefront?: boolean;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolverRef = useRef<(v: boolean) => void>();

  const confirm = useCallback<ConfirmFn>((options) => {
    const normalized: ConfirmOptions =
      typeof options === "string" ? { description: options } : options;
    setOpts(normalized);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleClose = (result: boolean) => {
    setOpen(false);
    resolverRef.current?.(result);
    resolverRef.current = undefined;
  };

  const destructive = opts.destructive !== false;
  const sf = opts.storefront === true;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(false); }}>
        <AlertDialogContent
          className={sf ? "storefront w-[calc(100%-40px)] max-w-[340px] gap-0 rounded-[24px] border-0 p-5" : undefined}
          style={sf ? { background: "var(--sf-bg)", border: "1px solid var(--sf-hairline)" } : undefined}
        >
          <AlertDialogHeader className={sf ? "space-y-1.5 text-left sm:text-left" : undefined}>
            <AlertDialogTitle
              className={sf ? "text-[19px] font-extrabold" : undefined}
              style={sf ? { color: "var(--sf-text)" } : undefined}
            >
              {opts.title ?? "Confirmar ação"}
            </AlertDialogTitle>
            {opts.description && (
              <AlertDialogDescription
                className={
                  sf
                    ? "whitespace-pre-line text-[13px] leading-relaxed"
                    : "whitespace-pre-line"
                }
                style={sf ? { color: "var(--sf-text-muted)" } : undefined}
              >
                {opts.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {/* Na loja os dois botões ficam lado a lado e do mesmo tamanho: é uma
              tela de polegar, e a coluna empilhada do shadcn joga o confirmar
              para longe de onde a mão está. */}
          <AlertDialogFooter className={sf ? "mt-5 flex-row gap-2" : undefined}>
            <AlertDialogCancel
              onClick={() => handleClose(false)}
              className={sf ? "mt-0 h-12 flex-1 rounded-full border-0 text-[13.5px] font-bold sm:mt-0" : undefined}
              style={sf ? { background: "var(--sf-surface)", color: "var(--sf-text-muted)" } : undefined}
            >
              {opts.cancelText ?? "Cancelar"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleClose(true)}
              className={
                sf
                  ? "h-12 flex-1 rounded-full text-[13.5px] font-extrabold"
                  : destructive
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : undefined
              }
              style={
                sf
                  ? {
                      background: destructive ? "var(--sf-danger)" : "var(--sf-accent)",
                      color: "var(--sf-accent-ink)",
                    }
                  : undefined
              }
            >
              {opts.confirmText ?? (destructive ? "Excluir" : "Confirmar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
