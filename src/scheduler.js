#!/usr/bin/env node

/**
 * scheduler.js — Long-running process that automates the biweekly workflow.
 *
 * Instead of using macOS launchd, this runs as a persistent Node.js process
 * that handles scheduling internally with node-cron AND listens for WhatsApp
 * responses in real-time between send and check cycles.
 *
 * Usage:
 *   npm run scheduler         # Start the scheduler
 *   node src/scheduler.js     # Same thing
 *
 * The scheduler will:
 * 1. Run "send" every other Tuesday at configured time
 * 2. Keep WhatsApp connected to detect responses in real-time
 * 3. Run "check" on Wednesday to generate the report
 * 4. Run "followup" on Thursday for non-responders
 *
 * Keep this process running (e.g. via pm2, screen, or tmux).
 */

import cron from "node-cron";
import { readFileSync } from "fs";
import { loadContacts, getWhatsAppContacts, getEmailContacts } from "./contacts.js";
import { renderWhatsAppMessage } from "./templates.js";
import {
  loadTracker, saveTracker, markSent, markResponded,
  markFollowupSent, getNeedsFollowup, generateReport,
} from "./tracker.js";
import { createClient, sendBulk, checkResponses, watchForResponses } from "./whatsapp.js";
import { createGmailClient, sendBulkEmails, checkEmailReplies } from "./gmail.js";
import { logger } from "./logger.js";

function loadConfig() {
  return JSON.parse(readFileSync("config.json", "utf-8"));
}

/**
 * Calculate ISO week number for biweekly check.
 */
