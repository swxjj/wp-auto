#!/usr/bin/env node

/**
 * index.js — Main CLI orchestrator for the biweekly price request automation.
 *
 * Usage:
 *   node src/index.js send        → Tuesday: send initial messages to all contacts
 *   node src/index.js check       → Wednesday: check for responses, generate report
 *   node src/index.js followup    → Thursday: resend to non-responders
 *   node src/index.js report      → View current cycle status report
 *   node src/index.js test        → Dry run: show what would be sent
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadContacts, getWhatsAppContacts, getEmailContacts } from "./contacts.js";
import { renderWhatsAppMessage, renderEmailBody, renderEmailSubject } from "./templates.js";
import {
  loadTracker, saveTracker, markSent, markResponded,
  markFollowupSent, getNeedsFollowup, generateReport,
} from "./tracker.js";
import {
  createClient, sendBulk, checkResponses,
} from "./whatsapp.js";
import {
  createGmailClient, sendBulkEmails, checkEmailReplies,
} from "./gmail.js";
import { logger } from "./logger.js";

/**
 * Load the config file.
 */
function loadConfig() {
  return JSON.parse(readFileSync("config.json", "utf-8"));
}

// ─── SEND (Tuesday) ─────────────────────────────────────────────────────────

async function cmdSend(config, dryRun = false) {
  logger.info("═".repeat(50));
  logger.info("📤 ENVÍO INICIAL DE SOLICITUDES DE PRECIOS");
  logger.info("═".repeat(50));

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();

  // ── WhatsApp ──
  const waContacts = getWhatsAppContacts(contacts);
  logger.info(`\n📱 WhatsApp: ${waContacts.length} contactos`);

  if (waContacts.length > 0) {
    if (dryRun) {
      for (const c of waContacts) {
        const msg = renderWhatsAppMessage(c, config);
        logger.info(`\n[DRY RUN] Para: ${c.nombre_tienda} (${c.telefono})`);
        logger.info(`Mensaje:\n${msg}\n${"─".repeat(30)}`);
        markSent(tracker, c.telefono, "whatsapp");
      }
    } else {
      const client = await createClient();
      try {
        const results = await sendBulk(client, waContacts, config, false);
        for (const contact of waContacts) {
          if (results.get(contact.telefono)) {
            markSent(tracker, contact.telefono, "whatsapp");
          }
        }
      } finally {
        await client.destroy();
      }
    }
  }

  // ── Email ──
  const emailContacts = getEmailContacts(contacts);
  logger.info(`\n📧 Email: ${emailContacts.length} contactos`);

  if (emailContacts.length > 0) {
    if (dryRun) {
      for (const c of emailContacts) {
        const subject = renderEmailSubject(c, config);
        const body = renderEmailBody(c, config);
        logger.info(`\n[DRY RUN] Para: ${c.nombre_contacto} (${c.email})`);
        logger.info(`Asunto: ${subject}`);
        logger.info(`Cuerpo:\n${body}\n${"─".repeat(30)}`);
        markSent(tracker, c.email, "email");
      }
    } else {
      const gmail = await createGmailClient(config);
      const results = await sendBulkEmails(gmail, emailContacts, config, false);
      for (const contact of emailContacts) {
        if (results.get(contact.email)) {
          markSent(tracker, contact.email, "email");
        }
      }
    }
  }

  saveTracker(tracker);
  logger.info(`\n${"═".repeat(50)}`);
  logger.info("✅ Envío completado. Tracker guardado.");
  logger.info(`\n${generateReport(tracker)}`);
}

// ─── CHECK (Wednesday) ──────────────────────────────────────────────────────

async function cmdCheck(config) {
  logger.info("═".repeat(50));
  logger.info("🔍 VERIFICACIÓN DE RESPUESTAS");
  logger.info("═".repeat(50));

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();

  // ── Check Gmail replies ──
  const emailContacts = getEmailContacts(contacts);
  if (emailContacts.length > 0) {
    logger.info("\n📧 Verificando respuestas por email...");
    const gmail = await createGmailClient(config);
    const expectedEmails = emailContacts
      .map((c) => c.email.toLowerCase())
      .filter(Boolean);
    const respondedEmails = await checkEmailReplies(gmail, expectedEmails);

    for (const email of respondedEmails) {
      markResponded(tracker, email);
    }
  }

  // ── Check WhatsApp replies ──
  const waContacts = getWhatsAppContacts(contacts);
  if (waContacts.length > 0) {
    logger.info("\n📱 Verificando respuestas de WhatsApp...");
    const client = await createClient();
    try {
      const phones = waContacts.map((c) => c.telefono);
      const respondedPhones = await checkResponses(client, phones);

      for (const phone of respondedPhones) {
        // Normalize phone to match tracker keys
        const matchingContact = waContacts.find((c) => {
          const cleanTracker = c.telefono.replace(/[\s\-\+\(\)]/g, "");
          const cleanResponse = phone.replace(/[\s\-\+\(\)]/g, "");
          return cleanTracker === cleanResponse;
        });
        if (matchingContact) {
          markResponded(tracker, matchingContact.telefono);
        }
      }
    } finally {
      await client.destroy();
    }
  }

  saveTracker(tracker);

  // Generate and display report
  const report = generateReport(tracker);
  logger.info(`\n${report}`);

  // Save report to file
  const reportPath = join("logs", `reporte_${tracker.cycle_id}.txt`);
  writeFileSync(reportPath, report, "utf-8");
  logger.info(`\n📄 Reporte guardado en: ${reportPath}`);
}

