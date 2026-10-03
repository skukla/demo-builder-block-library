/*
 * catalog-menu block (Demo Builder block library).
 *
 * Put a one-cell `catalog-menu` table in the nav document and type "Shop the catalog"
 * (or "Shop the catalog: <category name>") as a line in the menu list. The line is
 * replaced with the Commerce category tree read from Catalog Service. See
 * catalog-menu-core.js for the rules and README.md for authoring.
 */
import { buildCatalogMenu } from './catalog-menu-core.js';

/**
 * The storefront's own Catalog Service client, so the request carries the same
 * endpoint and scope headers (store view, customer group) as the product list page.
 * Loaded on demand because it lives in the storefront, not in this library.
 */
async function storefrontClient() {
  // Resolves inside the storefront this block is copied into, not in this library.
  // eslint-disable-next-line import/no-unresolved
  const { CS_FETCH_GRAPHQL } = await import('../../scripts/commerce.js');
  return { fetchGraphQl: (query, options) => CS_FETCH_GRAPHQL.fetchGraphQl(query, options) };
}

export default async function decorate(block, deps) {
  const { fetchGraphQl, logger } = deps || await storefrontClient();
  await buildCatalogMenu(block, fetchGraphQl, logger);
}
