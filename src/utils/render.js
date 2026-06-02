function renderPage(res, view, data, next, statusCode) {
  const merged = { ...res.locals, ...data };
  res.render(view, merged, (err, html) => {
    if (err) {
      if (next) return next(err);
      console.error(err);
      return res.status(500).send('Render error');
    }
    res.render('layout', { ...merged, body: html }, (err2, final) => {
      if (err2) {
        if (next) return next(err2);
        console.error(err2);
        return res.status(500).send('Render error');
      }
      if (statusCode) res.status(statusCode);
      res.send(final);
    });
  });
}

function renderStandalone(res, view, data, next, statusCode) {
  const merged = { ...res.locals, ...data };
  res.render(view, merged, (err, html) => {
    if (err) {
      if (next) return next(err);
      console.error(err);
      return res.status(500).send('Render error');
    }
    if (statusCode) res.status(statusCode);
    res.send(html);
  });
}

module.exports = { renderPage, renderStandalone };
