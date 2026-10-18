from fastapi import APIRouter

from app.core.auth import AuthUser

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/me")
def me(user: AuthUser) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}
