// On-page coupon-field detection, accordion expanding, React-safe typing,
// price-diff detection, and autonomous auto-apply runner agent.
// Injected on demand via chrome.scripting.executeScript.
//
// Wrapped in an IIFE so multiple injections into the same tab never collide.
(() => {
  const COUPON_FIELD_SELECTORS = [
    'input[name*="coupon" i]',
    'input[name*="promo" i]',
    'input[name*="discount" i]',
    'input[id*="coupon" i]',
    'input[id*="promo" i]',
    'input[id*="discount" i]',
    'input[placeholder*="coupon" i]',
    'input[placeholder*="promo code" i]',
    'input[placeholder*="discount code" i]',
    'input[aria-label*="coupon" i]',
    'input[aria-label*="promo" i]',
    'input[aria-label*="discount" i]',
  ];

  const ACCORDION_TRIGGER_REGEX = /have a promo|add (a )?(promo|discount|coupon)|promo code|discount code|gift card|coupon code|enter (a )?(promo|discount)|have a discount/i;

  function storeName() {
    return location.hostname.replace(/^www\./, '');
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function findDirectCouponField() {
    for (const selector of COUPON_FIELD_SELECTORS) {
      const candidates = document.querySelectorAll(selector);
      for (const el of candidates) {
        if (isElementVisible(el)) return el;
      }
    }
    // Also check hidden/collapsed fields as fallback
    for (const selector of COUPON_FIELD_SELECTORS) {
      const field = document.querySelector(selector);
      if (field) return field;
    }
    return null;
  }

  /**
   * 1. Smart Accordion Expander:
   * If no visible promo input exists, search for collapsible trigger buttons/summaries/links,
   * click to expand, and wait up to 900ms for the input to appear.
   */
  async function ensurePromoFieldVisible() {
    let field = findDirectCouponField();
    if (field && isElementVisible(field)) {
      return { found: true, field, selector: field.name || field.id || 'promo-input', store: storeName(), expanded: false };
    }

    // Look for collapsible trigger
    const clickableCandidates = document.querySelectorAll('button, a, summary, [role="button"], span, div');
    let trigger = null;
    for (const el of clickableCandidates) {
      if (el.children.length > 3) continue; // Skip broad container wrappers
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (text.length > 2 && text.length < 60 && ACCORDION_TRIGGER_REGEX.test(text)) {
        if (isElementVisible(el)) {
          trigger = el;
          break;
        }
      }
    }

    if (trigger) {
      trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
      trigger.click();

      // Wait up to 900ms for promo field to appear
      const start = Date.now();
      while (Date.now() - start < 900) {
        await new Promise((r) => setTimeout(r, 80));
        field = findDirectCouponField();
        if (field && isElementVisible(field)) {
          return { found: true, field, selector: field.name || field.id || 'promo-input', store: storeName(), expanded: true };
        }
      }
    }

    return { found: !!field, field: field || null, selector: field?.name || field?.id || null, store: storeName(), expanded: !!trigger };
  }

  function detectCouponField() {
    const field = findDirectCouponField();
    return {
      found: !!field,
      selector: field ? (field.name || field.id || 'input[promo]') : null,
      store: storeName(),
    };
  }

  function extractDollarNear(label) {
    const re = new RegExp(`${label}[^$]{0,35}\\$\\s?([\\d,]+\\.\\d{2})`, 'i');
    const match = (document.body?.innerText || '').match(re);
    return match ? parseFloat(match[1].replace(/,/g, '')) : null;
  }

  function detectCartTotals() {
    const cartTotal = extractDollarNear('subtotal') ?? extractDollarNear('total') ?? extractDollarNear('order total');
    const shipping = extractDollarNear('shipping');
    return { cartTotal, shipping: shipping ?? (cartTotal != null ? 0 : null) };
  }

  function findApplyButton(field) {
    if (!field) return null;
    const scope = field.closest('form') || field.parentElement?.closest('div') || field.parentElement?.parentElement || document.body || document.documentElement;
    if (!scope) return null;
    const candidates = scope.querySelectorAll('button, input[type="submit"], [role="button"]');
    const labelRe = /apply|redeem|submit|arrow_forward/i;

    for (const el of candidates) {
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
      if (labelRe.test(text)) return el;
    }

    // Fallback: any submit button in parent form
    const formBtn = scope.querySelector('button[type="submit"], input[type="submit"]');
    if (formBtn) return formBtn;

    return document.querySelector('button[id*="coupon" i], button[id*="promo" i], button[class*="promo" i], button[class*="coupon" i]');
  }

  /**
   * Remove any previously applied coupon chip/tag before testing next code
   */
  async function removeAppliedCouponIfNeeded() {
    const removeCandidates = document.querySelectorAll('button, a, [role="button"], span');
    for (const el of removeCandidates) {
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (/^(\u00d7|x|remove|delete|clear)$/i.test(text) || /remove (coupon|promo|code|discount)/i.test(text)) {
        if (el.closest('[class*="promo" i], [class*="coupon" i], [class*="discount" i], [id*="promo" i], [id*="coupon" i], form, .cart-summary')) {
          el.click();
          await new Promise((r) => setTimeout(r, 450));
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 2. React-safe typing and visual outline feedback
   */
  async function applyCouponOnPage(code) {
    const visibility = await ensurePromoFieldVisible();
    const field = visibility.field || findDirectCouponField();
    if (!field) return { applied: false, reason: 'no coupon field found on this page' };

    field.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Subtle visual highlight so user sees the live agent typing
    const prevOutline = field.style.outline;
    const prevShadow = field.style.boxShadow;
    field.style.outline = '2px solid #2f6b4f';
    field.style.boxShadow = '0 0 8px rgba(47, 107, 79, 0.45)';

    field.focus();

    // React 16+ safe value setter (bypasses virtual DOM getter/setter overrides)
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(field, code);
    } else {
      field.value = code;
    }

    // Fire complete event pipeline
    field.dispatchEvent(new Event('focus', { bubbles: true }));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    const button = findApplyButton(field);
    if (button) {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      button.click();
    }

    setTimeout(() => {
      if (field) {
        field.style.outline = prevOutline;
        field.style.boxShadow = prevShadow;
      }
    }, 700);

    return {
      applied: true,
      hasButton: !!button,
      reason: button ? 'Filled field and clicked Apply' : 'Filled field (pressed enter)',
    };
  }

  /**
   * 3. Price-diff and mutation detector:
   * Compares cart total before and after code application, detecting inline validation messages
   */
  async function waitForCouponResult(code, baselineTotal, timeoutMs = 2800) {
    const start = Date.now();
    let initialTotals = baselineTotal != null ? baselineTotal : detectCartTotals().cartTotal;

    // Wait for mutations or total diff
    await new Promise((resolve) => {
      let resolved = false;
      let lastMutation = Date.now();

      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });

      const checkTimer = setInterval(() => {
        const elapsed = Date.now() - start;
        const settled = Date.now() - lastMutation >= 400;

        // Check if status text appeared
        const textSample = (document.body?.innerText || '').slice(0, 15000);
        const hasSuccess = /code applied|promo applied|discount applied|savings applied|coupon applied/i.test(textSample);
        const hasError = /invalid code|invalid promo|expired|not eligible|not recognized|not valid|coupon not found/i.test(textSample);

        const currentTotal = detectCartTotals().cartTotal;
        const totalChanged = initialTotals != null && currentTotal != null && currentTotal !== initialTotals;

        if ((settled && (hasSuccess || hasError || totalChanged)) || elapsed >= timeoutMs) {
          if (!resolved) {
            resolved = true;
            clearInterval(checkTimer);
            observer.disconnect();
            resolve();
          }
        }
      }, 100);
    });

    const finalTotals = detectCartTotals().cartTotal;
    const discount = (initialTotals != null && finalTotals != null && initialTotals > finalTotals)
      ? Math.round((initialTotals - finalTotals) * 100) / 100
      : 0;

    const pageText = (document.body?.innerText || '').slice(0, 15000);
    const hasError = /invalid (promo|coupon|code)|expired|not eligible|not recognized|cannot be applied/i.test(pageText);

    const valid = discount > 0 || (!hasError && /applied|savings/i.test(pageText));

    return {
      code,
      valid,
      beforeTotal: initialTotals,
      afterTotal: finalTotals,
      discountApplied: discount,
      reason: discount > 0 ? `Saved $${discount.toFixed(2)}` : (valid ? 'Applied' : 'Invalid or no savings'),
    };
  }

  /**
   * 4. Scoped Floating On-Page Overlay (Shadow DOM)
   */
  class CouponAgentOverlay {
    constructor() {
      this.host = document.getElementById('dubhacks26-coupon-agent-host');
      if (this.host) {
        this.host.remove();
      }
      this.host = document.createElement('div');
      this.host.id = 'dubhacks26-coupon-agent-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      document.body.appendChild(this.host);
      this.aborted = false;
      this.renderBase();
    }

    renderBase() {
      this.shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          .card {
            width: 330px;
            background: #141f19;
            color: #f3f4f6;
            border: 1px solid rgba(47, 107, 79, 0.45);
            border-radius: 16px;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.45), 0 0 1px 1px rgba(255, 255, 255, 0.08);
            padding: 16px;
            box-sizing: border-box;
            backdrop-filter: blur(12px);
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes slideIn {
            from { transform: translateY(-16px) scale(0.96); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 700;
            color: #4ade80;
          }
          .brand-badge {
            background: #2f6b4f;
            color: #fff;
            padding: 2px 7px;
            border-radius: 999px;
            font-size: 10px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .close-btn {
            background: transparent;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 4px;
          }
          .close-btn:hover { color: #fff; }
          .title {
            font-size: 15px;
            font-weight: 700;
            margin: 0 0 4px 0;
            color: #fff;
          }
          .subtitle {
            font-size: 12px;
            color: #9ca3af;
            margin: 0 0 12px 0;
          }
          .progress-bar-bg {
            background: rgba(255, 255, 255, 0.1);
            height: 6px;
            border-radius: 999px;
            overflow: hidden;
            margin-bottom: 12px;
          }
          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #10b981, #34d399);
            width: 0%;
            transition: width 0.35s ease;
          }
          .log-list {
            max-height: 130px;
            overflow-y: auto;
            margin: 0 0 12px 0;
            padding: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .log-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 12px;
            padding: 6px 10px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.05);
          }
          .log-code {
            font-family: monospace;
            font-weight: 700;
            color: #fff;
          }
          .badge-success { color: #4ade80; font-weight: 600; }
          .badge-fail { color: #9ca3af; font-size: 11px; }
          .badge-testing { color: #fbbf24; font-weight: 600; animation: pulse 1s infinite; }
          @keyframes pulse { 50% { opacity: 0.5; } }
          .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 10px;
          }
          .stop-btn {
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #fca5a5;
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
          }
          .stop-btn:hover { background: rgba(239, 68, 68, 0.35); }
          .status-note { font-size: 11px; color: #9ca3af; }
          .victory-card {
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid #10b981;
            border-radius: 10px;
            padding: 10px;
            margin-bottom: 12px;
            text-align: center;
          }
          .victory-amount {
            font-size: 20px;
            font-weight: 800;
            color: #34d399;
          }
        </style>
        <div class="card">
          <div class="header">
            <div class="brand">
              <svg viewBox="0 0 32 32" width="18" height="18" fill="none">
                <rect x="2" y="2" width="28" height="28" rx="8" fill="#2f6b4f" />
                <path d="M9 14 Q16 22 23 14" stroke="#fdfaf4" stroke-width="3" stroke-linecap="round" />
              </svg>
              <span>Pocket Agent</span>
              <span class="brand-badge">Auto-Tester</span>
            </div>
            <button class="close-btn" id="agent-close">&times;</button>
          </div>
          <div id="agent-body">
            <h3 class="title" id="agent-title">Testing Available Coupons</h3>
            <p class="subtitle" id="agent-subtitle">Scanning for promo input & applying codes...</p>
            <div class="progress-bar-bg"><div class="progress-bar-fill" id="agent-progress"></div></div>
            <ul class="log-list" id="agent-log"></ul>
            <div class="footer">
              <span class="status-note" id="agent-footer-note">Testing live against checkout</span>
              <button class="stop-btn" id="agent-stop">Stop</button>
            </div>
          </div>
        </div>
      `;

      this.shadow.getElementById('agent-close').addEventListener('click', () => this.destroy());
      this.shadow.getElementById('agent-stop').addEventListener('click', () => {
        this.aborted = true;
        this.shadow.getElementById('agent-title').textContent = 'Stopping agent...';
        this.shadow.getElementById('agent-stop').disabled = true;
      });
    }

    setProgress(percent, title, subtitle) {
      const progressEl = this.shadow.getElementById('agent-progress');
      if (progressEl) progressEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      if (title) this.shadow.getElementById('agent-title').textContent = title;
      if (subtitle) this.shadow.getElementById('agent-subtitle').textContent = subtitle;
    }

    addTestingLog(code) {
      const list = this.shadow.getElementById('agent-log');
      const li = document.createElement('li');
      li.id = `log-${code}`;
      li.className = 'log-item';
      li.innerHTML = `
        <span class="log-code">${code}</span>
        <span class="badge-testing">Testing...</span>
      `;
      list.appendChild(li);
      list.scrollTop = list.scrollHeight;
    }

    updateLogResult(code, result) {
      const li = this.shadow.getElementById(`log-${code}`);
      if (!li) return;
      if (result.discountApplied > 0) {
        li.innerHTML = `
          <span class="log-code">${code}</span>
          <span class="badge-success">Saved $${result.discountApplied.toFixed(2)}</span>
        `;
      } else if (result.valid) {
        li.innerHTML = `
          <span class="log-code">${code}</span>
          <span class="badge-success">Applied</span>
        `;
      } else {
        li.innerHTML = `
          <span class="log-code">${code}</span>
          <span class="badge-fail">No discount</span>
        `;
      }
    }

    showVictory(bestCoupon, maxSavings, finalTotal) {
      const body = this.shadow.getElementById('agent-body');
      body.innerHTML = `
        <div class="victory-card">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#a7f3d0; margin-bottom:2px;">Best Deal Applied</div>
          <div class="victory-amount">${maxSavings > 0 ? `Saved $${maxSavings.toFixed(2)}` : 'Best Code Applied'}</div>
          <div style="font-size:13px; font-weight:700; color:#fff; margin-top:2px;">Code: ${bestCoupon.code}</div>
          ${finalTotal != null ? `<div style="font-size:11px; color:#d1fae5; margin-top:4px;">New Checkout Total: $${finalTotal.toFixed(2)}</div>` : ''}
        </div>
        <p class="subtitle" style="text-align:center; margin-bottom:12px;">We re-applied the best code so your checkout is ready!</p>
        <button id="agent-done" style="width:100%; padding:9px; background:#10b981; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">Done</button>
      `;
      this.shadow.getElementById('agent-done')?.addEventListener('click', () => this.destroy());
      setTimeout(() => this.destroy(), 8000);
    }

    showNoneFound() {
      const body = this.shadow.getElementById('agent-body');
      body.innerHTML = `
        <p class="title" style="margin-top:6px;">No working codes</p>
        <p class="subtitle">None of the available codes applied extra savings to this order.</p>
        <button id="agent-done" style="width:100%; padding:9px; background:#374151; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">Close</button>
      `;
      this.shadow.getElementById('agent-done')?.addEventListener('click', () => this.destroy());
      setTimeout(() => this.destroy(), 4000);
    }

    destroy() {
      if (this.host) {
        this.host.remove();
        this.host = null;
      }
    }
  }

  /**
   * 5. Main Auto-Apply Loop:
   * Sequentially tests available coupons, updates overlay, and re-applies winner
   */
  async function runAutoApplyLoop(coupons = []) {
    if (!coupons || coupons.length === 0) {
      return { success: false, reason: 'No coupons provided to test' };
    }

    const overlay = new CouponAgentOverlay();
    const results = [];
    const initialTotals = detectCartTotals().cartTotal;
    let bestCoupon = null;
    let maxSavings = 0;
    let lastAppliedCode = null;

    overlay.setProgress(5, 'Preparing Checkout', 'Ensuring promo box is open...');
    await ensurePromoFieldVisible();
    await new Promise((r) => setTimeout(r, 400));

    for (let i = 0; i < coupons.length; i++) {
      if (overlay.aborted) {
        break;
      }

      const c = coupons[i];
      const percent = Math.round(((i) / coupons.length) * 100);
      overlay.setProgress(percent, `Testing Code ${i + 1} of ${coupons.length}`, `Trying "${c.code}"...`);
      overlay.addTestingLog(c.code);

      // Remove existing code if testing second or later code
      if (i > 0) {
        await removeAppliedCouponIfNeeded();
      }

      const applyRes = await applyCouponOnPage(c.code);
      if (!applyRes.applied) {
        const failResult = { code: c.code, valid: false, discountApplied: 0, reason: applyRes.reason };
        results.push(failResult);
        overlay.updateLogResult(c.code, failResult);
        continue;
      }

      lastAppliedCode = c.code;

      // Observe response and price diff
      const evalResult = await waitForCouponResult(c.code, initialTotals, 2600);
      results.push(evalResult);
      overlay.updateLogResult(c.code, evalResult);

      if (evalResult.discountApplied > maxSavings) {
        maxSavings = evalResult.discountApplied;
        bestCoupon = c;
      } else if (evalResult.valid && !bestCoupon) {
        bestCoupon = c;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    overlay.setProgress(100, 'Finishing up', 'Finalizing savings...');

    // If best code was not the last one tested, re-apply the winner!
    if (bestCoupon && lastAppliedCode !== bestCoupon.code) {
      await removeAppliedCouponIfNeeded();
      await applyCouponOnPage(bestCoupon.code);
      await new Promise((r) => setTimeout(r, 600));
    }

    const finalTotals = detectCartTotals().cartTotal;

    if (bestCoupon && (maxSavings > 0 || results.some((r) => r.valid))) {
      overlay.showVictory(bestCoupon, maxSavings, finalTotals);
    } else {
      overlay.showNoneFound();
    }

    return {
      success: true,
      bestCoupon,
      maxSavings,
      initialTotal: initialTotals,
      finalTotal: finalTotals,
      results,
    };
  }

  // Attach hooks for background scripts, popup, and content script triggers
  const api = {
    detectCouponField,
    ensurePromoFieldVisible,
    detectCartTotals,
    applyCouponOnPage,
    waitForCouponResult,
    removeAppliedCouponIfNeeded,
    runAutoApplyLoop,
  };

  window.__pocketCoupon = api;
  window.__dubhacksCouponFinder = api;
  window.__applyCouponToPage = applyCouponOnPage;

  return { ...detectCouponField(), ...detectCartTotals() };
})();
