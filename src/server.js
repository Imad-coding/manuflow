require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db');

const dashboardRouter = require('./routes/dashboard');
const ordersRouter = require('./routes/orders');
const settingsRouter = require('./routes/settings');
const productionBoardRouter = require('./routes/productionBoard');
const workstationRouter = require('./routes/workstation');
const reportsRouter = require('./routes/reports');
const apiRouter = require('./routes/api');
const exportRouter = require('./routes/export');
const authRouter = require('./routes/auth');
const eventsRouter = require('./routes/events');
const webhooksRouter = require('./routes/webhooks');
const { requireAuth } = require('./middleware/auth');
const { renderPage } = require('./utils/render');
const { getConnectionInfo } = require('./shopify/client');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.APP_LOGIN_PASSWORD) {
  console.warn('WARNING: APP_LOGIN_PASSWORD is not set. Admin login will reject all attempts until configured.');
}

if (isProduction && !process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using an insecure default is not recommended in production.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/webhooks/shopify', express.raw({ type: 'application/json' }), webhooksRouter);

app.use((req, res, next) => {
  res.locals.shopifyConnected = getConnectionInfo().configured;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(authRouter);
app.use(requireAuth);
app.use(eventsRouter);

app.get('/', (req, res) => res.redirect('/dashboard'));

app.use('/', dashboardRouter);
app.use('/', ordersRouter);
app.use('/', settingsRouter);
app.use('/', productionBoardRouter);
app.use('/', workstationRouter);
app.use('/', reportsRouter);
app.use('/', exportRouter);
app.use('/api', apiRouter);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, message: 'Not found.' });
  }
  renderPage(res, 'error', {
    title: 'Not Found',
    activePage: '',
    message: 'Page not found.',
    statusCode: 404,
  }, null, 404);
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
  renderPage(res, 'error', {
    title: 'Error',
    activePage: '',
    message: 'Something went wrong.',
    statusCode: 500,
  });
});

app.listen(PORT, () => {
  console.log(`FulfillForge running at http://localhost:${PORT}`);
});
