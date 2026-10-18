// Pip looking for a better price after a checkout conversation (backend /api/deal-checks).
import { apiFetch, apiStream } from "./api.js";

// trigger "buy" = right now; "wait" = scheduled for 24h later (the backend also does this itself).
export async function scheduleDealChecks(sessionId, trigger) {
  const { checks } = await apiFetch("/api/deal-checks", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, trigger }),
  });
  return checks;
}

export async function listDealChecks() {
  const { checks } = await apiFetch("/api/deal-checks");
  return checks;
}

export function markDealCheckSeen(id) {
  return apiFetch(`/api/deal-checks/${encodeURIComponent(id)}/seen`, { method: "POST" });
}

/**
 * Runs one check and streams Pip's progress.
 * @param {(message: string) => void} onStep
 * @returns {Promise<object>} the DealResponse
 */
export async function runDealCheck(id, onStep = () => {}) {
  let result = null;
  let error = null;
  await apiStream(`/api/deal-checks/${encodeURIComponent(id)}/run`, { method: "POST" }, (type, data) => {
    if (type === "step") onStep(data.message);
    else if (type === "result") result = data;
    else if (type === "error") error = data.message;
  });
  if (!result) throw new Error(error ?? "Pip couldn't finish this check.");
  return result;
}
