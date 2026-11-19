const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v27.0';
const {getSql} = require('../../lib/db');

function argentinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${part.year}-${part.month}-${part.day}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
}

function normalizePhone(value = '') {
  const source = String(value).trim();
  let digits = String(value).replace(/\D/g, '');
  if (source.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (!digits.startsWith('54')) digits = `549${digits.replace(/^0+/, '').replace(/^15/, '')}`;
  return digits;
}

async function sendTemplate(phone, name, overdueDays) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME,
        language: {code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_AR'},
        components: [{
          type: 'body',
          parameters: [
            {type: 'text', text: name},
            {type: 'text', text: String(overdueDays)},
            {type: 'text', text: process.env.WHATSAPP_BUSINESS_NAME || 'Lubox Cross'}
          ]
        }]
      }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `WhatsApp API respondió ${response.status}`);
  return body;
}

async function readReminderLog(sql, studentId, dueDate) {
  const rows = await sql`select status, updated_at from public.whatsapp_reminder_log where student_id = ${studentId} and due_date = ${dueDate}::date limit 1`;
  return rows[0] || null;
}

async function reserveReminder(sql, studentId, dueDate, existing) {
  const now = new Date();
  if (existing?.status === 'sent') return false;
  if (existing?.status === 'pending' && now - new Date(existing.updated_at) < 60 * 60 * 1000) return false;
  if (existing) {
    await sql`update public.whatsapp_reminder_log set status = 'pending', updated_at = ${now.toISOString()}, error = null where student_id = ${studentId} and due_date = ${dueDate}::date`;
    return true;
  }
  const rows = await sql`insert into public.whatsapp_reminder_log (student_id, due_date, status, updated_at) values (${studentId}, ${dueDate}::date, 'pending', ${now.toISOString()}) on conflict (student_id, due_date) do nothing returning id`;
  return rows.length > 0;
}

async function updateReminderLog(sql, studentId, dueDate, changes) {
  if (changes.status === 'sent') {
    await sql`update public.whatsapp_reminder_log set status = 'sent', sent_at = ${changes.sent_at}, provider_message_id = ${changes.provider_message_id}, error = null, updated_at = now() where student_id = ${studentId} and due_date = ${dueDate}::date`;
    return;
  }
  await sql`update public.whatsapp_reminder_log set status = 'failed', error = ${changes.error}, updated_at = now() where student_id = ${studentId} and due_date = ${dueDate}::date`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed'});
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({error: 'Unauthorized'});
  }

  const required = ['DATABASE_URL', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) return res.status(503).json({error: 'WhatsApp reminders are not configured', missing});

  try {
    const sql = getSql();
    const rows = await sql`select data from public.gym_state where id = 'lubox' limit 1`;
    if (!rows.length) return res.status(200).json({ok: true, sent: 0, skipped: 'No saved gym state'});

    const data = rows[0].data || {};
    const settings = data.settings || {};
    if (!settings.whatsappRemindersEnabled) return res.status(200).json({ok: true, sent: 0, skipped: 'Reminders are disabled in app settings'});

    const threshold = Math.max(1, Math.min(180, Number(settings.reminderDays) || Number(process.env.WHATSAPP_REMINDER_DAYS) || 14));
    const today = argentinaToday();
    let sent = 0;
    const errors = [];
    const students = Array.isArray(data.students) ? data.students : [];

    for (const student of students) {
      if (!student.whatsappOptIn || !student.phone || !student.lastPayment) continue;
      const dueDate = addDays(student.lastPayment, Math.max(1, Number(student.billingDays) || 30));
      const overdueDays = daysBetween(dueDate, today);
      if (overdueDays <= threshold || !student.id) continue;
      try {
        const existing = await readReminderLog(sql, student.id, dueDate);
        if (!await reserveReminder(sql, student.id, dueDate, existing)) continue;
        const result = await sendTemplate(normalizePhone(student.phone), student.name || 'alumno/a', overdueDays);
        await updateReminderLog(sql, student.id, dueDate, {
          status: 'sent', sent_at: new Date().toISOString(), provider_message_id: result.messages?.[0]?.id || null, error: null
        });
        sent += 1;
      } catch (error) {
        await updateReminderLog(sql, student.id, dueDate, {status: 'failed', error: error.message}).catch(() => {});
        errors.push({studentId: student.id, message: error.message});
      }
    }
    return res.status(errors.length ? 207 : 200).json({ok: errors.length === 0, sent, failed: errors.length, errors});
  } catch (error) {
    return res.status(500).json({error: 'Reminder job failed', detail: error.message});
  }
};
