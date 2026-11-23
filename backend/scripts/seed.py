"""Local CLI: apply migrations, load the knowledge base and (re)generate the
synthetic demo institution.

    python -m backend.scripts.seed
"""

from backend.app.companion.knowledge import sync_knowledge
from backend.app.core.database import SessionLocal
from backend.app.ops.router import run_migrations
from backend.app.seed.generator import generate

if __name__ == "__main__":
    print("migrations:", run_migrations())
    db = SessionLocal()
    print("knowledge chunks:", sync_knowledge(db))
    print(generate(db))
    db.close()
