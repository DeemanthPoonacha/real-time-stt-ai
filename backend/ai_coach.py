"""
AI Coach - Real-time sales coaching powered by LLM via OpenAI SDK.

Uses the OpenAI SDK for compatibility with:
  - Ollama (local, free) — default
  - OpenAI (cloud, GPT-4o)
  - Any OpenAI-compatible API

Integrates with RAG engine for context-aware coaching.
"""

import json
import logging
import asyncio
from typing import AsyncGenerator

from openai import AsyncOpenAI

from config import settings
from rag_engine import RAGEngine
from data.prompts import (
    SALES_COACH_SYSTEM_PROMPT,
    OBJECTION_DETECTION_PROMPT,
    CLOSING_SIGNAL_PROMPT,
)

logger = logging.getLogger(__name__)


class AICoach:
    """
    AI Sales Coach that provides real-time coaching suggestions
    based on live call transcripts and RAG-retrieved context.

    Usage:
        coach = AICoach(rag_engine)
        async for suggestion in coach.get_coaching(transcript_text):
            print(suggestion)
    """

    def __init__(self, rag_engine: RAGEngine):
        self.rag_engine = rag_engine
        self.client = AsyncOpenAI(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
        )
        self.model = settings.LLM_MODEL
        self.conversation_history: list[dict] = []
        self.max_history = 10  # Keep last N transcript segments for context

    def _build_system_prompt(self, transcript: str) -> str:
        """Build the system prompt with RAG context injected."""
        # Search for relevant playbook context based on the transcript
        rag_results = self.rag_engine.search(transcript, top_k=settings.RAG_TOP_K)

        # Format RAG context
        if rag_results:
            context_parts = []
            for i, doc in enumerate(rag_results, 1):
                source = doc["metadata"].get("source", "unknown")
                source_type = doc["metadata"].get("source_type", "knowledge")
                context_parts.append(
                    f"[Source {i}: {source} ({source_type})]\n{doc['text']}"
                )
            rag_context = "\n\n".join(context_parts)
        else:
            rag_context = "(No specific playbook context found for this conversation segment.)"

        return SALES_COACH_SYSTEM_PROMPT.format(
            rag_context=rag_context,
            transcript=transcript,
        )

    def _get_conversation_context(self) -> str:
        """Get recent conversation history as a formatted string."""
        if not self.conversation_history:
            return "(Call just started — no transcript yet)"

        return "\n".join(
            f"[{entry.get('speaker', 'unknown')}]: {entry['text']}"
            for entry in self.conversation_history[-self.max_history:]
        )

    def add_transcript(self, text: str, speaker: str = "unknown"):
        """Add a transcript segment to the conversation history."""
        self.conversation_history.append({
            "text": text,
            "speaker": speaker,
        })

        # Trim history to max size
        if len(self.conversation_history) > self.max_history * 2:
            self.conversation_history = self.conversation_history[-self.max_history:]

    async def get_coaching(self, transcript_text: str) -> AsyncGenerator[str, None]:
        """
        Get streaming coaching suggestions for the given transcript text.

        Yields partial text chunks as they arrive from the LLM.
        """
        # Add to conversation history
        self.add_transcript(transcript_text)

        # Build context
        conversation_context = self._get_conversation_context()
        system_prompt = self._build_system_prompt(conversation_context)

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Latest transcript segment: \"{transcript_text}\"\n\n"
                    f"{OBJECTION_DETECTION_PROMPT}\n\n"
                    f"{CLOSING_SIGNAL_PROMPT}\n\n"
                    "Provide ONE coaching suggestion in the specified JSON format."
                ),
            },
        ]

        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=settings.LLM_MAX_TOKENS,
                temperature=settings.LLM_TEMPERATURE,
                stream=True,
            )

            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"AI Coach error: {e}")
            # Return a fallback suggestion
            yield json.dumps({
                "type": "tip",
                "priority": "low",
                "title": "AI Coach Offline",
                "suggestion": f"AI coaching temporarily unavailable: {str(e)[:100]}. Check your LLM configuration.",
                "script": "",
            })

    async def get_coaching_full(self, transcript_text: str) -> dict:
        """
        Get a complete coaching suggestion (non-streaming).
        Returns parsed JSON or a fallback dict.
        """
        full_response = ""
        async for chunk in self.get_coaching(transcript_text):
            full_response += chunk

        # Try to parse as JSON
        try:
            # Extract JSON from response (handle markdown code blocks)
            json_str = full_response
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]

            return json.loads(json_str.strip())
        except (json.JSONDecodeError, IndexError):
            logger.warning(f"Failed to parse AI response as JSON: {full_response[:200]}")
            return {
                "type": "tip",
                "priority": "medium",
                "title": "Coaching Tip",
                "suggestion": full_response[:300],
                "script": "",
            }

    def reset(self):
        """Reset conversation history for a new call."""
        self.conversation_history = []
        logger.info("AI Coach conversation history reset")
