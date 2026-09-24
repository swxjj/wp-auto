/**
 * tracker.js — Tracks which contacts have been messaged and who responded.
 *
 * Stores state in JSON files per cycle (biweekly round) inside tracking/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TRACKER_DIR = "tracking";

/**
 * Generate a cycle ID based on year and ISO week number.
 * @returns {string} e.g. "2026-W39"
 */
function getCycleId() {
  const now = new Date();
  // Calculate ISO week number
  const d = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Get the path to the tracker file for a given cycle.
 * @param {string} [cycleId]
 * @returns {string}
 */
function trackerPath(cycleId) {
  mkdirSync(TRACKER_DIR, { recursive: true });
  return join(TRACKER_DIR, `cycle_${cycleId || getCycleId()}.json`);
}

/**
 * Load or initialize the tracker for the current cycle.
 * @param {string} [cycleId]
 * @returns {object}
 */
export function loadTracker(cycleId) {
  const id = cycleId || getCycleId();
  const path = trackerPath(id);

  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  return {
    cycle_id: id,
    created_at: new Date().toISOString(),
    contacts: {},
  };
}

/**
 * Save the tracker state to disk.
 * @param {object} tracker
 */
export function saveTracker(tracker) {
  const path = trackerPath(tracker.cycle_id);
  writeFileSync(path, JSON.stringify(tracker, null, 2), "utf-8");
}

/**
 * Mark a contact as having been sent a message.
 * @param {object} tracker
 * @param {string} contactId - Phone number or email
 * @param {string} channel - "whatsapp" or "email"
 */
export function markSent(tracker, contactId, channel) {
  if (!tracker.contacts[contactId]) {
    tracker.contacts[contactId] = {
      channel,
      sent_at: null,
      followup_sent_at: null,
      responded: false,
      responded_at: null,
    };
  }
  tracker.contacts[contactId].sent_at = new Date().toISOString();
}

/**
 * Mark a contact as having responded.
 * @param {object} tracker
 * @param {string} contactId
 */
export function markResponded(tracker, contactId) {
  if (tracker.contacts[contactId]) {
    tracker.contacts[contactId].responded = true;
    tracker.contacts[contactId].responded_at = new Date().toISOString();
  }
}

/**
 * Mark that a follow-up was sent to a contact.
 * @param {object} tracker
 * @param {string} contactId
 */
export function markFollowupSent(tracker, contactId) {
  if (tracker.contacts[contactId]) {
    tracker.contacts[contactId].followup_sent_at = new Date().toISOString();
  }
}

/**
 * Get contact IDs that haven't responded and haven't been followed up.
 * @param {object} tracker
 * @returns {string[]}
 */
export function getNeedsFollowup(tracker) {
  return Object.entries(tracker.contacts)
    .filter(([, data]) => !data.responded && data.sent_at && !data.followup_sent_at)
    .map(([id]) => id);
}

/**
 * Generate a human-readable status report.
 * @param {object} tracker
 * @returns {string}
 */
export function generateReport(tracker) {
  const entries = Object.entries(tracker.contacts);
  const total = entries.length;
  const responded = entries.filter(([, d]) => d.responded).length;
  const pending = total - responded;
  const followedUp = entries.filter(([, d]) => d.followup_sent_at).length;

  const lines = [
    `📊 Reporte del Ciclo ${tracker.cycle_id}`,
    "═".repeat(45),
    `Total de contactos: ${total}`,
    `✅ Respondieron:     ${responded}`,
    `⏳ Pendientes:       ${pending}`,
    `🔁 Seguimiento:      ${followedUp}`,
    "",
    "Detalle:",
  ];

  for (const [id, data] of entries) {
    const icon = data.responded ? "✅" : data.followup_sent_at ? "🔁" : "⏳";
    lines.push(`  ${icon} ${id} (${data.channel})`);
  }

  return lines.join("\n");
}
