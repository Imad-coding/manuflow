const express = require('express');
const { renderStandalone } = require('../utils/render');

const router = express.Router();

function getExpectedCredentials() {
  return {
    username: process.env.APP_LOGIN_USERNAME || 'admin',
    password: process.env.APP_LOGIN_PASSWORD || '',
  };
}

router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/dashboard');
  }

  renderStandalone(res, 'login', {
    title: 'Sign in',
    error: null,
  });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const expected = getExpectedCredentials();

  if (
    typeof username === 'string'
    && typeof password === 'string'
    && username === expected.username
    && expected.password
    && password === expected.password
  ) {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }

  renderStandalone(res, 'login', {
    title: 'Sign in',
    error: 'Incorrect username or password.',
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err.message);
    res.redirect('/login');
  });
});

module.exports = router;
