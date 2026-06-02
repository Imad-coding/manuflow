require('dotenv').config();

const path = require('path');
const express = require('express');

require('./db');

const dashboardRouter = require('./routes/dashboard');
const ordersRouter = require('./routes/orders');
const settingsRouter = require('./routes/settings');
const productionBoardRouter = require('./routes/productionBoard');
const apiRouter = require('./routes/api');
const exportRouter = require('./routes/export');
const { renderPage } = require('./utils/render');
const { getConnectionInfo } = require('./shopify/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.shopifyConnected = getConnectionInfo().configured;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/dashboard'));

app.use('/', dashboardRouter);
app.use('/', ordersRouter);
app.use('/', settingsRouter);
app.use('/', productionBoardRouter);
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
