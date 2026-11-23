from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ProvenanceMixin:
    """Marks where a row came from so synthetic demo data never mixes
    silently with real institutional data (see `data_batches`)."""

    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    @declared_attr
    def batch_id(cls) -> Mapped[Optional[int]]:  # noqa: N805
        return mapped_column(Integer, ForeignKey("data_batches.id", ondelete="SET NULL"), nullable=True, index=True)
