// Test suite for Honey store resolution & matching algorithm
import assert from 'node:assert/strict';
import {
  parseDomainParts,
  normalizePath,
  normalizeUrl,
  matchStorePartials,
  resolveStoreFromUrl,
  SUPPORTED_STORE_PARTIALS,
} from '../src/lib/store-matcher.js';

console.log('🧪 Running Honey store-matcher tests...\n');

// 1. Domain & TLD extraction (Honey Public Suffix List logic)
console.log('Test 1: Domain & Multi-part TLD extraction');
{
  const r1 = parseDomainParts('store.nike.com');
  assert.equal(r1.domain, 'nike.com');
  assert.equal(r1.topLevelDomain, 'com');

  const r2 = parseDomainParts('www.amazon.co.uk');
  assert.equal(r2.domain, 'amazon.co.uk');
  assert.equal(r2.topLevelDomain, 'co.uk');

  const r3 = parseDomainParts('checkout.shoes.com.au');
  assert.equal(r3.domain, 'shoes.com.au');
  assert.equal(r3.topLevelDomain, 'com.au');

  console.log('  ✓ Multi-part TLD & base domain parsed correctly.');
}

// 2. SPA Hash-Path Normalization (Honey g({ pathname, hash }))
console.log('Test 2: SPA Hash-Path Normalization');
{
  assert.equal(normalizePath({ pathname: '/', hash: '#/checkout' }), '/checkout/');
  assert.equal(normalizePath({ pathname: '/cart', hash: '' }), '/cart/');
  assert.equal(normalizePath({ pathname: '/checkout/review/', hash: '' }), '/checkout/review/');
  console.log('  ✓ SPA hash-path rewritten with guaranteed trailing slash.');
}

// 3. Full URL Normalization (Honey y(e))
console.log('Test 3: URL Normalization y(e)');
{
  const norm1 = normalizeUrl('https://Store.Nike.com/#/checkout?ref=honey');
  assert.equal(norm1.host, '.store.nike.com');
  assert.equal(norm1.path, '/checkout/');
  assert.equal(norm1.domain, 'nike.com');
  assert.equal(norm1.topLevelDomain, 'com');

  // Protocol rejection
  assert.throws(() => normalizeUrl('ftp://nike.com'), /invalid hostname, pathname, or protocol/i);
  console.log('  ✓ URL normalized with leading-dot host and protocol validation.');
}

// 4. Exact Matching & Longest-Prefix Tie Breaker (Honey v(e, t))
console.log('Test 4: Specificity & Matching Algorithm v(e, t)');
{
  const partials = {
    'nike.com/': { storeId: 'nike_root', name: 'Nike' },
    'store.nike.com/': { storeId: 'nike_store', name: 'Nike Store' },
    'nike.com/gb/en_gb/': { storeId: 'nike_uk', name: 'Nike UK' },
  };

  // Subdomain beats root domain (longer host string)
  const normSub = normalizeUrl('https://store.nike.com/products/shoe');
  const matchSub = matchStorePartials(partials, normSub);
  assert.equal(matchSub.storeId, 'nike_store', 'store.nike.com/ should beat nike.com/');

  // Deeper path beats shallow path (longer path string)
  const normPath = normalizeUrl('https://nike.com/gb/en_gb/sale');
  const matchPath = matchStorePartials(partials, normPath);
  assert.equal(matchPath.storeId, 'nike_uk', 'nike.com/gb/en_gb/ should beat nike.com/');

  // Root fallback when neither subdomain nor deeper path matches
  const normRoot = normalizeUrl('https://nike.com/us/en_us/just-do-it');
  const matchRoot = matchStorePartials(partials, normRoot);
  assert.equal(matchRoot.storeId, 'nike_root', 'nike.com/ should match generic root path');

  console.log('  ✓ Longest-prefix specificity tie-breakers verified.');
}

// 5. High-level resolveStoreFromUrl integration
console.log('Test 5: High-level store resolution');
{
  const resTarget = resolveStoreFromUrl('https://www.target.com/co-cart');
  assert.equal(resTarget.found, true);
  assert.equal(resTarget.domain, 'target.com');
  assert.equal(resTarget.isCheckout, true);

  const resUnknown = resolveStoreFromUrl('https://boutique-sneakers.co.uk/collections/all');
  assert.equal(resUnknown.found, false);
  assert.equal(resUnknown.domain, 'boutique-sneakers.co.uk');
  assert.equal(resUnknown.name, 'Boutique-sneakers');

  console.log('  ✓ Target resolved as checkout store; unknown store gracefully resolved.');
}

console.log('\n🎉 All Honey store-matcher tests passed successfully!');
