const ASSIGNED_NAME_PREFIX = 'assigned-name:';

function buildLocationKey(assignedLocation) {
  if (!assignedLocation) return null;

  const locationId = assignedLocation.location?.id;
  if (locationId) return locationId;

  const name = (assignedLocation.name || assignedLocation.location?.name || '').trim();
  if (name) return `${ASSIGNED_NAME_PREFIX}${name}`;

  return null;
}

function getDisplayName(assignedLocation) {
  if (!assignedLocation) return null;
  return (
    assignedLocation.name ||
    assignedLocation.location?.name ||
    null
  )?.trim() || null;
}

function isNameFallbackKey(shopifyLocationId) {
  return Boolean(shopifyLocationId && shopifyLocationId.startsWith(ASSIGNED_NAME_PREFIX));
}

function mergeSource(existingSource, incomingSource) {
  if (!existingSource) return incomingSource;
  if (existingSource === incomingSource) return existingSource;
  if (
    existingSource === 'shopify_location_query' &&
    incomingSource === 'fulfillment_order_assigned_location'
  ) {
    return 'shopify_location_query';
  }
  if (
    existingSource === 'fulfillment_order_assigned_location' &&
    incomingSource === 'shopify_location_query'
  ) {
    return 'shopify_location_query';
  }
  return incomingSource;
}

module.exports = {
  ASSIGNED_NAME_PREFIX,
  buildLocationKey,
  getDisplayName,
  isNameFallbackKey,
  mergeSource,
};
