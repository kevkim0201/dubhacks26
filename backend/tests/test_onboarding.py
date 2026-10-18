"""Onboarding interview routes with a fake profiles table (no network)."""

import pytest

import app.routers.onboarding as onboarding_router
import app.services.supabase as svc
from app.core.auth import CurrentUser, get_current_user
from app.main import app

ANSWERS = {
    "spend_categories": ["electronics", "food"],
    "impulse_triggers": ["late_night", "sales"],
    "goals": ["fewer_impulse_buys", "save_for_goal"],
    "savings_goal": {"name": "Trip to Japan", "amount": 2500},
    "monthly_budget": 300,
    "coaching_style": "tough_love",
    "notes": "I always buy gadgets I don't use.",
}


@pytest.fixture
def profiles(monkeypatch):
    table: dict[str, dict] = {}

    def fake_request(method, path, *, params=None, payload=None, prefer=None):
        assert path == "profiles"
        uid = (params or {}).get("id", "eq.")[3:] or (payload or {}).get("id")
        if method == "GET":
            return [table[uid]] if uid in table else []
        if method == "POST":
            table.setdefault(uid, {"id": uid, "personalization": {}, "onboarding_completed_at": None})
            return None
        if method == "PATCH":
            table[uid].update(payload)
            return [table[uid]]
        raise AssertionError(method)

    monkeypatch.setattr(svc, "_request", fake_request)
    return table


@pytest.fixture
def api():
    from fastapi.testclient import TestClient
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="new-user", claims={})
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def test_new_user_needs_onboarding_and_missing_profile_is_created(profiles, api):
    r = api.get("/api/onboarding").json()
    assert r == {"needs_onboarding": True, "personalization": {}, "completed_at": None, "persona_prompt": onboarding_router.NO_PERSONA}
    assert "new-user" in profiles  # the safety net created the row


def test_save_answers_finishes_onboarding(profiles, api):
    r = api.post("/api/onboarding", json=ANSWERS)
    assert r.status_code == 200
    body = r.json()
    assert body["needs_onboarding"] is False and body["completed_at"]
    saved = profiles["new-user"]["personalization"]
    assert saved["coaching_style"] == "tough_love" and saved["savings_goal"] == {"name": "Trip to Japan", "amount": 2500.0}
    assert saved["version"] == 1 and saved["answered_at"]
    assert api.get("/api/onboarding").json()["needs_onboarding"] is False


@pytest.mark.parametrize("bad", [
    {"spend_categories": ["crypto"]},                 # not one of the categories
    {"impulse_triggers": ["always"]},
    {"coaching_style": "mean"},
    {"monthly_budget": -5},
    {"notes": "x" * 501},
    {"savings_goal": {"name": ""}},
])
def test_invalid_answers_are_rejected(profiles, api, bad):
    assert api.post("/api/onboarding", json={**ANSWERS, **bad}).status_code == 422


def test_skip_stops_asking_and_keeps_earlier_answers(profiles, api):
    api.get("/api/onboarding")
    r = api.post("/api/onboarding/skip").json()
    assert r["needs_onboarding"] is False and r["personalization"] == {"skipped": True, "version": 1}
    api.post("/api/onboarding", json=ANSWERS)
    r = api.post("/api/onboarding/skip").json()
    assert r["personalization"]["coaching_style"] == "tough_love"  # skip again later doesn't wipe answers


def test_requires_sign_in():
    from fastapi.testclient import TestClient
    assert TestClient(app).get("/api/onboarding").status_code == 401


# ---------- voice interview -> Gemini -> persona ----------

TRANSCRIPT = [
    {"role": "pip", "text": "What do you usually end up buying online the most?"},
    {"role": "user", "text": "Clothes and way too much takeout."},
    {"role": "pip", "text": "Gentle or tough love?"},
    {"role": "user", "text": "Gentle please."},
]


def fake_extraction(**overrides):
    base = dict(
        spend_categories=["clothing", "food", "food"], impulse_triggers=["late_night"], goals=["fewer_impulse_buys"],
        savings_goal_name="Trip to Japan", savings_goal_amount=2000, monthly_budget=250, coaching_style="gentle",
        notes="Returns a lot of late-night orders.", persona_summary="A late-night browser saving for Japan.",
        shopper_type="Late-night browser", tips_for_pip=["Remind them of Japan", "  ", "Suggest sleeping on it"],
    )
    return onboarding_router.OnboardingExtraction(**{**base, **overrides})


