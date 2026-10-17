// Store resolution & URL matcher engine.
// Reverse-engineered PayPal Honey architecture adapted for Pocket (Manifest V3).
//
// 1. URL Normalization: y(e) + SPA hash route normalization g({ pathname, hash })
// 2. Multi-part TLD & Domain Parser (PSL lightweight standard extractor)
// 3. Exact Matching Algorithm: v(e, t) using longest-host + longest-path specificity
// 4. Curated candidate partials registry with fallback heuristics

// Common two-level TLDs to correctly extract root domain without heavy external dependencies
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'org.br', 'net.br',
  'com.mx', 'org.mx', 'edu.mx',
  'co.in', 'net.in', 'org.in', 'gen.in',
  'com.sg', 'org.sg', 'edu.sg',
  'com.hk', 'org.hk', 'edu.hk',
  'co.za', 'org.za', 'web.za',
  'com.tw', 'org.tw', 'idv.tw',
  'com.cn', 'net.cn', 'org.cn',
  'co.kr', 'ne.kr', 'or.kr',
  'com.ph', 'org.ph', 'net.ph',
  'com.tr', 'org.tr', 'edu.tr',
]);

/**
 * Extracts base domain and effective TLD from hostname.
 * e.g. "www.store.nike.co.uk" -> { domain: "nike.co.uk", topLevelDomain: "co.uk" }
 *      "store.nike.com"       -> { domain: "nike.com", topLevelDomain: "com" }
 */
export function parseDomainParts(hostname) {
  if (!hostname) return { domain: '', topLevelDomain: '' };
  const lower = hostname.toLowerCase().replace(/\.+$/, '');
  const parts = lower.split('.');
  if (parts.length <= 1) return { domain: lower, topLevelDomain: '' };

  // Check last two parts for multi-part TLD (e.g. "co.uk")
  if (parts.length >= 3) {
    const candidateTld = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (MULTI_PART_TLDS.has(candidateTld)) {
      const s = parts[parts.length - 3];
      return {
        domain: `${s}.${candidateTld}`,
        topLevelDomain: candidateTld,
        subdomains: parts.slice(0, -3),
      };
    }
  }

  // Single-part TLD (e.g. "com", "org", "io")
  const tld = parts[parts.length - 1];
  const s = parts[parts.length - 2];
  return {
    domain: `${s}.${tld}`,
    topLevelDomain: tld,
    subdomains: parts.slice(0, -2),
  };
}

/**
 * Normalizes SPA hash-path (Honey's g({ pathname, hash })).
 * Guarantees a leading slash, rewrites hash routes (/#/checkout -> /checkout/),
 * and guarantees a trailing slash for deterministic prefix matching.
 */
