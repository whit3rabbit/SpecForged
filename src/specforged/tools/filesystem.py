# src/specforged/tools/filesystem.py
from typing import Any, Dict

import aiofiles
from mcp.server.fastmcp import Context, FastMCP

from ..core.spec_manager import SpecificationManager


def setup_filesystem_tools(mcp: FastMCP, spec_manager: SpecificationManager) -> None:
    """Setup filesystem-related MCP tools, constrained to the detected project root.

    Tools:
    - read_file(path): Read a UTF-8 text file within the project.
    - write_file(path, content, mode): Write/append UTF-8 text within the project.
    - edit_block(file_path, old_string, new_string, expected_replacements):
      Safe text replacement.

    All paths are validated to be inside the project root using
    ProjectDetector.validate_path.
    """

    @mcp.tool()
    async def read_file(path: str, ctx: Context) -> Dict[str, Any]:
        """
        Read the content of a file within the project directory.

        Args:
            path: Relative or absolute path to the file (must resolve
                under project root).
        """
        try:
            validated_path = spec_manager.project_detector.validate_path(path)
            async with aiofiles.open(validated_path, mode="r", encoding="utf-8") as f:
                content = await f.read()
            return {
                "status": "success",
                "path": str(validated_path),
                "content": content,
            }
        except FileNotFoundError:
            return {"status": "error", "message": f"File not found: {path}"}
        except PermissionError as e:
            return {"status": "error", "message": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"status": "error", "message": f"Error reading file {path}: {e}"}

    @mcp.tool()
    async def create_directory(
        path: str, ctx: Context, exist_ok: bool = True
    ) -> Dict[str, Any]:
        """
        Create a directory within the project directory (recursively).

        Args:
            path: Relative or absolute directory path (must resolve
                under project root).
            exist_ok: If True (default), do not error if directory already exists.
        """
        try:
            validated_path = spec_manager.project_detector.validate_path(path)
            validated_path.mkdir(parents=True, exist_ok=exist_ok)
            return {
                "status": "success",
                "message": f"Directory ensured: {validated_path}",
                "path": str(validated_path),
            }
        except PermissionError as e:
            return {"status": "error", "message": str(e)}
        except Exception as e:  # noqa: BLE001
            return {
                "status": "error",
                "message": f"Error creating directory {path}: {e}",
            }

    @mcp.tool()
    async def write_file(
        path: str, content: str, ctx: Context, mode: str = "rewrite"
    ) -> Dict[str, Any]:
        """
        Write or append UTF-8 text to a file within the project directory.
        Creates the file and parent directories if they don't exist.

        Args:
            path: Relative or absolute path to the file (must resolve
                under project root).
            content: Text to write.
            mode: 'rewrite' (default) to overwrite, 'append' to append.
        """
        try:
            validated_path = spec_manager.project_detector.validate_path(path)
            validated_path.parent.mkdir(parents=True, exist_ok=True)
            if mode == "rewrite":
                async with aiofiles.open(
                    file=validated_path, mode="w", encoding="utf-8"
                ) as f:
                    await f.write(content)
            else:
                async with aiofiles.open(
                    file=validated_path, mode="a", encoding="utf-8"
                ) as f:
                    await f.write(content)
            action = "written" if mode == "rewrite" else "appended"
            return {
                "status": "success",
                "message": f"Content {action} to {validated_path}",
                "path": str(validated_path),
            }
        except PermissionError as e:
            return {"status": "error", "message": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"status": "error", "message": f"Error writing to file {path}: {e}"}

    @mcp.tool()
    async def edit_block(
        file_path: str,
        old_string: str,
        new_string: str,
        ctx: Context,
        expected_replacements: int = 1,
    ) -> Dict[str, Any]:
        """
        Replace a specific block of text in a file within the project directory.

        Args:
            file_path: Path to the file to edit (must resolve under project
                root).
            old_string: Exact string to be replaced.
            new_string: Replacement string.
            expected_replacements: Expected number of occurrences to replace
                (default: 1).
        """
        try:
            validated_path = spec_manager.project_detector.validate_path(file_path)
            async with aiofiles.open(validated_path, mode="r", encoding="utf-8") as f:
                content = await f.read()

            occurrences = content.count(old_string)
            if occurrences != expected_replacements:
                return {
                    "status": "error",
                    "message": (
                        f"Found {occurrences} occurrence(s), expected "
                        f"{expected_replacements}. "
                        "Provide a more specific old_string to ensure "
                        "precise replacement."
                    ),
                }

            if occurrences == 0:
                return {
                    "status": "error",
                    "message": f"Search string not found in {file_path}.",
                }

            new_content = content.replace(old_string, new_string, expected_replacements)
            async with aiofiles.open(validated_path, mode="w", encoding="utf-8") as f:
                await f.write(new_content)

            return {
                "status": "success",
                "message": f"Replaced {occurrences} occurrence(s) in {validated_path}.",
                "path": str(validated_path),
            }
        except FileNotFoundError:
            return {"status": "error", "message": f"File not found: {file_path}"}
        except PermissionError as e:
            return {"status": "error", "message": str(e)}
        except Exception as e:  # noqa: BLE001
            return {
                "status": "error",
                "message": f"Error editing file {file_path}: {e}",
            }
