"""
Cross-database SQLAlchemy type helpers.
Provides UUID and ArrayOfString types that work with both PostgreSQL and SQLite.
"""
import uuid
import json
from sqlalchemy import TypeDecorator, String, Text
from sqlalchemy.engine import Dialect


class GUID(TypeDecorator):
    """Platform-independent UUID type.
    Uses PostgreSQL native UUID on pg; CHAR(36) string on SQLite/others.
    """
    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import UUID as PG_UUID
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect: Dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return value  # pass uuid.UUID or str directly
        return str(value)  # SQLite stores as string

    def process_result_value(self, value, dialect: Dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        try:
            return uuid.UUID(str(value))
        except (ValueError, AttributeError):
            return value


class ArrayOfString(TypeDecorator):
    """Platform-independent list-of-strings type.
    Uses PostgreSQL ARRAY(String) on pg; JSON text on SQLite/others.
    """
    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import ARRAY
            return dialect.type_descriptor(ARRAY(String))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect: Dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return list(value) if not isinstance(value, list) else value
        return json.dumps(list(value) if not isinstance(value, list) else value)

    def process_result_value(self, value, dialect: Dialect):
        if value is None:
            return []
        if isinstance(value, list):
            return value
        try:
            result = json.loads(value)
            return result if isinstance(result, list) else []
        except Exception:
            return []
