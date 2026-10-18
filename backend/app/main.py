from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.routers import checkout, health, user_state, users

settings = get_settings()

app = FastAPI(title="Squirrel Savings API (DubHacks '26)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    # Chrome extension IDs differ per machine when loaded unpacked.
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(users.router)
app.include_router(checkout.router)
app.include_router(user_state.router)

# Mount mock store for convenient local testing
demo_dir = Path(__file__).resolve().parents[2] / "demo" / "store"
if demo_dir.exists():
    app.mount("/demo", StaticFiles(directory=str(demo_dir), html=True), name="demo")
