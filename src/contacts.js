/**
 * contacts.js — Loads and manages the shop contact list from CSV.
 */

import { createReadStream } from "fs";
import { parse } from "csv-parse";

/**
 * @typedef {Object} Contact
 * @property {string} nombre_tienda  - Shop name
 * @property {string} nombre_contacto - Contact person name
 * @property {string|null} telefono   - Phone number (international format)
 * @property {string|null} email      - Email address
 * @property {string} tipo            - "whatsapp", "email", or "ambos"
 * @property {string[]} productos     - List of products to request prices for
 */

/**
 * Load contacts from a CSV file.
 * @param {string} csvPath - Path to the CSV file
 * @returns {Promise<Contact[]>}
 */
export async function loadContacts(csvPath) {
  return new Promise((resolve, reject) => {
    const contacts = [];

    createReadStream(csvPath, { encoding: "utf-8" })
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        })
      )
      .on("data", (row) => {
        // Skip ghost empty rows (e.g. ,,,,,)
        const email = row.email || row.mail || null;
        const telefono = row.telefono || null;
        const nombre_tienda = (row.nombre_tienda || "").trim();

        if (!nombre_tienda && !telefono && !email) {
          return;
        }

        let tipo = (row.tipo || "whatsapp").toLowerCase().trim();
        if (tipo === "mail") tipo = "email";

        // Strip leading/trailing literal quotes from products
        const rawProducts = (row.productos || "").replace(/^"+|"+$/g, "");
        const productos = rawProducts
          .split(",")
          .map((p) => p.trim().replace(/^"+|"+$/g, ""))
          .filter(Boolean);

        contacts.push({
          nombre_tienda,
          nombre_contacto: (row.nombre_contacto || "").trim(),
          telefono: telefono ? telefono.trim() : null,
          email: email ? email.trim() : null,
          tipo,
          productos,
        });
      })
      .on("end", () => resolve(contacts))
      .on("error", reject);
  });
}

/**
 * Filter contacts that need WhatsApp messages.
 * @param {Contact[]} contacts
 * @returns {Contact[]}
 */
export function getWhatsAppContacts(contacts) {
  return contacts.filter(
    (c) => (c.tipo === "whatsapp" || c.tipo === "ambos") && c.telefono
  );
}

/**
 * Filter contacts that need email.
 * @param {Contact[]} contacts
 * @returns {Contact[]}
 */
export function getEmailContacts(contacts) {
  return contacts.filter(
    (c) => (c.tipo === "email" || c.tipo === "ambos") && c.email
  );
}
