from fastapi import APIRouter, HTTPException, status

from app.core.auth import AuthUser
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    get_user_state,
)

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/me")
def me(user: AuthUser) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}


@router.get("/user/state")
def user_state(user: AuthUser) -> dict:
    try:
        return get_user_state(user.id)
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
