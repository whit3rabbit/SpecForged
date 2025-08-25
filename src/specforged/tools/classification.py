"""
Mode classification MCP tools.
"""

from typing import Dict, Any
from mcp.server.fastmcp import FastMCP, Context

from ..core.classifier import ModeClassifier


def setup_classification_tools(mcp: FastMCP, classifier: ModeClassifier) -> None:
    """Setup classification-related MCP tools"""

    @mcp.tool()
    async def classify_mode(user_input: str, ctx: Context) -> Dict[str, Any]:
        """
        Classify user input to determine routing mode.
        Returns confidence scores for chat, do, and spec modes.
        """
        classification = classifier.classify(user_input)

        await ctx.info(f"Classified as {classification.primary_mode.value} mode")

        return classification.to_dict()
