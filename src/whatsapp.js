/**
 * whatsapp.js — WhatsApp Web automation using whatsapp-web.js.
 *
 * This module provides a reliable WhatsApp client that:
 * - Connects to WhatsApp Web via the whatsapp-web.js library
 * - Displays a QR code in terminal on first run (scan with phone)
 * - Persists session data for automatic reconnection
 * - Sends messages directly via the protocol (no UI scraping)
 * - Listens for incoming messages to detect responses
 */

import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";
import { renderWhatsAppMessage } from "./templates.js";
import { logger } from "./logger.js";

/**
 * Creates and initializes a WhatsApp client.
 * The client stays connected until you call destroy().
 *
 * @returns {Promise<Client>} Authenticated WhatsApp client
 */
export async function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: false,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--profile-directory=WPAuto",
      ],
    },
  });

  return new Promise((resolve, reject) => {
    // Display QR code in terminal for first-time authentication
    client.on("qr", (qr) => {
      logger.info("📱 Escanee este código QR con WhatsApp en su celular:");
      qrcode.generate(qr, { small: true });
    });

    client.on("authenticated", () => {
      logger.info("✅ WhatsApp autenticado correctamente.");
    });

    client.on("auth_failure", (msg) => {
      logger.error(`❌ Error de autenticación WhatsApp: ${msg}`);
      reject(new Error(`Auth failure: ${msg}`));
    });

    client.on("ready", () => {
      logger.info("✅ WhatsApp Web está listo.");
      resolve(client);
    });

    client.on("disconnected", (reason) => {
      logger.warn(`⚠️ WhatsApp desconectado: ${reason}`);
    });

    logger.info("🔄 Conectando a WhatsApp Web...");
    client.initialize().catch(reject);
  });
}

/**
 * Format a phone number for WhatsApp's chat ID format.
 * WhatsApp expects: countrycode + number + @c.us
 * Example: "+54 9 11 1234-5678" → "5491112345678@c.us"
 *
 * @param {string} phone
 * @returns {string}
 */
function formatChatId(phone) {
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, "");
  return `${cleaned}@c.us`;
}

/**
 * Send a WhatsApp message to a single contact.
 *
 * @param {Client} client - Authenticated WhatsApp client
 * @param {import('./contacts.js').Contact} contact
 * @param {string} message
 * @param {number} delayMs - Delay after sending (anti-spam)
 * @returns {Promise<boolean>} True if sent successfully
 */
export async function sendMessage(client, contact, message, delayMs = 5000) {
  const chatId = formatChatId(contact.telefono);

  try {
    // Check if the number is registered on WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      logger.warn(
        `⚠️ ${contact.nombre_tienda} (${contact.telefono}) no está registrado en WhatsApp.`
      );
      return false;
    }

    await client.sendMessage(chatId, message);
    logger.info(
      `✅ Mensaje enviado a ${contact.nombre_tienda} (${contact.telefono})`
    );

    // Anti-spam delay
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    return true;
  } catch (err) {
    logger.error(
      `❌ Error enviando a ${contact.nombre_tienda} (${contact.telefono}): ${err.message}`
    );
    return false;
  }
}

/**
 * Send WhatsApp messages to multiple contacts.
 *
 * @param {Client} client
 * @param {import('./contacts.js').Contact[]} contacts
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {Promise<Map<string, boolean>>} phone → success
 */
export async function sendBulk(client, contacts, config, isFollowup = false) {
  const results = new Map();
  const delayMs = config.whatsapp_delay_between_messages_ms || 5000;

  for (const contact of contacts) {
    const message = renderWhatsAppMessage(contact, config, isFollowup);
    const success = await sendMessage(client, contact, message, delayMs);
    results.set(contact.telefono, success);
  }

  return results;
}

/**
 * Check for unread messages from specific phone numbers.
 * Uses whatsapp-web.js's chat API to find chats with unread messages.
 *
 * @param {Client} client
 * @param {string[]} phoneNumbers - List of phone numbers to check
 * @returns {Promise<string[]>} Phone numbers that have sent messages
 */
export async function checkResponses(client, phoneNumbers) {
  const respondedPhones = [];

  try {
    const chats = await client.getChats();

    // Build a set of expected chat IDs
    const expectedIds = new Set(phoneNumbers.map(formatChatId));

    for (const chat of chats) {
      if (expectedIds.has(chat.id._serialized) && chat.unreadCount > 0) {
        // Extract the phone number back from chat ID
        const phone = "+" + chat.id.user;
        respondedPhones.push(phone);
        logger.info(
          `✅ Respuesta detectada de: ${chat.name || phone} (${chat.unreadCount} mensajes sin leer)`
        );
      }
    }
  } catch (err) {
    logger.error(`❌ Error verificando respuestas WhatsApp: ${err.message}`);
  }

  return respondedPhones;
}

/**
 * Set up a real-time listener for incoming messages.
 * This allows detecting responses as they arrive (useful for the scheduler mode).
 *
 * @param {Client} client
 * @param {string[]} watchPhones - Phone numbers to watch for
 * @param {function(string)} onResponse - Callback with the phone number that responded
 * @returns {function} Cleanup function to remove the listener
 */
export function watchForResponses(client, watchPhones, onResponse) {
  const expectedIds = new Set(watchPhones.map(formatChatId));

  const handler = (msg) => {
    const senderId = msg.from;
    if (expectedIds.has(senderId)) {
      const phone = "+" + senderId.replace("@c.us", "");
      logger.info(`📩 Respuesta recibida en tiempo real de: ${phone}`);
      onResponse(phone);
    }
  };

  client.on("message", handler);
  logger.info(
    `👂 Escuchando respuestas de ${watchPhones.length} contactos...`
  );

  // Return cleanup function
  return () => client.removeListener("message", handler);
}
