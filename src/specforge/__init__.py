"""
SpecForge - Specification-driven development with EARS notation and MCP

A Model Context Protocol (MCP) server that implements intelligent mode classification,
structured workflow management, and EARS (Easy Approach to Requirements Syntax) notation.
"""

__version__ = "1.0.0"
__author__ = "SpecForge Team"

# Conditional imports to avoid dependency issues during testing
__all__ = [
    "__version__",
    "__author__",
]

try:
    from .server import create_server, run_server
    from .cli import specforge_mcp, specforge_http
    __all__.extend([
        "create_server",
        "run_server", 
        "specforge_mcp",
        "specforge_http",
    ])
except ImportError:
    # Dependencies not available - likely during testing or build
    pass
