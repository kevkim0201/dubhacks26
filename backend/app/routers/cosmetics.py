from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import AuthUser
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    equip_cosmetic,
    get_avatar_state,
    purchase_cosmetic,
)

router = APIRouter(prefix="/api/cosmetics", tags=["cosmetics"])


class CosmeticRequest(BaseModel):
    cosmetic_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")


def _raise_api_error(exc: SupabaseAPIError) -> None:
    response_status = {
        "22023": status.HTTP_409_CONFLICT,
        "P0002": status.HTTP_404_NOT_FOUND,
        "42501": status.HTTP_403_FORBIDDEN,
        "23505": status.HTTP_409_CONFLICT,
    }.get(exc.code, status.HTTP_502_BAD_GATEWAY)
    raise HTTPException(response_status, str(exc)) from exc


@router.get("")
def avatar_state(user: AuthUser) -> dict:
    try:
        return get_avatar_state(user.id)
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        _raise_api_error(exc)


@router.post("/purchase", status_code=status.HTTP_200_OK)
def buy_cosmetic(payload: CosmeticRequest, user: AuthUser) -> dict:
    try:
        result = purchase_cosmetic(user.id, payload.cosmetic_id)
        return {"result": result, **get_avatar_state(user.id)}
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        _raise_api_error(exc)


@router.post("/equip", status_code=status.HTTP_200_OK)
def wear_cosmetic(payload: CosmeticRequest, user: AuthUser) -> dict:
    try:
        result = equip_cosmetic(user.id, payload.cosmetic_id)
        return {"result": result, **get_avatar_state(user.id)}
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        _raise_api_error(exc)
