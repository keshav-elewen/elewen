import { isCorporateDecorPackage, normalizeServiceSlug, packageThemeSlugsMatchFilter } from './packageFilters'

/**
 * Shared package search matching for nav + listing pages.
 * Theme-name queries match theme_slugs only; otherwise title/category/description/includes.
 */

const KEYWORD_ALIASES = {
  flower: ['flower', 'flowers', 'floral', 'florals', 'floral vase'],
  balloon: ['balloon', 'balloons'],
  candle: ['candle', 'candles'],
  backdrop: ['backdrop', 'backdrops', 'back drop'],
  lighting: ['light', 'lighting', 'lights', 'fairy light', 'fairy lights'],
  entrance: [
    'entrance set up',
    'entrance setup',
    'entrance décor',
    'entrance decor',
    'entrance decoration',
  ],
  centerpiece: ['centerpiece', 'centerpieces'],
  neon: ['neon sign', 'neon'],
  canopy: ['canopy', 'canopies'],
  projector: ['projector', 'plasma screen', 'projector / plasma screen', 'screen'],
  urli: ['urli'],
  cushion: ['cushion', 'cushions'],
  chair: ['chair', 'chairs'],
  table: ['table', 'cake table'],
  printable: ['printable', 'printables'],
  game: ['games night', 'game night', 'games'],
  movie: ['movie night', 'movies night'],
  date: ['date night'],
  bar: ['bar'],
  sheesha: ['sheesha', 'hookah', 'hukkah'],
  decor: ['decor', 'decoration', 'styling'],
  bartending: ['bartender', 'bartenders', 'bartending', 'drinks'],
  catering: ['food', 'main course', 'snacks', 'starters', 'bar nibbles', 'catering'],
}

/** Longer phrases first so "bar nibbles" wins over decor "bar". */
const CATERING_SEARCH_KEYWORDS = [
  'bar nibbles',
  'main course',
  'starters',
  'snacks',
  'food',
  'catering',
]

const BARTENDING_SEARCH_KEYWORDS = [
  'bar-tending',
  'bar tending',
  'bartenders',
  'bartender',
  'bartending',
  'drinks',
  'classic pour',
  'signature mix',
  'house special',
]

/** Named bartending packages — match title/type, not every bartending card. */
const BARTENDING_PACKAGE_NAME_KEYWORDS = ['classic pour', 'signature mix', 'house special']

const DECOR_SEARCH_KEYWORDS = [
  'projector / plasma screen',
  'plasma screen',
  'entrance set up',
  'entrance décor',
  'entrance decor',
  'entrance setup',
  'floral vase',
  'fairy lights',
  'games night',
  'movie night',
  'date night',
  'neon sign',
  'cake table',
  'centerpieces',
  'printables',
  'cushions',
  'backdrop',
  'balloons',
  'canopy',
  'candles',
  'flowers',
  'florals',
  'projector',
  'chairs',
  'table',
  'urli',
  'bar',
]

function normalizeSearchQuery(query) {
  return String(query ?? '')
    .toLowerCase()
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
}

function matchesCatalogKeyword(query, keyword) {
  const q = normalizeSearchQuery(query)
  const k = normalizeSearchQuery(keyword)

  if (!q || !k) return false
  if (q === k) return true
  if (k.includes(' ')) return q.includes(k)

  return false
}

function matchesAnySearchKeyword(query, keywords) {
  const sorted = [...keywords].sort((a, b) => b.length - a.length)
  return sorted.some(keyword => matchesCatalogKeyword(query, keyword))
}

function packageHasServiceSlug(pkg, serviceSlug) {
  const target = normalizeServiceSlug(serviceSlug)
  const slugs = Array.isArray(pkg?.service_slugs) ? pkg.service_slugs : []

  return slugs.some(slug => normalizeServiceSlug(slug) === target)
}

function aliasGroupMatchesToken(token, aliases) {
  const normalizedToken = normalizeSearchQuery(token)

  return aliases.some(alias => {
    const normalizedAlias = normalizeSearchQuery(alias)
    if (normalizedAlias === normalizedToken) return true
    if (normalizedAlias.includes(' ')) return false

    return textContainsTerm(normalizedToken, normalizedAlias) || textContainsTerm(normalizedAlias, normalizedToken)
  })
}

