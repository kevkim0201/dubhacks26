from fastapi import APIRouter

from app.core.storage import db
from app.schemas.checkout import UserSeedRequest, UserStateResponse

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/state", response_model=UserStateResponse)
async def get_user_state(user_id: str = "demo_user") -> UserStateResponse:
    state = db.get_user_state(user_id)
    return UserStateResponse(**state)


@router.post("/seed", response_model=UserStateResponse)
async def seed_user_state(payload: UserSeedRequest) -> UserStateResponse:
    state = db.seed_user(
        user_id=payload.user_id,
        total_earned=payload.total_earned,
        balance=payload.balance,
    )
    return UserStateResponse(**state)
