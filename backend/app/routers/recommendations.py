from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import OptionalAuthUser
from app.schemas.recommendations import RecommendationsRequest, RecommendationsResponse
from app.services.jev_recommender import run_jev_recommender

router = APIRouter(prefix="/api/checkout/recommendations", tags=["recommendations"])


@router.post("", response_model=RecommendationsResponse)
async def get_checkout_recommendations(
    payload: RecommendationsRequest,
    user: OptionalAuthUser,
) -> RecommendationsResponse:
    """Evaluates checkout cart items and returns TypeSafe Jev alternative recommendations."""
    user_id = user.id if user else "guest"
    print(f"[Jev Recommender] User '{user_id}' checking alternatives on {payload.store_domain} (total ${payload.total_cost:.2f})")
    return await run_jev_recommender(payload)


class RecommendationClickRequest(BaseModel):
    recommendation_id: str
    search_url: str
    title: str | None = None


@router.post("/click")
async def track_recommendation_click(
    payload: RecommendationClickRequest,
    user: OptionalAuthUser,
):
    user_id = user.id if user else "guest"
    print(f"[Jev Recommender] Click recorded: User '{user_id}' checked swap '{payload.recommendation_id}' ({payload.title}) -> {payload.search_url}")
    return {"ok": True, "awarded_acorns": 10}
