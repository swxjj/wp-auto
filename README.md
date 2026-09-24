# 🤖 WP Auto — Automatización de Solicitudes de Precios

Sistema de automatización biweekly para enviar solicitudes de precios a tiendas vía **WhatsApp** y **Gmail**, con seguimiento automático de respuestas.

## Tecnologías

- **[whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)** — WhatsApp Web automation (protocolo directo, sin scraping de UI)
- **[Gmail API](https://developers.google.com/gmail/api)** — Envío y verificación de emails
- **[node-cron](https://github.com/node-cron/node-cron)** — Scheduler automático
- **[winston](https://github.com/winstonjs/winston)** — Logging

## Flujo automático

| Día | Acción |
|---|---|
| **Martes** | Envía mensajes a todos los contactos del CSV |
| **Miércoles** | Verifica respuestas (Gmail + WhatsApp), genera reporte |
| **Jueves** | Reenvía solo a quienes no respondieron |

## ⚠️ Archivos requeridos en la otra PC (No incluidos en el repositorio)

Por motivos de seguridad, los archivos con credenciales, contactos y sesiones activas están ignorados en `.gitignore`. Al clonar el repositorio en una nueva máquina (ej. PC del trabajo), deberás configurar estos **3 archivos clave**:

| Archivo | Qué hacer | Origen / Referencia |
|---|---|---|
| **`config.json`** | Copiar desde la plantilla y completar con tus datos | `cp config.example.json config.json` |
| **`contactos.csv`** | Copiar desde la plantilla y cargar los contactos reales | `cp contactos.example.csv contactos.csv` |
| **`credentials/gmail_credentials.json`** | Crear la carpeta `credentials/` y pegar el archivo JSON de OAuth | Descargado de Google Cloud Console |

> 💡 **Tip para ahorrar tiempo en Gmail**: Si no querés volver a pasar por la pantalla de autorización de Google en la otra PC, podés copiar directamente el archivo `credentials/gmail_token.json` de esta PC a la otra.
>
> 💡 **WhatsApp Web**: La carpeta `.wwebjs_auth/` **no** se copia. Se generará automáticamente la primera vez que ejecutes el script al escanear el código QR con el celular de trabajo.

---

## Setup

### 1. Requisitos

- Node.js 18+
- Google Chrome instalado
- Cuenta de Gmail

### 2. Instalar dependencias

```bash
npm install
npm install-scripts approve puppeteer@24.38.0
```

### 3. Configuración

```bash
cp config.example.json config.json
```

Editar `config.json` con tu nombre, empresa y email.

### 4. Contactos

```bash
cp contactos.example.csv contactos.csv
```

Editar `contactos.csv` con tus contactos reales. Columnas:

| Campo | Descripción |
|---|---|
| `nombre_tienda` | Nombre de la tienda |
| `nombre_contacto` | Nombre del contacto |
| `telefono` | Formato internacional: `+549...` |
| `email` | Email de contacto |
| `tipo` | `whatsapp`, `email`, o `ambos` |
| `productos` | Lista separada por comas (usar comillas si hay comas) |

### 5. Gmail API

1. Ir a [console.cloud.google.com](https://console.cloud.google.com/)
2. Nuevo proyecto → Habilitar **Gmail API**
3. Crear credenciales **OAuth 2.0** (tipo: Desktop App)
4. Descargar JSON → guardar como `credentials/gmail_credentials.json`
5. Agregar tu email como **Test User** en OAuth consent screen
6. Autorizar:

```bash
npm run setup-gmail
```

### 6. WhatsApp

En la primera ejecución se muestra un QR en la terminal. Escanearlo con WhatsApp (Ajustes → Dispositivos vinculados). La sesión queda guardada.

> **macOS**: Cerrar Chrome antes de correr por primera vez.

## Comandos

```bash
npm run send        # Enviar a todos los contactos
npm run check       # Verificar respuestas y generar reporte
npm run followup    # Reenviar a no respondidos
npm run report      # Ver estado del ciclo actual
npm run test-dry    # Dry run (sin enviar nada real)
npm run setup-gmail # Configurar Gmail OAuth (una vez)
npm run scheduler   # Iniciar scheduler automático
```

## Scheduler automático (producción)

```bash
npm install -g pm2
pm2 start src/scheduler.js --name wp-auto
pm2 startup && pm2 save
```

## Estructura

```
src/
├── index.js        ← CLI principal
├── scheduler.js    ← Scheduler biweekly con node-cron
├── whatsapp.js     ← WhatsApp Web client
├── gmail.js        ← Gmail API (envío + verificación)
├── gmail-setup.js  ← OAuth setup (correr una vez)
├── contacts.js     ← Carga de CSV
├── templates.js    ← Renderizado de mensajes
├── tracker.js      ← Tracking de respuestas por ciclo
└── logger.js       ← Logging centralizado
```

## Archivos ignorados por git

Los siguientes archivos contienen datos sensibles y **no se suben al repositorio**:

- `config.json` → usar `config.example.json` como base
- `contactos.csv` → usar `contactos.example.csv` como base
- `credentials/` → credenciales OAuth de Gmail
- `.wwebjs_auth/` → sesión de WhatsApp
- `tracking/` → estado de ciclos
- `logs/` → logs de ejecución
