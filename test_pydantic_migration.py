#!/usr/bin/env python3
"""
Test script to verify Pydantic v2 migration is working correctly.
Run this after installing dependencies with: uv sync
"""


def test_pydantic_imports():
    """Test that all Pydantic v2 imports work correctly."""
    try:
        # Test imports to verify Pydantic v2 compatibility
        from src.specforged.config.schema import (
            UnifiedConfig,
            FeatureFlag,
            NotificationConfig,
            PerformanceConfig,
            VSCodeExtensionConfig,
            MCPServerConfig,
        )
        from src.specforged.config.performance import (
            PerformanceConfigModel,
            PerformanceProfile,
        )

        # Ensure all imports are accessible
        assert UnifiedConfig
        assert FeatureFlag
        assert NotificationConfig
        assert PerformanceConfig
        assert VSCodeExtensionConfig
        assert MCPServerConfig
        assert PerformanceConfigModel
        assert PerformanceProfile

        print("✓ All imports successful")
        return True
    except Exception as e:
        print(f"✗ Import failed: {e}")
        return False


def test_field_validators():
    """Test that field validators work correctly."""
    try:
        from src.specforged.config.schema import FeatureFlag

        # Test valid feature flag
        FeatureFlag(name="test_feature", created_at="2024-01-01T00:00:00Z")
        print("✓ Valid FeatureFlag creation successful")

        # Test invalid feature flag name
        try:
            FeatureFlag(
                name="Test_Feature",  # Invalid: uppercase letters
                created_at="2024-01-01T00:00:00Z",
            )
            print("✗ Invalid feature flag should have failed validation")
            return False
        except ValueError:
            print("✓ Invalid feature flag correctly rejected")

        return True
    except Exception as e:
        print(f"✗ Field validator test failed: {e}")
        return False


def test_model_validator():
    """Test that model validator works correctly."""
    try:
        from src.specforged.config.schema import UnifiedConfig

        # Test creating a config with minimal required fields
        UnifiedConfig(
            created_at="2024-01-01T00:00:00Z",
            mcp_server={"name": "test_server", "version": "1.0.0"},
        )
        print("✓ UnifiedConfig creation successful")
        return True
    except Exception as e:
        print(f"✗ Model validator test failed: {e}")
        return False


def test_performance_config():
    """Test performance configuration validators."""
    try:
        from src.specforged.config.performance import PerformanceConfigModel

        # Test default configuration
        PerformanceConfigModel()
        print("✓ PerformanceConfigModel creation successful")

        # Test profile validation
        PerformanceConfigModel(profile="balanced")
        print("✓ Profile validation successful")

        return True
    except Exception as e:
        print(f"✗ Performance config test failed: {e}")
        return False


def main():
    """Run all tests."""
    print("Testing Pydantic v2 migration...")
    print("=" * 50)

    tests = [
        test_pydantic_imports,
        test_field_validators,
        test_model_validator,
        test_performance_config,
    ]

    passed = 0
    total = len(tests)

    for test in tests:
        try:
            if test():
                passed += 1
            print()
        except Exception as e:
            print(f"✗ Test {test.__name__} failed with exception: {e}\n")

    print("=" * 50)
    print(f"Tests passed: {passed}/{total}")

    if passed == total:
        print("🎉 All Pydantic v2 migration tests passed!")
        return True
    else:
        print("❌ Some tests failed. Check the output above.")
        return False


if __name__ == "__main__":
    main()
