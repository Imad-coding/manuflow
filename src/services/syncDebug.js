let lastFulfillmentLocations = [];

function setLastFulfillmentLocations(entries) {
  lastFulfillmentLocations = Array.isArray(entries) ? entries : [];
}

function getLastFulfillmentLocations() {
  return lastFulfillmentLocations;
}

module.exports = {
  setLastFulfillmentLocations,
  getLastFulfillmentLocations,
};
