import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        /**
         * Três bibliotecas grandes em arquivos próprios, com nome estável.
         *
         * Isso NÃO diminui o total baixado na primeira visita — quem diminui é
         * o `lazy` de cada tela, no App.tsx. O que muda é a SEGUNDA visita:
         * react, supabase e motion quase nunca mudam, e hoje eles voltavam do
         * servidor a cada deploy só porque uma linha de tela mudou junto no
         * mesmo arquivo. Separados, o navegador reaproveita o que já tem.
         *
         * Os grupos param aqui de propósito. Um por pacote (o que o Rollup faz
         * se a gente deixar) vira vinte e poucos arquivos minúsculos, e aí o
         * custo de pedir cada um passa a pesar mais que o que se economiza.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return "react";
          if (id.includes("node_modules/@supabase/")) return "supabase";
          if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return "motion";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
