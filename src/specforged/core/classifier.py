"""
Mode classification logic for determining user intent.
"""

import re

from ..models import ModeClassification, UserMode


class ModeClassifier:
    """Rule-based mode classifier for user input"""

    def __init__(self) -> None:
        # Spec mode trigger patterns with weights
        self.spec_patterns = [
            (r"\b(create|generate|write|draft)\s+(?:a\s+)?spec(?:ification)?", 0.9),
            (r"\bspec(?:ification)?\s+for\b", 0.85),
            (r"\b(?:execute|run)\s+task\s+[\d\.]+\s+from\s+[\w-]+\s+spec", 0.95),
            (r"\b(?:update|modify)\s+(?:the\s+)?(?:requirements|design|tasks)", 0.8),
            (r"\bEARS\s+(?:format|notation|requirements)", 0.9),
            (r"\b(?:user\s+stor(?:y|ies)|acceptance\s+criteria)", 0.75),
            (r"\b(?:technical\s+)?(?:architecture|design\s+document)", 0.6),
            (r"\b(?:implementation\s+plan|task\s+breakdown)", 0.85),
            (r"\bworkflow\s+phase", 0.7),
            # Planning-specific patterns
            (r"\b(?:generate|create)\s+(?:implementation\s+)?plan", 0.9),
            (r"\b(?:check\s+off|mark\s+complete)\s+task\s+\d+", 0.95),
            (r"\bcheck\s+task\s+\d+(?:\.\d+)*", 0.95),
            (r"\b(?:complete|finish)\s+task\s+\d+(?:\.\d+)*", 0.9),
            (r"\b(?:update|refresh)\s+(?:the\s+)?(?:implementation\s+)?plan", 0.85),
            (r"\bget\s+(?:next|available)\s+tasks", 0.8),
            (r"\btask\s+(?:status|progress|summary)", 0.8),
            (r"\bhow\s+many\s+tasks?\s+(?:are\s+)?(?:complete|done)", 0.8),
            (r"\b(?:bulk|multiple)\s+(?:check|complete)\s+tasks?", 0.9),
            (r"\bcheckbox\s+(?:format|style)", 0.75),
            # Requirements-specific patterns
            (r"\b(?:add|create|update|modify|remove|delete)\s+requirements?", 0.9),
            (r"\b(?:add|create|write|define|update)\s+user\s+stor(?:y|ies)", 0.85),
            (r"\brequirements\.md\b", 0.95),
            (r"\b(?:EARS|ears)\s+(?:criteria|requirements?)", 0.9),
            # Design-specific patterns
            (r"\b(?:add|create|update|modify)\s+design", 0.9),
            (r"\b(?:create|write|define|update)\s+architecture", 0.85),
            (r"\bdesign\.md\b", 0.95),
            (r"\b(?:system|technical)\s+(?:architecture|design)", 0.8),
            # Task-specific patterns
            (r"\b(?:add|create|update|modify|remove|delete)\s+tasks?", 0.9),
            (r"\btasks\.md\b", 0.95),
            (r"\b(?:implementation|task)\s+plan", 0.85),
            # SpecForge trigger words (high priority for wizard mode)
            (r"\bspecforge\b", 0.95),
            (r"\bspecforged\b", 0.95),
            # Wizard mode specific patterns
            (r"\b(?:start|launch|run)\s+(?:specforge|specforged)\s+wizard", 0.98),
            (r"\b(?:use\s+)?(?:specforge|specforged)\s+to\s+create", 0.95),
            (
                r"\b(?:new\s+project|create\s+project)\s+(?:with\s+)?"
                r"(?:specforge|specforged)",
                0.95,
            ),
            (r"\b(?:wizard|interactive)\s+(?:mode|setup)", 0.85),
            (r"\b(?:specforge|specforged)\s+(?:setup|initialization)", 0.9),
        ]

        # Do mode patterns (code modifications, commands)
        self.do_patterns = [
            (r"\b(?:modify|change|update|edit)\s+(?:the\s+)?(?:code|file)", 0.8),
            (r"\b(?:run|execute|start|launch)\s+(?!task)", 0.75),
            (r"\b(?:fix|debug|resolve|patch)", 0.7),
            (r"\b(?:implement|build|compile|deploy)", 0.75),
            (r"\b(?:test|validate|check)\s+(?:the\s+)?(?:code|implementation)", 0.7),
            (r"\b(?:add|remove|delete)\s+(?:a\s+)?(?:function|method|class)", 0.8),
            (r"\b(?:refactor|optimize|improve)\s+(?:the\s+)?code", 0.75),
            (r"\bgit\s+(?:commit|push|pull|merge)", 0.85),
        ]

        # Chat mode patterns (questions, explanations)
        self.chat_patterns = [
            (r"^(?:what|how|why|when|where|who)\b", 0.6),
            (r"\b(?:explain|tell\s+me|show\s+me|describe)", 0.8),
            (r"\b(?:help|assist|guide)\s+(?:me\s+)?(?:with)?", 0.6),
            (r"^(?:hello|hi|hey|greetings)", 0.9),
            (r"\b(?:thank|thanks|appreciate)", 0.85),
            (r"\?$", 0.3),  # Questions ending with ?
        ]

    def classify(self, user_input: str) -> ModeClassification:
        """Classify user input into mode with confidence scores"""
        user_input_lower = user_input.lower().strip()

        # Initialize scores
        scores = {UserMode.SPEC: 0.0, UserMode.DO: 0.0, UserMode.CHAT: 0.0}

        reasoning = []

        # Check spec patterns
        for pattern, weight in self.spec_patterns:
            if re.search(pattern, user_input_lower):
                scores[UserMode.SPEC] += weight
                reasoning.append(f"Matched spec pattern: {pattern[:30]}...")

        # Check do patterns
        for pattern, weight in self.do_patterns:
            if re.search(pattern, user_input_lower):
                scores[UserMode.DO] += weight
                reasoning.append(f"Matched do pattern: {pattern[:30]}...")

        # Check chat patterns
        for pattern, weight in self.chat_patterns:
            if re.search(pattern, user_input_lower):
                scores[UserMode.CHAT] += weight
                reasoning.append(f"Matched chat pattern: {pattern[:30]}...")

        # Apply heuristics
        word_count = len(user_input.split())

        # Very short inputs are likely chat (but not empty strings)
        if word_count < 3 and user_input.strip():
            scores[UserMode.CHAT] += 0.3
            reasoning.append("Short input suggests chat mode")

        # Long, detailed inputs might be specs
        if word_count > 20:
            scores[UserMode.SPEC] += 0.2
            reasoning.append("Long input suggests specification mode")

        # Check for code-like content
        if any(char in user_input for char in ["()", "{}", "[]", "->", "=>"]):
            scores[UserMode.DO] += 0.3
            reasoning.append("Contains code-like syntax")

        # Normalize scores to sum to 1
        total = sum(scores.values())
        if total > 0:
            for mode in scores:
                scores[mode] = scores[mode] / total
        else:
            # Default to do mode with low confidence
            scores[UserMode.DO] = 0.6
            scores[UserMode.CHAT] = 0.3
            scores[UserMode.SPEC] = 0.1
            reasoning.append("No strong patterns matched, defaulting to do mode")

        # Determine primary mode
        primary_mode = max(scores, key=lambda mode: scores[mode])

        # If confidence is too low, default to do mode
        if scores[primary_mode] < 0.4:
            primary_mode = UserMode.DO
            reasoning.append("Low confidence, defaulting to do mode")

        return ModeClassification(
            chat_confidence=scores[UserMode.CHAT],
            do_confidence=scores[UserMode.DO],
            spec_confidence=scores[UserMode.SPEC],
            primary_mode=primary_mode,
            reasoning=reasoning,
        )
