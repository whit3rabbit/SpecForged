"""
Tests for the SpecForge wizard functionality.

This module tests the interactive project wizard that guides users through
specification creation with Requirements -> Design -> Planning phases.
"""

import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from specforged.wizard import ProjectWizard, run_wizard


@pytest.fixture
def temp_spec_dir():
    """Create a temporary directory for testing"""
    temp_dir = Path(tempfile.mkdtemp())
    yield temp_dir
    shutil.rmtree(temp_dir)


class TestProjectWizard:
    """Test the ProjectWizard class functionality"""

    def test_wizard_initialization_with_dependencies(self, temp_spec_dir):
        """Test that wizard initializes correctly when dependencies are available"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)
            assert wizard.spec_manager is not None
            assert wizard.console is not None
            assert len(wizard.project_types) > 0
            assert len(wizard.architectures) > 0

    def test_wizard_initialization_without_dependencies(self, temp_spec_dir):
        """Test that wizard raises ImportError when interactive
        dependencies are missing"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", False):
            with pytest.raises(ImportError) as exc_info:
                ProjectWizard(temp_spec_dir)
            assert "Interactive dependencies not available" in str(exc_info.value)

    def test_project_types_available(self, temp_spec_dir):
        """Test that wizard has expected project types"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            expected_types = {
                "web-app": "Web Application",
                "rest-api": "REST API Service",
                "cli-tool": "Command Line Tool",
                "python-lib": "Python Library",
                "microservice": "Microservice",
                "desktop-app": "Desktop Application",
                "custom": "Custom Project",
            }

            assert wizard.project_types == expected_types

    def test_architecture_patterns_available(self, temp_spec_dir):
        """Test that wizard has expected architecture patterns"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            expected_architectures = {
                "mvc": "Model-View-Controller",
                "layered": "Layered Architecture",
                "microservices": "Microservices",
                "event-driven": "Event-Driven Architecture",
                "component": "Component-Based",
                "custom": "Custom Architecture",
            }

            assert wizard.architectures == expected_architectures

    @patch("specforged.wizard.questionary")
    def test_get_project_info_success(self, mock_questionary, temp_spec_dir):
        """Test successful project information gathering"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Mock questionary responses
            mock_questionary.text.return_value.ask.side_effect = [
                "Test Project",  # project name
                "A test project description",  # description
                "Python, FastAPI, PostgreSQL",  # tech stack
            ]
            mock_questionary.select.return_value.ask.return_value = (
                "web-app: Web Application"
            )

            project_info = wizard._get_project_info()

            assert project_info is not None
            assert project_info["name"] == "Test Project"
            assert project_info["description"] == "A test project description"
            assert project_info["type"] == "web-app"
            assert project_info["tech_stack"] == "Python, FastAPI, PostgreSQL"

    @patch("specforged.wizard.questionary")
    def test_get_project_info_cancelled(self, mock_questionary, temp_spec_dir):
        """Test project information gathering when user cancels"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Mock user cancelling (returning None)
            mock_questionary.text.return_value.ask.return_value = None

            project_info = wizard._get_project_info()

            assert project_info is None

    def test_create_specification_success(self, temp_spec_dir):
        """Test successful specification creation"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            project_info = {
                "name": "Test Project",
                "description": "A test project",
                "type": "web-app",
                "tech_stack": "Python, React",
            }

            spec_id = wizard._create_specification(project_info)

            assert spec_id is not None
            assert spec_id == "test-project"
            assert spec_id in wizard.spec_manager.specs

            spec = wizard.spec_manager.specs[spec_id]
            assert spec.name == "Test Project"
            assert spec.metadata["project_type"] == "web-app"
            assert spec.metadata["tech_stack"] == "Python, React"
            assert spec.metadata["created_via"] == "wizard"

    @patch("specforged.wizard.questionary")
    def test_get_user_story_success(self, mock_questionary, temp_spec_dir):
        """Test successful user story creation"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Mock questionary responses for user story
            mock_questionary.text.return_value.ask.side_effect = [
                "user",  # as_a
                "log into the system",  # i_want
                "I can access protected features",  # so_that
                "WHEN user enters valid credentials",  # EARS condition
                "authenticate and redirect to dashboard",  # EARS response
            ]
            mock_questionary.confirm.return_value.ask.side_effect = [
                True,  # Add EARS requirements?
                False,  # Add another EARS requirement?
            ]

            story = wizard._get_user_story()

            assert story is not None
            assert story["as_a"] == "user"
            assert story["i_want"] == "log into the system"
            assert story["so_that"] == "I can access protected features"
            assert len(story["ears_requirements"]) == 1
            assert (
                story["ears_requirements"][0]["condition"]
                == "WHEN user enters valid credentials"
            )
            assert (
                story["ears_requirements"][0]["system_response"]
                == "authenticate and redirect to dashboard"
            )

    @patch("specforged.wizard.questionary")
    def test_get_user_story_cancelled(self, mock_questionary, temp_spec_dir):
        """Test user story creation when user cancels"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Mock user cancelling (returning None)
            mock_questionary.text.return_value.ask.return_value = None

            story = wizard._get_user_story()

            assert story is None

    @patch("specforged.wizard.questionary")
    def test_design_phase_success(self, mock_questionary, temp_spec_dir):
        """Test successful design phase completion"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Create a test specification first
            spec = wizard.spec_manager.create_specification(
                "Test Project", "Test description"
            )

            # Mock questionary responses for design
            mock_questionary.select.return_value.ask.return_value = (
                "layered: Layered Architecture"
            )
            mock_questionary.text.return_value.ask.side_effect = [
                "Authentication Service",  # component name
                ("Handles user authentication and authorization"),
                # component description
                (
                    "interface User { id: string; name: string; " "email: string; }"
                ),  # data models
            ]
            mock_questionary.confirm.return_value.ask.side_effect = [
                False,  # Add another component?
                True,  # Define data models?
            ]

            wizard._design_phase(spec.id)

            # Verify design was updated
            updated_spec = wizard.spec_manager.specs[spec.id]
            assert "architecture" in updated_spec.design
            assert updated_spec.design["architecture"] == "Layered Architecture"
            assert len(updated_spec.design["components"]) == 1
            assert (
                updated_spec.design["components"][0]["name"] == "Authentication Service"
            )
            assert "data_models" in updated_spec.design

    def test_generate_tasks_success(self, temp_spec_dir):
        """Test successful task generation"""
        with patch("specforged.wizard.INTERACTIVE_AVAILABLE", True):
            wizard = ProjectWizard(temp_spec_dir)

            # Create and setup a specification
            spec = wizard.spec_manager.create_specification(
                "Test Project", "Test description"
            )

            # Add user story and EARS requirement
            story = wizard.spec_manager.add_user_story(
                spec.id, "user", "log into system", "access protected features"
            )
            wizard.spec_manager.add_ears_requirement(
                spec.id, story.id, "WHEN user enters credentials", "authenticate user"
            )

            # Add design
            spec.design = {
                "architecture": "Layered Architecture",
                "components": [
                    {"name": "Auth Service", "description": "Authentication"}
                ],
                "data_models": "interface User { id: string; }",
                "sequence_diagrams": [],
            }
            wizard.spec_manager.save_specification(spec.id)

            wizard._generate_tasks(spec.id)

            # Verify tasks were generated
            updated_spec = wizard.spec_manager.specs[spec.id]
            assert len(updated_spec.tasks) > 0

    @patch("specforged.wizard.questionary")
    @patch("specforged.wizard.INTERACTIVE_AVAILABLE", True)
    def test_run_wizard_keyboard_interrupt(self, mock_questionary, temp_spec_dir):
        """Test wizard handling keyboard interrupt gracefully"""
        wizard = ProjectWizard(temp_spec_dir)

        # Mock KeyboardInterrupt during project info gathering
        mock_questionary.text.return_value.ask.side_effect = KeyboardInterrupt()

        result = wizard.run()

        assert result is None

    @patch("specforged.wizard.questionary")
    @patch("specforged.wizard.INTERACTIVE_AVAILABLE", True)
    def test_run_wizard_exception_handling(self, mock_questionary, temp_spec_dir):
        """Test wizard handling general exceptions gracefully"""
        wizard = ProjectWizard(temp_spec_dir)

        # Mock exception during project info gathering
        mock_questionary.text.return_value.ask.side_effect = ValueError("Test error")

        result = wizard.run()

        assert result is None


