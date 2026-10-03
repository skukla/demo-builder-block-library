/*
 * catalog-menu block — behaviour tests.
 *
 * Run with `npm test` (node's own test runner; jsdom stands in for the browser).
 *
 * The category records below follow the Catalog Service `categories` reference
 * (developer.adobe.com/commerce/services/graphql/catalog-service/categories/, read
 * 2026-10-03): `id`, `name`, `level`, `roles`, `urlPath`, `parentId`, `position`,
 * `children` (ids as strings). They are NOT captured from a live store yet — the
 * first live run is the check that they match (see the Demo Builder plan
 * `.rptc/plans/category-pages/overview.md`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildCatalogMenu } from '../blocks/catalog-menu/catalog-menu-core.js';
import decorate from '../blocks/catalog-menu/catalog-menu.js';

const CATEGORIES = [
  {
    id: '41', name: 'Safety Signs', level: 2, parentId: '2', position: 2, urlPath: 'safety-signs', roles: ['active', 'show_in_menu'], children: ['42', '43'],
  },
  {
    id: '42', name: 'Exit Signs', level: 3, parentId: '41', position: 1, urlPath: 'safety-signs/exit-signs', roles: ['active', 'show_in_menu'], children: [],
  },
  {
    id: '43', name: 'Fire Signs', level: 3, parentId: '41', position: 2, urlPath: 'safety-signs/fire-signs', roles: ['active', 'show_in_menu'], children: [],
  },
  {
    id: '50', name: 'Safety Cabinets', level: 2, parentId: '2', position: 1, urlPath: 'safety-cabinets', roles: ['active', 'show_in_menu'], children: ['51'],
  },
  {
    id: '51', name: 'Flammable Cabinets', level: 3, parentId: '50', position: 1, urlPath: 'safety-cabinets/flammable', roles: ['active', 'show_in_menu'], children: [],
  },
];

const NAV = `
<main>
  <div class="section"><div class="default-content-wrapper"><p>Brand</p></div></div>
  <div class="section"><div class="default-content-wrapper"><ul>
    <li>Custom Signs</li>
    LINES
    <li><p>Resources</p><ul><li><a href="/guides">Guides</a></li></ul></li>
  </ul></div></div>
  <div class="section"><div class="default-content-wrapper"><p>Tools</p></div>
    <div class="catalog-menu-wrapper"><div class="catalog-menu block" data-block-name="catalog-menu"><div><div></div></div></div></div>
  </div>
</main>`;

function setup(lines) {
  const dom = new JSDOM(`<!doctype html><body>${NAV.replace('LINES', lines)}</body>`);
  const { document } = dom.window;
  return { document, block: document.querySelector('.catalog-menu') };
}

/** Every path has products unless listed in `empty`. */
function fakeFetch({ categories = CATEGORIES, empty = [], fail = false } = {}) {
  const calls = [];
  const fetchGraphQl = async (query, options = {}) => {
    calls.push({ query, variables: options.variables });
    if (fail) throw new Error('network down');
    if (query.includes('categories(')) return { data: { categories } };
    const data = {};
    Object.entries(options.variables || {}).forEach(([key, path]) => {
      data[key.replace('p', 'c')] = { total_count: empty.includes(path) ? 0 : 7 };
    });
    return { data };
  };
  return { fetchGraphQl, calls };
}

function quietLogger() {
  const warnings = [];
  const errors = [];
  return {
    logger: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) },
    warnings,
    errors,
  };
}

const topLevel = (document) => [...document.querySelectorAll('.default-content-wrapper > ul > li')]
  .map((li) => li.firstChild.textContent.trim());

const linkOf = (document, text) => [...document.querySelectorAll('a')]
  .find((a) => a.textContent === text)?.getAttribute('href');

test('a bare "Shop the catalog" line becomes one entry per top-level category, in place', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  const { fetchGraphQl } = fakeFetch();
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Safety Cabinets', 'Safety Signs', 'Resources']);
  assert.equal(linkOf(document, 'Safety Signs'), '/safety-signs');
  assert.equal(linkOf(document, 'Exit Signs'), '/safety-signs/exit-signs');
  assert.equal(linkOf(document, 'Flammable Cabinets'), '/safety-cabinets/flammable');
});

test('a named line becomes that category with its sub-categories as links', async () => {
  const { document, block } = setup('<li>Shop the catalog: Safety Signs</li>');
  await buildCatalogMenu(block, fakeFetch().fetchGraphQl, quietLogger().logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Safety Signs', 'Resources']);
  const entry = [...document.querySelectorAll('.default-content-wrapper > ul > li')][1];
  const subLinks = [...entry.querySelectorAll(':scope ul a')].map((a) => a.textContent);
  assert.deepEqual(subLinks, ['Exit Signs', 'Fire Signs']);
});

test('the category name is matched the way Commerce spells it, ignoring case and spacing', async () => {
  const { document, block } = setup('<li><p>shop the catalog:   exit signs </p></li>');
  await buildCatalogMenu(block, fakeFetch().fetchGraphQl, quietLogger().logger);

  assert.equal(linkOf(document, 'Exit Signs'), '/safety-signs/exit-signs');
});

test('a name that matches nothing renders as plain text and the console names it', async () => {
  const { document, block } = setup('<li>Shop the catalog: Lockout</li>');
  const log = quietLogger();
  await buildCatalogMenu(block, fakeFetch().fetchGraphQl, log.logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Lockout', 'Resources']);
  assert.equal(document.querySelectorAll('a').length, 1, 'only the hand-typed Guides link remains');
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /Lockout/);
});

test('hand-typed items keep their content and their place', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  await buildCatalogMenu(block, fakeFetch().fetchGraphQl, quietLogger().logger);

  assert.equal(linkOf(document, 'Guides'), '/guides');
  assert.equal(topLevel(document)[0], 'Custom Signs');
  assert.equal(topLevel(document).at(-1), 'Resources');
});

