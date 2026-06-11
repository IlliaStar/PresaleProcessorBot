/**
 * inject-prompt.js — Option #4: External prompt files for AI agent nodes.
 *
 * Usage:
 *   node scripts/inject-prompt.js extract [workflow.json...]
 *   node scripts/inject-prompt.js inject  [workflow.json...]
 *
 * extract — reads each workflow JSON, finds @n8n/n8n-nodes-langchain.agent
 *   nodes, writes their systemMessage into prompts/<workflow>-<node>.md
 *   (unescaping \n to real newlines).
 *
 * inject  — reads each prompt file back, re-escapes, and writes the
 *   updated workflow JSON back to the same path.
 *
 * If no workflow files are given, operates on all JSON files in workflows/.
 *
 * Examples:
 *   node scripts/inject-prompt.js extract
 *   node scripts/inject-prompt.js extract workflows/presale-agent-workflow.json
 *   node scripts/inject-prompt.js inject
 *   node scripts/inject-prompt.js inject workflows/sharepoint-agent-workflow.json
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.resolve(__dirname, '..', 'workflows');
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Given a workflow file name like "presale-agent-workflow.json",
 *  return the slug prefix: "presale-agent" */
function workflowSlug(fileName) {
  return fileName.replace(/\.json$/i, '');
}

/** Replace real newlines with \n escape sequences for JSON embedding */
function escapeForJson(str) {
  // Escape backslashes first so we don't double-escape
  return str
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\\n/g, '\\n'); // no-op safeguard — already correct
}

/** Replace \n escape sequences with real newlines for markdown editing */
function unescapeFromJson(str) {
  return str.replace(/\\n/g, '\n');
}

/** Find all agent nodes in a workflow JSON */
function findAgentNodes(workflow) {
  return (workflow.nodes || []).filter(
    (n) => n.type === '@n8n/n8n-nodes-langchain.agent'
  );
}

function extract(workflowPath) {
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  const workflow = JSON.parse(raw);
  const agents = findAgentNodes(workflow);
  const fileName = path.basename(workflowPath);
  const slug = workflowSlug(fileName);

  if (agents.length === 0) {
    console.log(`  [SKIP] ${fileName} — no AI agent nodes`);
    return;
  }

  for (const agent of agents) {
    const prompt = agent.parameters?.options?.systemMessage;
    if (!prompt) {
      console.log(`  [SKIP] ${fileName} / "${agent.name}" — no systemMessage`);
      continue;
    }

    const promptFile = path.join(PROMPTS_DIR, `${slug}-${agent.name}.md`);
    const content = unescapeFromJson(prompt) + '\n';
    fs.writeFileSync(promptFile, content, 'utf-8');
    console.log(`  [EXTRACT] ${fileName} → ${path.basename(promptFile)}  (${content.length} chars)`);
  }
}

function inject(workflowPath) {
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  const workflow = JSON.parse(raw);
  const agents = findAgentNodes(workflow);
  const fileName = path.basename(workflowPath);
  const slug = workflowSlug(fileName);
  let modified = false;

  if (agents.length === 0) {
    console.log(`  [SKIP] ${fileName} — no AI agent nodes`);
    return;
  }

  for (const agent of agents) {
    const promptFile = path.join(PROMPTS_DIR, `${slug}-${agent.name}.md`);
    if (!fs.existsSync(promptFile)) {
      console.log(`  [SKIP] ${fileName} / "${agent.name}" — no prompt file: ${path.basename(promptFile)}`);
      continue;
    }

    const promptContent = fs.readFileSync(promptFile, 'utf-8').trim();
    const escaped = escapeForJson(promptContent);
    agent.parameters = agent.parameters || {};
    agent.parameters.options = agent.parameters.options || {};
    agent.parameters.options.systemMessage = escaped;
    modified = true;
    console.log(`  [INJECT] ${path.basename(promptFile)} → ${fileName} / "${agent.name}"`);
  }

  if (modified) {
    fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
    console.log(`  [SAVED] ${fileName}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────

const mode = process.argv[2];
const files = process.argv.slice(3);

if (!mode || !['extract', 'inject'].includes(mode)) {
  console.error('Usage: node scripts/inject-prompt.js <extract|inject> [workflow.json...]');
  process.exit(1);
}

ensureDir(PROMPTS_DIR);

let targets;
if (files.length > 0) {
  targets = files.map((f) => path.resolve(process.cwd(), f));
} else {
  targets = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

console.log(`\nPrompt injection — mode: ${mode}\n`);

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.warn(`  [WARN] File not found: ${target}`);
    continue;
  }
  if (mode === 'extract') extract(target);
  else inject(target);
}

console.log(`\nDone.\n`);