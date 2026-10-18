import { apiFetch } from "./api.js";

// Backend: backend/app/routers/quests.py and forest.py.

export function getQuests() {
  return apiFetch("/api/quests");
}

export function claimQuest(questId) {
  return apiFetch(`/api/quests/${encodeURIComponent(questId)}/claim`, { method: "POST" });
}

export function getForest() {
  return apiFetch("/api/forest");
}

export function plantTrees(trees = 1) {
  return apiFetch("/api/forest/plant", { method: "POST", body: JSON.stringify({ trees }) });
}

export function getLeaderboard(limit = 10) {
  return apiFetch(`/api/forest/leaderboard?limit=${limit}`);
}

// apiFetch errors look like `API 409: {"detail":"Not enough acorns…"}`.
export function errorMessage(error) {
  const text = error?.message ?? String(error);
  const json = text.match(/\{.*\}$/s)?.[0];
  if (json) {
    try {
      const detail = JSON.parse(json).detail;
      if (typeof detail === "string") return detail;
    } catch {
      // fall through to the raw message
    }
  }
  return text;
}
