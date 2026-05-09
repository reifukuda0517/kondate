import os
import sys
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
import pytz

from database import get_db, init_db
from models import User, MealPlan, Ingredient, Comment, PushSubscription
from push_service import get_vapid_public_key, send_push_to_subscriptions
from scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

JST = pytz.timezone("Asia/Tokyo")

app = FastAPI(title="献立共有アプリ", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── WebSocket Manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"WebSocket connected: user_id={user_id}")

    def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)
        logger.info(f"WebSocket disconnected: user_id={user_id}")

    async def broadcast(self, message: dict):
        disconnected = []
        for uid, ws in self.active_connections.items():
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(uid)
        for uid in disconnected:
            self.disconnect(uid)

    async def send_to_user(self, user_id: str, message: dict):
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(user_id)


manager = ConnectionManager()


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    name: str
    role: str

    class Config:
        from_attributes = True


class MealPlanCreate(BaseModel):
    date: Optional[date] = None
    meal_name: str
    memo: Optional[str] = None
    created_by: int
    is_confirmed: bool = False


class MealPlanUpdate(BaseModel):
    date: Optional[date] = None
    meal_name: Optional[str] = None
    memo: Optional[str] = None
    is_confirmed: Optional[bool] = None


class MealPlanOut(BaseModel):
    id: int
    date: Optional[date]
    meal_name: str
    memo: Optional[str]
    created_by: int
    is_confirmed: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IngredientCreate(BaseModel):
    name: str
    quantity: Optional[str] = None
    unit: Optional[str] = None
    meal_plan_id: Optional[int] = None
    shopping_date: Optional[date] = None
    is_purchased: bool = False


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[str] = None
    unit: Optional[str] = None
    meal_plan_id: Optional[int] = None
    shopping_date: Optional[date] = None
    is_purchased: Optional[bool] = None


class IngredientOut(BaseModel):
    id: int
    name: str
    quantity: Optional[str]
    unit: Optional[str]
    meal_plan_id: Optional[int]
    shopping_date: Optional[date]
    is_purchased: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CommentCreate(BaseModel):
    user_id: int
    content: str


class CommentOut(BaseModel):
    id: int
    meal_plan_id: int
    user_id: int
    content: str
    created_at: datetime
    user_name: Optional[str] = None

    class Config:
        from_attributes = True


class PushSubscribeRequest(BaseModel):
    user_id: int
    endpoint: str
    p256dh: str
    auth: str


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class UserUpdate(BaseModel):
    name: Optional[str] = None


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    await init_db()
    start_scheduler()
    logger.info("App started")


@app.on_event("shutdown")
async def shutdown_event():
    stop_scheduler()


# ─── WebSocket Endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo heartbeat
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(user_id)


# ─── Users ────────────────────────────────────────────────────────────────────

@app.get("/api/users", response_model=List[UserOut])
async def get_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    return result.scalars().all()


