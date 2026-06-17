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


class BaseSTTStreamSession(ABC):
    """Abstract base class for provider streaming sessions."""

    def __init__(self, language: str | None = None):
        self.language = language
        self.active_speaker = "rep"

    def set_active_speaker(self, speaker: str):
        self.active_speaker = speaker

    @abstractmethod
    async def send_audio(self, audio_data: np.ndarray):
        """Send audio data to the stream."""
        pass

    @abstractmethod
    async def flush(self) -> list[TranscriptSegment]:
        """Flush remaining buffered audio if applicable."""
        pass

    @abstractmethod
    async def close(self):
        """Close the streaming session."""
        pass


class BaseSTTProvider(ABC):
    """Abstract base class for STT providers."""

    @abstractmethod
    async def initialize(self):
        """Initialize the STT provider (load model, connect, etc.)."""
        pass

    @abstractmethod
    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        """Start a streaming session."""
        pass

    @abstractmethod
    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        """Transcribe audio data and return segments (fallback/non-streaming)."""
        pass

    @abstractmethod
    async def cleanup(self):
        """Clean up resources."""
        pass


class FasterWhisperStreamSession(BaseSTTStreamSession):
    """Streaming session for local Faster-Whisper, mimicking streaming via buffering."""

    def __init__(self, provider: 'FasterWhisperProvider', on_transcript, language: str | None = None):
        super().__init__(language)
        self.provider = provider
        self.on_transcript = on_transcript
        self.audio_buffer = np.array([], dtype=np.float32)
        self.buffer_threshold = int(
            settings.AUDIO_SAMPLE_RATE * settings.AUDIO_CHUNK_DURATION
        )

    async def send_audio(self, audio_data: np.ndarray):
        # Buffer incoming audio
        self.audio_buffer = np.concatenate([self.audio_buffer, audio_data])

        # Transcribe when enough data has accumulated
        if len(self.audio_buffer) < self.buffer_threshold:
            return

        audio_to_transcribe = self.audio_buffer.copy()
        self.audio_buffer = np.array([], dtype=np.float32)

        await self._process_and_callback(audio_to_transcribe)

    async def _process_and_callback(self, audio_to_transcribe: np.ndarray):
        # Apply simple energy-based VAD
        energy = np.sqrt(np.mean(audio_to_transcribe ** 2))
        if energy < 0.01:  # Silence threshold
            logger.debug("Audio chunk below energy threshold, skipping")
            return

        segments = await self.provider.transcribe(audio_to_transcribe, self.language)
        for s in segments:
            if s.text.strip():
                await self.on_transcript(s)

    async def flush(self) -> list[TranscriptSegment]:
        if len(self.audio_buffer) == 0:
            return []
        audio_to_transcribe = self.audio_buffer.copy()
        self.audio_buffer = np.array([], dtype=np.float32)
        
        # We also return the segments directly to preserve compat with legacy flush()
        energy = np.sqrt(np.mean(audio_to_transcribe ** 2))
        if energy < 0.01:
            return []
        
        segments = await self.provider.transcribe(audio_to_transcribe, self.language)
        valid_segments = [s for s in segments if s.text.strip()]
        for s in valid_segments:
            await self.on_transcript(s)
        return valid_segments

    async def close(self):
        self.audio_buffer = np.array([], dtype=np.float32)


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

    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        return FasterWhisperStreamSession(self, on_transcript, language)

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
                beam_size=1,
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