def test_conversation_is_parsed_and_saved_with_persona(profiles, api, monkeypatch):
    seen = {}

    def fake_gemini(lines):
        seen["lines"] = [(l.role, l.text) for l in lines]
        return fake_extraction()

    monkeypatch.setattr(onboarding_router, "_extract_with_gemini", fake_gemini)
    body = api.post("/api/onboarding/from-conversation", json={"transcript": TRANSCRIPT}).json()
    assert body["needs_onboarding"] is False
    saved = profiles["new-user"]["personalization"]
    assert saved["spend_categories"] == ["clothing", "food"]  # deduped
    assert saved["savings_goal"] == {"name": "Trip to Japan", "amount": 2000.0} and saved["monthly_budget"] == 250
    assert saved["persona"]["shopper_type"] == "Late-night browser"
    assert saved["persona"]["tips_for_pip"] == ["Remind them of Japan", "Suggest sleeping on it"]  # blanks dropped
    assert saved["source"] == "voice"
    assert "transcript" not in saved  # only the derived profile is stored
    assert seen["lines"][1] == ("user", "Clothes and way too much takeout.")


def test_zero_values_mean_unknown(profiles, api, monkeypatch):
    monkeypatch.setattr(onboarding_router, "_extract_with_gemini", lambda lines: fake_extraction(savings_goal_name="", savings_goal_amount=0, monthly_budget=0))
    api.post("/api/onboarding/from-conversation", json={"transcript": TRANSCRIPT})
    saved = profiles["new-user"]["personalization"]
    assert saved["savings_goal"] is None and saved["monthly_budget"] is None


def test_no_user_answers_is_rejected_without_calling_gemini(profiles, api, monkeypatch):
    def boom(lines):
        raise AssertionError("should not call Gemini")

    monkeypatch.setattr(onboarding_router, "_extract_with_gemini", boom)
    r = api.post("/api/onboarding/from-conversation", json={"transcript": [{"role": "pip", "text": "Hi!"}]})
    assert r.status_code == 422


def test_edits_after_voice_keep_the_persona(profiles, api, monkeypatch):
    monkeypatch.setattr(onboarding_router, "_extract_with_gemini", lambda lines: fake_extraction())
    persona = api.post("/api/onboarding/from-conversation", json={"transcript": TRANSCRIPT}).json()["personalization"]["persona"]
    api.post("/api/onboarding", json={**ANSWERS, "persona": persona, "source": "voice"})
    saved = profiles["new-user"]["personalization"]
    assert saved["coaching_style"] == "tough_love" and saved["persona"]["summary"] == persona["summary"]


def test_missing_gemini_key_is_a_clear_503(profiles, api, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    r = api.post("/api/onboarding/from-conversation", json={"transcript": TRANSCRIPT})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]


# ---------- {{user_persona}} for the checkout agent ----------

def test_persona_prompt_reads_like_a_brief():
    text = onboarding_router.persona_prompt({
        **ANSWERS,
        "persona": {"summary": "A late-night browser saving for Japan.", "shopper_type": "Late-night browser",
                    "tips_for_pip": ["Mention Japan at checkout", "Suggest sleeping on it."]},
    })
    for expected in ["Shopper type: Late-night browser.", "A late-night browser saving for Japan.",
                     "Tends to overspend on: electronics, food & takeout.", "Impulse buys happen: late at night, during sales.",
                     "Saving up for: Trip to Japan (about $2,500).", "Monthly online shopping budget: about $300.",
                     "tough love: be direct", "Tips for Pip: Mention Japan at checkout. Suggest sleeping on it."]:
        assert expected in text, expected
    assert len(text) <= 1500


def test_persona_prompt_fallbacks():
    assert onboarding_router.persona_prompt({}) == onboarding_router.NO_PERSONA
    assert onboarding_router.persona_prompt(None) == onboarding_router.NO_PERSONA
    assert onboarding_router.persona_prompt({"skipped": True, "version": 1}) == onboarding_router.NO_PERSONA


def test_get_onboarding_includes_persona_prompt(profiles, api):
    assert api.get("/api/onboarding").json()["persona_prompt"] == onboarding_router.NO_PERSONA
    api.post("/api/onboarding", json=ANSWERS)
    assert "Trip to Japan" in api.get("/api/onboarding").json()["persona_prompt"]
