"""normalize attendance subjects

Revision ID: 1aa377368443
Revises: 002
Create Date: 2026-07-12 22:53:07.313593
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1aa377368443"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create subjects table (no issue - new table)
    op.create_table(
        "subjects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subject_code", sa.String(length=50), nullable=False),
        sa.Column("subject_name", sa.String(length=255), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("department", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_subjects_department"), "subjects", ["department"], unique=False)
    op.create_index(op.f("ix_subjects_id"), "subjects", ["id"], unique=False)
    op.create_index(op.f("ix_subjects_subject_code"), "subjects", ["subject_code"], unique=True)

    # 2. Add subject_id column to attendance_records using batch operations
    # SQLite requires batch mode for: adding non-nullable column, dropping constraints, dropping columns
    with op.batch_alter_table("attendance_records") as batch_op:
        # Add nullable subject_id first (will backfill in step 3)
        batch_op.add_column(sa.Column("subject_id", sa.Integer(), nullable=True))

    # 3. Backfill subject_id from existing subject_code data
    # This requires raw SQL to join and update
    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE attendance_records
        SET subject_id = (
            SELECT id FROM subjects
            WHERE subjects.subject_code = attendance_records.subject_code
        )
    """))

    # 4. Now make subject_id non-nullable and add constraints using batch
    with op.batch_alter_table("attendance_records") as batch_op:
        # Make subject_id non-nullable (now that data is backfilled)
        batch_op.alter_column("subject_id", existing_type=sa.Integer(), nullable=False)
        # Drop old unique constraint (student_id, subject_code, period)
        batch_op.drop_constraint("uq_attendance_student_subject_period", type_="unique")
        # Add new unique constraint (student_id, subject_id, period)
        batch_op.create_unique_constraint(
            "uq_attendance_student_subject_period",
            ["student_id", "subject_id", "period"]
        )
        # Add foreign key
        batch_op.create_foreign_key(
            "fk_attendance_records_subject_id_subjects",
            "subjects",
            ["subject_id"],
            ["id"]
        )
        # Add index on subject_id
        batch_op.create_index(
            op.f("ix_attendance_records_subject_id"),
            ["subject_id"],
            unique=False
        )
        # Drop denormalized columns
        batch_op.drop_column("subject_code")
        batch_op.drop_column("subject_name")


def downgrade() -> None:
    # Reverse operations using batch for SQLite compatibility
    with op.batch_alter_table("attendance_records") as batch_op:
        # Restore denormalized columns (nullable for backfill)
        batch_op.add_column(sa.Column("subject_name", sa.VARCHAR(length=255), nullable=True))
        batch_op.add_column(sa.Column("subject_code", sa.VARCHAR(length=50), nullable=True))

    # Backfill subject_code and subject_name from subjects table
    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE attendance_records
        SET subject_code = (
            SELECT subject_code FROM subjects WHERE subjects.id = attendance_records.subject_id
        ),
        subject_name = (
            SELECT subject_name FROM subjects WHERE subjects.id = attendance_records.subject_id
        )
    """))

    with op.batch_alter_table("attendance_records") as batch_op:
        # Make subject_code non-nullable now that data is backfilled
        batch_op.alter_column("subject_code", existing_type=sa.VARCHAR(length=50), nullable=False)
        # Drop foreign key
        batch_op.drop_constraint("fk_attendance_records_subject_id_subjects", type_="foreignkey")
        # Drop index on subject_id
        batch_op.drop_index(op.f("ix_attendance_records_subject_id"))
        # Drop new unique constraint
        batch_op.drop_constraint("uq_attendance_student_subject_period", type_="unique")
        # Restore old unique constraint (student_id, subject_code, period)
        batch_op.create_unique_constraint(
            op.f("uq_attendance_student_subject_period"),
            ["student_id", "subject_code", "period"]
        )
        # Drop subject_id column
        batch_op.drop_column("subject_id")

    # Drop subjects table
    op.drop_index(op.f("ix_subjects_subject_code"), table_name="subjects")
    op.drop_index(op.f("ix_subjects_id"), table_name="subjects")
    op.drop_index(op.f("ix_subjects_department"), table_name="subjects")
    op.drop_table("subjects")