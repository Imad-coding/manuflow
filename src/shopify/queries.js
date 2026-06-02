const LOCATIONS_QUERY = `
  query Locations {
    locations(first: 50) {
      edges {
        node {
          id
          name
          isActive
        }
      }
    }
  }
`;

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          createdAt
          customer {
            displayName
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                sku
                quantity
                variantTitle
                image {
                  url
                }
                customAttributes {
                  key
                  value
                }
                variant {
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
          fulfillmentOrders(first: 20) {
            edges {
              node {
                id
                status
                assignedLocation {
                  name
                  location {
                    id
                    name
                  }
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      remainingQuantity
                      lineItem {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

module.exports = {
  LOCATIONS_QUERY,
  ORDERS_QUERY,
};
