"""
Celery application setup with Redis broker.
Configures task schedule for periodic jobs.
"""

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

# Create Celery app
celery_app = Celery(
    "market_cockpit",
    broker=settings.redis_url,
    backend=settings.redis_url
)

# Configure task schedule
celery_app.conf.beat_schedule = {
    "ingest-news": {
        "task": "app.workers.ingestion_tasks.ingest_news_sources",
        "schedule": settings.news_poll_interval_seconds,  # Every 3 minutes
    },
    "sync-calendars": {
        "task": "app.workers.ingestion_tasks.sync_calendars_task",
        "schedule": 3600,  # Every 60 minutes
    },
    "evaluate-alerts": {
        "task": "app.workers.ingestion_tasks.evaluate_alerts_task",
        "schedule": settings.alert_check_interval_seconds,  # Every 60 seconds
    },
    "generate-morning-briefs": {
        "task": "app.workers.ingestion_tasks.generate_morning_briefs_task",
        "schedule": crontab(hour=8, minute=30),  # 8:30 AM IST
    },
    "generate-evening-briefs": {
        "task": "app.workers.ingestion_tasks.generate_evening_briefs_task",
        "schedule": crontab(hour=17, minute=30),  # 5:30 PM EST
    },
}

# Configure task settings
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minute hard limit
)
