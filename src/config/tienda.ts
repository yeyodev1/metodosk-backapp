/**
 * La tienda de Scarlett en Amazon.
 *
 * Todo lo que usa —lo del reto y lo de su vida diaria— reunido en un enlace,
 * para que la pregunta que más llega ("¿qué banda compraste?") tenga una sola
 * respuesta.
 *
 * Vive en el servidor porque de acá sale el bloque que va dentro de los
 * correos. El frontend tiene su propia copia para la app y la landing (ver
 * metodosk-frontapp/src/config/tienda.ts) — si cambia una, cambia la otra.
 */

export const TIENDA = {
  url: "https://www.amazon.com/shop/scarlettcordova9",
  titulo: "La tienda de Scarlett",
  intro:
    "Sus mancuernas, su banda, su mat, su botella y lo que usa fuera del gym. Todo lo que le preguntan, en un solo lugar.",
  cta: "Ver la tienda de Scarlett",
  /**
   * La comisión se dice de frente, también en el correo. Si se descubriera
   * después, haría dudar del resto de las recomendaciones.
   */
  nota: "Amazon le reconoce una pequeña comisión por cada compra hecha desde su tienda. A ti no te cuesta nada más.",
};

/**
 * El bloque de la tienda, tal cual va dentro de un correo.
 *
 * Va pegado a la lista de implementos y no aparte: quien acaba de leer que
 * necesita una banda de tela es exactamente quien se está preguntando dónde
 * la compra.
 */
export function tiendaHtml(): string {
  return `
    <div style="margin:0 0 20px;padding:18px 20px;border-radius:12px;background:#191413;">
      <div style="color:#f3d9cf;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;">${TIENDA.titulo}</div>
      <div style="color:#fffdfb;font-size:18px;line-height:1.3;margin-bottom:8px;">Todo lo que usa Scarlett, en un solo lugar</div>
      <p style="margin:0 0 14px;color:rgba(255,253,251,.75);font-size:14px;line-height:1.6;">
        ${TIENDA.intro}
      </p>
      <a href="${TIENDA.url}" style="display:block;padding:14px 20px;border-radius:999px;background:#a5655d;color:#fffdfb;font-size:14px;font-weight:600;text-align:center;text-decoration:none;">
        ${TIENDA.cta} →
      </a>
      <div style="margin-top:12px;color:rgba(255,253,251,.55);font-size:12px;line-height:1.6;">
        ${TIENDA.nota}
      </div>
    </div>`;
}

/** La misma tienda, para el texto plano. */
export function tiendaText(): string {
  return [
    `${TIENDA.titulo.toUpperCase()} 🛍️`,
    TIENDA.intro,
    TIENDA.url,
    TIENDA.nota,
  ].join("\n");
}