@app.get("/api/users/{user_id}", response_model=UserOut)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.put("/api/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        user.name = body.name
    await db.commit()
    await db.refresh(user)
    return user


# ─── Meal Plans ───────────────────────────────────────────────────────────────

@app.get("/api/meal-plans/week")
async def get_week_meal_plans(date_str: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Return meal plans for the week containing the given date (Mon–Sun)."""
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.now(JST).date()

    # Calculate Monday of the week
    weekday = target_date.weekday()  # 0=Mon, 6=Sun
    monday = target_date - timedelta(days=weekday)
    sunday = monday + timedelta(days=6)

    result = await db.execute(
        select(MealPlan).where(
            MealPlan.date >= monday,
            MealPlan.date <= sunday,
        ).order_by(MealPlan.date)
    )
    plans = result.scalars().all()

    # Build a dict keyed by date string
    plan_dict = {}
    for p in plans:
        plan_dict[p.date.isoformat()] = {
            "id": p.id,
            "date": p.date.isoformat(),
            "meal_name": p.meal_name,
            "memo": p.memo,
            "created_by": p.created_by,
            "is_confirmed": p.is_confirmed,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        }

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "plans": plan_dict,
    }


@app.get("/api/meal-plans", response_model=List[MealPlanOut])
async def get_meal_plans(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(MealPlan).order_by(MealPlan.date.desc())
    if year and month:
        from sqlalchemy import extract
        query = query.where(
            extract("year", MealPlan.date) == year,
            extract("month", MealPlan.date) == month,
        )
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/api/meal-plans/{plan_id}", response_model=MealPlanOut)
async def get_meal_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MealPlan).where(MealPlan.id == plan_id))
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")
    return plan


@app.get("/api/meal-plans/unscheduled", response_model=List[MealPlanOut])
async def get_unscheduled_meal_plans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MealPlan).where(MealPlan.date == None).order_by(MealPlan.created_at.desc())
    )
    return result.scalars().all()


@app.post("/api/meal-plans", response_model=MealPlanOut, status_code=status.HTTP_201_CREATED)
async def create_meal_plan(body: MealPlanCreate, db: AsyncSession = Depends(get_db)):
    # Check for date conflict only when a date is provided
    if body.date is not None:
        result = await db.execute(select(MealPlan).where(MealPlan.date == body.date))
        existing = result.scalars().first()
        if existing:
            raise HTTPException(status_code=409, detail="Meal plan already exists for this date")

    plan = MealPlan(
        date=body.date,
        meal_name=body.meal_name,
        memo=body.memo,
        created_by=body.created_by,
        is_confirmed=body.is_confirmed,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)

    await manager.broadcast({
        "type": "meal_plan_created",
        "data": {
            "id": plan.id,
            "date": plan.date.isoformat(),
            "meal_name": plan.meal_name,
            "memo": plan.memo,
            "created_by": plan.created_by,
            "is_confirmed": plan.is_confirmed,
        }
    })

    return plan


@app.put("/api/meal-plans/{plan_id}", response_model=MealPlanOut)
async def update_meal_plan(plan_id: int, body: MealPlanUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MealPlan).where(MealPlan.id == plan_id))
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")

    if body.date is not None:
        # Check for date conflict when assigning a date
        conflict = await db.execute(
            select(MealPlan).where(MealPlan.date == body.date, MealPlan.id != plan_id)
        )
        if conflict.scalars().first():
            raise HTTPException(status_code=409, detail="Meal plan already exists for this date")
        plan.date = body.date
    if body.meal_name is not None:
        plan.meal_name = body.meal_name
    if body.memo is not None:
        plan.memo = body.memo
    if body.is_confirmed is not None:
        plan.is_confirmed = body.is_confirmed
    plan.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(plan)

    await manager.broadcast({
        "type": "meal_plan_updated",
        "data": {
            "id": plan.id,
            "date": plan.date.isoformat() if plan.date else None,
            "meal_name": plan.meal_name,
            "memo": plan.memo,
            "is_confirmed": plan.is_confirmed,
        }
    })

    return plan


@app.delete("/api/meal-plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meal_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MealPlan).where(MealPlan.id == plan_id))
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")

    await db.delete(plan)
    await db.commit()

    await manager.broadcast({
        "type": "meal_plan_deleted",
        "data": {"id": plan_id}
    })


# ─── Ingredients ──────────────────────────────────────────────────────────────

@app.get("/api/ingredients", response_model=List[IngredientOut])
async def get_ingredients(
    meal_plan_id: Optional[int] = None,
    shopping_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(Ingredient).order_by(Ingredient.created_at.desc())
    if meal_plan_id is not None:
        query = query.where(Ingredient.meal_plan_id == meal_plan_id)
    if shopping_date:
        try:
            sd = date.fromisoformat(shopping_date)
            query = query.where(Ingredient.shopping_date == sd)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    result = await db.execute(query)
    return result.scalars().all()


@app.post("/api/ingredients", response_model=IngredientOut, status_code=status.HTTP_201_CREATED)
async def create_ingredient(body: IngredientCreate, db: AsyncSession = Depends(get_db)):
    ingredient = Ingredient(
        name=body.name,
        quantity=body.quantity,
        unit=body.unit,
        meal_plan_id=body.meal_plan_id,
        shopping_date=body.shopping_date,
        is_purchased=body.is_purchased,
    )
    db.add(ingredient)
    await db.commit()
    await db.refresh(ingredient)

    await manager.broadcast({
        "type": "ingredient_created",
        "data": {
            "id": ingredient.id,
            "name": ingredient.name,
            "quantity": ingredient.quantity,
            "unit": ingredient.unit,
            "meal_plan_id": ingredient.meal_plan_id,
            "shopping_date": ingredient.shopping_date.isoformat() if ingredient.shopping_date else None,
            "is_purchased": ingredient.is_purchased,
        }
    })

    return ingredient


@app.put("/api/ingredients/{ingredient_id}", response_model=IngredientOut)
async def update_ingredient(ingredient_id: int, body: IngredientUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Ingredient).where(Ingredient.id == ingredient_id))
    ingredient = result.scalars().first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    if body.name is not None:
        ingredient.name = body.name
    if body.quantity is not None:
        ingredient.quantity = body.quantity
    if body.unit is not None:
        ingredient.unit = body.unit
    if body.meal_plan_id is not None:
        ingredient.meal_plan_id = body.meal_plan_id
    if body.shopping_date is not None:
        ingredient.shopping_date = body.shopping_date
    if body.is_purchased is not None:
        ingredient.is_purchased = body.is_purchased

    await db.commit()
    await db.refresh(ingredient)

    await manager.broadcast({
        "type": "ingredient_updated",
        "data": {
            "id": ingredient.id,
            "name": ingredient.name,
            "is_purchased": ingredient.is_purchased,
            "meal_plan_id": ingredient.meal_plan_id,
        }
    })

    return ingredient


@app.delete("/api/ingredients/{ingredient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ingredient(ingredient_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Ingredient).where(Ingredient.id == ingredient_id))
    ingredient = result.scalars().first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    await db.delete(ingredient)
    await db.commit()

    await manager.broadcast({
        "type": "ingredient_deleted",
        "data": {"id": ingredient_id}
    })


# ─── Comments ─────────────────────────────────────────────────────────────────

@app.get("/api/comments/{meal_plan_id}", response_model=List[CommentOut])
async def get_comments(meal_plan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Comment, User.name.label("user_name"))
        .join(User, Comment.user_id == User.id)
        .where(Comment.meal_plan_id == meal_plan_id)
        .order_by(Comment.created_at.asc())
    )
    rows = result.all()
    comments = []
    for comment, user_name in rows:
        comments.append(CommentOut(
            id=comment.id,
            meal_plan_id=comment.meal_plan_id,
            user_id=comment.user_id,
            content=comment.content,
            created_at=comment.created_at,
            user_name=user_name,
        ))
    return comments


@app.post("/api/comments/{meal_plan_id}", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(meal_plan_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db)):
    # Verify meal plan exists
    result = await db.execute(select(MealPlan).where(MealPlan.id == meal_plan_id))
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")

    # Get user name
    user_result = await db.execute(select(User).where(User.id == body.user_id))
    user = user_result.scalars().first()
    user_name = user.name if user else "不明"

    comment = Comment(
        meal_plan_id=meal_plan_id,
        user_id=body.user_id,
        content=body.content,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    out = CommentOut(
        id=comment.id,
        meal_plan_id=comment.meal_plan_id,
        user_id=comment.user_id,
        content=comment.content,
        created_at=comment.created_at,
        user_name=user_name,
    )

    await manager.broadcast({
        "type": "comment_created",
        "data": {
            "id": comment.id,
            "meal_plan_id": comment.meal_plan_id,
            "user_id": comment.user_id,
            "user_name": user_name,
            "content": comment.content,
            "created_at": comment.created_at.isoformat(),
        }
    })

    return out


# ─── Push Notifications ───────────────────────────────────────────────────────

@app.get("/api/push/vapid-public-key")
async def get_vapid_key():
    return {"public_key": get_vapid_public_key()}


@app.post("/api/push/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_push(body: PushSubscribeRequest, db: AsyncSession = Depends(get_db)):
    # Check if subscription already exists
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    )
    existing = result.scalars().first()
    if existing:
        # Update keys
        existing.p256dh = body.p256dh
        existing.auth = body.auth
        existing.user_id = body.user_id
        await db.commit()
        return {"message": "Subscription updated"}

    subscription = PushSubscription(
        user_id=body.user_id,
        endpoint=body.endpoint,
        p256dh=body.p256dh,
        auth=body.auth,
    )
    db.add(subscription)
    await db.commit()
    return {"message": "Subscription created"}


@app.delete("/api/push/unsubscribe")
async def unsubscribe_push(body: PushUnsubscribeRequest, db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    )
    await db.commit()
    return {"message": "Unsubscribed"}


@app.post("/api/push/test")
async def test_push(user_id: int, db: AsyncSession = Depends(get_db)):
    """Send a test push notification to the specified user."""
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    subscriptions = result.scalars().all()
    if not subscriptions:
        raise HTTPException(status_code=404, detail="No subscriptions found for this user")

    results = send_push_to_subscriptions(
        subscriptions=subscriptions,
        title="テスト通知",
        body="プッシュ通知のテストです",
        data={"test": True}
    )
    return results


# ─── Static Files ─────────────────────────────────────────────────────────────

frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(frontend_path / "index.html"))

    @app.get("/manifest.json")
    async def serve_manifest():
        return FileResponse(str(frontend_path / "manifest.json"))

    @app.get("/sw.js")
    async def serve_sw():
        return FileResponse(str(frontend_path / "sw.js"), media_type="application/javascript")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = frontend_path / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(frontend_path / "index.html"))
