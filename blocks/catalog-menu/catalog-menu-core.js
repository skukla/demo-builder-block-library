/*
 * catalog-menu — the part of the block that does not touch the storefront's own scripts.
 *
 * The nav document carries ordinary list lines an author types in words:
 *
 *   Shop the catalog                    -> one menu entry per top-level category
 *   Shop the catalog: Signs and Labels  -> that category, its sub-categories as links
 *
 * The block's own table may carry two-cell rows, "category url path | page":
 *
 *   signs | /safety-signage             -> the Signs entry links to /safety-signage
 *
 * A category page can live at any address; a row says where, when it is not at the
 * category's own url path. Demo Builder writes one for each hand-built category page it
 * finds, and an author can type one to point any category at any page.
 *
 * The header loads the nav as a fragment, and the fragment decorates and loads its
 * blocks BEFORE the header reads the list (`blocks/fragment/fragment.js`: `decorateMain`,
 * then `await loadSections`). So this block runs first and rewrites those lines in place.
 *
 * Kept free of storefront imports so it can be tested with a fake fetch.
 */

/** "Shop the catalog" or "Shop the catalog: <category name>", any case. */
const LINE_PATTERN = /^shop the catalog\s*(?::\s*(.*))?$/i;

/**
 * Categories whose "Include in Menu" switch is on. The role name is the one the
 * Catalog Service reference uses for that switch. The `categories` argument list and
 * the field names are from the same reference (read 2026-10-03).
 */
const CATEGORIES_QUERY = `query CatalogMenuCategories($roles: [String!]) {
  categories(roles: $roles) { id name level parentId position urlPath children }
}`;
const MENU_ROLES = ['show_in_menu'];

/**
 * On a B2B website a category is invisible to a customer group until a shared
 * catalog grants it, and it is not yet proven that the `categories` read honours
 * those grants. So every candidate is checked by asking search what THIS shopper
 * can see — the same filter the product list page sends — and an entry whose page
 * would be empty is left out. Set to false once the live check shows `categories`
 * already answers per group.
 */
const FILTER_BY_VISIBLE_PRODUCTS = true;
const VISIBILITY_FILTER = '{attribute: "visibility", in: ["Search", "Catalog, Search"]}';

