# Recordatorios automáticos de Lubox Cross

La app usa Supabase para guardar una copia compartida de alumnos, pagos y configuración. Vercel ejecuta el cron todos los días a las 10:00 de Argentina (13:00 UTC). Los avisos solo salen cuando el control está activado, el alumno tiene un número WhatsApp y está marcada su aceptación de avisos.

## Preparación de Supabase

1. Crear un proyecto Supabase y un usuario administrador en **Authentication → Users**.
2. Ejecutar `supabase-schema.sql` desde el SQL Editor del proyecto.
3. Copiar la URL y la clave pública (anon/publishable) del proyecto.
4. Iniciar sesión desde el botón circular `L` de Lubox. El primer acceso a una cuenta vacía crea un registro compartido sin los datos de ejemplo.

El SQL aplica Row Level Security: la sesión solo puede leer y modificar su fila. La clave `service_role` se usa únicamente en Vercel para el cron y nunca se expone al navegador.

## Preparación de WhatsApp Business

1. Configurar WhatsApp Cloud API en Meta y obtener el token de acceso y el **Phone Number ID**.
2. Crear y conseguir la aprobación de una plantilla en español con nombre `lubox_cuota_atrasada`, idioma `es_AR` y tres parámetros en el cuerpo, en este orden:
   - `{{1}}`: nombre del alumno.
   - `{{2}}`: días de atraso.
   - `{{3}}`: nombre del gimnasio.
3. Texto sugerido: `Hola {{1}}, desde {{3}} te avisamos que tu cuota lleva {{2}} días vencida. Cuando puedas, comunicate con el gimnasio o envianos el comprobante si ya abonaste. Si ya pagaste, desestimá este mensaje.`
4. Registrar el consentimiento antes de activar los avisos. La ficha no lo marca por defecto; desmarcarlo detiene futuros avisos para esa persona.

Los avisos proactivos de WhatsApp se envían como plantilla. Meta exige que el usuario haya compartido su número y aceptado recibir mensajes del negocio; el nombre, idioma y orden de parámetros de la plantilla deben coincidir con la aprobada.

## Variables de entorno de Vercel

Copiar las variables de `.env.example` al proyecto de Vercel. `SUPABASE_OWNER_ID` es el UUID del usuario administrador de Supabase Auth. Guardar las claves privadas solo como variables de entorno, nunca en Git.

`WHATSAPP_REMINDER_DAYS` es el respaldo por defecto. El valor que se cambia desde la app (`Recordatorios → Avisar cuando la cuota supere`) se guarda en Supabase y tiene prioridad. El cron manda un solo aviso por vencimiento; al registrar el siguiente pago se calcula un nuevo vencimiento y empieza un ciclo nuevo.

Vercel ejecuta el cron en la implementación de producción. Si el token o la plantilla aún no están configurados, la función falla cerrada y no envía mensajes. Revisar **Functions/Logs** en Vercel para ver errores del proveedor.

## Datos actuales

Al iniciar sesión, los alumnos y pagos se sincronizan como JSON en Supabase. Las fotos de comprobantes siguen en IndexedDB del dispositivo y todavía no se sincronizan entre equipos; no se necesitan para el cron de cuotas.