export function normalizePath({ pathname = '/', hash = '' } = {}) {
  let r = pathname || '/';
  if (r === '/' && hash) {
    const cleanHash = hash.replace(/^#+/, '');
    r = cleanHash.startsWith('/') ? cleanHash : `/${cleanHash}`;
  }
  // Strip query params if accidentally passed inside path
  r = r.split('?')[0];
  return r.endsWith('/') ? r : `${r}/`;
}

/**
 * Normalizes a store URL for Honey-style matching (Honey's y(e)).
 * Returns: { host: '.hostname', path: '/path/', domain: 'brand.com', topLevelDomain: 'com', rawHostname }
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl) throw new Error('No store URL provided');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // If protocol was missing, attempt prepend https://
    try {
      parsed = new URL(`https://${rawUrl}`);
    } catch {
      throw new Error(`Invalid store URL: could not parse "${rawUrl}"`);
    }
  }

  const { protocol, hostname, pathname, hash } = parsed;
  if (!hostname || (protocol !== 'http:' && protocol !== 'https:')) {
    throw new Error('Invalid store URL: invalid hostname, pathname, or protocol');
  }

  const lowerHost = hostname.toLowerCase();
  const { domain, topLevelDomain } = parseDomainParts(lowerHost);
  if (!domain || !topLevelDomain) {
    throw new Error(`Invalid store URL: invalid domain or tld for "${hostname}"`);
  }

  return {
    // Leading dot allows suffix-matching subdomains safely (.nike.com matches .store.nike.com)
    host: `.${lowerHost}`,
    path: normalizePath({ pathname: pathname.toLowerCase(), hash: hash?.toLowerCase() }),
    domain,
    topLevelDomain,
    rawHostname: lowerHost,
    fullUrl: rawUrl,
  };
}

/**
 * Exact Matching Algorithm: v(e, t)
 * Evaluates candidate partials dictionary against normalized URL with specificity tie-breaker:
 * 1. lengthHost (subdomain beats root domain: store.nike.com/ beats nike.com/)
 * 2. lengthPath (deeper subpath beats shallow path: nike.com/gb/en_gb/ beats nike.com/)
 *
 * @param {Record<string, any>} partialsDict - { [partialUrl]: storeMeta }
 * @param {ReturnType<typeof normalizeUrl>} normalizedUrl
 * @returns {{ storeId: string, storeMeta: any, lengthHost: number, lengthPath: number, partialUrl: string } | null}
 */
export function matchStorePartials(partialsDict, normalizedUrl) {
  if (!partialsDict || !normalizedUrl) return null;

  return Object.keys(partialsDict).reduce((winner, partialKey) => {
    const o = partialKey.toLowerCase();
    const slashIdx = o.indexOf('/');
    let hostPart, pathPart;

    if (slashIdx >= 0) {
      hostPart = `.${o.substring(0, slashIdx)}`;
      const subPath = o.substring(slashIdx);
      pathPart = subPath.endsWith('/') ? subPath : `${subPath}/`;
    } else {
      hostPart = `.${o}`;
      pathPart = '/';
    }

    // Honey matching criteria:
    // Tab host ends with candidate host AND tab path starts with candidate path
    const matchesHost = normalizedUrl.host.endsWith(hostPart);
    const matchesPath = normalizedUrl.path.startsWith(pathPart);

    if (!matchesHost || !matchesPath) {
      return winner;
    }

    const lengthHost = hostPart.length;
    const lengthPath = pathPart.length;

    // Specificity tie-breaker:
    // Reject if current winner has longer host, or equal host and longer path
    if (
      winner &&
      (winner.lengthHost > lengthHost ||
        (winner.lengthHost === lengthHost && winner.lengthPath > lengthPath))
    ) {
      return winner;
    }

    const val = partialsDict[partialKey];
    const storeId = typeof val === 'object' && val !== null ? val.storeId || val.id || partialKey : val;

    return {
      storeId,
      storeMeta: val,
      lengthHost,
      lengthPath,
      partialUrl: partialKey,
    };
  }, null);
}

/**
 * Curated candidate partials dictionary representing major e-commerce storefronts
 * and sub-storefronts with checkout path awareness.
 */
export const SUPPORTED_STORE_PARTIALS = {
  // Nike examples from Honey reverse engineering
  'nike.com/': { storeId: 'nike_us', name: 'Nike', domain: 'nike.com' },
  'store.nike.com/': { storeId: 'nike_store', name: 'Nike Official Store', domain: 'nike.com' },
  'nike.com/gb/en_gb/': { storeId: 'nike_uk', name: 'Nike UK', domain: 'nike.com' },
  'nike.com/checkout/': { storeId: 'nike_checkout', name: 'Nike Checkout', domain: 'nike.com', isCheckout: true },

  // Big Retailers
  'target.com/': { storeId: 'target', name: 'Target', domain: 'target.com' },
  'target.com/co-cart': { storeId: 'target_cart', name: 'Target Cart', domain: 'target.com', isCheckout: true },
  'amazon.com/': { storeId: 'amazon_us', name: 'Amazon', domain: 'amazon.com' },
  'amazon.co.uk/': { storeId: 'amazon_uk', name: 'Amazon UK', domain: 'amazon.co.uk' },
  'walmart.com/': { storeId: 'walmart', name: 'Walmart', domain: 'walmart.com' },
  'bestbuy.com/': { storeId: 'bestbuy', name: 'Best Buy', domain: 'bestbuy.com' },
  'apple.com/': { storeId: 'apple', name: 'Apple', domain: 'apple.com' },
  'sephora.com/': { storeId: 'sephora', name: 'Sephora', domain: 'sephora.com' },
  'ebay.com/': { storeId: 'ebay', name: 'eBay', domain: 'ebay.com' },
  'nordstrom.com/': { storeId: 'nordstrom', name: 'Nordstrom', domain: 'nordstrom.com' },
  'macys.com/': { storeId: 'macys', name: "Macy's", domain: 'macys.com' },
  'gap.com/': { storeId: 'gap', name: 'Gap', domain: 'gap.com' },
  'oldnavy.gap.com/': { storeId: 'oldnavy', name: 'Old Navy', domain: 'gap.com' },

  // Local / Testing Fallback
  'example.com/': { storeId: 'example', name: 'Example Store', domain: 'example.com' },
  'example.com/cart/': { storeId: 'example_cart', name: 'Example Cart', domain: 'example.com', isCheckout: true },
};

/**
 * Checks if a path indicates checkout or cart activity.
 */
export function isCheckoutPath(path) {
  if (!path) return false;
  return /(checkout|cart|basket|bag|pay|order-summary|payment)/i.test(path);
}

/**
 * High-level store resolution entrypoint (Honey's getStoreByUrl / findStoreIdForUrl).
 * Resolves any raw URL into a normalized store profile with best partial match.
 *
 * @param {string} url
 * @param {Record<string, any>} [extraPartials]
 */
export function resolveStoreFromUrl(url, extraPartials = {}) {
  if (!url) return null;
  let normalized;
  try {
    normalized = normalizeUrl(url);
  } catch {
    return null;
  }

  // Combine curated catalog with dynamic/extra partials
  const combinedPartials = { ...SUPPORTED_STORE_PARTIALS, ...extraPartials };
  const matched = matchStorePartials(combinedPartials, normalized);

  const cleanStoreName = normalized.topLevelDomain && normalized.domain.endsWith(`.${normalized.topLevelDomain}`)
    ? normalized.domain.slice(0, -(normalized.topLevelDomain.length + 1))
    : normalized.domain.replace(/\.[^.]+$/, '');
  const isCheckout = (matched?.storeMeta?.isCheckout) || isCheckoutPath(normalized.path);

  if (matched) {
    const meta = typeof matched.storeMeta === 'object' ? matched.storeMeta : {};
    return {
      found: true,
      storeId: matched.storeId,
      name: meta.name || cleanStoreName.charAt(0).toUpperCase() + cleanStoreName.slice(1),
      domain: meta.domain || normalized.domain,
      partialUrl: matched.partialUrl,
      rawHostname: normalized.rawHostname,
      isCheckout,
      normalized,
    };
  }

  // Graceful fallback for any valid domain not explicitly registered in partials
  return {
    found: false,
    storeId: normalized.domain,
    name: cleanStoreName.charAt(0).toUpperCase() + cleanStoreName.slice(1),
    domain: normalized.domain,
    partialUrl: `${normalized.domain}/`,
    rawHostname: normalized.rawHostname,
    isCheckout,
    normalized,
  };
}