class DeepgramStreamSession(BaseSTTStreamSession):
    """Streaming session for Deepgram Speech-to-Text API over WebSockets."""

    def __init__(self, api_key: str, on_transcript, language: str | None = None):
        super().__init__(language)
        self.api_key = api_key
        self.on_transcript = on_transcript
        self.websocket = None
        self.receive_task = None
        self._connected = asyncio.Event()

    async def connect(self):
        import websockets
        import urllib.parse
        
        lang = self.language or settings.STT_LANGUAGE
        if lang == "auto":
            lang = None

        params = {
            "model": "nova-2",
            "smart_format": "true",
            "encoding": "linear16",
            "sample_rate": str(settings.AUDIO_SAMPLE_RATE),
            "channels": str(settings.AUDIO_CHANNELS)
        }
        if lang:
            params["language"] = lang

        query_str = urllib.parse.urlencode(params)
        url = f"wss://api.deepgram.com/v1/listen?{query_str}"
        headers = {
            "Authorization": f"Token {self.api_key}"
        }

        logger.info(f"Connecting to Deepgram streaming WebSocket: {url}")
        try:
            self.websocket = await websockets.connect(url, extra_headers=headers)
            self.receive_task = asyncio.create_task(self._receive_loop())
            self._connected.set()
            logger.info("Connected to Deepgram STT stream")
        except Exception as e:
            logger.error(f"Failed to connect to Deepgram streaming API: {e}")
            raise e

    async def send_audio(self, audio_data: np.ndarray):
        if not self._connected.is_set():
            await self.connect()

        if self.websocket is None:
            return

        # Convert float32 to 16-bit PCM bytes
        int16_data = (audio_data * 32767.0).astype(np.int16)
        raw_bytes = int16_data.tobytes()

        try:
            await self.websocket.send(raw_bytes)
        except Exception as e:
            logger.error(f"Error sending audio to Deepgram: {e}")

    async def _receive_loop(self):
        import json
        try:
            async for message in self.websocket:
                response = json.loads(message)
                is_final = response.get("is_final", True)
                channel = response.get("channel", {})
                alternatives = channel.get("alternatives", [])
                if alternatives:
                    text = alternatives[0].get("transcript", "").strip()
                    confidence = alternatives[0].get("confidence", 0.0)
                    if text and is_final:
                        segment = TranscriptSegment(
                            text=text,
                            language=self.language or "unknown",
                            confidence=confidence
                        )
                        await self.on_transcript(segment)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Deepgram receive loop error: {e}")

    async def flush(self) -> list[TranscriptSegment]:
        if self.websocket and self._connected.is_set():
            import json
            try:
                await self.websocket.send(json.dumps({"type": "Finalize"}))
            except Exception as e:
                logger.error(f"Error sending Finalize to Deepgram: {e}")
        return []

    async def close(self):
        if self.receive_task:
            self.receive_task.cancel()
            try:
                await self.receive_task
            except asyncio.CancelledError:
                pass
            self.receive_task = None

        if self.websocket:
            import json
            try:
                await self.websocket.send(json.dumps({"type": "CloseStream"}))
                await self.websocket.close()
            except Exception:
                pass
            self.websocket = None
        self._connected.clear()


class DeepgramProvider(BaseSTTProvider):
    """
    STT provider using Deepgram streaming API over WebSockets.
    """

    def __init__(self):
        self.api_key = settings.DEEPGRAM_API_KEY

    async def initialize(self):
        logger.info("Initializing Deepgram provider...")
        if not self.api_key:
            logger.warning("DEEPGRAM_API_KEY is not set in config/env. Deepgram STT will fail.")

    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        if not self.api_key:
            raise ValueError("DEEPGRAM_API_KEY is not set. Please add it to your .env file.")
        session = DeepgramStreamSession(self.api_key, on_transcript, language)
        await session.connect()
        return session

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        # Fallback using streaming under the hood
        segments = []
        async def cb(seg):
            segments.append(seg)
            
        session = await self.start_stream(cb, language)
        await session.send_audio(audio_data)
        await session.flush()
        await asyncio.sleep(0.5)  # Wait briefly for server transcripts to arrive
        await session.close()
        return segments

    async def cleanup(self):
        pass


