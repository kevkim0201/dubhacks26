import os
import secrets
import urllib.parse
from decimal import Decimal
from typing import Annotated, List, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Response, status
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.core.auth import AuthUser, OptionalAuthUser
from app.core.config import get_settings
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    create_checkout_session,
    record_checkout_decision,
    save_assessment,
    save_conversation,
)

router = APIRouter(prefix="/api/checkout", tags=["checkout"])

DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"


class CartItem(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    quantity: int = Field(default=1, gt=0, le=100)
    url: str | None = Field(default=None, max_length=2048)
    image: str | None = Field(default=None, max_length=2048)
    item_key: str | None = Field(default=None, max_length=512)


class CheckoutStartRequest(BaseModel):
    store: str = Field(min_length=1, max_length=200)
    cart_total: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    items: list[CartItem] = Field(default_factory=list, max_length=100)
    page_url: str | None = Field(default=None, max_length=2048)


# Postgres error codes raised by record_checkout_decision -> HTTP status.
_PG_STATUS = {
    "22023": 422,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "55000": status.HTTP_409_CONFLICT,
}


def _supabase_http_error(exc: Exception, action: str) -> HTTPException:
    if isinstance(exc, SupabaseConfigurationError):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if isinstance(exc, SupabaseUnavailable):
        return HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    if isinstance(exc, SupabaseAPIError):
        return HTTPException(_PG_STATUS.get(exc.code, status.HTTP_502_BAD_GATEWAY), f"Could not {action}: {exc}")
    return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Could not {action}")


class AssessmentRequest(BaseModel):
    assessment: Literal["clear_need", "unsure", "impulsive"]
    suggestion: Literal["buy", "wait", "skip"]
    reason_summary: str | None = Field(default=None, max_length=1000)
    closing_line: str | None = Field(default=None, max_length=500)


class DecisionRequest(BaseModel):
    decision: Literal["buy", "save", "skip"]


class CheckoutTurnRequest(BaseModel):
    user_text: str
    cart_total: float = 0.0
    turn_count: int = 1


@router.get("/voice/speak")
async def generate_speech(
    text: str = Query(..., description="Text for Pip to speak"),
    voice_id: str = Query(DEFAULT_VOICE_ID, description="ElevenLabs voice ID"),
) -> Response:
    """Streams ElevenLabs Eleven Turbo synthesized speech audio (MP3)."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")

    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Empty text provided")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            tts_url = (
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
            )
            resp = await client.post(
                tts_url,
                headers={"xi-api-key": settings.elevenlabs_api_key},
                json={
                    "text": clean_text,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {
                        "stability": 0.45,
                        "similarity_boost": 0.8,
                    },
                },
            )

            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"ElevenLabs TTS failed: {resp.text}",
                )

            return Response(
                content=resp.content,
                media_type="audio/mpeg",
                headers={
                    "Cache-Control": "public, max-age=3600",
                    "Content-Disposition": "inline; filename=pip-voice.mp3",
                },
            )
    except httpx.RequestError as err:
        raise HTTPException(status_code=502, detail=f"Failed to connect to ElevenLabs: {err}")


@router.post("/turn")
def handle_checkout_turn(payload: CheckoutTurnRequest) -> dict:
    user_text = payload.user_text.strip().lower()
    turn_count = payload.turn_count

    if any(k in user_text for k in ["gym", "need", "replace", "broke", "work", "gift", "run", "training"]):
        reply_text = "Fair enough! If it's replacing something broken or for your daily routine, that's solid. Go for it if you feel ready!"
        done = True
        recommendation = "Go for it"
    elif any(k in user_text for k in ["sale", "deal", "cheap", "want", "bored", "cute", "treat", "impulse"]):
        if turn_count < 2:
            reply_text = "A good deal is tempting! But just checking: do you already have something similar, or could you wait 24 hours?"
            done = False
            recommendation = "Consider waiting"
        else:
            reply_text = f"Got it! Skipping or waiting saves you ${payload.cart_total:.0f} and earns extra acorns, but the final call is yours."
            done = True
            recommendation = "Wait 24 hours"
    else:
        if turn_count >= 2:
            reply_text = "Makes sense. Take a moment to weigh it—whatever you choose, you earn acorns for reflecting!"
            done = True
            recommendation = "Thoughtful pause"
        else:
            reply_text = "Tell me more! How often do you honestly see yourself using it this month?"
            done = False
            recommendation = None

    audio_param = urllib.parse.quote(reply_text)
    reply_audio_url = f"/api/checkout/voice/speak?text={audio_param}"

    return {
        "reply_text": reply_text,
        "reply_audio_url": reply_audio_url,
        "done": done,
        "recommendation": recommendation,
    }


@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_checkout(payload: CheckoutStartRequest, user: AuthUser) -> dict:
    # Every conversation is logged against a real session; no silent local fallback.
    try:
        session = create_checkout_session(
            user.id,
            store=payload.store,
            cart_total=str(payload.cart_total),
            currency=payload.currency,
            items=[item.model_dump(mode="json", exclude_none=True) for item in payload.items],
            page_url=payload.page_url,
        )
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _supabase_http_error(exc, "start a checkout session") from exc
    session_id = str(session["id"])
    session_status = str(session["status"])

    if payload.items:
        first_item = payload.items[0].name
        opening_line = f"Ooh, ${payload.cart_total:.0f} for {first_item}! Why do you need this today?"
    else:
        opening_line = f"Ooh, ${payload.cart_total:.0f} in your cart at {payload.store}! Why do you need this today?"

    audio_param = urllib.parse.quote(opening_line)
    audio_url = f"/api/checkout/voice/speak?text={audio_param}"

    return {
        "session_id": session_id,
        "status": session_status,
        "opening_line": opening_line,
        "audio_url": audio_url,
    }


@router.post("/{session_id}/assessment", include_in_schema=False)
def set_checkout_assessment(
    session_id: UUID,
    payload: AssessmentRequest,
    x_internal_service_token: Annotated[str | None, Header()] = None,
) -> dict:
    settings = get_settings()
    if not settings.internal_service_token:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "INTERNAL_SERVICE_TOKEN is not configured",
        )
    if not secrets.compare_digest(
        x_internal_service_token or "",
        settings.internal_service_token,
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal service token")

    try:
        save_assessment(
            session_id,
            assessment=payload.assessment,
            suggestion=payload.suggestion,
            reason_summary=payload.reason_summary,
            closing_line=payload.closing_line,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc

    return {"session_id": str(session_id), "assessment_saved": True}


@router.post("/{session_id}/decision")
def submit_decision(
    session_id: UUID,
    payload: DecisionRequest,
    user: AuthUser,
) -> dict:
    try:
        return record_checkout_decision(user.id, session_id, payload.decision)
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _supabase_http_error(exc, "record your decision") from exc


class TranscriptEntry(BaseModel):
    role: Literal["squirrel", "user"]
    text: str


class VerdictRequest(BaseModel):
    cart_items: str
    cart_total: str
    transcript: List[TranscriptEntry] = Field(max_length=200)
    # When set, the verdict and conversation are saved on this session.
    session_id: UUID | None = None
    duration_seconds: int | None = Field(default=None, ge=0, le=6 * 60 * 60)


class SquirrelVerdictJSON(BaseModel):
    assessment: Literal["clear_need", "unsure", "impulsive"]
    suggestion: Literal["buy", "wait", "skip"]
    reason_summary: str
    closing_line: str


@router.post("/verdict", response_model=SquirrelVerdictJSON)
async def generate_and_save_verdict(
    payload: VerdictRequest,
    user: OptionalAuthUser = None,
) -> SquirrelVerdictJSON:
    settings = get_settings()
    api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY not configured in backend/.env",
        )

    gemini_client = genai.Client(api_key=api_key)

    formatted_tx = "\n".join([f"{m.role.upper()}: {m.text}" for m in payload.transcript])

    prompt = f"""
    Analyze this checkout voice conversation between Pip the Squirrel and the shopper.
    Cart Items: {payload.cart_items}
    Cart Total: {payload.cart_total}
    
    Conversation Transcript:
    {formatted_tx}

    Produce the structured JSON verdict evaluating the purchase.
    """

    response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SquirrelVerdictJSON,
            temperature=0.1,
        ),
    )

    verdict = SquirrelVerdictJSON.model_validate_json(response.text)

    if payload.session_id:
        if user is None or user.id == "demo-user":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to save the conversation")
        try:
            save_conversation(
                user.id,
                payload.session_id,
                assessment=verdict.assessment,
                suggestion=verdict.suggestion,
                reason_summary=verdict.reason_summary,
                closing_line=verdict.closing_line,
                transcript=[m.model_dump() for m in payload.transcript],
                duration_seconds=payload.duration_seconds,
            )
        except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
            raise _supabase_http_error(exc, "save the conversation") from exc

    return verdict

