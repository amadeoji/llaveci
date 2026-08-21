# CreatorHub Premium

Plataforma exclusiva de contenido (fotos, videos, canales Telegram y servicios) lista para desplegar en **Railway**.

## Características

- Registro / login de usuarios
- Panel de moderación (emails autorizados)
- Fotos de presentación públicas
- Packs de fotos y videos (slots 1–200) con portada blur
- Canales Telegram VIP (desbloqueo tras aprobación)
- Servicios (videollamada, video personalizado, etc.)
- Carrito + checkout por transferencia / WhatsApp
- Aprobación de pedidos por moderador
- Biblioteca del usuario
- Visor protegido (sin descarga, watermark)

## Despliegue en Railway

1. Creá un nuevo proyecto en [Railway](https://railway.app).
2. Conectá este repositorio (o subí la carpeta).
3. Railway detectará el `Dockerfile` automáticamente.
4. **Importante – persistencia:** el filesystem de Railway es efímero. Para no perder datos al reiniciar:
   - Andá a tu servicio → **Volumes** → agregá un volume montado en `/app/data`.
5. Desplegá. Railway asignará un dominio público.

## Variables de entorno (opcionales)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT`   | `3000`  | Puerto del servidor |
| `DATA_DIR` | `/app/data` | Carpeta para la base de datos y archivos subidos |

## Moderadores

Emails con acceso al panel de moderación (contraseña por defecto `Amadeo2010`):

- nicolasamadeo34@gmail.com
- nicolásamadeo34@gmail.com
- antonellaiodati39@gmail.com

Podés cambiarlos en `server.js` (arrays `MODS` y `MODPASS`).

## Desarrollo local

```bash
npm install
npm start
```

Abrí http://localhost:3000

## Estructura

```
creatorhub/
├── data/           # JSON + uploads (montá volume aquí en Railway)
│   └── uploads/
├── public/
│   └── index.html  # Frontend completo
├── server.js
├── package.json
├── Dockerfile
└── railway.toml
```

## Notas

- Los archivos subidos se guardan en `data/uploads/`.
- Los pedidos y la biblioteca se guardan en `data/db.json`.
- El visor de packs comprados solo permite visualización (watermark + bloqueo de descarga).
- Mercado Pago está deshabilitado; el flujo es transferencia + comprobante por WhatsApp.
