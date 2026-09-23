import os
from contextlib import contextmanager
from sqlalchemy import create_engine, String, Integer, Float, Text, JSON, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

URL = os.getenv('DATABASE_URL', 'sqlite:///./fgl.db')
engine = create_engine(URL, connect_args={'check_same_thread': False, 'timeout': 20} if URL.startswith('sqlite') else {}, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(30))

class LoginSession(Base):
    __tablename__ = 'sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    expires: Mapped[float] = mapped_column(Float)

class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    expires: Mapped[float] = mapped_column(Float)

class Event(Base):
    __tablename__ = 'events'
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)

class Audit(Base):
    __tablename__ = 'audit'
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[str] = mapped_column(Text)
    created: Mapped[float] = mapped_column(Float)

@contextmanager
def transaction():
    """Serialize writes on SQLite; PostgreSQL callers additionally lock the event row."""
    with Session() as session:
        try:
            if engine.dialect.name == 'sqlite':
                session.execute(text('BEGIN IMMEDIATE'))
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def locked_event(session):
    return session.scalar(select(Event).where(Event.id == 1).with_for_update())

class AccountControl(Base):
    __tablename__ = 'account_controls'
    user_id: Mapped[int] = mapped_column(primary_key=True)
    disabled: Mapped[bool] = mapped_column(default=False)
