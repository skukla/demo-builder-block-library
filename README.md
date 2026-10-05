# Demo Builder Block Library

Optional Edge Delivery Services blocks that Demo Builder can add to a storefront.
Demo Builder copies every folder under `blocks/` into the storefront repository when
an SC ticks this library in the Storefront area, the same way it installs any block
library. Nothing here is required by a storefront.

## Blocks

### catalog-menu

Builds the storefront's menu from the Commerce category tree, so the nav reaches the
category pages without anyone hand-typing them.

**How an author uses it.** In the nav document, type one ordinary line in the menu list:

```
Custom Signs                        <- typed by hand, stays as typed
Shop the catalog                    <- one menu entry per top-level category
Shop the catalog: Signs and Labels  <- that category, its sub-categories as links
Resources                           <- typed by hand
```

and put a one-cell `catalog-menu` table anywhere in the nav document (Demo Builder adds
it at the end).

- Categories are named the way Commerce names them, not by path or id. Case and extra
  spaces do not matter. A name that matches nothing shows as plain text and the
  browser console names it.
- Hand-typed items keep their place; each line expands where it sits.
- To hide a category, turn off **Include in Menu** on it in Commerce.
- No line, no change: the nav is exactly what was authored.
- Each link points at `/<category url path>`, the page holding that category's
  `product-list-page` block. Demo Builder writes those pages when it sets the
  storefront up, and again on every republish and reset.
- A category page can live at any address. To link a category to a page that is not
  at its url path, add a two-cell row to the `catalog-menu` table: the category's url
  path, then the page.

  ```
  catalog-menu
  signs              | /safety-signage
  signs/danger-signs | /danger
  ```

  Demo Builder writes a row for each hand-built category page it finds (a page whose
  `product-list-page` block names the category), and writes no page of its own for
  that category. Rows you type are yours: Demo Builder never changes or removes them.
  A category with a row is taken to have a page, so it is not checked and never falls
  back to search.
- A category added in Commerce after that is in the menu at once, before its page
  exists. Until the next republish its link goes to the search page filtered to that
  category (`/search?filter=categoryPath:<url path>`), so it never lands on a 404. The
  block checks each shown category with one `HEAD` request to its page.

**How it works.** The header loads the nav as a fragment, and the fragment decorates
and loads its blocks before the header reads the list. This block runs then, reads
`categories` (roles `show_in_menu`) from Catalog Service through the storefront's own
client (`CS_FETCH_GRAPHQL` in `scripts/commerce.js`), and rewrites the lines.

**B2B.** On a B2B website a category is invisible to a customer group until a shared
catalog grants it. Until it is proven that the `categories` read honours those grants,
the block also asks product search, as the current shopper, whether each category has
anything to show, and leaves out the ones that do not. `FILTER_BY_VISIBLE_PRODUCTS` in
`catalog-menu-core.js` switches that off.

**Needs.** A storefront built on the Adobe Commerce boilerplate that exports
`CS_FETCH_GRAPHQL` from `scripts/commerce.js` and loads the nav through
`blocks/fragment/fragment.js`.

## Tests

```
npm install
npm test
```

Node's own test runner with jsdom standing in for the browser. Tests live in `test/`,
outside `blocks/`, so they are never copied into a storefront.