test('no line, no change: nothing is queried and the list is exactly as authored', async () => {
  const { document, block } = setup('');
  const before = document.querySelector('ul').outerHTML;
  const { fetchGraphQl, calls } = fakeFetch();
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  assert.equal(calls.length, 0);
  assert.equal(document.querySelector('ul').outerHTML, before);
});

test('the block removes itself so nothing of it renders in the header', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  await buildCatalogMenu(block, fakeFetch().fetchGraphQl, quietLogger().logger);

  assert.equal(document.querySelector('.catalog-menu'), null);
  assert.equal(document.querySelector('.catalog-menu-wrapper'), null);
});

test('asks Catalog Service only for categories marked "Include in Menu"', async () => {
  const { block } = setup('<li>Shop the catalog</li>');
  const { fetchGraphQl, calls } = fakeFetch();
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  assert.match(calls[0].query, /categories\(roles: \$roles\)/);
  assert.deepEqual(calls[0].variables, { roles: ['show_in_menu'] });
});

test('B2B: a category the shopper\'s group cannot search is left out of the menu', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  const { fetchGraphQl } = fakeFetch({ empty: ['safety-cabinets', 'safety-cabinets/flammable', 'safety-signs/fire-signs'] });
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Safety Signs', 'Resources']);
  assert.equal(linkOf(document, 'Fire Signs'), undefined);
  assert.equal(linkOf(document, 'Exit Signs'), '/safety-signs/exit-signs');
});

test('B2B: a parent with no products of its own stays when one of its children is visible', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  // Measured shape on Justrite, 2026-10-01: the shared catalogs granted the
  // sub-categories but not Safety Signs itself.
  const { fetchGraphQl } = fakeFetch({ empty: ['safety-signs', 'safety-signs/fire-signs'] });
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  assert.ok(topLevel(document).includes('Safety Signs'));
  assert.equal(linkOf(document, 'Exit Signs'), '/safety-signs/exit-signs');
});

test('the visibility check sends the same filter the product list page sends, as variables', async () => {
  const { block } = setup('<li>Shop the catalog</li>');
  const { fetchGraphQl, calls } = fakeFetch();
  await buildCatalogMenu(block, fetchGraphQl, quietLogger().logger);

  const search = calls[1];
  assert.match(search.query, /productSearch\(phrase: "", page_size: 1/);
  assert.match(search.query, /attribute: "categoryPath", eq: \$p0/);
  assert.match(search.query, /attribute: "visibility", in: \["Search", "Catalog, Search"\]/);
  assert.equal(Object.values(search.variables).includes('safety-signs/exit-signs'), true);
});

test('when Catalog Service cannot be reached the nav still renders: bare lines go, named lines stay as text', async () => {
  const { document, block } = setup('<li>Shop the catalog</li><li>Shop the catalog: Safety Signs</li>');
  const log = quietLogger();
  await buildCatalogMenu(block, fakeFetch({ fail: true }).fetchGraphQl, log.logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Safety Signs', 'Resources']);
  assert.equal(linkOf(document, 'Safety Signs'), undefined);
  assert.equal(log.errors.length, 1);
  assert.equal(document.querySelector('.catalog-menu'), null);
});

test('GraphQL errors in the response are treated as a failure, not as an empty catalog', async () => {
  const { document, block } = setup('<li>Shop the catalog: Safety Signs</li>');
  const log = quietLogger();
  const fetchGraphQl = async () => ({ errors: [{ message: 'Cannot query field "categories"' }] });
  await buildCatalogMenu(block, fetchGraphQl, log.logger);

  assert.deepEqual(topLevel(document), ['Custom Signs', 'Safety Signs', 'Resources']);
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0], /Cannot query field/);
});

test('decorate takes the storefront\'s own Catalog Service client when it is handed one', async () => {
  const { document, block } = setup('<li>Shop the catalog</li>');
  const { fetchGraphQl, calls } = fakeFetch();
  await decorate(block, { fetchGraphQl, logger: quietLogger().logger });

  assert.equal(calls.length, 2);
  assert.ok(topLevel(document).includes('Safety Signs'));
});

test('in its own section (where Demo Builder puts it) the block takes that section with it', async () => {
  // The header names the first three sections brand / sections / tools; a fourth,
  // empty one must not be left behind in the nav.
  const dom = new JSDOM(`<!doctype html><body><main>
    <div class="section"><div class="default-content-wrapper"><p>Brand</p></div></div>
    <div class="section"><div class="default-content-wrapper"><ul><li>Shop the catalog</li></ul></div></div>
    <div class="section"><div class="default-content-wrapper"><p>Tools</p></div></div>
    <div class="section catalog-menu-container"><div class="catalog-menu-wrapper"><div class="catalog-menu block"><div><div></div></div></div></div></div>
  </main></body>`);
  const { document } = dom.window;
  await buildCatalogMenu(document.querySelector('.catalog-menu'), fakeFetch().fetchGraphQl, quietLogger().logger);

  assert.equal(document.querySelectorAll('main > .section').length, 3);
  assert.equal(document.querySelector('main > .section:last-child').textContent.trim(), 'Tools');
});
