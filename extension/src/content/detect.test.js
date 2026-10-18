// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findTotal, readCheckout, scoreCheckout } from "./detect.js";

// jsdom has no layout; size images from their width/height attributes.
beforeAll(() => {
  HTMLImageElement.prototype.getBoundingClientRect = function () {
    const width = Number(this.getAttribute("width") ?? 56);
    const height = Number(this.getAttribute("height") ?? 56);
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  };
});

function page(html, href) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, url: new URL(href) };
}

function detect(html, href) {
  const { doc, url } = page(html, href);
  const result = scoreCheckout(doc, url);
  return { ...result, cart: result.isCheckout ? readCheckout(doc, url, result.site) : null };
}

describe("checkouts that should trigger", () => {
  it("demo store", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../../demo/checkout.html"), "utf8");
    const r = detect(html, "http://localhost:4321/checkout.html");
    expect(r.isCheckout).toBe(true);
    expect(r.cart).toMatchObject({ store: "Outdoor Store", total: "$128.00", itemCount: 1 });
    expect(r.cart.items[0].name).toBe("Insulated water bottle");
  });

  it("Shopify checkout", () => {
    const r = detect(
      `<html><head><title>Information - Acme Goods - Checkout</title>
        <link rel="stylesheet" href="https://cdn.shopify.com/checkout.css"></head>
      <body>
        <h2>Contact</h2><input autocomplete="email">
        <aside><div role="table">
          <div role="row"><img alt="Canvas tote" src="tote.jpg"><span>Canvas tote</span><span>$45.00</span></div>
          <div role="row"><span>Subtotal</span><span>$45.00</span></div>
          <div role="row"><span>Total</span><span>USD $45.00</span></div>
        </div></aside>
        <button>Continue to shipping</button>
      </body></html>`,
      "https://acme-goods.com/checkouts/cn/Z2NwLXVzLWVhc3Qx/information"
    );
    expect(r.site?.id).toBe("shopify");
    expect(r.cart).toMatchObject({ store: "Acme Goods", total: "$45.00" });
    expect(r.cart.items[0].name).toBe("Canvas tote");
  });

  it("WooCommerce checkout", () => {
    const r = detect(
      `<html><body class="woocommerce-checkout woocommerce-page">
        <table class="shop_table"><tbody>
          <tr class="cart_item"><td><img width="40" height="40" alt="Trail socks" src="socks.jpg"> Trail socks × 2</td><td>$24.00</td></tr>
        </tbody><tfoot>
          <tr class="order-total"><th>Total</th><td><span class="woocommerce-Price-amount">$29.99</span></td></tr>
        </tfoot></table>
        <button type="submit">Place order</button>
      </body></html>`,
      "https://socks.example/checkout/"
    );
    expect(r.site?.id).toBe("woocommerce");
    expect(r.cart.total).toBe("$29.99");
  });

  it("Amazon checkout", () => {
    const r = detect(
      `<html><head><title>Amazon.com Checkout</title></head><body>
        <table id="subtotals-marketplace-table">
          <tr><td>Items:</td><td>$21.99</td></tr>
          <tr><td>Shipping &amp; handling:</td><td>$0.00</td></tr>
          <tr><td class="a-color-price">Order total:</td><td class="a-color-price grand-total-price">$23.47</td></tr>
        </table>
        <input type="submit" value="Place your order">
      </body></html>`,
      "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1"
    );
    expect(r.site?.id).toBe("amazon");
    expect(r.cart).toMatchObject({ store: "Amazon", total: "$23.47" });
  });

  it("generic checkout with no checkout URL", () => {
    const r = detect(
      `<html><head><title>Northwind</title></head><body>
        <h1>Checkout</h1>
        <input autocomplete="shipping address-line1">
        <div class="summary"><div><span>Total</span><span>$80.00</span></div></div>
        <button>Place order</button>
      </body></html>`,
      "https://northwind.example/s/flow"
    );
    expect(r.isCheckout).toBe(true);
    expect(r.cart).toMatchObject({ store: "Northwind", total: "$80.00" });
  });

  it("checkout on a payment subdomain with card iframes", () => {
    const r = detect(
      `<html><body>
        <iframe src="https://js.stripe.com/v3/elements-inner-card-8a.html#name=cardNumber"></iframe>
        <div>Total due <b>€42,50</b></div>
        <button>Pay €42,50</button>
      </body></html>`,
      "https://pay.example.eu/session/123"
    );
    expect(r.isCheckout).toBe(true);
    expect(r.cart.total).toBe("€42,50");
  });
});

describe("item names without product images", () => {
  it("reads names from product-title elements", () => {
    const r = detect(
      `<html><head><title>Checkout - Best Buy</title></head><body>
        <h1>Checkout</h1>
        <section class="order-summary">
          <ul>
            <li class="cart-item"><span class="item-title">Sony WH-1000XM6 Wireless Headphones</span><span>$449.99</span></li>
            <li class="cart-item"><span class="item-title">USB-C Charging Cable (6 ft)</span><span>$19.99</span></li>
          </ul>
          <div><span>Subtotal</span><span>$469.98</span></div>
          <div><span>Total</span><span>$503.29</span></div>
        </section>
        <button>Place your order</button>
      </body></html>`,
      "https://www.bestbuy.com/checkout/c/standard"
    );
    expect(r.cart.total).toBe("$503.29");
    expect(r.cart.items.map((i) => i.name)).toEqual(["Sony WH-1000XM6 Wireless Headphones", "USB-C Charging Cable (6 ft)"]);
    expect(r.cart.items[0].price).toBe("$449.99");
    expect(r.cart.itemCount).toBe(2);
  });
});

describe("pages that should not trigger", () => {
  it("product page with express-pay buttons", () => {
    const r = detect(
      `<html><body>
        <h1>Ceramic mug</h1><span>$18.00</span>
        <button>Add to cart</button><button>Buy now</button>
        <iframe src="https://www.paypal.com/smart/buttons?style.label=pay"></iframe>
        <iframe src="https://js.stripe.com/v3/controller-with-preconnect.html"></iframe>
      </body></html>`,
      "https://shop.example/products/ceramic-mug"
    );
    expect(r.isCheckout).toBe(false);
  });

  it("cart page", () => {
    const r = detect(
      `<html><body><h1>Your cart</h1>
        <div><span>Subtotal</span><span>$40.00</span></div>
        <button>Proceed to checkout</button>
      </body></html>`,
      "https://shop.example/cart"
    );
    expect(r.isCheckout).toBe(false);
  });

  it("blog post about checkout", () => {
    const r = detect(
      `<html><head><meta property="og:type" content="article"></head><body>
        <article><h1>Checkout optimization tips</h1><p>Make your checkout fast.</p></article>
      </body></html>`,
      "https://blog.example/posts/checkout-tips"
    );
    expect(r.isCheckout).toBe(false);
  });
});

describe("findTotal", () => {
  it("prefers the order total over subtotal and estimates", () => {
    const { doc } = page(
      `<body>
        <div><span>Subtotal</span><span>$100.00</span></div>
        <div><span>Total savings</span><span>$5.00</span></div>
        <div><span>Estimated total</span><span>$108.00</span></div>
        <div><span>Order total</span><span>$110.25</span></div>
      </body>`,
      "https://x.example/checkout"
    );
    expect(findTotal(doc).amount).toBe("$110.25");
  });

  it("reads inline 'Total: $X' labels and thousands separators", () => {
    const { doc } = page(`<body><p>Total: $1,249.00</p></body>`, "https://x.example/checkout");
    expect(findTotal(doc).amount).toBe("$1,249.00");
  });
});
