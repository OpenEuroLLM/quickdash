"""Quickdash's native, configuration-driven evaluation analysis API."""

from .analysis import (
    analyze,
    compare,
    read_results,
    QuickdashWarning,
    DiagnosticError,
    Report,
)
from .config import load_config

__all__ = [
    "analyze",
    "compare",
    "read_results",
    "load_config",
    "QuickdashWarning",
    "DiagnosticError",
    "Report",
]