function normalise(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The line's own words: its text without any nested list. */
function ownText(li) {
  return [...li.childNodes]
    .filter((node) => !(node.nodeType === 1 && node.tagName === 'UL'))
    .map((node) => node.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every "Shop the catalog" line in the document the block sits in. */
export function findMenuLines(root) {
  return [...root.querySelectorAll('li')]
    .map((li) => ({ li, match: ownText(li).match(LINE_PATTERN) }))
    .filter(({ match }) => match)
    .map(({ li, match }) => ({ li, name: match[1] ? match[1].trim() : null }));
}

/** A category url path as an author types it: any case, stray slashes. */
function pathKey(urlPath) {
  return normalise(urlPath).replace(/^\/+|\/+$/g, '');
}

/** A page as an author types it: a path, or a pasted link (its path and query are kept). */
function pagePath(cell) {
  const link = cell.querySelector('a[href]');
  const text = (link ? link.getAttribute('href') : cell.textContent).trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  return text.startsWith('/') ? text : `/${text}`;
}

/**
 * The block table's "category url path | page" rows.
 *
 * @param {Element} block the catalog-menu block
 * @returns {Map<string, string>} category url path (lower case, no outer slashes) -> page
 */
export function readPageLinks(block) {
  const links = new Map();
  [...block.children].forEach((row) => {
    const [category, page] = row.children;
    const key = category ? pathKey(category.textContent) : '';
    const path = page ? pagePath(page) : null;
    if (key && path && !links.has(key)) links.set(key, path);
  });
  return links;
}

function byPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name);
}

/**
 * Flat category list -> tree. The top level is the shallowest level returned, so a
 * hidden store root (or a hidden parent) never promotes its children by accident.
 */
export function buildTree(categories) {
  const usable = (categories || []).filter((c) => c && c.id && c.name && c.urlPath);
  if (usable.length === 0) return [];
  const nodes = new Map(usable.map((c) => [
    String(c.id),
    { ...c, id: String(c.id), children: [] },
  ]));
  nodes.forEach((node) => {
    const parent = nodes.get(String(node.parentId));
    if (parent) parent.children.push(node);
  });
  nodes.forEach((node) => node.children.sort(byPosition));
  const topLevel = Math.min(...usable.map((c) => c.level ?? Infinity));
  return [...nodes.values()].filter((n) => (n.level ?? Infinity) === topLevel).sort(byPosition);
}

function findByName(tree, name) {
  const wanted = normalise(name);
  const stack = [...tree];
  while (stack.length) {
    const node = stack.shift();
    if (normalise(node.name) === wanted) return node;
    stack.push(...node.children);
  }
  return null;
}

/** One aliased productSearch per path; values travel as variables, never spliced in. */
export function visibilityQuery(paths) {
  const params = paths.map((_, i) => `$p${i}: String!`).join(', ');
  const fields = paths.map((_, i) => `c${i}: productSearch(phrase: "", page_size: 1, `
    + `filter: [{attribute: "categoryPath", eq: $p${i}}, ${VISIBILITY_FILTER}]) { total_count }`);
  const variables = Object.fromEntries(paths.map((path, i) => [`p${i}`, path]));
  return { query: `query CatalogMenuVisibility(${params}) {\n  ${fields.join('\n  ')}\n}`, variables };
}

async function runQuery(fetchGraphQl, query, variables) {
  const response = await fetchGraphQl(query, { variables });
  if (response?.errors?.length) {
    throw new Error(response.errors.map((e) => e.message).join('; '));
  }
  return response?.data || {};
}

/** The nodes a menu can show: every top-level category and its direct children. */
function shownNodes(tree) {
  return tree.flatMap((node) => [node, ...node.children]);
}

async function keepVisible(tree, fetchGraphQl) {
  const nodes = shownNodes(tree);
  if (nodes.length === 0) return tree;
  const { query, variables } = visibilityQuery(nodes.map((n) => n.urlPath));
  const data = await runQuery(fetchGraphQl, query, variables);
  const visible = new Set(nodes
    .filter((_, i) => (data[`c${i}`]?.total_count ?? 0) > 0)
    .map((n) => n.id));
  return tree
    .map((node) => ({ ...node, children: node.children.filter((c) => visible.has(c.id)) }))
    .filter((node) => visible.has(node.id) || node.children.length > 0);
}

/**
 * Where a category with no page of its own sends the shopper: the search page, filtered
 * to that category. The search page's list block reads `?filter=` (its `search-url.js`)
 * and turns `categoryPath:<urlPath>` into an `in` filter, which Catalog Service answers
 * the same as the `eq` a category page sends (measured 2026-10-05).
 *
 * `search-url.js` reads a value with a hyphen between two numbers as a price range, and
 * splits on a comma; a url path shaped like either cannot be a filter, so it keeps its
 * own (missing) page rather than a wrong search.
 *
 * @param {string} urlPath the category's url path
 * @returns {string|null} the search link, or null when the path cannot be a filter
 */
export function searchFallbackHref(urlPath) {
  if (/,/.test(urlPath)) return null;
  const [from, to] = urlPath.split('-');
  if (to !== undefined && Number.isFinite(Number(from)) && Number.isFinite(Number(to))) return null;
  return `/search?filter=${encodeURIComponent(`categoryPath:${urlPath}`)}`;
}

/**
 * The shown categories that have no page yet (a category the table links to a page is
 * not asked about). A category added in Commerce after the
 * storefront was set up is in the menu at once, but its page arrives only at the next
 * republish or reset. A probe that fails says nothing, so that link stays as it is.
 */
async function missingPages(tree, pageExists, links) {
  if (!pageExists) return new Set();
  // A category with a row in the table has a page: the row says where.
  const nodes = shownNodes(tree).filter((node) => !links.has(pathKey(node.urlPath)));
  const answers = await Promise.all(nodes.map(async (node) => {
    try {
      return await pageExists(`/${node.urlPath}`);
    } catch {
      return true;
    }
  }));
  return new Set(nodes.filter((_, i) => answers[i] === false).map((n) => n.id));
}

function hrefFor(node, { missing, links }) {
  const linked = links.get(pathKey(node.urlPath));
  if (linked) return linked;
  const fallback = missing.has(node.id) ? searchFallbackHref(node.urlPath) : null;
  return fallback || `/${node.urlPath}`;
}

function entryFor(document, node, pages) {
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.href = hrefFor(node, pages);
  link.textContent = node.name;
  li.append(link);
  if (node.children.length) {
    const list = document.createElement('ul');
    node.children.forEach((child) => {
      const item = document.createElement('li');
      const childLink = document.createElement('a');
      childLink.href = hrefFor(child, pages);
      childLink.textContent = child.name;
      item.append(childLink);
      list.append(item);
    });
    li.append(list);
  }
  return li;
}

function plainEntry(document, text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

function renderLine(line, tree, logger, pages) {
  const document = line.li.ownerDocument;
  if (!line.name) {
    line.li.replaceWith(...tree.map((node) => entryFor(document, node, pages)));
    return;
  }
  const node = findByName(tree, line.name);
  if (!node) {
    logger.warn(`catalog-menu: no category named "${line.name}" in this store's menu`);
    line.li.replaceWith(plainEntry(document, line.name));
    return;
  }
  line.li.replaceWith(entryFor(document, node, pages));
}

/** Without the catalog: bare lines go, named lines keep their words. */
function renderWithoutCatalog(lines) {
  lines.forEach((line) => {
    if (line.name) line.li.replaceWith(plainEntry(line.li.ownerDocument, line.name));
    else line.li.remove();
  });
}

/**
 * Take the block out of the nav, and its section too when nothing else is in it: the
 * header names only the first three sections (brand, sections, tools), so an empty
 * fourth one would be left in the nav.
 */
function removeBlock(block) {
  const wrapper = block.closest('.catalog-menu-wrapper') || block;
  const section = wrapper.closest('.section');
  wrapper.remove();
  if (section && section.children.length === 0) section.remove();
}

/**
 * Rewrite every "Shop the catalog" line in the nav the block sits in.
 *
 * @param {Element} block the catalog-menu block
 * @param {Function} fetchGraphQl the storefront's Catalog Service client
 *   (`CS_FETCH_GRAPHQL.fetchGraphQl`), so the shopper's own scope headers apply
 * @param {{warn: Function, error: Function}} logger console by default
 * @param {Function} [pageExists] answers whether the storefront has a page at a path;
 *   a category without one links to the filtered search page. Absent: no check. A
 *   category the block's table links to a page is never checked.
 */
export async function buildCatalogMenu(block, fetchGraphQl, logger = console, pageExists = null) {
  const root = block.closest('main') || block.ownerDocument;
  const lines = findMenuLines(root);
  const links = readPageLinks(block);
  removeBlock(block);
  if (lines.length === 0) return;

  try {
    const data = await runQuery(fetchGraphQl, CATEGORIES_QUERY, { roles: MENU_ROLES });
    let tree = buildTree(data.categories);
    if (FILTER_BY_VISIBLE_PRODUCTS) tree = await keepVisible(tree, fetchGraphQl);
    const missing = await missingPages(tree, pageExists, links);
    lines.forEach((line) => renderLine(line, tree, logger, { missing, links }));
  } catch (error) {
    logger.error(`catalog-menu: could not read the category tree: ${error.message}`);
    renderWithoutCatalog(lines);
  }
}
