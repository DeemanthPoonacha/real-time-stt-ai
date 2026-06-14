"""
Centralized configuration for the Real-Time Sales Coaching backend.
All settings can be overridden via environment variables or a .env file.
"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CHROMA_DIR = BASE_DIR / "chroma_db"


class Settings(BaseSettings):
    """Application settings with environment variable overrides."""

    # --- Server ---
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # --- STT Engine ---
    # Provider: "faster-whisper" | "deepgram" | "assemblyai" | "google"
    STT_PROVIDER: str = "faster-whisper"
    WHISPER_MODEL_SIZE: str = "base"
    WHISPER_DEVICE: str = "cpu"  # "cpu" or "cuda"
    WHISPER_COMPUTE_TYPE: str = "int8"  # "int8", "float16", "float32"
    STT_LANGUAGE: str = "en"  # "en", "he", or None for auto-detect

    # Deepgram (when STT_PROVIDER="deepgram")
    DEEPGRAM_API_KEY: str = ""

    # AssemblyAI (when STT_PROVIDER="assemblyai")
    ASSEMBLYAI_API_KEY: str = ""

    # Google Cloud STT (when STT_PROVIDER="google")
    GOOGLE_APPLICATION_CREDENTIALS: str = ""

    # --- Audio ---
    AUDIO_SAMPLE_RATE: int = 16000
    AUDIO_CHANNELS: int = 1
    AUDIO_CHUNK_DURATION: float = 2.0  # seconds of audio to buffer before STT

    # --- LLM (OpenAI SDK - compatible with Ollama) ---
    # For Ollama local: http://localhost:11434/v1
    # For OpenAI: https://api.openai.com/v1
    LLM_BASE_URL: str = "http://localhost:11434/v1"
    LLM_API_KEY: str = "ollama"  # "ollama" for local, real key for OpenAI
    LLM_MODEL: str = "llama3.2"  # or "gpt-4o" for OpenAI
    LLM_MAX_TOKENS: int = 300
    LLM_TEMPERATURE: float = 0.7

    # --- RAG ---
    RAG_COLLECTION_NAME: str = "sales_knowledge"
    RAG_CHUNK_SIZE: int = 500  # characters per chunk
    RAG_CHUNK_OVERLAP: int = 50
    RAG_TOP_K: int = 5  # number of relevant chunks to retrieve

    # --- Demo Mode ---
    DEMO_MODE: bool = False
    DEMO_SPEED: float = 1.0  # playback speed multiplier

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
