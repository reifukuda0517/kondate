from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from models import Base, User
import os

DATABASE_URL = "sqlite+aiosqlite:///./kondate.db"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def _migrate_date_nullable(conn):
    """Make meal_plans.date nullable for existing DBs."""
    from sqlalchemy import text
    result = await conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='meal_plans'"
    ))
    row = result.fetchone()
    if row and 'date DATE NOT NULL' in (row[0] or ''):
        await conn.execute(text("""
            CREATE TABLE meal_plans_new (
                id INTEGER PRIMARY KEY,
                date DATE,
                meal_name VARCHAR(200) NOT NULL,
                memo TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                is_confirmed BOOLEAN DEFAULT 0,
                created_at DATETIME,
                updated_at DATETIME
            )
        """))
        await conn.execute(text("INSERT INTO meal_plans_new SELECT * FROM meal_plans"))
        await conn.execute(text("DROP TABLE meal_plans"))
        await conn.execute(text("ALTER TABLE meal_plans_new RENAME TO meal_plans"))


async def init_db():
    async with engine.begin() as conn:
        await _migrate_date_nullable(conn)
        await conn.run_sync(Base.metadata.create_all)

    # Seed default users if they don't exist
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        result = await session.execute(select(User))
        users = result.scalars().all()
        if not users:
            husband = User(name="夫", role="husband")
            wife = User(name="妻", role="wife")
            session.add(husband)
            session.add(wife)
            await session.commit()
