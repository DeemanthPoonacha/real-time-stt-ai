"""
STT Engine - Abstraction layer for Speech-to-Text providers.

Supports:
  - faster-whisper (default, local, free)
  - Deepgram (cloud, streaming API)
  - AssemblyAI (cloud)
  - Google Cloud STT (cloud)

Switch providers by changing STT_PROVIDER in config/env.
"""

import io
import asyncio
import logging
import base64
import struct
import time
from abc import ABC, abstractmethod
from typing import AsyncGenerator

import numpy as np

from config import settings

logger = logging.getLogger(__name__)


class TranscriptSegment:
    """A single transcribed segment with metadata."""

    def __init__(self, text: str, start: float = 0.0, end: float = 0.0,
                 language: str = "en", confidence: float = 0.0):
        self.text = text
        self.start = start
        self.end = end
        self.language = language
        self.confidence = confidence
        self.timestamp = time.time()

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "language": self.language,
            "confidence": self.confidence,
            "timestamp": self.timestamp,
        }


class BaseSTTProvider(ABC):
    """Abstract base class for STT providers."""

    @abstractmethod
    async def initialize(self):
        """Initialize the STT provider (load model, connect, etc.)."""
        pass

    @abstractmethod
    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        """Transcribe audio data and return segments."""
        pass

    @abstractmethod
    async def cleanup(self):
        """Clean up resources."""
        pass


class FasterWhisperProvider(BaseSTTProvider):
    """
    STT provider using faster-whisper (CTranslate2 backend).
    Runs locally, supports Hebrew, and is free.
    """

    def __init__(self):
        self.model = None
        self.model_size = settings.WHISPER_MODEL_SIZE
        self.device = settings.WHISPER_DEVICE
        self.compute_type = settings.WHISPER_COMPUTE_TYPE

    async def initialize(self):
        """Load the Whisper model."""
        from faster_whisper import WhisperModel

        logger.info(f"Loading faster-whisper model: {self.model_size} "
                     f"(device={self.device}, compute={self.compute_type})")

        # Run model loading in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        self.model = await loop.run_in_executor(
            None,
            lambda: WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type
            )
        )
        logger.info("faster-whisper model loaded successfully")

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        """Transcribe audio using faster-whisper."""
        if self.model is None:
            raise RuntimeError("Model not initialized. Call initialize() first.")

        lang = language or settings.STT_LANGUAGE
        # None means auto-detect
        if lang == "auto":
            lang = None

        loop = asyncio.get_event_loop()

        def _transcribe():
            segments_gen, info = self.model.transcribe(
                audio_data,
                language=lang,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=200,
                ),
            )
            results = []
            for seg in segments_gen:
                results.append(TranscriptSegment(
                    text=seg.text.strip(),
                    start=seg.start,
                    end=seg.end,
                    language=info.language if info.language else (lang or "unknown"),
                    confidence=seg.avg_logprob,
                ))
            return results

        return await loop.run_in_executor(None, _transcribe)

    async def cleanup(self):
        self.model = None


class DeepgramProvider(BaseSTTProvider):
    """
    STT provider using Deepgram API.
    Uses httpx to send raw PCM audio to Deepgram for ultra-low latency transcription.
    """

    def __init__(self):
        self.api_key = settings.DEEPGRAM_API_KEY
        self.client = None

    async def initialize(self):
        import httpx
        logger.info("Initializing Deepgram provider...")
        if not self.api_key:
            logger.warning("DEEPGRAM_API_KEY is not set in config/env. Deepgram STT will fail.")
        self.client = httpx.AsyncClient()

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        if not self.api_key:
            raise ValueError("DEEPGRAM_API_KEY is not set. Please add it to your .env file.")

        if self.client is None:
            import httpx
            self.client = httpx.AsyncClient()

        # Convert float32 [-1, 1] to 16-bit PCM bytes
        int16_data = (audio_data * 32767.0).astype(np.int16)
        raw_bytes = int16_data.tobytes()

        lang = language or settings.STT_LANGUAGE
        if lang == "auto":
            lang = None

        # Setup request parameters
        params = {
            "model": "nova-2",
            "smart_format": "true",
            "encoding": "linear16",
            "sample_rate": str(settings.AUDIO_SAMPLE_RATE),
            "channels": str(settings.AUDIO_CHANNELS)
        }
        if lang:
            params["language"] = lang

        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": f"audio/l16;rate={settings.AUDIO_SAMPLE_RATE};channels={settings.AUDIO_CHANNELS}"
        }

        try:
            response = await self.client.post(
                "https://api.deepgram.com/v1/listen",
                params=params,
                headers=headers,
                content=raw_bytes,
                timeout=10.0
            )
            response.raise_for_status()
            result = response.json()

            alternatives = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])
            if not alternatives:
                return []

            text = alternatives[0].get("transcript", "").strip()
            confidence = alternatives[0].get("confidence", 0.0)

            if not text:
                return []

            return [TranscriptSegment(
                text=text,
                language=lang or "unknown",
                confidence=confidence
            )]
        except Exception as e:
            logger.error(f"Deepgram transcription error: {e}")
            raise e

    async def cleanup(self):
        if self.client:
            await self.client.aclose()
            self.client = None


