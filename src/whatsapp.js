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

import fs from "fs";

/**
 * Detect Google Chrome path based on the operating system.
 */
function getDefaultChromePath() {
  if (process.platform === "darwin") {
    const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return fs.existsSync(macPath) ? macPath : undefined;
  }
  if (process.platform === "win32") {
    const winPaths = [
      `${process.env["PROGRAMFILES"] || "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["LOCALAPPDATA"] || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }
  if (process.platform === "linux") {
    const linuxPaths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

/**
 * Creates and initializes a WhatsApp client.
 * The client stays connected until you call destroy().
 *
 * @returns {Promise<Client>} Authenticated WhatsApp client
 */
export async function createClient() {
  const chromePath = getDefaultChromePath();
  const puppeteerConfig = {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--profile-directory=WPAuto",
    ],
  };

  if (chromePath) {
    puppeteerConfig.executablePath = chromePath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: puppeteerConfig,
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
 * Calculate a randomized human-like delay with jitter.
 * Default range: 8,000ms - 18,000ms (8 to 18 seconds).
 *
 * @param {object} [config]
 * @returns {number} Delay in milliseconds
 */
export function getHumanDelay(config = {}) {
  const minMs = config.whatsapp_delay_min_ms ?? 8000;
  const maxMs = config.whatsapp_delay_max_ms ?? 18000;

  if (
    config.whatsapp_delay_between_messages_ms &&
    !config.whatsapp_delay_min_ms &&
    !config.whatsapp_delay_max_ms
  ) {
    const base = config.whatsapp_delay_between_messages_ms;
    const min = Math.max(1000, Math.floor(base * 0.75));
    const max = Math.floor(base * 1.25);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Send a WhatsApp message to a single contact.
 *
 * @param {Client} client - Authenticated WhatsApp client
 * @param {import('./contacts.js').Contact} contact
 * @param {string} message
 * @param {number|null} delayMs - Delay after sending (anti-spam), null for randomized delay
 * @returns {Promise<boolean>} True if sent successfully
 */
export async function sendMessage(client, contact, message, delayMs = null) {
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

    // Anti-spam delay if requested
    const waitTime = delayMs !== null ? delayMs : getHumanDelay();
    if (waitTime > 0) {
      await new Promise((r) => setTimeout(r, waitTime));
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
 * Send WhatsApp messages to multiple contacts with randomized anti-spam jitter.
 *
 * @param {Client} client
 * @param {import('./contacts.js').Contact[]} contacts
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {Promise<Map<string, boolean>>} phone → success
 */
export async function sendBulk(client, contacts, config, isFollowup = false) {
  const results = new Map();

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const message = renderWhatsAppMessage(contact, config, isFollowup);
    const success = await sendMessage(client, contact, message, 0);
    results.set(contact.telefono, success);

    // Wait with randomized human-like jitter between messages (except after the last one)
    if (i < contacts.length - 1) {
      const delayMs = getHumanDelay(config);
      logger.info(
        `⏳ Pausa humana anti-spam: esperando ${(delayMs / 1000).toFixed(1)}s antes del próximo mensaje... (${i + 1}/${contacts.length})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Grace buffer after the last message to ensure WhatsApp Web flushes
  // WebSocket frames and confirms server delivery before the browser is closed
  if (contacts.length > 0) {
    logger.info(
      "⏳ Esperando 5s de confirmación para asegurar la entrega del último mensaje a WhatsApp..."
    );
    await new Promise((r) => setTimeout(r, 5000));
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