function expandQueryTokens(query) {
  const raw = normalizeSearchQuery(query)
  if (!raw) return []

  const expanded = new Set([raw])
  const tokens = raw.split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    for (const aliases of Object.values(KEYWORD_ALIASES)) {
      if (aliasGroupMatchesToken(token, aliases)) {
        aliases.forEach(alias => expanded.add(alias))
      }
    }
  }

  for (const aliases of Object.values(KEYWORD_ALIASES)) {
    if (aliases.some(alias => normalizeSearchQuery(alias) === raw)) {
      aliases.forEach(alias => expanded.add(alias))
    }
  }

  return [...expanded]
}

export function fuzzyMatchText(text, query) {
  const t = String(text ?? '').toLowerCase()
  const q = normalizeSearchQuery(query)
  if (!q || !t) return false
  if (t.includes(q)) return true

  const words = q.split(/\s+/).filter(Boolean)
  return words.every(w => {
    if (t.includes(w)) return true
    if (w.endsWith('y') && t.includes(w.slice(0, -1) + 'ies')) return true
    if (w.endsWith('ies') && t.includes(w.slice(0, -3) + 'y')) return true
    if (w.endsWith('s') && t.includes(w.slice(0, -1))) return true
    if (t.includes(w + 's')) return true
    return false
  })
}

function packageThemeSearchBlob(pkg) {
  const themeSlugs = Array.isArray(pkg?.theme_slugs) ? pkg.theme_slugs : []

  return themeSlugs
    .flatMap(slug => {
      const raw = String(slug ?? '').trim()
      if (!raw) return []
      return [raw, raw.replace(/-/g, ' ')]
    })
    .join(' ')
}

function packageDirectSearchBlob(pkg) {
  const slug = String(pkg?.slug ?? '').trim()

  return [
    pkg?.title,
    pkg?.bartender_type,
    slug,
    slug.replace(/-/g, ' '),
  ]
    .filter(Boolean)
    .join(' ')
}

/** Strong match on package name / bartender tier / slug (before theme-only results). */
function packageMatchesDirectTitleSearch(pkg, query) {
  const q = String(query ?? '').trim()
  if (!q) return false

  const blob = packageDirectSearchBlob(pkg)
  if (!blob) return false

  return fuzzyMatchText(blob, q) || textContainsTerm(blob, q)
}

/** Event links ("diwali-party") so searching an event name finds its packages. */
function packageEventSearchBlob(pkg) {
  const eventSlugs = [
    ...(Array.isArray(pkg?.event_slugs) ? pkg.event_slugs : []),
    ...(Array.isArray(pkg?.category_slugs) ? pkg.category_slugs : []),
  ]

  return eventSlugs
    .flatMap(slug => {
      const raw = String(slug ?? '').trim()
      if (!raw) return []
      return [raw, raw.replace(/-/g, ' ')]
    })
    .join(' ')
}

function packageSearchBlob(pkg) {
  const includes = Array.isArray(pkg?.includes)
    ? pkg.includes
    : Array.isArray(pkg?.tags)
      ? pkg.tags
      : []

  const slug = String(pkg?.slug ?? '').trim()

  return [
    pkg?.title,
    pkg?.bartender_type,
    slug,
    slug.replace(/-/g, ' '),
    pkg?.category,
    pkg?.description,
    pkg?.desc,
    includes.join(' '),
    pkg?.level_slug,
    packageEventSearchBlob(pkg),
  ]
    .filter(Boolean)
    .join(' ')
}

/** True when the query matches this package's theme name/slug only (incl. parent themes). */
export function packageMatchesThemeSearch(pkg, query) {
  const q = String(query ?? '').trim()
  if (!q) return true

  if (textMatchesQuery(packageThemeSearchBlob(pkg), q)) return true

  const querySlug = q
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return Boolean(querySlug) && packageThemeSlugsMatchFilter(pkg?.theme_slugs, querySlug)
}

function textContainsTerm(text, term) {
  const haystack = String(text ?? '').toLowerCase()
  const needle = normalizeSearchQuery(term)

  if (!haystack || !needle) return false
  if (needle.includes(' ')) return haystack.includes(needle)

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)
}

function textMatchesDecorQuery(blob, query) {
  const q = String(query ?? '').trim()
  if (!q) return true
  if (textContainsTerm(blob, q)) return true

  return expandQueryTokens(q).some(token => textContainsTerm(blob, token))
}