class TestWizardFunction:
    """Test the run_wizard function"""

    @patch("specforged.wizard.ProjectWizard")
    def test_run_wizard_with_default_base_dir(self, mock_wizard_class):
        """Test run_wizard function with default base directory"""
        mock_wizard = MagicMock()
        mock_wizard.run.return_value = "test-project"
        mock_wizard_class.return_value = mock_wizard

        result = run_wizard()

        # Should create wizard with default base_dir of None (converted to Path)
        mock_wizard_class.assert_called_once()
        call_args = mock_wizard_class.call_args[0]
        assert call_args == (None,)

        mock_wizard.run.assert_called_once()
        assert result == "test-project"

    @patch("specforged.wizard.ProjectWizard")
    def test_run_wizard_with_custom_base_dir(self, mock_wizard_class):
        """Test run_wizard function with custom base directory"""
        mock_wizard = MagicMock()
        mock_wizard.run.return_value = "test-project"
        mock_wizard_class.return_value = mock_wizard

        result = run_wizard("/custom/path")

        # Should create wizard with custom base_dir as Path
        mock_wizard_class.assert_called_once()
        call_args = mock_wizard_class.call_args[0]
        # Should work on both Unix (/) and Windows (\) paths
        expected_path = Path("/custom/path")
        assert call_args[0] == expected_path

        mock_wizard.run.assert_called_once()
        assert result == "test-project"


