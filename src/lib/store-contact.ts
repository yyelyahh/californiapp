/**
 * WhatsApp da loja (+55 51 9714-1255), só dígitos, no formato do wa.me.
 *
 * Mora aqui porque duas telas falam com ele: a loja pública (o pedido
 * finalizado vai direto para esta conversa, e o botão flutuante do catálogo
 * abre a mesma conversa) e a tela do vendedor (o "Confirmou por engano? Avise
 * a California"). Número escrito em dois lugares é número que um dia diverge.
 */
export const STORE_WHATSAPP = "555197141255";

export function storeWhatsAppLink(text?: string) {
  return `https://wa.me/${STORE_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
