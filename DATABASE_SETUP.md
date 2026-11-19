# Base de datos Neon para Lubox Cross

## Conectar Neon con Vercel

1. En Vercel, abrir el proyecto de Lubox y entrar a **Storage → Marketplace**.
2. Instalar **Neon Postgres**. La integración crea la base y agrega `DATABASE_URL` a las variables del proyecto.
3. Abrir el editor SQL de Neon y ejecutar `postgres-schema.sql`.
4. En **Settings → Environment Variables**, configurar `ADMIN_PASSWORD`, `SESSION_SECRET` y `CRON_SECRET` con valores aleatorios largos. Agregar también las variables `WHATSAPP_*` cuando se configure WhatsApp.
5. Volver a desplegar en producción. En Lubox, tocar el botón circular `L` e iniciar sesión con `ADMIN_PASSWORD`.

Vercel guarda alumnos, pagos, configuración y el registro de avisos en Neon. La contraseña y la cadena de conexión se validan únicamente en funciones del servidor; el navegador recibe una cookie de sesión `HttpOnly`.

El primer inicio en una base vacía crea un registro compartido sin cargar los alumnos de muestra. Los cambios se guardan en Neon y quedan disponibles al iniciar sesión desde otro dispositivo.

## Configuración local

Para ejecutar las funciones localmente con Vercel CLI, crear `.env.local` a partir de `.env.example` y completar las variables. No subir `.env.local` ni claves reales a Git. Ejecutar `vercel dev` para probar la app con sus rutas API.

El archivo `postgres-schema.sql` crea dos tablas: `gym_state` para los datos del gimnasio y `whatsapp_reminder_log` para evitar volver a avisar por el mismo vencimiento.
