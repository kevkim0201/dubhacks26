import urllib.parse
import httpx
from fastapi import APIRouter, HTTPException, Query, Response

from app.core.config import get_settings
from app.core.storage import db
from app.schemas.checkout import (
    CheckoutDecisionRequest,
    CheckoutDecisionResponse,
    CheckoutStartRequest,
    CheckoutStartResponse,
    CheckoutTurnRequest,
    CheckoutTurnResponse,
)

settings = get_settings()
router = APIRouter(prefix="/checkout", tags=["checkout"])

# Default squirrel voice ID (Rachel - friendly, warm, clear)
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"


async def get_elevenlabs_signed_url(agent_id: str, api_key: str) -> str | None:
    """Obtains a short-lived signed WebSocket URL for ElevenLabs Conversational AI Agent."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id={agent_id}",
                headers={"xi-api-key": api_key},
            )
            if resp.status_code == 200:
                return resp.json().get("signed_url")
    except Exception as err:
        print(f"ElevenLabs signed URL request failed: {err}")
    return None


@router.get("/voice/speak")
async def generate_speech(
    text: str = Query(..., description="Text for Pip the Squirrel to speak"),
    voice_id: str = Query(DEFAULT_VOICE_ID, description="ElevenLabs voice ID"),
) -> Response:
    """Streams ElevenLabs Eleven Turbo synthesized speech audio (MP3)."""
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


@router.post("/start", response_model=CheckoutStartResponse)
async def start_checkout_session(payload: CheckoutStartRequest) -> CheckoutStartResponse:
    cart_dict = payload.cart.model_dump()
    session = db.create_session(cart=cart_dict, user_id=payload.user_id)
    session_id = session["session_id"]

    # Generate personalized opening line based on cart
    items = payload.cart.items
    total = payload.cart.total

    if items:
        first_item = items[0]
        opening_line = f"Ooh, ${total:.0f} for {first_item.name}! Why do you need this today?"
    else:
        opening_line = f"Ooh, ${total:.0f} in your cart! What are you thinking of grabbing?"

    voice_link = None
    if settings.elevenlabs_api_key and settings.elevenlabs_agent_id:
        voice_link = await get_elevenlabs_signed_url(
            settings.elevenlabs_agent_id, settings.elevenlabs_api_key
        )

    # Audio endpoint for Pip's speech
    audio_param = urllib.parse.quote(opening_line)
    audio_url = f"/checkout/voice/speak?text={audio_param}"

    return CheckoutStartResponse(
        session_id=session_id,
        opening_line=opening_line,
        voice_link=voice_link,
        audio_url=audio_url,
    )


@router.post("/turn", response_model=CheckoutTurnResponse)
async def handle_checkout_turn(payload: CheckoutTurnRequest) -> CheckoutTurnResponse:
    session = db.get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    turn_count = len(session.get("turns", [])) + 1
    user_text = payload.user_text.strip().lower()

    # Conversational squirrel evaluation
    cart = session.get("cart", {})
    cart_total = float(cart.get("total", 0.0))

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
            reply_text = f"Got it! Skipping or waiting saves you ${cart_total:.0f} and earns extra acorns, but the final call is yours."
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

    db.add_turn(payload.session_id, user_text=payload.user_text, reply_text=reply_text)

    audio_param = urllib.parse.quote(reply_text)
    reply_audio_url = f"/checkout/voice/speak?text={audio_param}"

    return CheckoutTurnResponse(
        reply_text=reply_text,
        reply_audio_url=reply_audio_url,
        done=done,
        recommendation=recommendation,
    )


@router.post("/decision", response_model=CheckoutDecisionResponse)
async def submit_checkout_decision(payload: CheckoutDecisionRequest) -> CheckoutDecisionResponse:
    try:
        result = db.apply_decision(payload.session_id, payload.decision)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return CheckoutDecisionResponse(
        acorns_awarded=result["acorns_awarded"],
        status=result["status"],
        total_earned=result["total_earned"],
        balance=result["balance"],
        tier=result["tier"],
        tier_up=result["tier_up"],
        streak=result["streak"],
    )
