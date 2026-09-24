/**
 * logger.js — Centralized logging with winston.
 *
 * Logs to both console (with colors) and rotating log files.
 */

import winston from "winston";
import { mkdirSync } from "fs";

const LOG_DIR = "logs";
mkdirSync(LOG_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    // Console with colors
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(
          ({ timestamp, level, message }) => `${timestamp} ${level} ${message}`
        )
      ),
    }),
    // Log file for current run
    new winston.transports.File({
      filename: `${LOG_DIR}/${timestamp}.log`,
    }),
    // Persistent error log
    new winston.transports.File({
      filename: `${LOG_DIR}/errors.log`,
      level: "error",
    }),
  ],
});