// ─── FOLLOWUP (Thursday) ────────────────────────────────────────────────────

async function cmdFollowup(config, dryRun = false) {
  logger.info("═".repeat(50));
  logger.info("🔁 ENVÍO DE SEGUIMIENTO A NO RESPONDIDOS");
  logger.info("═".repeat(50));

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();

  const needsFollowup = getNeedsFollowup(tracker);
  if (needsFollowup.length === 0) {
    logger.info("🎉 ¡Todos respondieron! No es necesario enviar seguimiento.");
    return;
  }

  logger.info(`📋 ${needsFollowup.length} contactos necesitan seguimiento.`);

  // Build lists of contacts needing follow-up
  const needsSet = new Set(needsFollowup);
  const waFollowup = getWhatsAppContacts(contacts).filter((c) =>
    needsSet.has(c.telefono)
  );
  const emailFollowup = getEmailContacts(contacts).filter((c) =>
    needsSet.has(c.email)
  );

  // ── WhatsApp follow-ups ──
  if (waFollowup.length > 0) {
    logger.info(`\n📱 WhatsApp seguimiento: ${waFollowup.length} contactos`);

    if (dryRun) {
      for (const c of waFollowup) {
        const msg = renderWhatsAppMessage(c, config, true);
        logger.info(`\n[DRY RUN] Seguimiento: ${c.nombre_tienda} (${c.telefono})`);
        logger.info(`Mensaje:\n${msg}\n${"─".repeat(30)}`);
        markFollowupSent(tracker, c.telefono);
      }
    } else {
      const client = await createClient();
      try {
        const results = await sendBulk(client, waFollowup, config, true);
        for (const contact of waFollowup) {
          if (results.get(contact.telefono)) {
            markFollowupSent(tracker, contact.telefono);
          }
        }
      } finally {
        await client.destroy();
      }
    }
  }

  // ── Email follow-ups ──
  if (emailFollowup.length > 0) {
    logger.info(`\n📧 Email seguimiento: ${emailFollowup.length} contactos`);

    if (dryRun) {
      for (const c of emailFollowup) {
        const subject = renderEmailSubject(c, config, true);
        const body = renderEmailBody(c, config, true);
        logger.info(`\n[DRY RUN] Seguimiento: ${c.nombre_contacto} (${c.email})`);
        logger.info(`Asunto: ${subject}`);
        logger.info(`Cuerpo:\n${body}\n${"─".repeat(30)}`);
        markFollowupSent(tracker, c.email);
      }
    } else {
      const gmail = await createGmailClient(config);
      const results = await sendBulkEmails(gmail, emailFollowup, config, true);
      for (const contact of emailFollowup) {
        if (results.get(contact.email)) {
          markFollowupSent(tracker, contact.email);
        }
      }
    }
  }

  saveTracker(tracker);
  logger.info(`\n${"═".repeat(50)}`);
  logger.info("✅ Seguimiento completado.");
  logger.info(`\n${generateReport(tracker)}`);
}

// ─── REPORT ─────────────────────────────────────────────────────────────────

function cmdReport() {
  const tracker = loadTracker();
  console.log(generateReport(tracker));
}

// ─── CLI ENTRY POINT ────────────────────────────────────────────────────────

const HELP = `
🤖 WP Auto — Automatización de Solicitudes de Precios

Comandos:
  send       Martes: enviar mensajes a todos los contactos
  check      Miércoles: verificar respuestas y generar reporte
  followup   Jueves: reenviar a quienes no respondieron
  report     Ver estado del ciclo actual
  test       Dry run — mostrar qué se enviaría sin enviar

Uso:
  node src/index.js <comando>
  npm run <comando>
`;

async function main() {
  const command = process.argv[2]?.toLowerCase();

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const config = loadConfig();

  try {
    switch (command) {
      case "send":
        await cmdSend(config);
        break;
      case "check":
        await cmdCheck(config);
        break;
      case "followup":
        await cmdFollowup(config);
        break;
      case "report":
        cmdReport();
        break;
      case "test":
        logger.info("🧪 MODO DE PRUEBA (dry run) — No se enviarán mensajes reales\n");
        await cmdSend(config, true);
        break;
      default:
        console.error(`❌ Comando no reconocido: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    logger.error(`💥 Error fatal: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
