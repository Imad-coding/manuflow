function getShopDomain() {
  return (process.env.SHOPIFY_SHOP_DOMAIN || '').trim();
}

function getAccessToken() {
  return (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
}

function getApiVersion() {
  return process.env.SHOPIFY_API_VERSION || '2026-01';
}

function isShopifyConfigured() {
  return Boolean(getShopDomain() && getAccessToken());
}

function normalizeShopDomain(domain) {
  let shop = (domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (shop && !shop.includes('.')) {
    shop = `${shop}.myshopify.com`;
  }
  return shop.toLowerCase();
}

function validateShopDomain(domain) {
  const shop = normalizeShopDomain(domain);
  if (!shop) {
    return { valid: false, code: 'MISSING_SHOP_DOMAIN', message: 'SHOPIFY_SHOP_DOMAIN is empty.' };
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return {
      valid: false,
      code: 'INVALID_SHOP_DOMAIN',
      message: `Invalid shop domain "${domain}". Use your-store.myshopify.com format.`,
    };
  }
  return { valid: true, shop };
}

function validateCredentials() {
  const domainRaw = getShopDomain();
  const token = getAccessToken();

  if (!domainRaw && !token) {
    return {
      ok: false,
      code: 'MISSING_CREDENTIALS',
      message: 'Shopify credentials are not configured. Add SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN to your .env file, then restart the server.',
    };
  }
  if (!domainRaw) {
    return {
      ok: false,
      code: 'MISSING_SHOP_DOMAIN',
      message: 'SHOPIFY_SHOP_DOMAIN is missing from your .env file. Example: my-store.myshopify.com',
    };
  }
  if (!token) {
    return {
      ok: false,
      code: 'MISSING_ACCESS_TOKEN',
      message: 'SHOPIFY_ADMIN_ACCESS_TOKEN is missing from your .env file. Create a custom app in Shopify Admin and paste the Admin API access token.',
    };
  }

  const domainCheck = validateShopDomain(domainRaw);
  if (!domainCheck.valid) {
    return { ok: false, code: domainCheck.code, message: domainCheck.message };
  }

  return { ok: true, shop: domainCheck.shop, token };
}

function getConnectionInfo() {
  const domainRaw = getShopDomain();
  const token = getAccessToken();
  const domainCheck = domainRaw ? validateShopDomain(domainRaw) : { valid: false };
  const configured = isShopifyConfigured() && domainCheck.valid;

  return {
    mode: configured ? 'connected' : 'demo',
    shopDomain: configured ? domainCheck.shop : (domainRaw || null),
    shopDomainValid: domainCheck.valid,
    hasShopDomain: Boolean(domainRaw),
    hasAccessToken: Boolean(token),
    tokenPreview: token ? `••••${token.slice(-4)}` : null,
    apiVersion: getApiVersion(),
    configured,
  };
}

class ShopifySyncError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ShopifySyncError';
    this.code = code;
    this.details = details;
  }
}

function parseHttpError(status, bodyText) {
  const snippet = (bodyText || '').slice(0, 280);

  if (status === 401) {
    return new ShopifySyncError(
      'INVALID_ACCESS_TOKEN',
      'Invalid Shopify access token. Check SHOPIFY_ADMIN_ACCESS_TOKEN in your .env file and restart the server.',
      { status, body: snippet }
    );
  }
  if (status === 403) {
    return new ShopifySyncError(
      'MISSING_SCOPES',
      'Shopify rejected the request — the access token may be missing required scopes. Ensure your custom app has read_orders, read_locations, and read_fulfillments (or read_all_orders).',
      { status, body: snippet }
    );
  }
  if (status === 404) {
    return new ShopifySyncError(
      'INVALID_SHOP_DOMAIN',
      'Shop not found. Check SHOPIFY_SHOP_DOMAIN in your .env file (example: my-store.myshopify.com).',
      { status, body: snippet }
    );
  }
  if (status === 429) {
    return new ShopifySyncError(
      'RATE_LIMITED',
      'Shopify rate limit reached. Wait a moment and try syncing again.',
      { status, body: snippet }
    );
  }

  return new ShopifySyncError(
    'API_ERROR',
    `Shopify API error (${status}). ${snippet || 'No response body.'}`,
    { status, body: snippet }
  );
}

function parseGraphQLErrors(errors) {
  const messages = (errors || []).map((e) => e.message).filter(Boolean);
  const combined = messages.join('; ') || 'Unknown GraphQL error';

  if (/access denied|required access|unauthorized|not authorized|permission/i.test(combined)) {
    return new ShopifySyncError(
      'MISSING_SCOPES',
      `Missing Shopify API scopes: ${combined}. Update your custom app scopes and regenerate the Admin API access token.`,
      { graphqlErrors: errors }
    );
  }

  return new ShopifySyncError(
    'GRAPHQL_ERROR',
    `Shopify GraphQL error: ${combined}`,
    { graphqlErrors: errors }
  );
}

async function shopifyGraphQL(query, variables = {}) {
  const creds = validateCredentials();
  if (!creds.ok) {
    throw new ShopifySyncError(creds.code, creds.message);
  }

  const url = `https://${creds.shop}/admin/api/${getApiVersion()}/graphql.json`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': creds.token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new ShopifySyncError(
      'NETWORK_ERROR',
      `Could not reach Shopify at ${creds.shop}. Check your internet connection and shop domain.`,
      { cause: err.message }
    );
  }

  const bodyText = await response.text();
  let payload;
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw parseHttpError(response.status, bodyText);
  }

  if (!response.ok) {
    throw parseHttpError(response.status, bodyText);
  }

  if (payload.errors && payload.errors.length > 0) {
    throw parseGraphQLErrors(payload.errors);
  }

  return payload.data;
}

module.exports = {
  isShopifyConfigured,
  getShopDomain,
  getAccessToken,
  getApiVersion,
  getConnectionInfo,
  validateCredentials,
  normalizeShopDomain,
  shopifyGraphQL,
  ShopifySyncError,
};
