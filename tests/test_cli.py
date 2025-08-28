"""
Tests for the SpecForge CLI functionality.

This module tests the command-line interface entry points and their behavior.
"""

import sys
from unittest.mock import MagicMock, patch

import pytest

from specforged.cli import main, specforge_http, specforge_mcp, specforge_new


class TestSpecforgeMCP:
    """Test the MCP server CLI functionality"""

    @patch("specforged.cli.create_server")
    @patch("specforged.cli.run_server")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_specforge_mcp_default_args(
        self, mock_parse_args, mock_run_server, mock_create_server
    ):
        """Test MCP server with default arguments"""
        # Mock default arguments (no base_dir specified)
        mock_args = MagicMock()
        mock_args.base_dir = None
        mock_parse_args.return_value = mock_args

        specforge_mcp()

        # Should call run_server() when no base_dir specified
        mock_run_server.assert_called_once()
        mock_create_server.assert_not_called()

    @patch("specforged.cli.create_server")
    @patch("specforged.cli.run_server")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_specforge_mcp_with_base_dir(
        self, mock_parse_args, mock_run_server, mock_create_server
    ):
        """Test MCP server with custom base directory"""
        mock_args = MagicMock()
        mock_args.base_dir = "/custom/path"
        mock_parse_args.return_value = mock_args

        mock_server = MagicMock()
        mock_create_server.return_value = mock_server

        specforge_mcp()

        # Should call create_server with resolved path
        mock_create_server.assert_called_once()
        call_args = mock_create_server.call_args[1]  # keyword args
        assert "base_dir" in call_args
        mock_server.run.assert_called_once()
        mock_run_server.assert_not_called()

    @patch("specforged.cli.run_server")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_specforge_mcp_keyboard_interrupt(self, mock_parse_args, mock_run_server):
        """Test MCP server handles KeyboardInterrupt gracefully"""
        mock_args = MagicMock()
        mock_args.base_dir = None
        mock_parse_args.return_value = mock_args

        mock_run_server.side_effect = KeyboardInterrupt()

        with patch("sys.exit") as mock_exit:
            specforge_mcp()
            mock_exit.assert_called_once_with(0)


class TestSpecforgeHTTP:
    """Test the HTTP server CLI functionality"""

    @patch("uvicorn.run")
    @patch("specforged.cli.create_server")
    def test_specforge_http_default_port(self, mock_create_server, mock_uvicorn_run):
        """Test HTTP server with default port"""
        mock_server = MagicMock()
        mock_create_server.return_value = mock_server
        mock_server.streamable_http_app.return_value = MagicMock()

        with patch.dict("os.environ", {}, clear=True):
            specforge_http()

        # Should use default port 8000
        mock_uvicorn_run.assert_called_once()
        call_args = mock_uvicorn_run.call_args
        assert call_args[1]["port"] == 8000
        assert call_args[1]["host"] == "0.0.0.0"

    @patch("uvicorn.run")
    @patch("specforged.cli.create_server")
    def test_specforge_http_custom_port(self, mock_create_server, mock_uvicorn_run):
        """Test HTTP server with custom port from environment"""
        mock_server = MagicMock()
        mock_create_server.return_value = mock_server
        mock_server.streamable_http_app.return_value = MagicMock()

        with patch.dict("os.environ", {"PORT": "9000"}):
            specforge_http()

        # Should use custom port from environment
        mock_uvicorn_run.assert_called_once()
        call_args = mock_uvicorn_run.call_args
        assert call_args[1]["port"] == 9000

    @patch("uvicorn.run")
    @patch("specforged.cli.create_server")
    def test_specforge_http_keyboard_interrupt(
        self, mock_create_server, mock_uvicorn_run
    ):
        """Test HTTP server handles KeyboardInterrupt gracefully"""
        mock_server = MagicMock()
        mock_create_server.return_value = mock_server
        mock_server.streamable_http_app.return_value = MagicMock()

        mock_uvicorn_run.side_effect = KeyboardInterrupt()

        with patch("sys.exit") as mock_exit:
            specforge_http()
            mock_exit.assert_called_once_with(0)


