const {hasAdminSession} = require('../lib/auth');
const {getSql} = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({error: 'Method not allowed'});
  if (!hasAdminSession(req)) return res.status(401).json({error: 'Iniciá sesión para acceder a Lubox.'});

  try {
    const sql = getSql();
    if (req.method === 'GET') {
      const rows = await sql`select data from public.gym_state where id = 'lubox' limit 1`;
      return res.status(200).json({data: rows[0]?.data || null});
    }
    if (!req.body || !Array.isArray(req.body.students) || !Array.isArray(req.body.payments) || !req.body.settings) {
      return res.status(400).json({error: 'Invalid app state'});
    }
    await sql`
      insert into public.gym_state (id, data, updated_at)
      values ('lubox', ${JSON.stringify(req.body)}::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()
    `;
    return res.status(200).json({saved: true});
  } catch (error) {
    console.error('Lubox state API error:', error.message);
    return res.status(500).json({error: 'No se pudo acceder a la base de datos.'});
  }
};
