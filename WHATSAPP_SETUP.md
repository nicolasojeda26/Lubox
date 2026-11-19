# Recordatorios automáticos de Lubox Cross

La app guarda alumnos, pagos y configuración en Neon Postgres. Vercel ejecuta el cron diariamente a las 10:00 de Argentina (13:00 UTC). Los avisos solo salen cuando están activados, hay un número WhatsApp y el alumno aceptó recibirlos.

## Preparar WhatsApp Business

1. Configurar WhatsApp Cloud API en Meta y obtener el token de acceso y el **Phone Number ID**.
2. Crear y conseguir la aprobación de una plantilla en español con nombre `lubox_cuota_atrasada`, idioma `es_AR` y tres parámetros en el cuerpo, en este orden:
   - `{{1}}`: nombre del alumno.
   - `{{2}}`: días de atraso.
   - `{{3}}`: nombre del gimnasio.
3. Texto sugerido: `Hola {{1}}, desde {{3}} te avisamos que tu cuota lleva {{2}} días vencida. Cuando puedas, comunicate con el gimnasio o envianos el comprobante si ya abonaste. Si ya pagaste, desestimá este mensaje.`
4. Registrar el consentimiento en la ficha del alumno. La casilla está desmarcada por defecto; desmarcarla detiene los próximos avisos.

Meta requiere que los destinatarios hayan compartido su número y aceptado recibir mensajes del negocio. Los avisos proactivos se envían como una plantilla aprobada.

## Variables de entorno en Vercel

Agregar las variables de `.env.example` en el proyecto de Vercel. La integración de Neon añade `DATABASE_URL`. Mantener `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET` y el token de WhatsApp solo como variables privadas del servidor.

El valor que se configura desde la app (`Recordatorios → Avisar cuando la cuota supere`) tiene prioridad sobre `WHATSAPP_REMINDER_DAYS`. Se manda un aviso por ciclo de vencimiento. Al registrar el siguiente pago se calcula un nuevo vencimiento y comienza un ciclo nuevo.

El cron solo corre en la implementación de producción. Sin credenciales de WhatsApp, configuración de Neon y una plantilla aprobada, no se puede enviar ningún aviso. Revisar **Functions → Logs** en Vercel si la API de Meta devuelve un error.

Las fotos de comprobantes continúan en IndexedDB del dispositivo; alumnos, pagos y ajustes se sincronizan en Neon.
