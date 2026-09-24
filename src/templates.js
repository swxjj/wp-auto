/**
 * templates.js — Renders message templates with contact-specific data.
 */

/**
 * Replace all {placeholder} tokens in a template string.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/**
 * Format a product list as bullet points.
 * @param {string[]} productos
 * @returns {string}
 */
function formatProductos(productos) {
  return productos.map((p) => `  • ${p}`).join("\n");
}

/**
 * Build the common template variables from a contact + config.
 * @param {import('./contacts.js').Contact} contact
 * @param {object} config
 * @returns {Record<string, string>}
 */
function buildVars(contact, config) {
  return {
    nombre_tienda: contact.nombre_tienda,
    nombre_contacto: contact.nombre_contacto,
    productos: formatProductos(contact.productos),
    mi_empresa: config.mi_empresa,
    mi_nombre: config.mi_nombre,
  };
}

/**
 * Render a WhatsApp message for a contact.
 * @param {import('./contacts.js').Contact} contact
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {string}
 */
export function renderWhatsAppMessage(contact, config, isFollowup = false) {
  const vars = buildVars(contact, config);
  const template = isFollowup
    ? config.followup_whatsapp_template
    : config.whatsapp_template;
  return render(template, vars);
}

/**
 * Render an email subject line.
 * @param {import('./contacts.js').Contact} contact
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {string}
 */
export function renderEmailSubject(contact, config, isFollowup = false) {
  const subject = render(config.email_subject_template, buildVars(contact, config));
  return isFollowup ? `Re: ${subject}` : subject;
}

/**
 * Render an email body.
 * @param {import('./contacts.js').Contact} contact
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {string}
 */
export function renderEmailBody(contact, config, isFollowup = false) {
  const vars = buildVars(contact, config);
  const template = isFollowup
    ? config.followup_email_template
    : config.email_template;
  return render(template, vars);
}
