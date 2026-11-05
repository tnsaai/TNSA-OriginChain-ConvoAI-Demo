# TNSA × OriginChain — Conversation AI Demo

Standalone OriginChain voice workspace. No login or sidebar. Includes streamed text, tool activity, ordered audio playback, live captions, interruption handling, English/Saudi Arabic responses, and database/document sources.

## Architecture

The browser calls the same-origin Next.js speech routes. Next.js runs the
speech handlers in its Node process, sends Sansar requests to the hosted
Omni API, and uses Groq for transcription and Realtime speech. Provider
credentials are configured on the server.

## Local development

Use Node.js 24.

```sh
npm ci
cp .env.example .env.local
# Fill the provider and OriginChain settings in .env.local
npm run dev
```

Open http://localhost:3001. Allow microphone access to speak; typing also works. If playback is blocked, use **Enable sound**. Microphone access requires HTTPS or localhost.

```sh
npm run typecheck
npm run build
```

## Vercel deployment

Import this repository using the Next.js preset, with the repository root as the Root Directory and Node.js 24 selected. Use the standard `npm run build` command.

Set the server-only provider and OriginChain variables from `.env.example`
in the deployment environment. Use Node 24. For the legacy relay deployment,
set `SPEECH_RELAY_MODE=external`, `SPEECH_API_URL`, and `SPEECH_API_KEY`.
Keep credentials in server environment settings.

## Streaming and tools

Replies use one SSE request containing text deltas, tool events and sentence WAV chunks. Audio prefetch preserves playback order. Captions use short incremental transcription requests; the microphone endpointing delay is 350 ms, with eager upload during the final pause.

The API exposes seven tools backed by OriginChainDB and a source catalog. Business, calendar, region and weather records are demonstration data, labeled in the interface. Official documentation sources link to their original pages. Database tokens and inference configuration belong to the server environment.

The public website can invoke the server relay without visitor authentication. The API still requires its bearer key; rate/concurrency limits are enforced by the API.

## Current voice model choices

The UI offers **NGen-4.5 Sansar** and **NGen 4 Realtime**. Selection is forwarded server-side using `X-Speech-Model`; the browser cannot supply a provider URL or credentials. Sansar uses the hosted Omni model and requires `TNSA_API_KEY`.

Sansar audio uses streamed mono PCM16 at 24 kHz, scheduled incrementally through Web Audio. WAV replies remain supported for Realtime. Switching models cancels capture/playback and the active request while retaining conversation history. The activity panel separates inference queue time, first PCM and tool timings. Model speed depends on GPU availability; no universal latency guarantee is implied.
