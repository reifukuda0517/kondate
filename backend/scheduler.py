import logging
from datetime import datetime, date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

logger = logging.getLogger(__name__)

JST = pytz.timezone("Asia/Tokyo")
scheduler = AsyncIOScheduler(timezone=JST)


async def send_evening_notification():
    """
    Daily job at 18:00 JST: fetch today's meal plan and send push notification to wife.
    """
    try:
        from database import AsyncSessionLocal
        from models import MealPlan, PushSubscription, User
        from push_service import send_push_to_subscriptions
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        today = date.today()

        async with AsyncSessionLocal() as session:
            # Get today's meal plan
            result = await session.execute(
                select(MealPlan).where(MealPlan.date == today)
            )
            meal_plan = result.scalars().first()

            if meal_plan:
                meal_name = meal_plan.meal_name
                memo = meal_plan.memo or ""
                body = f"今夜の献立: {meal_name}"
                if memo:
                    body += f"\n{memo}"
            else:
                meal_name = "未定"
                body = "今夜の献立はまだ登録されていません"

            # Get wife's push subscriptions
            wife_result = await session.execute(
                select(User).where(User.role == "wife")
            )
            wife = wife_result.scalars().first()

            if not wife:
                logger.warning("Wife user not found, skipping notification")
                return

            subs_result = await session.execute(
                select(PushSubscription).where(PushSubscription.user_id == wife.id)
            )
            subscriptions = subs_result.scalars().all()

            if not subscriptions:
                logger.info("No push subscriptions found for wife")
                return

            results = send_push_to_subscriptions(
                subscriptions=subscriptions,
                title="今夜の献立",
                body=body,
                data={
                    "meal_name": meal_name,
                    "date": today.isoformat(),
                    "url": "/",
                }
            )

            logger.info(
                f"Evening notification sent: {results['success']} success, "
                f"{results['failure']} failure"
            )

            # Remove failed subscriptions
            if results["failed_endpoints"]:
                from sqlalchemy import delete
                await session.execute(
                    delete(PushSubscription).where(
                        PushSubscription.endpoint.in_(results["failed_endpoints"])
                    )
                )
                await session.commit()

    except Exception as e:
        logger.error(f"Error in evening notification job: {e}", exc_info=True)


def start_scheduler():
    """Initialize and start the APScheduler."""
    scheduler.add_job(
        send_evening_notification,
        trigger=CronTrigger(hour=18, minute=0, timezone=JST),
        id="evening_notification",
        name="Evening meal notification",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("Scheduler started. Evening notifications set for 18:00 JST.")


def stop_scheduler():
    """Stop the scheduler gracefully."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler stopped.")
