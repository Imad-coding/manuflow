function isPublicRequest(req) {
  const { path, method } = req;

  if (path === '/health') return true;
  if (path === '/login' && (method === 'GET' || method === 'POST')) return true;
  if (path.startsWith('/webhooks/shopify/') && method === 'POST') return true;
  if (path.startsWith('/css/')) return true;
  if (path.startsWith('/js/')) return true;
  if (path.startsWith('/images/')) return true;

  return false;
}

function requireAuth(req, res, next) {
  if (isPublicRequest(req)) return next();

  if (req.session && req.session.authenticated) return next();

  if (req.path.startsWith('/api/') || req.path.startsWith('/api')) {
    return res.status(401).json({ ok: false, message: 'Authentication required.' });
  }

  return res.redirect('/login');
}

module.exports = { requireAuth, isPublicRequest };
