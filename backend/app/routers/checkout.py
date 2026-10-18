import secrets
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import AuthUser
from app.core.config import get_settings
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    create_checkout_session,
    record_checkout_decision,
    save_assessment,
)

router = APIRouter(prefix="/api/checkout", tags=["checkout"])


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


class AssessmentRequest(BaseModel):
    assessment: Literal["clear_need", "unsure", "impulsive"]
    suggestion: Literal["buy", "wait", "skip"]
    reason_summary: str | None = Field(default=None, max_length=1000)
    closing_line: str | None = Field(default=None, max_length=500)


class DecisionRequest(BaseModel):
    decision: Literal["buy", "save", "skip"]


@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_checkout(payload: CheckoutStartRequest, user: AuthUser) -> dict:
    try:
        session = create_checkout_session(
            user.id,
            store=payload.store,
            cart_total=str(payload.cart_total),
            currency=payload.currency,
            items=[item.model_dump(mode="json") for item in payload.items],
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not create checkout session") from exc

    return {"session_id": session["id"], "status": session["status"]}


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
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        response_status = {
            "22023": status.HTTP_422_UNPROCESSABLE_ENTITY,
            "P0002": status.HTTP_404_NOT_FOUND,
            "23505": status.HTTP_409_CONFLICT,
            "55000": status.HTTP_409_CONFLICT,
        }.get(exc.code, status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(response_status, str(exc)) from exc