class AssemblyAIStreamSession(BaseSTTStreamSession):
    """Streaming session for AssemblyAI Speech-to-Text API over WebSockets."""

    def __init__(self, api_key: str, on_transcript, language: str | None = None):
        super().__init__(language)
        self.api_key = api_key
        self.on_transcript = on_transcript
        self.websocket = None
        self.receive_task = None
        self._connected = asyncio.Event()

    async def connect(self):
        import websockets
        import urllib.parse

        params = {
            "sample_rate": str(settings.AUDIO_SAMPLE_RATE),
            "format_turns": "true"
        }
        query_str = urllib.parse.urlencode(params)
        url = f"wss://streaming.assemblyai.com/v3/ws?{query_str}"
        headers = {
            "Authorization": self.api_key
        }

        logger.info(f"Connecting to AssemblyAI streaming WebSocket: {url}")
        try:
            self.websocket = await websockets.connect(url, extra_headers=headers)
            self.receive_task = asyncio.create_task(self._receive_loop())
            self._connected.set()
            logger.info("Connected to AssemblyAI STT stream")
        except Exception as e:
            logger.error(f"Failed to connect to AssemblyAI streaming API: {e}")
            raise e

    async def send_audio(self, audio_data: np.ndarray):
        if not self._connected.is_set():
            await self.connect()

        if self.websocket is None:
            return

        # Convert float32 to 16-bit PCM bytes
        int16_data = (audio_data * 32767.0).astype(np.int16)
        raw_bytes = int16_data.tobytes()

        try:
            await self.websocket.send(raw_bytes)
        except Exception as e:
            logger.error(f"Error sending audio to AssemblyAI: {e}")

    async def _receive_loop(self):
        import json
        try:
            async for message in self.websocket:
                response = json.loads(message)
                msg_type = response.get("type")

                if msg_type == "Turn":
                    transcript = response.get("transcript", "").strip()
                    end_of_turn = response.get("end_of_turn", False)
                    confidence = response.get("confidence", 1.0)
                    
                    if transcript and end_of_turn:
                        segment = TranscriptSegment(
                            text=transcript,
                            language=self.language or "en",
                            confidence=confidence
                        )
                        await self.on_transcript(segment)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"AssemblyAI receive loop error: {e}")

    async def flush(self) -> list[TranscriptSegment]:
        if self.websocket and self._connected.is_set():
            import json
            try:
                await self.websocket.send(json.dumps({"type": "Terminate"}))
            except Exception as e:
                logger.error(f"Error flushing AssemblyAI stream: {e}")
        return []

    async def close(self):
        if self.receive_task:
            self.receive_task.cancel()
            try:
                await self.receive_task
            except asyncio.CancelledError:
                pass
            self.receive_task = None

        if self.websocket:
            import json
            try:
                await self.websocket.send(json.dumps({"type": "Terminate"}))
                await self.websocket.close()
            except Exception:
                pass
            self.websocket = None
        self._connected.clear()


class AssemblyAIProvider(BaseSTTProvider):
    """
    STT provider using AssemblyAI Universal Streaming API.
    """

    def __init__(self):
        self.api_key = settings.ASSEMBLYAI_API_KEY

    async def initialize(self):
        logger.info("AssemblyAI provider initialized")
        if not self.api_key:
            logger.warning("ASSEMBLYAI_API_KEY is not set. AssemblyAI STT will fail.")

    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        if not self.api_key:
            raise ValueError("ASSEMBLYAI_API_KEY is not set. Please add it to your .env file.")
        session = AssemblyAIStreamSession(self.api_key, on_transcript, language)
        await session.connect()
        return session

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        # Fallback using streaming under the hood
        segments = []
        async def cb(seg):
            segments.append(seg)
            
        session = await self.start_stream(cb, language)
        await session.send_audio(audio_data)
        await session.flush()
        await asyncio.sleep(0.5)
        await session.close()
        return segments

    async def cleanup(self):
        pass


