"""files: pages that write math as LaTeX

`files_document_pages.latex` marks a page whose text writes math as LaTeX between `$` (read by a
model under the OCR prompt, or from HTML with MathML): the app typesets math on these pages only
(M07 §6.1). False for every existing row: none was written to that rule before.

Revision ID: 0075
Revises: 0074
Create Date: 2026-11-24 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0075"
down_revision: str | Sequence[str] | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("files_document_pages") as batch:
        batch.add_column(sa.Column("latex", sa.Boolean(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    with op.batch_alter_table("files_document_pages") as batch:
        batch.drop_column("latex")
