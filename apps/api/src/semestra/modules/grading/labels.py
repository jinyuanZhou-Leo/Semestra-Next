"""Names of assessments and grading categories for the assistant's chat (`core.labels`)."""

from semestra.core.labels import owned_names, resolver
from semestra.modules.grading.models import GradingAssessment, GradingCategory

resolver("assessment")(owned_names(GradingAssessment, lambda row: row.title))
resolver("category")(owned_names(GradingCategory, lambda row: row.name))