class TestWizardIntegration:
    """Integration tests for wizard functionality"""

    @patch("specforged.wizard.INTERACTIVE_AVAILABLE", True)
    def test_wizard_creates_complete_specification(self, temp_spec_dir):
        """Integration test: wizard creates complete specification with all phases"""
        wizard = ProjectWizard(temp_spec_dir)

        # Create specification
        project_info = {
            "name": "Integration Test Project",
            "description": "A complete integration test",
            "type": "web-app",
            "tech_stack": "Python, FastAPI",
        }

        spec_id = wizard._create_specification(project_info)
        assert spec_id is not None

        # Verify specification files are created
        spec_dir = temp_spec_dir / spec_id
        assert spec_dir.exists()
        assert (spec_dir / "spec.json").exists()
        assert (spec_dir / "requirements.md").exists()
        assert (spec_dir / "design.md").exists()
        assert (spec_dir / "tasks.md").exists()

        # Verify specification content
        spec = wizard.spec_manager.specs[spec_id]
        assert spec.name == "Integration Test Project"
        assert spec.metadata["created_via"] == "wizard"
        assert spec.metadata["project_type"] == "web-app"

    @patch("specforged.wizard.INTERACTIVE_AVAILABLE", True)
    def test_wizard_workflow_phases(self, temp_spec_dir):
        """Integration test: wizard properly transitions through workflow phases"""
        wizard = ProjectWizard(temp_spec_dir)

        # Create and setup specification
        spec = wizard.spec_manager.create_specification("Phase Test", "Phase testing")

        # Add requirements (phase 1)
        story = wizard.spec_manager.add_user_story(
            spec.id, "developer", "test phases", "verify workflow"
        )
        wizard.spec_manager.add_ears_requirement(
            spec.id, story.id, "WHEN phase transitions", "validate workflow"
        )

        # Add design (phase 2)
        spec.design = {
            "architecture": "Test Architecture",
            "components": [{"name": "Test Component", "description": "For testing"}],
            "data_models": "interface TestModel { id: string; }",
            "sequence_diagrams": [],
        }
        wizard.spec_manager.save_specification(spec.id)

        # Generate tasks (phase 3)
        wizard._generate_tasks(spec.id)

        # Verify all phases completed
        final_spec = wizard.spec_manager.specs[spec.id]
        assert len(final_spec.user_stories) > 0
        assert len(final_spec.design) > 0
        assert len(final_spec.tasks) > 0
