const { shopifyGraphQL, validateCredentials, ShopifySyncError } = require('./client');

const WEBHOOK_SUBSCRIPTIONS_QUERY = `
  query WebhookSubscriptions($first: Int!, $after: String) {
    webhookSubscriptions(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          topic
          createdAt
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  }
`;

const WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        createdAt
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const WEBHOOK_SUBSCRIPTION_DELETE_MUTATION = `
  mutation WebhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
      }
    }
  }
`;

const WEBHOOK_DEFINITIONS = [
  { topic: 'ORDERS_CREATE', path: 'orders-create', optional: false },
  { topic: 'ORDERS_UPDATED', path: 'orders-updated', optional: false },
  { topic: 'ORDERS_CANCELLED', path: 'orders-cancelled', optional: false },
  { topic: 'FULFILLMENT_ORDERS_FULFILLMENT_REQUEST_SUBMITTED', path: 'fulfillment-orders-updated', optional: true },
  { topic: 'FULFILLMENT_ORDERS_FULFILLMENT_REQUEST_ACCEPTED', path: 'fulfillment-orders-updated', optional: true },
  { topic: 'FULFILLMENT_ORDERS_FULFILLMENT_REQUEST_REJECTED', path: 'fulfillment-orders-updated', optional: true },
  { topic: 'FULFILLMENT_ORDERS_CANCELLATION_REQUEST_SUBMITTED', path: 'fulfillment-orders-updated', optional: true },
  { topic: 'FULFILLMENT_ORDERS_CANCELLATION_REQUEST_ACCEPTED', path: 'fulfillment-orders-updated', optional: true },
  { topic: 'FULFILLMENT_ORDERS_CANCELLATION_REQUEST_REJECTED', path: 'fulfillment-orders-updated', optional: true },
];

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
}

function getCallbackUrl(pathSegment) {
  const base = getAppBaseUrl();
  return `${base}/webhooks/shopify/${pathSegment}`;
}

function normalizeSubscription(node) {
  const callbackUrl = node?.endpoint?.callbackUrl || null;
  return {
    id: node.id,
    topic: node.topic,
    callbackUrl,
    createdAt: node.createdAt || null,
  };
}

function validateWebhookRegistrationConfig() {
  if (process.env.SHOPIFY_WEBHOOK_ENABLED !== 'true') {
    return {
      ok: false,
      message: 'Webhooks are disabled. Set SHOPIFY_WEBHOOK_ENABLED=true in .env and restart the server.',
    };
  }

  if (!process.env.SHOPIFY_WEBHOOK_SECRET?.trim()) {
    return {
      ok: false,
      message: 'SHOPIFY_WEBHOOK_SECRET is not configured. Add it to .env and restart the server.',
    };
  }

  if (!getAppBaseUrl()) {
    return {
      ok: false,
      message: 'APP_BASE_URL is not configured. Example: https://fullfilforge.store',
    };
  }

  const creds = validateCredentials();
  if (!creds.ok) {
    return { ok: false, message: creds.message };
  }

  return { ok: true };
}

async function getWebhookSubscriptions() {
  const subscriptions = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await shopifyGraphQL(WEBHOOK_SUBSCRIPTIONS_QUERY, {
      first: 50,
      after: cursor,
    });

    const connection = data.webhookSubscriptions;
    for (const edge of connection?.edges || []) {
      subscriptions.push(normalizeSubscription(edge.node));
    }

    hasNextPage = connection?.pageInfo?.hasNextPage || false;
    cursor = connection?.pageInfo?.endCursor || null;
  }

  return subscriptions;
}

function findExistingSubscription(subscriptions, topic, callbackUrl) {
  return subscriptions.find(
    (sub) => sub.topic === topic && sub.callbackUrl === callbackUrl,
  );
}

async function createWebhookSubscription(topic, callbackUrl) {
  const data = await shopifyGraphQL(WEBHOOK_SUBSCRIPTION_CREATE_MUTATION, {
    topic,
    webhookSubscription: {
      callbackUrl,
      format: 'JSON',
    },
  });

  const result = data.webhookSubscriptionCreate;
  const userErrors = result?.userErrors || [];

  if (userErrors.length > 0) {
    throw new ShopifySyncError(
      'WEBHOOK_CREATE_FAILED',
      userErrors.map((e) => e.message).join('; '),
      { userErrors },
    );
  }

  if (!result?.webhookSubscription) {
    throw new ShopifySyncError('WEBHOOK_CREATE_FAILED', 'Shopify did not return a webhook subscription.');
  }

  return normalizeSubscription(result.webhookSubscription);
}

async function deleteWebhookSubscription(id) {
  const data = await shopifyGraphQL(WEBHOOK_SUBSCRIPTION_DELETE_MUTATION, { id });
  const result = data.webhookSubscriptionDelete;
  const userErrors = result?.userErrors || [];

  if (userErrors.length > 0) {
    throw new ShopifySyncError(
      'WEBHOOK_DELETE_FAILED',
      userErrors.map((e) => e.message).join('; '),
      { userErrors },
    );
  }

  return result?.deletedWebhookSubscriptionId || id;
}

async function ensureWebhookSubscriptions() {
  const config = validateWebhookRegistrationConfig();
  if (!config.ok) {
    return { ok: false, message: config.message, created: [], existing: [], failed: [] };
  }

  const subscriptions = await getWebhookSubscriptions();
  const created = [];
  const existing = [];
  const failed = [];

  for (const def of WEBHOOK_DEFINITIONS) {
    const callbackUrl = getCallbackUrl(def.path);
    const match = findExistingSubscription(subscriptions, def.topic, callbackUrl);

    if (match) {
      existing.push({
        topic: def.topic,
        callbackUrl,
        id: match.id,
        createdAt: match.createdAt,
      });
      continue;
    }

    try {
      const subscription = await createWebhookSubscription(def.topic, callbackUrl);
      created.push({
        topic: def.topic,
        callbackUrl,
        id: subscription.id,
        createdAt: subscription.createdAt,
      });
      subscriptions.push(subscription);
    } catch (err) {
      const message = err.message || 'Failed to create webhook subscription.';
      failed.push({
        topic: def.topic,
        callbackUrl,
        optional: def.optional,
        error: message,
      });

      if (!def.optional) {
        console.error(`[webhooks] required topic ${def.topic} failed: ${message}`);
      }
    }
  }

  const requiredFailures = failed.filter((item) => !item.optional);

  return {
    ok: requiredFailures.length === 0,
    message: requiredFailures.length
      ? 'Some required webhooks could not be registered. Check custom app scopes (write_webhooks) and try again.'
      : `Registered ${created.length} webhook(s), ${existing.length} already existed.`,
    created,
    existing,
    failed,
  };
}

async function registerCustomAppWebhooks() {
  return ensureWebhookSubscriptions();
}

module.exports = {
  WEBHOOK_DEFINITIONS,
  getAppBaseUrl,
  getCallbackUrl,
  validateWebhookRegistrationConfig,
  getWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  ensureWebhookSubscriptions,
  registerCustomAppWebhooks,
};
