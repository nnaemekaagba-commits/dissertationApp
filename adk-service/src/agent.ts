import { FunctionTool, InMemoryRunner, LlmAgent, SkillToolset, isFinalResponse,
  loadSkillFromDir } from '@google/adk';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DiagramSnapshot } from './contract.js';

const INSTRUCTION = `You are Solvepistemic's read-only statics coach. For every FBD question, load the
fbd-coaching skill and follow it exactly. Produce one response only. You have no mutation or calculation tool.`;

const fbdCoachingSkill = loadSkillFromDir(fileURLToPath(
  new URL('../skills/fbd-coaching', import.meta.url)));

export async function runFBDCoach(snapshot: DiagramSnapshot, prompt: string): Promise<string> {
  const inspect = new FunctionTool({
    name: 'inspect_current_diagram',
    description: 'Returns the exact current rigid-body EngineeringState and active student FBDState. Read-only.',
    parameters: z.object({}),
    execute: async () => ({ status: 'success', ...snapshot }),
  });
  const skillToolset = new SkillToolset([await fbdCoachingSkill], { additionalTools: [inspect] });
  const agent = new LlmAgent({ name: 'solvepistemic_fbd_coach', model: process.env.ADK_MODEL || 'gemini-2.5-flash',
    description: 'Grounded read-only coaching for a student-built statics FBD.', instruction: INSTRUCTION,
    tools: [skillToolset] });
  const runner = new InMemoryRunner({ agent, appName: 'solvepistemic' });
  const userId = 'student';
  const session = await runner.sessionService.createSession({ appName: 'solvepistemic', userId });
  let answer = '';
  for await (const event of runner.runAsync({ userId, sessionId: session.id,
    newMessage: { role: 'user', parts: [{ text: prompt }] } })) {
    if (isFinalResponse(event)) answer = (event.content?.parts || [])
      .map((part) => 'text' in part ? part.text || '' : '').join('\n').trim();
  }
  if (!answer) throw new Error('ADK returned no final response.');
  return answer;
}
