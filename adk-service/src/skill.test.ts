import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSkillFromDir, SkillToolset } from '@google/adk';
import { fileURLToPath } from 'node:url';

test('loads the formal FBD coaching skill and its read-only tool declaration', async () => {
  const skill = await loadSkillFromDir(fileURLToPath(new URL('../skills/fbd-coaching', import.meta.url)));
  assert.equal(skill.frontmatter.name, 'fbd-coaching');
  assert.deepEqual(skill.frontmatter.metadata?.adk_additional_tools, ['inspect_current_diagram']);
  assert.match(skill.instructions, /Call `inspect_current_diagram`/);
  assert.ok(skill.resources?.references?.['observation-rules.md']);
  const toolset = new SkillToolset([skill]);
  assert.equal(toolset.getSkill('fbd-coaching')?.frontmatter.name, 'fbd-coaching');
});
