"""
Tests for the ModeClassifier.
"""

from src.specforged.core.classifier import ModeClassifier
from src.specforged.models import UserMode


def test_classifier_initialization():
    """Test that ModeClassifier initializes correctly"""
    classifier = ModeClassifier()
    assert classifier.spec_patterns is not None
    assert classifier.do_patterns is not None
    assert classifier.chat_patterns is not None


def test_spec_mode_classification():
    """Test classification of spec mode inputs"""
    classifier = ModeClassifier()

    test_cases = [
        "Create a spec for user authentication",
        "Generate specification for payment system",
        "Write a spec for the login system",
        "Execute task 3.2 from user-auth spec",
    ]

    for test_input in test_cases:
        result = classifier.classify(test_input)
        assert result.primary_mode == UserMode.SPEC
        assert result.spec_confidence > result.do_confidence
        assert result.spec_confidence > result.chat_confidence


def test_do_mode_classification():
    """Test classification of do mode inputs"""
    classifier = ModeClassifier()

    test_cases = [
        "Fix the syntax error in app.js",
        "Run the test suite",
        "Implement the login function",
        "Deploy to production",
        "git commit -m 'test'",
    ]

    for test_input in test_cases:
        result = classifier.classify(test_input)
        assert result.primary_mode == UserMode.DO
        assert result.do_confidence > result.spec_confidence
        assert result.do_confidence > result.chat_confidence


def test_chat_mode_classification():
    """Test classification of chat mode inputs"""
    classifier = ModeClassifier()

    test_cases = [
        "What is EARS notation?",
        "How do promises work?",
        "Explain the architecture",
        "Hello",
        "Thank you for your help",
    ]

    for test_input in test_cases:
        result = classifier.classify(test_input)
        assert result.primary_mode == UserMode.CHAT
        assert result.chat_confidence > result.spec_confidence
        assert result.chat_confidence > result.do_confidence


def test_confidence_sum():
    """Test that confidence scores sum to approximately 1"""
    classifier = ModeClassifier()

    result = classifier.classify("Test input")
    total_confidence = (
        result.chat_confidence + result.do_confidence + result.spec_confidence
    )

    # Allow small floating point errors
    assert abs(total_confidence - 1.0) < 0.001


def test_empty_input():
    """Test classification of empty or minimal input"""
    classifier = ModeClassifier()

    result = classifier.classify("")
    assert result.primary_mode == UserMode.DO  # Default fallback

    result = classifier.classify("hi")
    assert result.primary_mode == UserMode.CHAT  # Short greeting


def test_mixed_patterns():
    """Test inputs that might match multiple patterns"""
    classifier = ModeClassifier()

    # This should lean toward spec mode due to "create spec"
    result = classifier.classify("Create a spec and then run tests")
    assert result.primary_mode == UserMode.SPEC

    # This should lean toward do mode due to stronger "fix" pattern
    result = classifier.classify("Fix the code and update the spec")
    assert result.primary_mode == UserMode.DO