class AssemblyAIProvider(BaseSTTProvider):
    """
    Placeholder for AssemblyAI STT integration.
    Swap in by setting STT_PROVIDER=assemblyai and ASSEMBLYAI_API_KEY.
    """

    async def initialize(self):
        logger.info("AssemblyAI provider initialized (placeholder)")

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        raise NotImplementedError(
            "AssemblyAI provider not yet implemented. "
            "Set STT_PROVIDER=faster-whisper to use the default provider."
        )

    async def cleanup(self):
        pass


class GoogleSTTProvider(BaseSTTProvider):
    """
    Placeholder for Google Cloud STT integration.
    Swap in by setting STT_PROVIDER=google and GOOGLE_APPLICATION_CREDENTIALS.
    """

    async def initialize(self):
        logger.info("Google Cloud STT provider initialized (placeholder)")

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        raise NotImplementedError(
            "Google Cloud STT provider not yet implemented. "
            "Set STT_PROVIDER=faster-whisper to use the default provider."
        )

    async def cleanup(self):
        pass


# --- Provider Registry ---

_PROVIDERS = {
    "faster-whisper": FasterWhisperProvider,
    "deepgram": DeepgramProvider,
    "assemblyai": AssemblyAIProvider,
    "google": GoogleSTTProvider,
}


class STTEngine:
    """
    Main STT engine with audio buffering and provider abstraction.

    Usage:
        engine = STTEngine()
        await engine.initialize()
        segments = await engine.process_audio_chunk(base64_audio)
    """

    def __init__(self):
        provider_name = settings.STT_PROVIDER
        if provider_name not in _PROVIDERS:
            raise ValueError(
                f"Unknown STT provider: {provider_name}. "
                f"Available: {list(_PROVIDERS.keys())}"
            )

        self.provider = _PROVIDERS[provider_name]()
        self.audio_buffer = np.array([], dtype=np.float32)
        self.buffer_threshold = int(
            settings.AUDIO_SAMPLE_RATE * settings.AUDIO_CHUNK_DURATION
        )
        self._initialized = False

    async def initialize(self):
        """Initialize the STT provider."""
        await self.provider.initialize()
        self._initialized = True
        logger.info(f"STT Engine ready (provider={settings.STT_PROVIDER})")

    def _decode_audio(self, base64_audio: str) -> np.ndarray:
        """Decode base64-encoded audio to numpy float32 array."""
        raw_bytes = base64.b64decode(base64_audio)

        # Convert from 16-bit PCM to float32
        samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32)
        samples /= 32768.0  # Normalize to [-1, 1]

        return samples

    async def process_audio_chunk(self, base64_audio: str,
                                   language: str | None = None) -> list[TranscriptSegment]:
        """
        Process an audio chunk. Buffers audio and transcribes
        when enough data has accumulated.

        Returns empty list if buffer is not full yet.
        """
        if not self._initialized:
            await self.initialize()

        # Decode and buffer
        audio_data = self._decode_audio(base64_audio)
        self.audio_buffer = np.concatenate([self.audio_buffer, audio_data])

        # Check if we have enough audio buffered
        if len(self.audio_buffer) < self.buffer_threshold:
            return []

        # Transcribe the buffered audio
        audio_to_transcribe = self.audio_buffer.copy()
        self.audio_buffer = np.array([], dtype=np.float32)

        # Apply simple energy-based VAD
        energy = np.sqrt(np.mean(audio_to_transcribe ** 2))
        if energy < 0.01:  # Silence threshold
            logger.debug("Audio chunk below energy threshold, skipping")
            return []

        segments = await self.provider.transcribe(audio_to_transcribe, language)

        # Filter out empty segments
        return [s for s in segments if s.text.strip()]

    def reset_buffer(self):
        """Clear the audio buffer."""
        self.audio_buffer = np.array([], dtype=np.float32)

    async def cleanup(self):
        """Clean up resources."""
        await self.provider.cleanup()
        self._initialized = False
