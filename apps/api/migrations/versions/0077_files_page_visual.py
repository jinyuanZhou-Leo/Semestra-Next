"""files: pages with handwriting or figures

`files_document_pages.visual` marks a page whose text may not have everything on it (a scan,
handwriting, drawings; M07 §3.1): read and search results say so, and a model that sees pages
looks at it. Existing pages that OCR read are such pages; the others stay false until read again
(PDFs read before the page classifier, reader version 1, are listed for that in AI settings).

Revision ID: 0077
Revises: 0076
Create Date: 2026-11-27 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0077"
down_revision: str | Sequence[str] | None = "0076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("files_document_pages") as batch:
        batch.add_column(
            sa.Column("visual", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )
    op.execute("UPDATE files_document_pages SET visual = ocr_used")


def downgrade() -> None:
    with op.batch_alter_table("files_document_pages") as batch:
        batch.drop_column("visual")
