import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runFBDCoach } from './agent.js';
import { conversationPrompt, parseChatRequest } from './contract.js';

const port = Number(process.env.PORT || 8090);
const allowedOrigin = process.env.CORS_ORIGIN || '*';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin, 'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 10_000_000) throw new Error('Request is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health')
    return send(res, 200, { status: 'ok', framework: 'google-adk', mode: 'read-only-fbd-coach' });
  if (req.method !== 'POST' || req.url !== '/chat') return send(res, 404, { error: 'Not found.' });
  const secret = process.env.ADK_SHARED_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`)
    return send(res, 401, { error: 'Unauthorized.' });
  try {
    const request = parseChatRequest(await readJson(req));
    const response = await runFBDCoach({ engineeringState: request.engineeringState, fbdState: request.fbdState },
      conversationPrompt(request));
    return send(res, 200, { response, provider: 'google-adk', providerUsed: 'google-adk' });
  } catch (error) {
    console.error(error);
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, () => console.log(`Solvepistemic ADK coach listening on ${port}`));
