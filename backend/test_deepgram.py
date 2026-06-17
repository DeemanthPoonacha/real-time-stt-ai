import asyncio
import os
import websockets
import urllib.parse
from dotenv import load_dotenv

load_dotenv()

async def test_connect():
    api_key = os.getenv("DEEPGRAM_API_KEY")
    print(f"Loaded DEEPGRAM_API_KEY: {api_key[:10]}..." if api_key else "No DEEPGRAM_API_KEY found")
    if not api_key:
        return

    params = {
        "model": "nova-2",
        "smart_format": "true",
        "encoding": "linear16",
        "sample_rate": "16000",
        "channels": "1"
    }
    query_str = urllib.parse.urlencode(params)
    url = f"wss://api.deepgram.com/v1/listen?{query_str}"
    headers = {
        "Authorization": f"Token {api_key}"
    }

    print(f"Connecting to: {url}")
    try:
        async with websockets.connect(url, additional_headers=headers) as ws:
            print("Connected successfully!")
            # Send an empty JSON or wait
            print("Closing...")
    except Exception as e:
        print(f"Connection failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connect())
