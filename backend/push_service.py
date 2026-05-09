import os
import json
import logging
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Load .env from project root (one level up from backend/)
_ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL", "mailto:admin@kondate.local")


def get_vapid_public_key() -> str:
    return VAPID_PUBLIC_KEY


def send_push_notification(subscription_info: dict, title: str, body: str, data: Optional[dict] = None) -> bool:
    """
    Send a push notification to a single subscription.
    Returns True on success, False on failure.
    """
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        logger.warning("VAPID keys not configured. Skipping push notification.")
        return False

    try:
        from pywebpush import webpush, WebPushException

        payload = json.dumps({
            "title": title,
            "body": body,
            "data": data or {},
            "icon": "/icons/icon-192x192.png",
            "badge": "/icons/icon-72x72.png",
        })

        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_EMAIL},
        )
        logger.info(f"Push notification sent successfully to {subscription_info.get('endpoint', '')[:50]}...")
        return True

    except Exception as e:
        logger.error(f"Failed to send push notification: {e}")
        return False


def send_push_to_subscriptions(subscriptions: list, title: str, body: str, data: Optional[dict] = None) -> dict:
    """
    Send push notifications to multiple subscriptions.
    Returns dict with success/failure counts.
    """
    results = {"success": 0, "failure": 0, "failed_endpoints": []}

    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth,
            }
        }
        success = send_push_notification(subscription_info, title, body, data)
        if success:
            results["success"] += 1
        else:
            results["failure"] += 1
            results["failed_endpoints"].append(sub.endpoint)

    return results
