const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v27.0';

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

async function supabaseRequest(path, init = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
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

async function readReminderLog(owner, studentId, dueDate) {
  const query = new URLSearchParams({
    owner_id: `eq.${owner}`,
    student_id: `eq.${studentId}`,
    due_date: `eq.${dueDate}`,
    select: 'status,updated_at'
  });
  const response = await supabaseRequest(`whatsapp_reminder_log?${query}`);
  if (!response.ok) throw new Error('Could not read WhatsApp reminder log');
  const rows = await response.json();
  return rows[0] || null;
}

async function reserveReminder(owner, studentId, dueDate, existing) {
  const now = new Date();
  if (existing?.status === 'sent') return false;
  if (existing?.status === 'pending' && now - new Date(existing.updated_at) < 60 * 60 * 1000) return false;
  if (existing) {
    const query = new URLSearchParams({owner_id: `eq.${owner}`, student_id: `eq.${studentId}`, due_date: `eq.${dueDate}`});
    const response = await supabaseRequest(`whatsapp_reminder_log?${query}`, {
      method: 'PATCH', headers: {Prefer: 'return=minimal'},
      body: JSON.stringify({status: 'pending', updated_at: now.toISOString(), error: null})
    });
    if (!response.ok) throw new Error('Could not reserve WhatsApp reminder');
    return true;
  }
  const response = await supabaseRequest('whatsapp_reminder_log?on_conflict=owner_id,student_id,due_date', {
    method: 'POST',
    headers: {Prefer: 'resolution=ignore-duplicates,return=representation'},
    body: JSON.stringify({owner_id: owner, student_id: studentId, due_date: dueDate, status: 'pending', updated_at: now.toISOString()})
  });
  if (!response.ok) throw new Error('Could not reserve WhatsApp reminder');
  return (await response.json()).length > 0;
}

async function updateReminderLog(owner, studentId, dueDate, changes) {
  const query = new URLSearchParams({owner_id: `eq.${owner}`, student_id: `eq.${studentId}`, due_date: `eq.${dueDate}`});
  const response = await supabaseRequest(`whatsapp_reminder_log?${query}`, {
    method: 'PATCH', headers: {Prefer: 'return=minimal'},
    body: JSON.stringify({...changes, updated_at: new Date().toISOString()})
  });
  if (!response.ok) throw new Error('Could not update WhatsApp reminder log');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed'});
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({error: 'Unauthorized'});
  }

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_OWNER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) return res.status(503).json({error: 'WhatsApp reminders are not configured', missing});
  if (!/^[0-9a-f-]{36}$/i.test(process.env.SUPABASE_OWNER_ID)) return res.status(503).json({error: 'SUPABASE_OWNER_ID must be a Supabase Auth UUID'});

  try {
    const ownerId = process.env.SUPABASE_OWNER_ID;
    const owner = encodeURIComponent(ownerId);
    const read = await supabaseRequest(`gym_state?owner_id=eq.${owner}&select=owner_id,data`);
    if (!read.ok) return res.status(502).json({error: 'Could not read reminder state from Supabase'});
    const rows = await read.json();
    if (!rows.length) return res.status(200).json({ok: true, sent: 0, skipped: 'No saved gym state'});

    const row = rows[0];
    const data = row.data || {};
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
        const existing = await readReminderLog(owner, student.id, dueDate);
        if (!await reserveReminder(ownerId, student.id, dueDate, existing)) continue;
        const result = await sendTemplate(normalizePhone(student.phone), student.name || 'alumno/a', overdueDays);
        await updateReminderLog(ownerId, student.id, dueDate, {
          status: 'sent', sent_at: new Date().toISOString(), provider_message_id: result.messages?.[0]?.id || null, error: null
        });
        sent += 1;
      } catch (error) {
        await updateReminderLog(ownerId, student.id, dueDate, {status: 'failed', error: error.message}).catch(() => {});
        errors.push({studentId: student.id, message: error.message});
      }
    }
    return res.status(errors.length ? 207 : 200).json({ok: errors.length === 0, sent, failed: errors.length, errors});
  } catch (error) {
    return res.status(500).json({error: 'Reminder job failed', detail: error.message});
  }
};
