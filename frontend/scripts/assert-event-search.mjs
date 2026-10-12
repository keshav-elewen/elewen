/**
 * Asserts event-name search: packages linked to an event (event_slugs /
 * category_slugs) are found by the event's words, while title-first ranking,
 * theme hits, and the corporate filter keep working.
 *
 * Run: node --import ./scripts/register-esm-extension-resolver.mjs scripts/assert-event-search.mjs
 */
import {
  filterPackagesBySearch,
  filterNavHeaderSearchResults,
  packageMatchesSearch,
} from '../src/lib/packageSearch.js'
import { isCorporateDecorPackage } from '../src/lib/packageFilters.js'

let failures = 0
function check(name, actual, expected) {
  const pass = actual === expected
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

// Three packages linked to the "Diwali Party" event (id 3 only via parent event).
const diwaliEventPackages = [
  {
    id: 1,
    slug: 'radiant-glow-1',
    title: 'Radiant Glow',
    event_slugs: ['diwali-party'],
    category_slugs: ['diwali-party'],
    service_slugs: ['decor'],
  },
  {
    id: 2,
    slug: 'royal-feast-1',
    title: 'Royal Feast',
    event_slugs: ['diwali-party'],
    category_slugs: ['diwali-party'],
    service_slugs: ['decor'],
  },
  {
    id: 3,
    slug: 'festival-lights-1',
    title: 'Festival Lights',
    event_slugs: [],
    category_slugs: ['diwali-party'],
    service_slugs: ['decor'],
  },
]

// Unrelated package that must NOT match "diwali".
const birthdayPkg = {
  id: 4,
  slug: 'birthday-bliss-1',
  title: 'Birthday Bliss',
  event_slugs: ['birthday-party'],
  category_slugs: ['birthday-party'],
  service_slugs: ['decor'],
}

// A package whose TITLE contains "diwali" — must outrank event-only hits.
const titleHitPkg = {
  id: 5,
  slug: 'diwali-delight-1',
  title: 'Diwali Delight',
  event_slugs: [],
  category_slugs: [],
  service_slugs: ['decor'],
}

// Corporate package: recognized via its event link (exhibition-stalls).
const corporatePkg = {
  id: 7,
  slug: 'stall-upgrade-1',
  title: 'Stall Upgrade',
  event_slugs: ['exhibition-stalls'],
  category_slugs: ['exhibition-stalls'],
  service_slugs: ['decor'],
}

const all = [...diwaliEventPackages, birthdayPkg, titleHitPkg, corporatePkg]

check(
  'query "diwali" matches every event-linked package',
  diwaliEventPackages.every(pkg => packageMatchesSearch(pkg, 'diwali')),
  true
)
check(
  'query "diwali" does not match the birthday package',
  packageMatchesSearch(birthdayPkg, 'diwali'),
  false
)
check(
  'event-only list: filterPackagesBySearch("diwali") finds all 3 event-linked packages',
  filterPackagesBySearch(diwaliEventPackages, 'diwali').length,
  3
)
check(
  'merged ranking: title hit first, event-linked packages follow',
  filterPackagesBySearch(all, 'diwali').map(p => p.title).join(','),
  'Diwali Delight,Radiant Glow,Royal Feast,Festival Lights'
)
check(
  'query "party" matches the 3 diwali + 1 birthday event packages',
  filterPackagesBySearch(all, 'party').length,
  4
)
check(
  'query "birthday" matches only the birthday package',
  filterPackagesBySearch(all, 'birthday').map(p => p.title).join(','),
  'Birthday Bliss'
)

// Regression: theme search untouched.
const themePkg = {
  id: 6,
  slug: 'glow-theme-1',
  title: 'Glow Set',
  theme_slugs: ['diwali-radiance'],
  service_slugs: ['decor'],
}
check('theme search still matches theme slug', packageMatchesSearch(themePkg, 'diwali'), true)

// Regression: corporate filter behavior unchanged.
check('corporate package is recognized by its event link', isCorporateDecorPackage(corporatePkg), true)
const navResults = filterNavHeaderSearchResults(all, 'diwali')
check('nav search hides corporate package for generic "diwali" query', navResults.some(p => p.id === 7), false)
check(
  'nav search returns title hit + event-linked matches, no corporate',
  navResults.map(p => p.title).join(','),
  'Diwali Delight,Radiant Glow,Royal Feast,Festival Lights'
)
check('nav search still ignores 1-character queries', filterNavHeaderSearchResults(all, 'd').length, 0)

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll checks passed')
