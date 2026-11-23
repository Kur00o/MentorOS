from alembic import op
import sqlalchemy as sa

revision = "9b4c68dca0ae"  
down_revision = None       
branch_labels = None
depends_on = None


def upgrade():
    # Ensure vector extension exists (safe to run even if already enabled)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Create the table with standard columns first
    op.create_table(
        "knowledge_chunks",
        sa.Column("id",          sa.Integer(),     primary_key=True),
        sa.Column("question",    sa.Text(),        nullable=False),
        sa.Column("answer",      sa.Text(),        nullable=False),
        sa.Column("source_file", sa.String(255),   nullable=False),
        sa.Column("created_at",  sa.DateTime(timezone=True),
                  server_default=sa.text("now()")),
    )

    # Add the vector column separately via raw SQL.
    # WHY: Alembic doesn't natively understand the 'vector' type,
    # so we bypass it just for this column.
    op.execute(
        "ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(768) NOT NULL"
    )

    # Create HNSW index for cosine similarity search.
    # OPINIONATED: vector_cosine_ops = cosine similarity metric.
    # Alternative is vector_l2_ops (Euclidean distance) — cosine is better
    # for text embeddings because it's length-invariant.
    op.execute(
        "CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade():
    op.drop_table("knowledge_chunks")