function getISOWeek() {
  const d = new Date();
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Check if this is a "send week" (even ISO weeks).
 */
function isSendWeek(frequencyWeeks) {
  return getISOWeek() % frequencyWeeks === 0;
}

async function runSend(config) {
  logger.info("\n🚀 ═══ CICLO AUTOMÁTICO: ENVÍO ═══");

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();

  // WhatsApp
  const waContacts = getWhatsAppContacts(contacts);
  if (waContacts.length > 0) {
    logger.info(`📱 Enviando WhatsApp a ${waContacts.length} contactos...`);
    const client = await createClient();
    try {
      const results = await sendBulk(client, waContacts, config, false);
      for (const c of waContacts) {
        if (results.get(c.telefono)) markSent(tracker, c.telefono, "whatsapp");
      }
    } finally {
      await client.destroy();
    }
  }

  // Email
  const emailContacts = getEmailContacts(contacts);
  if (emailContacts.length > 0) {
    logger.info(`📧 Enviando email a ${emailContacts.length} contactos...`);
    const gmail = await createGmailClient(config);
    const results = await sendBulkEmails(gmail, emailContacts, config, false);
    for (const c of emailContacts) {
      if (results.get(c.email)) markSent(tracker, c.email, "email");
    }
  }

  saveTracker(tracker);
  logger.info(`\n${generateReport(tracker)}`);
}

async function runCheck(config) {
  logger.info("\n🔍 ═══ CICLO AUTOMÁTICO: VERIFICACIÓN ═══");

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();

  // Check emails
  const emailContacts = getEmailContacts(contacts);
  if (emailContacts.length > 0) {
    const gmail = await createGmailClient(config);
    const expectedEmails = emailContacts.map((c) => c.email.toLowerCase());
    const replied = await checkEmailReplies(gmail, expectedEmails);
    for (const email of replied) markResponded(tracker, email);
  }

  // Check WhatsApp
  const waContacts = getWhatsAppContacts(contacts);
  if (waContacts.length > 0) {
    const client = await createClient();
    try {
      const phones = waContacts.map((c) => c.telefono);
      const replied = await checkResponses(client, phones);
      for (const phone of replied) {
        const match = waContacts.find((c) =>
          c.telefono.replace(/[\s\-\+\(\)]/g, "") === phone.replace(/[\s\-\+\(\)]/g, "")
        );
        if (match) markResponded(tracker, match.telefono);
      }
    } finally {
      await client.destroy();
    }
  }

  saveTracker(tracker);
  logger.info(`\n${generateReport(tracker)}`);
}

async function runFollowup(config) {
  logger.info("\n🔁 ═══ CICLO AUTOMÁTICO: SEGUIMIENTO ═══");

  const contacts = await loadContacts(config.contacts_csv);
  const tracker = loadTracker();
  const needsFollowup = getNeedsFollowup(tracker);

  if (needsFollowup.length === 0) {
    logger.info("🎉 ¡Todos respondieron!");
    return;
  }

  const needsSet = new Set(needsFollowup);

  // WhatsApp follow-ups
  const waFollowup = getWhatsAppContacts(contacts).filter((c) => needsSet.has(c.telefono));
  if (waFollowup.length > 0) {
    const client = await createClient();
    try {
      const results = await sendBulk(client, waFollowup, config, true);
      for (const c of waFollowup) {
        if (results.get(c.telefono)) markFollowupSent(tracker, c.telefono);
      }
    } finally {
      await client.destroy();
    }
  }

  // Email follow-ups
  const emailFollowup = getEmailContacts(contacts).filter((c) => needsSet.has(c.email));
  if (emailFollowup.length > 0) {
    const gmail = await createGmailClient(config);
    const results = await sendBulkEmails(gmail, emailFollowup, config, true);
    for (const c of emailFollowup) {
      if (results.get(c.email)) markFollowupSent(tracker, c.email);
    }
  }

  saveTracker(tracker);
  logger.info(`\n${generateReport(tracker)}`);
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const { schedule } = config;
  const freq = schedule.frequency_weeks || 2;

  const [sendHour, sendMin] = schedule.send_time.split(":").map(Number);
  const [checkHour, checkMin] = schedule.check_time.split(":").map(Number);
  const [fuHour, fuMin] = schedule.followup_time.split(":").map(Number);

  logger.info("🤖 WP Auto Scheduler iniciado");
  logger.info(`   Frecuencia: cada ${freq} semanas`);
  logger.info(`   Envío:       día ${schedule.send_day} a las ${schedule.send_time}`);
  logger.info(`   Verificación: día ${schedule.check_day} a las ${schedule.check_time}`);
  logger.info(`   Seguimiento: día ${schedule.followup_day} a las ${schedule.followup_time}`);
  logger.info("─".repeat(50));

  // Schedule: SEND — e.g. "0 9 * * 2" (Tuesday at 09:00)
  cron.schedule(`${sendMin} ${sendHour} * * ${schedule.send_day}`, async () => {
    if (!isSendWeek(freq)) {
      logger.info("⏭️  No es semana de envío (biweekly). Saltando.");
      return;
    }
    try {
      await runSend(config);
    } catch (err) {
      logger.error(`💥 Error en envío automático: ${err.message}`);
    }
  });

  // Schedule: CHECK — e.g. "0 9 * * 3" (Wednesday at 09:00)
  cron.schedule(`${checkMin} ${checkHour} * * ${schedule.check_day}`, async () => {
    if (!isSendWeek(freq)) return;
    try {
      await runCheck(config);
    } catch (err) {
      logger.error(`💥 Error en verificación automática: ${err.message}`);
    }
  });

  // Schedule: FOLLOWUP — e.g. "0 9 * * 4" (Thursday at 09:00)
  cron.schedule(`${fuMin} ${fuHour} * * ${schedule.followup_day}`, async () => {
    if (!isSendWeek(freq)) return;
    try {
      await runFollowup(config);
    } catch (err) {
      logger.error(`💥 Error en seguimiento automático: ${err.message}`);
    }
  });

  logger.info("\n✅ Scheduler activo. Presione Ctrl+C para detener.\n");

  // Keep process alive
  process.on("SIGINT", () => {
    logger.info("\n🛑 Scheduler detenido.");
    process.exit(0);
  });
}

main();
