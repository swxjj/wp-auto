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
        contacts.push({
          nombre_tienda: row.nombre_tienda || "",
          nombre_contacto: row.nombre_contacto || "",
          telefono: row.telefono || null,
          email: row.email || null,
          tipo: (row.tipo || "whatsapp").toLowerCase(),
          productos: (row.productos || "")
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
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
