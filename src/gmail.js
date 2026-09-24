/**
 * gmail.js — Gmail API integration for sending and checking emails.
 *
 * Setup:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create project → Enable Gmail API
 * 3. Create OAuth 2.0 credentials (Desktop App)
 * 4. Download JSON → save as credentials/gmail_credentials.json
 * 5. Run `npm run setup-gmail` to authorize (opens browser)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { google } from "googleapis";
import { renderEmailBody, renderEmailSubject } from "./templates.js";
import { logger } from "./logger.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/**
 * Authenticate with Gmail API using OAuth 2.0.
 * @param {object} config
 * @returns {Promise<import('googleapis').gmail_v1.Gmail>}
 */
export async function createGmailClient(config) {
  const credsPath = config.gmail_credentials_path;
  const tokenPath = config.gmail_token_path;

  if (!existsSync(credsPath)) {
    throw new Error(
      `No se encontró el archivo de credenciales: ${credsPath}\n` +
        `Descargue las credenciales OAuth de Google Cloud Console y guárdelas ahí.`
    );
  }

  const credentials = JSON.parse(readFileSync(credsPath, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "http://localhost"
  );

  // Try to load existing token
  if (existsSync(tokenPath)) {
    const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
    oAuth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      try {
        const { credentials: newCreds } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(newCreds);
        saveToken(tokenPath, newCreds);
        logger.info("🔄 Token de Gmail refrescado.");
      } catch (err) {
        logger.warn(
          `⚠️ No se pudo refrescar el token. Ejecute: npm run setup-gmail`
        );
        throw err;
      }
    }
  } else {
    throw new Error(
      `No se encontró el token de Gmail. Ejecute primero: npm run setup-gmail`
    );
  }

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  logger.info("✅ Gmail API autenticado.");
  return gmail;
}

/**
 * Save OAuth token to disk.
 * @param {string} tokenPath
 * @param {object} token
 */
function saveToken(tokenPath, token) {
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(token, null, 2), "utf-8");
}

/**
 * Send an email.
 * @param {import('googleapis').gmail_v1.Gmail} gmail
 * @param {string} senderEmail
 * @param {import('./contacts.js').Contact} contact
 * @param {string} subject
 * @param {string} body
 * @returns {Promise<boolean>}
 */
export async function sendEmail(gmail, senderEmail, contact, subject, body) {
  try {
    // Build raw email in RFC 2822 format
    const rawEmail = [
      `From: ${senderEmail}`,
      `To: ${contact.email}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      Buffer.from(body).toString("base64"),
    ].join("\r\n");

    const encodedMessage = Buffer.from(rawEmail)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage },
    });

    logger.info(
      `✅ Email enviado a ${contact.nombre_contacto} (${contact.email})`
    );
    return true;
  } catch (err) {
    logger.error(`❌ Error enviando email a ${contact.email}: ${err.message}`);
    return false;
  }
}

/**
 * Send emails to multiple contacts.
 * @param {import('googleapis').gmail_v1.Gmail} gmail
 * @param {import('./contacts.js').Contact[]} contacts
 * @param {object} config
 * @param {boolean} [isFollowup=false]
 * @returns {Promise<Map<string, boolean>>} email → success
 */
export async function sendBulkEmails(
  gmail,
  contacts,
  config,
  isFollowup = false
) {
  const results = new Map();

  for (const contact of contacts) {
    const subject = renderEmailSubject(contact, config, isFollowup);
    const body = renderEmailBody(contact, config, isFollowup);
    const success = await sendEmail(
      gmail,
      config.sender_email,
      contact,
      subject,
      body
    );
    results.set(contact.email, success);
  }

  return results;
}

/**
 * Check for email replies from expected senders since a given date.
 * @param {import('googleapis').gmail_v1.Gmail} gmail
 * @param {string[]} expectedEmails - Email addresses to check
 * @param {number} [sinceDays=3] - How many days back to check
 * @returns {Promise<string[]>} Email addresses that have replied
 */
export async function checkEmailReplies(gmail, expectedEmails, sinceDays = 3) {
  const respondedEmails = [];

  try {
    // Build date for "after" query
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);
    const dateStr = sinceDate.toISOString().split("T")[0].replace(/-/g, "/");

    // Build search query
    const senderQuery = expectedEmails
      .map((e) => `from:${e}`)
      .join(" OR ");
    const query = `after:${dateStr} in:inbox (${senderQuery})`;

    logger.info(`🔍 Buscando respuestas con query: ${query}`);

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
    });

    const messages = res.data.messages || [];

    for (const msgRef of messages) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: msgRef.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });

      const headers = {};
      for (const h of msg.data.payload?.headers || []) {
        headers[h.name] = h.value;
      }

      const fromEmail = extractEmail(headers.From || "");
      if (fromEmail && expectedEmails.includes(fromEmail)) {
        if (!respondedEmails.includes(fromEmail)) {
          respondedEmails.push(fromEmail);
          logger.info(
            `✅ Respuesta email de: ${headers.From} — ${headers.Subject}`
          );
        }
      }
    }
  } catch (err) {
    logger.error(`❌ Error verificando emails: ${err.message}`);
  }

  return respondedEmails;
}

/**
 * Extract email address from a "From" header.
 * "Juan López <juan@example.com>" → "juan@example.com"
 * @param {string} from
 * @returns {string}
 */
function extractEmail(from) {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}
