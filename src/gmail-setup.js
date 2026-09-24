/**
 * gmail-setup.js — One-time Gmail OAuth authorization flow.
 *
 * Run this once to authorize the app to access your Gmail:
 *   npm run setup-gmail
 *
 * It will open a browser window for you to log in and authorize.
 * After that, a token file is saved and reused automatically.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { google } from "googleapis";
import { createInterface } from "readline";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

async function setup() {
  // Load config
  const config = JSON.parse(readFileSync("config.json", "utf-8"));
  const credsPath = config.gmail_credentials_path;
  const tokenPath = config.gmail_token_path;

  if (!existsSync(credsPath)) {
    console.error(`\n❌ No se encontró: ${credsPath}`);
    console.error(`\nPasos para obtener las credenciales:`);
    console.error(`  1. Ir a https://console.cloud.google.com/`);
    console.error(`  2. Crear proyecto → Habilitar Gmail API`);
    console.error(
      `  3. Crear credenciales OAuth 2.0 (tipo: Desktop App)`
    );
    console.error(`  4. Descargar el JSON y guardarlo como: ${credsPath}`);
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(credsPath, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "http://localhost"
  );

  // Generate auth URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n🔐 Autorización Gmail\n");
  console.log("Abra esta URL en su navegador:\n");
  console.log(`  ${authUrl}\n`);
  console.log(
    "Después de autorizar, copie el código que aparece y péguelo aquí.\n"
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => {
    rl.question("Código de autorización: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Save token
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");

    console.log(`\n✅ ¡Autorización exitosa! Token guardado en: ${tokenPath}`);
    console.log("Ya puede usar el sistema de emails.\n");
  } catch (err) {
    console.error(`\n❌ Error al obtener el token: ${err.message}`);
    process.exit(1);
  }
}

setup();