class GoogleSTTStreamSession(BaseSTTStreamSession):
    """Streaming session for Google Cloud Speech-to-Text API using Async Client."""

    def __init__(self, credentials_path: str, on_transcript, language: str | None = None):
        super().__init__(language)
        self.credentials_path = credentials_path
        self.on_transcript = on_transcript
        self.audio_queue = asyncio.Queue()
        self.client = None
        self.stream_task = None
        self.closed = False

    async def connect(self):
        try:
            from google.cloud import speech_v1p1beta1 as speech
            import os
        except ImportError:
            raise ImportError(
                "Google Cloud STT streaming requires the 'google-cloud-speech' package. "
                "Please install it using: pip install google-cloud-speech"
            )

        if self.credentials_path:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = self.credentials_path

        self.client = speech.SpeechAsyncClient()
        self.stream_task = asyncio.create_task(self._run_stream())
        logger.info("Connected to Google Cloud STT stream")

    async def send_audio(self, audio_data: np.ndarray):
        if self.closed:
            return

        if self.client is None:
            await self.connect()

        # Convert float32 to 16-bit PCM bytes
        int16_data = (audio_data * 32767.0).astype(np.int16)
        raw_bytes = int16_data.tobytes()

        await self.audio_queue.put(raw_bytes)

    async def _run_stream(self):
        from google.cloud import speech_v1p1beta1 as speech
        
        lang = self.language or settings.STT_LANGUAGE
        if lang == "auto":
            lang = "en-US"
        elif lang == "he":
            lang = "he-IL"
        elif lang == "en":
            lang = "en-US"

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=settings.AUDIO_SAMPLE_RATE,
            language_code=lang,
            enable_automatic_punctuation=True,
        )
        streaming_config = speech.StreamingRecognitionConfig(
            config=config,
            interim_results=False
        )

        async def request_generator():
            yield speech.StreamingRecognizeRequest(streaming_config=streaming_config)
            
            while not self.closed:
                try:
                    chunk = await self.audio_queue.get()
                    if chunk is None:
                        break
                    yield speech.StreamingRecognizeRequest(audio_content=chunk)
                except asyncio.CancelledError:
                    break
                except Exception:
                    break

        try:
            responses = await self.client.streaming_recognize(requests=request_generator())
            async for response in responses:
                for result in response.results:
                    if result.is_final:
                        alternative = result.alternatives[0]
                        text = alternative.transcript.strip()
                        confidence = alternative.confidence
                        if text:
                            segment = TranscriptSegment(
                                text=text,
                                language=self.language or "unknown",
                                confidence=confidence
                            )
                            await self.on_transcript(segment)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Google Cloud STT streaming recognize error: {e}")

    async def flush(self) -> list[TranscriptSegment]:
        await self.audio_queue.put(None)
        await asyncio.sleep(0.1)
        if not self.closed:
            self.audio_queue = asyncio.Queue()
            self.stream_task = asyncio.create_task(self._run_stream())
        return []

    async def close(self):
        self.closed = True
        await self.audio_queue.put(None)
        if self.stream_task:
            self.stream_task.cancel()
            try:
                await self.stream_task
            except asyncio.CancelledError:
                pass
            self.stream_task = None
        self.client = None


class GoogleSTTProvider(BaseSTTProvider):
    """
    STT provider using Google Cloud STT Async Streaming Client.
    """

    def __init__(self):
        self.credentials_path = settings.GOOGLE_APPLICATION_CREDENTIALS

    async def initialize(self):
        logger.info("Google Cloud STT provider initialized")
        if not self.credentials_path:
            logger.warning("GOOGLE_APPLICATION_CREDENTIALS is not set. Google STT will fail.")

    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        session = GoogleSTTStreamSession(self.credentials_path, on_transcript, language)
        await session.connect()
        return session

    async def transcribe(self, audio_data: np.ndarray,
                         language: str | None = None) -> list[TranscriptSegment]:
        # Fallback to streaming session
        segments = []
        async def cb(seg):
            segments.append(seg)
            
        session = await self.start_stream(cb, language)
        await session.send_audio(audio_data)
        await session.flush()
        await asyncio.sleep(0.5)
        await session.close()
        return segments

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

    async def start_stream(self, on_transcript, language: str | None = None) -> BaseSTTStreamSession:
        """Start a streaming session using the active provider."""
        if not self._initialized:
            await self.initialize()
        return await self.provider.start_stream(on_transcript, language)

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

    async def flush(self, language: str | None = None) -> list[TranscriptSegment]:
        """
        Transcribe any remaining audio in the buffer.
        Useful when the speaker finishes speaking.
        """
        if not self._initialized:
            return []

        if len(self.audio_buffer) == 0:
            return []

        # Transcribe the remaining buffered audio
        audio_to_transcribe = self.audio_buffer.copy()
        self.audio_buffer = np.array([], dtype=np.float32)

        # Apply simple energy-based VAD
        energy = np.sqrt(np.mean(audio_to_transcribe ** 2))
        if energy < 0.01:  # Silence threshold
            logger.debug("Flush: audio chunk below energy threshold, skipping")
            return []

        segments = await self.provider.transcribe(audio_to_transcribe, language)
        return [s for s in segments if s.text.strip()]

    async def cleanup(self):
        """Clean up resources."""
        await self.provider.cleanup()
        self._initialized = False

