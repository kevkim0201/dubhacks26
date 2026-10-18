// Pip's onboarding interview (backend /api/onboarding).
import { apiFetch } from "./api.js";

export const getOnboarding = () => apiFetch("/api/onboarding");

export const saveOnboarding = (answers) =>
  apiFetch("/api/onboarding", { method: "POST", body: JSON.stringify(answers) });

export const skipOnboarding = () => apiFetch("/api/onboarding/skip", { method: "POST" });

// The voice interview's transcript -> Gemini -> saved answers + persona.
export const onboardingFromConversation = (transcript) =>
  apiFetch("/api/onboarding/from-conversation", { method: "POST", body: JSON.stringify({ transcript }) });
