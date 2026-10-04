# Solvepistemic ADK FBD coach

This is a read-only Google Agent Development Kit service for grounded FBD advice. It uses the formal ADK `SkillToolset` and the filesystem skill at `skills/fbd-coaching/SKILL.md`. The skill activates the read-only diagram inspection tool on demand. It never mutates `FBDState` and exposes no calculation tool. Explicit diagram modifications and calculations remain on Solvepistemic's existing AWS tool path.

## Run locally

1. Use Node.js 20.19 or later.
2. Set `GOOGLE_GENAI_API_KEY` and optionally `ADK_MODEL`.
3. Run `npm install`, `npm test`, `npm run typecheck`, and `npm start`.
4. Set the web app's `VITE_ADK_API_BASE_URL=http://localhost:8090`.

The service accepts the existing `POST /chat` payload and returns `{ response, providerUsed }`. Deploy the included container to the existing AWS container platform, then set `VITE_ADK_API_BASE_URL` to its HTTPS URL.
