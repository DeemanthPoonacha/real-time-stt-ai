# AI Developer Needed: Real-Time Speech-to-Text Integration with OpenAI API for Live Sales Coaching

Posted 14-June-2026 | Worldwide

## Summary
We are looking for an experienced AI/Full-Stack Developer to build a Real-Time Sales Enablement Tool. The goal of this system is to listen to live sales calls in Hebrew, transcribe them instantly, and feed the text into an OpenAI agent that will provide real-time objections-handling tips to the sales representative.

We already have the sales playbook, objections scripts, and prompts ready (currently configured in a Custom GPT setup). Your job will be to handle the pipeline integration, ultra-low latency streaming, and a simple frontend overlay/dashboard for the sales rep.

## Key Responsibilities & Workflow:

- **Audio Capture & Streaming:** Capture live audio from the microphone (or system audio/browser) during a call.

- **Real-Time Transcription (STT):** Stream the audio into an ultra-low latency STT engine that supports Hebrew (e.g., Deepgram Nova-2 / AssemblyAI).

- **AI Agent Integration:** Feed the streaming text into the OpenAI API (using GPT-4o or Assistants API), pre-loaded with our custom sales training data and prompts.

- **UI/Dashboard Output:** Display the AI’s real-time suggestions (scripts, objection handling) on a clean, scannable dashboard or widget overlay for the salesperson to see while they talk.

## Technical Requirements:

- **STT Engines:** Proven experience with Deepgram (Streaming API), AssemblyAI, or Google Cloud STT.

- **OpenAI API:** Deep understanding of OpenAI API, prompt engineering, and context management for streaming conversations.

- **Latency Optimization:** Ability to optimize the pipeline so the response time from speech to AI suggestion is under 1 second.

- **Frontend/Backend:** Experience building lightweight web interfaces, chrome extensions, or desktop widgets (Node.js/Python for backend, React/Vue/Vanilla JS for frontend).

- **UI/RTL Handling:** Ability to handle Right-to-Left (RTL) text formatting for the Hebrew dashboard display.

## Nice-to-Have / Preferred:

- **Prior experience with Hebrew NLP or Hebrew Speech-to-Text projects** is a major plus, but not mandatory.

## Project Scope & Timeline:

- **Type:** Milestone-based project (with potential for long-term maintenance and upgrades).

- **Timeline:** Expected MVP within  3-4 weeks.

## How to Apply:

Please share:

- Examples of previous real-time AI or Streaming Speech-to-Text projects you’ve built.

- Your recommended tech stack for the frontend/backend for this specific use case.

- Mention if you have any prior experience working with Hebrew or other RTL languages (optional).