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

        return (
            SALES_COACH_SYSTEM_PROMPT.replace("{rag_context}", rag_context)
            .replace("{transcript}", transcript)
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

        Attempts to use the LLM first. If offline or fails, falls back to a
        local RAG-based suggestion, streaming it to keep the UI smooth.
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
            logger.warning(f"LLM connection offline or error: {e}. Activating local RAG fallback.")
            
            # Generate high-quality matched suggestion from local ChromaDB
            fallback_suggestion = self._generate_local_fallback(transcript_text)
            
            # Stream the fallback suggestion in small chunks to simulate LLM streaming
            chunk_size = 6
            for i in range(0, len(fallback_suggestion), chunk_size):
                yield fallback_suggestion[i:i+chunk_size]
                await asyncio.sleep(0.015)

    def _generate_local_fallback(self, text: str) -> str:
        """Generate a high-quality coaching suggestion locally using ChromaDB RAG search."""
        try:
            results = self.rag_engine.search(text, top_k=1)
            if results:
                best_match = results[0]
                source_type = best_match["metadata"].get("source_type", "tip")
                source = best_match["metadata"].get("source", "playbook")
                
                if source_type == "objection":
                    lines = best_match["text"].split("\n")
                    category = "Objection Handling"
                    response = ""
                    for line in lines:
                        if line.startswith("Category:"):
                            category = line.split("Category:")[1].strip()
                        elif line.startswith("Response:"):
                            response = line.split("Response:")[1].strip()
                    
                    if not response:
                        response = best_match["text"]
                        
                    return json.dumps({
                        "type": "objection",
                        "priority": "high",
                        "title": f"Handle Objection: {category}",
                        "suggestion": f"The prospect raised concern about {category.lower()}. Reframe using the playbook track.",
                        "script": response
                    }, indent=2)
                
                # Playbook/Knowledge tip
                lines = best_match["text"].split("\n")
                title = "Playbook Tip"
                detail = best_match["text"]
                for line in lines:
                    if line.startswith("Headline:") or line.startswith("Name:") or line.startswith("Scenario:"):
                        title = line.split(":", 1)[1].strip()
                    elif line.startswith("Detail:") or line.startswith("Script:") or line.startswith("Talk Track:"):
                        detail = line.split(":", 1)[1].strip()
                
                return json.dumps({
                    "type": "script" if "script" in best_match["text"].lower() else "tip",
                    "priority": "medium",
                    "title": title[:40],
                    "suggestion": f"Relevant playbook reference from {source}.",
                    "script": detail[:200]
                }, indent=2)
                
        except Exception as e:
            logger.error(f"Fallback generation error: {e}")
            
        # Default fallback if RAG query also fails
        return json.dumps({
            "type": "tip",
            "priority": "medium",
            "title": "Acknowledge & Qualify",
            "suggestion": "Listen actively and ask clarifying questions to understand their current workflow and core pain points.",
            "script": "How are you currently managing these workflows, and what is the biggest bottleneck you face today?"
        }, indent=2)

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
