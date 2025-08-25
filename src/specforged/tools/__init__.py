"""
MCP tools for SpecForge server.
"""

from .classification import setup_classification_tools
from .specifications import setup_spec_tools
from .workflow import setup_workflow_tools
from .planning import setup_planning_tools

__all__ = [
    "setup_classification_tools",
    "setup_spec_tools",
    "setup_workflow_tools",
    "setup_planning_tools",
]
