"""Pip's onboarding interview: what a new user shared about their spending habits.

GET  /api/onboarding                    -> {needs_onboarding, personalization, completed_at}
POST /api/onboarding                    -> save answers (finishes onboarding)
POST /api/onboarding/from-conversation  -> Gemini turns the voice interview into answers + a persona, saved
POST /api/onboarding/skip               -> finish without answers (Pip won't ask again)
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field, ValidationError

from app.core.auth import AuthUser
from app.core.config import get_settings
from app.routers.checkout import Category
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    get_onboarding,
    save_onboarding,
)

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

PERSONALIZATION_VERSION = 1

ImpulseTrigger = Literal[
    "late_night", "stress", "boredom", "sales", "social_media", "payday", "with_friends", "other",
]
Goal = Literal[
    "fewer_impulse_buys", "save_for_goal", "stick_to_budget", "better_deals",
    "think_before_big_buys", "pay_off_debt",
]
CoachingStyle = Literal["gentle", "balanced", "tough_love"]


class SavingsGoal(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float | None = Field(default=None, gt=0, le=1_000_000)


class Persona(BaseModel):
    """Gemini's read of the user from the voice interview, for Pip to use later."""

    summary: str = Field(default="", max_length=1000)  # 2-3 sentences, second person-free
    shopper_type: str = Field(default="", max_length=80)  # e.g. "Late-night gadget browser"
    tips_for_pip: list[str] = Field(default_factory=list, max_length=5)  # how Pip should help at checkout


class Personalization(BaseModel):
    """Everything Pip learned in the interview. Stored as profiles.personalization."""

    spend_categories: list[Category] = Field(default_factory=list, max_length=8)
    impulse_triggers: list[ImpulseTrigger] = Field(default_factory=list, max_length=8)
    goals: list[Goal] = Field(default_factory=list, max_length=6)
    savings_goal: SavingsGoal | None = None
    monthly_budget: float | None = Field(default=None, gt=0, le=1_000_000)
    coaching_style: CoachingStyle = "balanced"
    notes: str = Field(default="", max_length=500)
    persona: Persona | None = None
    source: Literal["voice", "typed"] = "typed"


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SupabaseConfigurationError):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if isinstance(exc, SupabaseAPIError) and exc.code == "P0002":
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Onboarding unavailable: {exc}")


NO_PERSONA = "No profile yet: this shopper hasn't shared their spending habits with Pip."

_LABELS = {
    "late_night": "late at night", "stress": "when stressed", "boredom": "when bored", "sales": "during sales",
    "social_media": "while scrolling social media", "payday": "right after payday", "with_friends": "with friends",
    "other": "at other times", "fewer_impulse_buys": "fewer impulse buys", "save_for_goal": "saving for a goal",
    "stick_to_budget": "sticking to a budget", "better_deals": "finding better deals",
    "think_before_big_buys": "thinking before big purchases", "pay_off_debt": "paying off debt",
    "food": "food & takeout", "office": "office & school", "toys": "toys & hobbies", "jewelry": "jewelry & accessories",
}
_STYLE = {
    "gentle": "gentle: be kind and encouraging, no pressure",
    "balanced": "honest friend: friendly but real",
    "tough_love": "tough love: be direct and call out excuses",
}


def persona_prompt(personalization: dict | None) -> str:
    """The onboarding results as a short plain-text brief for Pip's checkout agent
    ({{user_persona}} in the ElevenLabs prompt)."""
    p = personalization or {}
    if not p or p.get("skipped") and len(p) <= 2:
        return NO_PERSONA
    names = lambda ids: ", ".join(_LABELS.get(i, i.replace("_", " ")) for i in ids or [])  # noqa: E731
    persona = p.get("persona") or {}
    parts = []
    if persona.get("shopper_type"):
        parts.append(f"Shopper type: {persona['shopper_type']}.")
    if persona.get("summary"):
        parts.append(persona["summary"])
    if p.get("spend_categories"):
        parts.append(f"Tends to overspend on: {names(p['spend_categories'])}.")
    if p.get("impulse_triggers"):
        parts.append(f"Impulse buys happen: {names(p['impulse_triggers'])}.")
    if p.get("goals"):
        parts.append(f"Wants help with: {names(p['goals'])}.")
    goal = p.get("savings_goal") or {}
    if goal.get("name"):
        amount = f" (about ${goal['amount']:,.0f})" if goal.get("amount") else ""
        parts.append(f"Saving up for: {goal['name']}{amount}.")
    if p.get("monthly_budget"):
        parts.append(f"Monthly online shopping budget: about ${p['monthly_budget']:,.0f}.")
    if p.get("coaching_style"):
        parts.append(f"Coaching style they asked for: {_STYLE.get(p['coaching_style'], p['coaching_style'])}.")
    if p.get("notes"):
        parts.append(f"Notes: {p['notes']}")
    if persona.get("tips_for_pip"):
        parts.append("Tips for Pip: " + " ".join(t.rstrip(".") + "." for t in persona["tips_for_pip"]))
    text = " ".join(parts).strip()
    return text[:1500] if text else NO_PERSONA


def _view(row: dict) -> dict:
    personalization = row.get("personalization") or {}
    return {
        "needs_onboarding": row.get("onboarding_completed_at") is None,
        "personalization": personalization,
        "completed_at": row.get("onboarding_completed_at"),
        "persona_prompt": persona_prompt(personalization),
    }