function textMatchesQuery(blob, query) {
  const q = String(query ?? '').trim()
  if (!q) return true
  if (fuzzyMatchText(blob, q)) return true

  return expandQueryTokens(q).some(token => fuzzyMatchText(blob, token))
}

export function packageMatchesSearch(pkg, query) {
  const q = String(query ?? '').trim()
  if (!q) return true

  // Theme hits win over title/includes (e.g. "Still Us" neon copy must not pollute theme search).
  if (packageMatchesThemeSearch(pkg, q)) return true

  if (matchesAnySearchKeyword(q, CATERING_SEARCH_KEYWORDS)) {
    return packageHasServiceSlug(pkg, 'catering')
  }

  if (matchesAnySearchKeyword(q, BARTENDING_PACKAGE_NAME_KEYWORDS)) {
    if (!packageHasServiceSlug(pkg, 'bartending')) return false
    return packageMatchesDirectTitleSearch(pkg, q)
  }

  if (matchesAnySearchKeyword(q, BARTENDING_SEARCH_KEYWORDS)) {
    return packageHasServiceSlug(pkg, 'bartending')
  }

  if (matchesAnySearchKeyword(q, DECOR_SEARCH_KEYWORDS)) {
    if (!packageHasServiceSlug(pkg, 'decor')) return false
    return textMatchesDecorQuery(packageSearchBlob(pkg), q)
  }

  const blob = packageSearchBlob(pkg)
  return textMatchesQuery(blob, q)
}

/** True when the query words appear in the package's linked event names/slugs. */
function packageMatchesEventSearch(pkg, query) {
  const blob = packageEventSearchBlob(pkg)
  if (!blob) return false

  return textMatchesQuery(blob, query)
}

/**
 * Prefer direct title/slug matches, then theme-only results, then broader text search.
 * Event-linked packages always join the results — searching "diwali" must surface
 * packages of the Diwali Party event even when some package title also matches.
 */
export function filterPackagesBySearch(packages, query) {
  const list = Array.isArray(packages) ? packages : []
  const q = String(query ?? '').trim()
  if (!q) return list

  const eventHits = list.filter(pkg => packageMatchesEventSearch(pkg, q))

  const directHits = list.filter(pkg => packageMatchesDirectTitleSearch(pkg, q))
  if (directHits.length > 0) {
    return [...directHits, ...eventHits.filter(pkg => !directHits.includes(pkg))]
  }

  const themeHits = list.filter(pkg => packageMatchesThemeSearch(pkg, q))
  if (themeHits.length > 0) {
    return [...themeHits, ...eventHits.filter(pkg => !themeHits.includes(pkg))]
  }

  return list.filter(pkg => packageMatchesSearch(pkg, q))
}

/** Nav header dropdown — corporate packages only for corporate-specific or exact-name search. */
const CORPORATE_NAV_SEARCH_KEYWORDS = [
  'registration and guest experience',
  'registeration and guest experience',
  'branding and visibility',
  'exhibition essentials',
  'stall upgrade',
  'stall upgarde',
  'simply elevated',
  'av and tech',
  'stage setup',
  'corporate package',
  'corporate packages',
  'corporate decor',
  'corporate',
  'exhibition',
  'conference',
  'seminar',
  'stall',
  'stalls',
]

function matchesCorporateNavSearchQuery(query = '') {
  const q = normalizeSearchQuery(query)
  if (!q) return false

  const sorted = [...CORPORATE_NAV_SEARCH_KEYWORDS].sort((a, b) => b.length - a.length)
  return sorted.some(keyword => {
    const k = normalizeSearchQuery(keyword)
    if (!k) return false
    if (q === k) return true
    if (k.includes(' ')) return q.includes(k)
    return false
  })
}

function corporatePackageAllowedInNavSearch(pkg, query) {
  if (!isCorporateDecorPackage(pkg)) return true
  if (packageMatchesDirectTitleSearch(pkg, query)) return true
  return matchesCorporateNavSearchQuery(query)
}

export function filterNavHeaderSearchResults(packages, query) {
  try {
    const list = Array.isArray(packages) ? packages : []
    const q = String(query ?? '').trim()
    if (!q || q.length < 2) return []

    return filterPackagesBySearch(list, q).filter(pkg =>
      corporatePackageAllowedInNavSearch(pkg, q)
    )
  } catch {
    return []
  }
}
