import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail } from "lucide-react";
import { motion } from "motion/react";
import { scaleIn, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/nocturne";
import LoginWaves from "@/components/LoginWaves";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Credenciais inválidas. Acesso restrito.");
    }
    setLoading(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <LoginWaves />
      <motion.div className="relative z-10 w-full max-w-sm" initial="hidden" animate="visible" variants={scaleIn}>
        <motion.div className="text-center mb-8" variants={fadeUp}>
          <h1 className="nc-wordmark text-4xl font-bold tracking-tight">
            California
          </h1>
          <p className={cn(EYEBROW, "mt-1")} style={{ color: "var(--nc-text-3)" }}>
            Contabilidade
          </p>
        </motion.div>

        {/* Sem card: o formulário flutua sobre as ondas atrás de um vidro. A
            borda dura empilhava duas molduras (título fora, caixa dentro) e
            espremia o fundo nas beiradas. */}
        <div
          className="rounded-2xl border border-border/25 p-6 backdrop-blur-xl"
          style={{
            background: "color-mix(in srgb, hsl(var(--card)) 55%, transparent)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className={cn(EYEBROW, "text-muted-foreground")}>Email</Label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className={cn(EYEBROW, "text-muted-foreground")}>Senha</Label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-10"
                  required
                />
              </div>
            </div>
            {error && (
              <motion.p
                className="text-sm text-destructive"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.p>
            )}
            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
