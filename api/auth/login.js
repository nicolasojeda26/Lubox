const {setSessionCookie, timingSafeEqual} = require('../../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({error: 'Admin authentication is not configured'});
  if (!timingSafeEqual(req.body?.password || '', process.env.ADMIN_PASSWORD)) return res.status(401).json({error: 'Contraseña incorrecta'});
  setSessionCookie(res);
  return res.status(200).json({authenticated: true});
};
