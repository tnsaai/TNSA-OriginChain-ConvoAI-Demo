# TNSA × OriginChain — Conversation AI Demo

Standalone OriginChain voice workspace. No login or sidebar. Includes streamed text, tool activity, ordered audio playback, live captions, interruption handling, English/Saudi Arabic responses, and database/document sources.

## Architecture

Browser → same-origin `/api/speech/*` relay → `https://speech.tnsaai.com/v1/*` → EC2 API via Cloudflare Tunnel.

The relay attaches the API key on the server. No credentials are sent to browser JavaScript. This repository contains the frontend and its server-side relay; the speech API is deployed separately.

## Local development

Use Node.js 24.

```sh
npm ci
cp .env.example .env.local
# Set SPEECH_API_KEY in .env.local
npm run dev
```

Open http://localhost:3001. Allow microphone access to speak; typing also works. If playback is blocked, use **Enable sound**. Microphone access requires HTTPS or localhost.

```sh
npm run typecheck
npm run build
```

## Vercel deployment

Import this repository using the Next.js preset, with the repository root as the Root Directory and Node.js 24 selected. Use the standard `npm run build` command.

Set these **server-only** environment variables for the required Vercel environments:

- `SPEECH_API_URL=https://speech.tnsaai.com`
- `SPEECH_API_KEY`: the deployed speech API bearer key, configured privately in Vercel.
- `WEB_AUTH_MODE=public`: opens the demo without login.

Never prefix credentials with `NEXT_PUBLIC_`. Redeploy after changing environment variables. Do not commit `.env.local`, PEM files or keys.

`SPEECH_DNS_SERVER` is an optional server-side DNS override for networks retaining a stale DNS result. Normally leave it unset on Vercel. Cloudflare Access settings in `.env.example` are optional for a future private deployment; they are not needed for the current no-login demo.

## Streaming and tools

Replies use one SSE request containing text deltas, tool events and sentence WAV chunks. Audio prefetch preserves playback order. Captions use short incremental transcription requests; the microphone endpointing delay is 350 ms, with eager upload during the final pause.

The API exposes seven tools backed by OriginChainDB and a source catalog. Business, calendar, region and weather records are demonstration data, labeled in the interface. Official documentation sources link to their original pages. Database tokens and inference configuration belong to the separate API service.

The public website can invoke the server relay without visitor authentication. The API still requires its bearer key; rate/concurrency limits are enforced by the API.
