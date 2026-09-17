import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Tema FIXO em escuro, e não o do sistema.
 *
 * Havia aqui um `useTheme()` do next-themes, mas o projeto nunca montou o
 * ThemeProvider que ele precisa — sem provider o hook cai no default e o tema
 * saía "system" SEMPRE. Era uma dependência inteira para produzir uma
 * constante, e a constante estava errada: o ERP é o Nocturne, escuro fixo, e a
 * loja pública tem tema próprio (.storefront). Numa máquina com o sistema em
 * tema claro o toast nascia claro em cima de uma tela escura.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
