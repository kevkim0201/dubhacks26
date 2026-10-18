from fastapi import APIRouter, HTTPException

from app.core.storage import db
from app.schemas.checkout import (
    CheckoutDecisionRequest,
    CheckoutDecisionResponse,
    CheckoutStartRequest,
    CheckoutStartResponse,
    CheckoutTurnRequest,
    CheckoutTurnResponse,
)

router = APIRouter(prefix="/checkout", tags=["checkout"])


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
        opening_line = f"Ooh, ${total:.0f} {first_item.name}! What are they for?"
    else:
        opening_line = f"Ooh, ${total:.0f} in your cart! What are you grabbing today?"

    return CheckoutStartResponse(
        session_id=session_id,
        opening_line=opening_line,
        voice_link=None,  # Populated in Phase 3 with ElevenLabs
    )


@router.post("/turn", response_model=CheckoutTurnResponse)
async def handle_checkout_turn(payload: CheckoutTurnRequest) -> CheckoutTurnResponse:
    session = db.get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    turn_count = len(session.get("turns", [])) + 1
    user_text = payload.user_text.strip().lower()

    # Adaptive dialogue response simulation (until Gemini Phase 3)
    if "gym" in user_text or "need" in user_text or "replace" in user_text or "broke" in user_text:
        reply_text = "Fair enough! If it's replacing something broken or needed for your routine, that's solid. Ready to decide?"
        done = True
    elif "sale" in user_text or "deal" in user_text or "cheap" in user_text or "want" in user_text:
        if turn_count < 3:
            reply_text = "A good deal is tempting! But just checking: do you already have something similar in your closet or desk?"
            done = False
        else:
            reply_text = "Got it! Sleeping on it or skipping earns you extra acorns, but the choice is always yours. What's the call?"
            done = True
    else:
        if turn_count >= 2:
            reply_text = "Makes sense. Take a moment to weigh it—whatever you choose, you earn acorns for reflecting!"
            done = True
        else:
            reply_text = "Tell me more! How often do you think you'll use it this month?"
            done = False

    db.add_turn(payload.session_id, user_text=payload.user_text, reply_text=reply_text)

    return CheckoutTurnResponse(
        reply_text=reply_text,
        reply_audio_url=None,
        done=done,
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
