# Package initialization for models
from backend.app.core.database import Base
from backend.app.models.user import User, UserRole
from backend.app.models.student import Student
from backend.app.models.mentor import Mentor
from backend.app.models.meeting import Meeting
from backend.app.models.knowledge_chunk import KnowledgeChunk