class TestSpecforgeNew:
    """Test the new project wizard CLI functionality"""

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_default_args(self, mock_template_manager, mock_run_wizard):
        """Test new command with default arguments"""
        mock_args = MagicMock()
        del mock_args.base_dir  # Test hasattr check
        del mock_args.template  # Test hasattr check

        mock_run_wizard.return_value = "test-project"

        specforge_new(mock_args)

        # Should call run_wizard with default base_dir
        mock_run_wizard.assert_called_once_with("specifications")

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_custom_base_dir(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command with custom base directory"""
        mock_args = MagicMock()
        mock_args.base_dir = "/custom/specs"
        mock_args.template = None

        mock_run_wizard.return_value = "test-project"

        specforge_new(mock_args)

        # Should call run_wizard with custom base_dir
        mock_run_wizard.assert_called_once_with("/custom/specs")

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_with_valid_template(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command with valid template"""
        mock_args = MagicMock()
        del mock_args.base_dir  # Test hasattr check
        mock_args.template = "web-app"

        # Mock template manager
        mock_tm_instance = MagicMock()
        mock_tm_instance.get_available_templates.return_value = {
            "web-app": {"name": "Web Application"}
        }
        mock_template_manager.return_value = mock_tm_instance

        mock_run_wizard.return_value = "test-project"

        specforge_new(mock_args)

        mock_run_wizard.assert_called_once_with("specifications")

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_with_invalid_template(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command with invalid template"""
        mock_args = MagicMock()
        del mock_args.base_dir  # Test hasattr check
        mock_args.template = "invalid-template"

        # Mock template manager with no matching template
        mock_tm_instance = MagicMock()
        mock_tm_instance.get_available_templates.return_value = {
            "web-app": {"name": "Web Application"}
        }
        mock_template_manager.return_value = mock_tm_instance

        with patch("sys.exit") as mock_exit:
            mock_exit.side_effect = SystemExit(1)
            with pytest.raises(SystemExit):
                specforge_new(mock_args)
            mock_exit.assert_called_once_with(1)

        mock_run_wizard.assert_not_called()

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_wizard_cancelled(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command when wizard is cancelled"""
        mock_args = MagicMock()
        mock_args.base_dir = None
        mock_args.template = None

        mock_run_wizard.return_value = None  # Wizard cancelled

        with patch("sys.exit") as mock_exit:
            specforge_new(mock_args)
            mock_exit.assert_called_once_with(1)

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_keyboard_interrupt(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command handles KeyboardInterrupt gracefully"""
        mock_args = MagicMock()
        mock_args.base_dir = None
        mock_args.template = None

        mock_run_wizard.side_effect = KeyboardInterrupt()

        with patch("sys.exit") as mock_exit:
            specforge_new(mock_args)
            mock_exit.assert_called_once_with(0)

    @patch("specforged.wizard.run_wizard")
    @patch("specforged.templates.TemplateManager")
    def test_specforge_new_exception_handling(
        self, mock_template_manager, mock_run_wizard
    ):
        """Test new command handles general exceptions"""
        mock_args = MagicMock()
        mock_args.base_dir = None
        mock_args.template = None

        mock_run_wizard.side_effect = ValueError("Test error")

        with patch("sys.exit") as mock_exit:
            specforge_new(mock_args)
            mock_exit.assert_called_once_with(1)


class TestMainCLI:
    """Test the main CLI entry point"""

    @patch("specforged.cli.specforge_mcp")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_mcp_command(self, mock_parse_args, mock_specforge_mcp):
        """Test main CLI with mcp command"""
        mock_args = MagicMock()
        mock_args.command = "mcp"
        mock_parse_args.return_value = mock_args

        main()

        mock_specforge_mcp.assert_called_once()

    @patch("specforged.cli.specforge_http")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_http_command(self, mock_parse_args, mock_specforge_http):
        """Test main CLI with http command"""
        mock_args = MagicMock()
        mock_args.command = "http"
        mock_args.port = None
        mock_parse_args.return_value = mock_args

        main()

        mock_specforge_http.assert_called_once()

    @patch("specforged.cli.specforge_http")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_http_command_with_port(self, mock_parse_args, mock_specforge_http):
        """Test main CLI with http command and custom port"""
        mock_args = MagicMock()
        mock_args.command = "http"
        mock_args.port = 9000
        mock_parse_args.return_value = mock_args

        main()

        # Should set PORT environment variable
        import os

        assert os.environ.get("PORT") == "9000"
        mock_specforge_http.assert_called_once()

    @patch("specforged.cli.specforge_new")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_new_command(self, mock_parse_args, mock_specforge_new):
        """Test main CLI with new command"""
        mock_args = MagicMock()
        mock_args.command = "new"
        mock_parse_args.return_value = mock_args

        main()

        mock_specforge_new.assert_called_once_with(mock_args)

    @patch("specforged.cli.specforge_mcp")
    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_default_command(self, mock_parse_args, mock_specforge_mcp):
        """Test main CLI with no command (defaults to mcp)"""
        mock_args = MagicMock()
        mock_args.command = None
        mock_parse_args.return_value = mock_args

        main()

        mock_specforge_mcp.assert_called_once()

    @patch("specforged.cli.argparse.ArgumentParser.parse_args")
    def test_main_argument_parser_setup(self, mock_parse_args):
        """Test that argument parser is set up correctly"""
        mock_args = MagicMock()
        mock_args.command = "mcp"
        mock_parse_args.return_value = mock_args

        with patch("specforged.cli.specforge_mcp"):
            main()

        # Verify ArgumentParser was called with expected configuration
        mock_parse_args.assert_called_once()


class TestCLIIntegration:
    """Integration tests for CLI functionality"""

    @patch("specforged.cli.specforge_mcp")
    def test_cli_version_display(self, mock_specforge_mcp):
        """Test that CLI can display version information"""
        from specforged import __version__
        from specforged.cli import main

        # Mock argv to include --version flag
        with patch.object(sys, "argv", ["specforged", "--version"]):
            with patch("sys.exit") as mock_exit:
                mock_exit.side_effect = SystemExit(0)
                # Should exit with version display
                with pytest.raises(SystemExit):
                    main()
                mock_exit.assert_called_once_with(0)

        # Should not call the MCP server
        mock_specforge_mcp.assert_not_called()

        # Verify version is accessible
        assert __version__ is not None
        assert len(__version__) > 0

    @patch("specforged.cli.specforge_mcp")
    def test_cli_help_display(self, mock_specforge_mcp):
        """Test that CLI can display help information"""
        from specforged.cli import main

        # Mock argv to include --help flag
        with patch.object(sys, "argv", ["specforged", "--help"]):
            with patch("sys.exit") as mock_exit:
                mock_exit.side_effect = SystemExit(0)
                # Should exit with help display
                with pytest.raises(SystemExit):
                    main()
                mock_exit.assert_called_once_with(0)

        # Should not call the MCP server
        mock_specforge_mcp.assert_not_called()

    @patch("specforged.wizard.run_wizard")
    def test_new_command_integration(self, mock_run_wizard):
        """Integration test for new command"""
        from specforged.cli import main

        mock_run_wizard.return_value = "test-project"

        # Mock argv for new command with arguments
        test_argv = [
            "specforged",
            "new",
            "--base-dir",
            "./test-specs",
            "--template",
            "web-app",
        ]

        with patch.object(sys, "argv", test_argv):
            with patch("specforged.templates.TemplateManager") as mock_tm:
                mock_tm_instance = MagicMock()
                mock_tm_instance.get_available_templates.return_value = {
                    "web-app": {"name": "Web Application"}
                }
                mock_tm.return_value = mock_tm_instance

                main()

        # Should call run_wizard with the specified base directory
        mock_run_wizard.assert_called_once_with("./test-specs")

    @patch("specforged.cli.specforge_mcp")
    def test_mcp_command_integration(self, mock_specforge_mcp):
        """Integration test for mcp command"""
        from specforged.cli import main

        # Mock argv for mcp command
        with patch.object(sys, "argv", ["specforged", "mcp"]):
            main()

        mock_specforge_mcp.assert_called_once()

    def test_http_command_integration(self):
        """Integration test for http command"""
        from specforged.cli import main

        # Mock argv for http command with port
        with patch.object(sys, "argv", ["specforged", "http", "--port", "9000"]):
            with patch("uvicorn.run") as mock_uvicorn_run:
                with patch("specforged.cli.create_server") as mock_create_server:
                    mock_server = MagicMock()
                    mock_create_server.return_value = mock_server
                    mock_server.streamable_http_app.return_value = MagicMock()

                    main()

        # Should call uvicorn with port 9000
        mock_uvicorn_run.assert_called_once()
        call_args = mock_uvicorn_run.call_args
        assert call_args[1]["port"] == 9000
