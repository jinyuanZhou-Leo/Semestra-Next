"""Names of board cards for the assistant's chat (`core.labels`)."""

from semestra.core.labels import owned_names, resolver
from semestra.modules.layouts.models import LayoutsCardSetting
from semestra.modules.layouts.service import card_name

# A card by what the user calls it: a habit's or counter's name, a note's first line. Read as
# stored (a card its board only generates has nothing to show yet).
resolver("instance")(owned_names(LayoutsCardSetting, lambda row: card_name(row.settings)))
