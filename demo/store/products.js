const PRODUCTS = [
  {
    id: "prod-headphones",
    name: "EchoPulse Sport Headphones",
    category: "Electronics",
    price: 89.0,
    rating: 4.8,
    reviews: 142,
    description: "Sweat-resistant, active noise-canceling over-ear headphones built for intense workouts and marathon runs.",
    tag: "Trending",
    icon: "🎧"
  },
  {
    id: "prod-hoodie",
    name: "CloudKnit Heavyweight Hoodie",
    category: "Apparel",
    price: 65.0,
    rating: 4.9,
    reviews: 310,
    description: "450gsm organic cotton fleece with ribbed side panels and an oversized cozy drape.",
    tag: "Popular",
    icon: "🧥"
  },
  {
    id: "prod-sneakers",
    name: "AeroStride Marathon Sneakers",
    category: "Footwear",
    price: 120.0,
    rating: 4.7,
    reviews: 89,
    description: "Carbon-plated road racing shoes engineered for maximum energy return and breathability.",
    tag: "New",
    icon: "👟"
  },
  {
    id: "prod-flask",
    name: "Thermal Hydro Flask 32oz",
    category: "Accessories",
    price: 38.0,
    rating: 4.9,
    reviews: 520,
    description: "Triple-vacuum insulated stainless steel bottle keeping beverages ice cold for up to 36 hours.",
    tag: "Essential",
    icon: "🍶"
  }
];

class CartManager {
  constructor() {
    this.storageKey = "squirrel_demo_cart";
    this.cart = this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.cart));
    window.dispatchEvent(new CustomEvent("cart-updated", { detail: this.cart }));
  }

  addItem(productId) {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) return;

    const existing = this.cart.find((item) => item.id === productId);
    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        icon: product.icon
      });
    }
    this.save();
  }

  removeItem(productId) {
    this.cart = this.cart.filter((item) => item.id !== productId);
    this.save();
  }

  updateQty(productId, qty) {
    const item = this.cart.find((i) => i.id === productId);
    if (!item) return;
    if (qty <= 0) {
      this.removeItem(productId);
    } else {
      item.qty = qty;
      this.save();
    }
  }

  clear() {
    this.cart = [];
    this.save();
  }

  getTotal() {
    return this.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  getCount() {
    return this.cart.reduce((sum, item) => sum + item.qty, 0);
  }
}

window.cartManager = new CartManager();