@router.get("")
def onboarding_state(user: AuthUser) -> dict:
    try:
        return _view(get_onboarding(user.id))
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc


@router.post("")
def complete_onboarding(answers: Personalization, user: AuthUser) -> dict:
    data = {
        **answers.model_dump(mode="json"),
        "version": PERSONALIZATION_VERSION,
        "answered_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        get_onboarding(user.id)  # make sure the profile exists
        return _view(save_onboarding(user.id, data))
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc


@router.post("/skip")
def skip_onboarding(user: AuthUser) -> dict:
    try:
        current = get_onboarding(user.id)
        # Keep earlier answers if there are any; just stop asking.
        data = current.get("personalization") or {"skipped": True, "version": PERSONALIZATION_VERSION}
        return _view(save_onboarding(user.id, data))
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc


# ---------- voice interview -> personalization (Gemini) ----------


class TranscriptLine(BaseModel):
    role: Literal["pip", "user"]
    text: str = Field(max_length=2000)


class ConversationRequest(BaseModel):
    transcript: list[TranscriptLine] = Field(min_length=1, max_length=200)


class OnboardingExtraction(BaseModel):
    """What Gemini fills in from the transcript. Flat fields with plain defaults (no nulls)
    so the structured-output schema stays simple; mapped onto Personalization below."""

    spend_categories: list[Category]
    impulse_triggers: list[ImpulseTrigger]
    goals: list[Goal]
    savings_goal_name: str
    savings_goal_amount: float
    monthly_budget: float
    coaching_style: CoachingStyle
    notes: str
    persona_summary: str
    shopper_type: str
    tips_for_pip: list[str]


EXTRACTION_PROMPT = """You are reading the onboarding voice interview between Pip (a friendly squirrel that helps
people shop mindfully) and a new user. Turn it into the user's profile.

Rules:
- Only use what the USER said. Never invent details. Leave lists empty and strings empty if unknown.
- spend_categories: what they buy most / overspend on, mapped to the allowed categories.
- impulse_triggers: when impulse buys happen (late night, stress, boredom, sales, social media, payday,
  with friends, other). Only if they said so.
- goals: what they want to change, mapped to the allowed goals (e.g. "impulse buys" -> fewer_impulse_buys,
  "subscriptions piling up" / "buying things I own" -> think_before_big_buys or fewer_impulse_buys,
  saving for something -> save_for_goal, a monthly budget -> stick_to_budget).
- savings_goal_name / savings_goal_amount: what they're saving for and how much (0 if no amount).
- monthly_budget: their monthly online-shopping amount in dollars. For a range use the middle; 0 if skipped.
- coaching_style: "gentle", "tough_love", or "balanced" if they didn't say or said both.
- notes: anything else useful in one short sentence (things they already own, returns, subscriptions), or "".
- persona_summary: 2-3 warm, non-judgmental sentences describing this shopper for Pip, in third person.
- shopper_type: a short friendly label, like "Late-night gadget browser".
- tips_for_pip: up to 3 short tips for how Pip should help this person at checkout.
- Never include income, bank, card or debt details even if mentioned.

Transcript:
{transcript}"""


def _extract_with_gemini(lines: list[TranscriptLine]) -> OnboardingExtraction:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "GEMINI_API_KEY not configured in backend/.env")
    transcript = "\n".join(f"{'PIP' if l.role == 'pip' else 'USER'}: {l.text}" for l in lines)
    client = genai.Client(api_key=settings.gemini_api_key)  # keep a reference: the SDK closes unreferenced clients
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=EXTRACTION_PROMPT.format(transcript=transcript),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=OnboardingExtraction,
                temperature=0.1,
            ),
        )
        return OnboardingExtraction.model_validate_json(response.text)
    except genai_errors.APIError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gemini ({settings.gemini_model}) failed: {exc.message or exc}") from exc
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gemini returned an invalid profile: {exc}") from exc


def to_personalization(x: OnboardingExtraction) -> Personalization:
    def dedupe(items):
        return list(dict.fromkeys(items))

    return Personalization(
        spend_categories=dedupe(x.spend_categories)[:8],
        impulse_triggers=dedupe(x.impulse_triggers)[:8],
        goals=dedupe(x.goals)[:6],
        savings_goal=SavingsGoal(name=x.savings_goal_name.strip()[:80], amount=x.savings_goal_amount if x.savings_goal_amount > 0 else None)
        if x.savings_goal_name.strip()
        else None,
        monthly_budget=round(x.monthly_budget, 2) if 0 < x.monthly_budget <= 1_000_000 else None,
        coaching_style=x.coaching_style,
        notes=x.notes.strip()[:500],
        persona=Persona(
            summary=x.persona_summary.strip()[:1000],
            shopper_type=x.shopper_type.strip()[:80],
            tips_for_pip=[t.strip()[:140] for t in x.tips_for_pip if t.strip()][:5],
        ),
        source="voice",
    )


@router.post("/from-conversation")
def onboarding_from_conversation(payload: ConversationRequest, user: AuthUser) -> dict:
    """Parses the voice interview with Gemini, saves the answers + persona, and returns them so
    the page can show a review (edits are saved again with POST /api/onboarding). The raw
    transcript itself is not stored."""
    if not any(l.role == "user" and l.text.strip() for l in payload.transcript):
        raise HTTPException(422, "Pip didn't hear any answers yet")
    personalization = to_personalization(_extract_with_gemini(payload.transcript))
    return complete_onboarding(personalization, user)
