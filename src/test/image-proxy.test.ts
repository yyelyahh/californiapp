import { describe, it, expect } from "vitest";
import { proxiedImage } from "@/lib/image-proxy";

/**
 * O proxy é o que faz uma foto de 2MB chegar com 80KB no celular. O que se
 * testa aqui é QUANDO ele não deve entrar no caminho: URL que ele não
 * alcançaria, URL que já é dele, e o tamanho que se pede.
 */

const FOTO = "https://cdn.exemplo.com/fotos/ignite v155.jpg?v=2";

describe("proxiedImage", () => {
  it("monta a url do proxy com a original codificada", () => {
    const out = proxiedImage(FOTO, 440)!;
    expect(out.startsWith("https://wsrv.nl/?url=")).toBe(true);
    // A original vai inteira e codificada: espaço e query string não podem
    // vazar para os parâmetros do proxy.
    expect(out).toContain(encodeURIComponent(FOTO));
    expect(out).not.toContain("ignite v155");
  });

  it("pede o dobro da largura da tela, para não borrar em tela 2x", () => {
    expect(proxiedImage(FOTO, 440)).toContain("&w=880");
    expect(proxiedImage(FOTO, 56)).toContain("&w=112");
  });

  it("tem teto de largura", () => {
    expect(proxiedImage(FOTO, 4000)).toContain("&w=1200");
  });

  it("não estica foto menor que o pedido", () => {
    expect(proxiedImage(FOTO, 440)).toContain("&we");
  });

  it("pede WebP, que o serviço não entrega por negociação", () => {
    expect(proxiedImage(FOTO, 440)).toContain("&output=webp");
  });

  it("não passa duas vezes pelo proxy", () => {
    const uma = proxiedImage(FOTO, 440)!;
    expect(proxiedImage(uma, 440)).toBe(uma);
  });

  it("devolve a original quando o proxy não teria como buscar", () => {
    // Sem protocolo http(s) não há o que baixar de fora.
    expect(proxiedImage("data:image/png;base64,AAAA", 440)).toBe("data:image/png;base64,AAAA");
    expect(proxiedImage("/local/foto.jpg", 440)).toBe("/local/foto.jpg");
    // Dev server na rede de casa: o proxy nunca chegaria nesse endereço.
    expect(proxiedImage("http://192.168.0.12:8080/foto.jpg", 440)).toBe("http://192.168.0.12:8080/foto.jpg");
    expect(proxiedImage("http://localhost:8080/foto.jpg", 440)).toBe("http://localhost:8080/foto.jpg");
  });

  it("produto sem foto continua sem foto", () => {
    expect(proxiedImage(null, 440)).toBeNull();
    expect(proxiedImage("   ", 440)).toBeNull();
  });
});
