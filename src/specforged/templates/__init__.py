"""
SpecForge Project Templates

Provides pre-built templates for common project types to accelerate
specification creation and provide best practices.
"""

from typing import Any, Dict, List, Optional

from .rest_api import get_rest_api_tasks, get_rest_api_template
from .web_app import get_web_app_tasks, get_web_app_template


class TemplateManager:
    """Manages project templates for the wizard"""

    def __init__(self) -> None:
        self.templates = {
            "web-app": {
                "get_template": get_web_app_template,
                "get_tasks": get_web_app_tasks,
                "name": "Web Application",
                "description": "Full-stack web application with frontend and backend",
            },
            "rest-api": {
                "get_template": get_rest_api_template,
                "get_tasks": get_rest_api_tasks,
                "name": "REST API Service",
                "description": "RESTful API service with CRUD operations",
            },
        }

    def get_available_templates(self) -> Dict[str, Dict[str, str]]:
        """Get list of available templates"""
        return {
            key: {
                "name": str(template["name"]),
                "description": str(template["description"]),
            }
            for key, template in self.templates.items()
        }

    def get_template(self, template_key: str) -> Optional[Dict[str, Any]]:
        """Get template data by key"""
        if template_key in self.templates:
            template_func = self.templates[template_key]["get_template"]
            if callable(template_func):
                result = template_func()
                return result if isinstance(result, dict) else None
            return None
        return None

    def get_template_tasks(self, template_key: str) -> Optional[List[str]]:
        """Get template tasks by key"""
        if template_key in self.templates:
            task_func = self.templates[template_key]["get_tasks"]
            if callable(task_func):
                result = task_func()
                return result if isinstance(result, list) else None
            return None
        return None

    def apply_template_to_spec(
        self, spec_manager: Any, spec_id: str, template_key: str
    ) -> bool:
        """Apply template to an existing specification"""
        template = self.get_template(template_key)
        if not template:
            return False

        try:
            # Add user stories from template
            for story_data in template.get("user_stories", []):
                story = spec_manager.add_user_story(
                    spec_id,
                    story_data["as_a"],
                    story_data["i_want"],
                    story_data["so_that"],
                )

                # Add EARS requirements
                for ears_data in story_data.get("ears_requirements", []):
                    from ..models import EARSRequirement

                    ears_req = EARSRequirement(
                        id=f"{story.id}-R{len(story.requirements) + 1:02d}",
                        condition=ears_data["condition"],
                        system_response=ears_data["system_response"],
                    )
                    story.requirements.append(ears_req)

            # Update design from template
            spec = spec_manager.specs[spec_id]
            spec.design.update(
                {
                    "architecture": template.get("architecture", ""),
                    "components": template.get("components", []),
                    "data_models": template.get("data_models", ""),
                    "sequence_diagrams": template.get("sequence_diagrams", []),
                }
            )

            # Save changes
            spec_manager.save_specification(spec_id)
            return True

        except (KeyError, AttributeError, ValueError, TypeError) as e:
            print(f"Error applying template {template_key}: {e}")
            return False
