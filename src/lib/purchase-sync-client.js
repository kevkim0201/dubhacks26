// The Supabase side of purchase-sync.js: the `client` that
// flushPurchaseSync() sends queued work through.
// Owned by: Deetya.
//
// Kept apart from purchase-sync.js because importing supabase.js also
// imports supabaseConfig.js, which is gitignored -- only import this from
// pages that already load supabase.js (the dashboard), never from the
// service worker, or a missing config would stop the whole worker.
import { callRpc, deleteFrom, getSession, insertInto, selectFrom, updateTable } from './supabase.js';
import { userIdFromToken } from './purchase-sync.js';

export const supabaseSyncClient = {
  /** The signed-in user's id, or null when signed out. No network call. */
  async getUserId() {
    const session = await getSession();
    return userIdFromToken(session?.access_token);
  },

  /** Inserts one row and returns it (with the id the database picked). */
  async insertPurchase(row) {
    const [inserted] = await insertInto('purchases', row);
    return inserted;
  },

  /** Finds a row matching an insert whose response never arrived. */
  async findPurchase(row) {
    const [match] = await selectFrom('purchases', {
      select: 'id',
      filters: {
        title: `eq.${row.title}`,
        purchase_date: `eq.${row.purchase_date}`,
        price_paid: `eq.${row.price_paid}`,
      },
      limit: 1,
    });
    return match?.id ?? null;
  },

  async updatePurchase(remoteId, patch) {
    await updateTable('purchases', { filters: { id: remoteId }, patch });
  },

  async deletePurchase(remoteId) {
    await deleteFrom('purchases', { filters: { id: remoteId } });
  },

  /** Sets the row's status/acorns; safe to call again. */
  async validatePurchase(remoteId) {
    return callRpc('validate_purchase', { p_purchase_id: remoteId });
  },
};
