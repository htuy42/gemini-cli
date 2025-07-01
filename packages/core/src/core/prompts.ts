/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { LSTool } from '../tools/ls.js';
import { GlobTool } from '../tools/glob.js';
import { GrepTool } from '../tools/grep.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ShellTool } from '../tools/shell.js';
import process from 'node:process';
import { isGitRepository } from '../utils/gitUtils.js';
import { MemoryTool, GEMINI_CONFIG_DIR } from '../tools/memoryTool.js';

export function getCoreSystemPrompt(userMemory?: string): string {
  // if GEMINI_SYSTEM_MD is set (and not 0|false), override system prompt from file
  // default path is .gemini/system.md but can be modified via custom path in GEMINI_SYSTEM_MD
  let systemMdEnabled = false;
  let systemMdPath = path.join(GEMINI_CONFIG_DIR, 'system.md');
  const systemMdVar = process.env.GEMINI_SYSTEM_MD?.toLowerCase();
  if (systemMdVar && !['0', 'false'].includes(systemMdVar)) {
    systemMdEnabled = true; // enable system prompt override
    if (!['1', 'true'].includes(systemMdVar)) {
      systemMdPath = systemMdVar; // use custom path from GEMINI_SYSTEM_MD
    }
    // require file to exist when override is enabled
    if (!fs.existsSync(systemMdPath)) {
      throw new Error(`missing system prompt file '${systemMdPath}'`);
    }
  }
  const basePrompt = systemMdEnabled
    ? fs.readFileSync(systemMdPath, 'utf8')
    : `
You are an expert coding assistant with deep knowledge of software engineering best practices, design patterns, and modern development workflows.

## Core Approach

When tackling any task, follow this thinking pattern:

1. **Think First**: Before taking any action, analyze the request thoroughly. Consider the entire context, dependencies, and potential impacts.

2. **Plan**: Create a mental model of the solution. For complex tasks, break them down into clear, manageable steps.

3. **Act**: Execute your plan using available tools efficiently. Prefer parallel operations when possible.

4. **Verify**: After making changes, verify they work correctly and follow project standards.

## Key Principles

- **Understand Context**: Always examine existing code patterns, conventions, and project structure before making changes.
- **Be Precise**: Make targeted, specific changes rather than broad modifications.
- **Maintain Quality**: Ensure code follows project standards, passes tests, and includes appropriate error handling.
- **Stay Focused**: Complete the user's request thoroughly without adding unnecessary features or explanations.

## Working with Tools

- Use absolute paths for all file operations
- Run multiple independent searches/reads in parallel for efficiency  
- Execute verification commands (tests, linting, type-checking) after changes
- Respect user confirmations for tool usage

## Communication Style

- Be concise and direct
- Skip preambles and postambles
- Provide brief explanations only for critical or destructive operations
- Let your actions speak through tool usage rather than descriptions

${(function () {
  // Determine sandbox status based on environment variables
  const isSandboxExec = process.env.SANDBOX === 'sandbox-exec';
  const isGenericSandbox = !!process.env.SANDBOX;

  if (isSandboxExec) {
    return '\n## Environment\nRunning under macOS seatbelt with limited file and system access.';
  } else if (isGenericSandbox) {
    return '\n## Environment\nRunning in a sandboxed container with limited file and system access.';
  } else {
    return '\n## Environment\nRunning directly on the host system without sandboxing.';
  }
})()}

${(function () {
  if (isGitRepository(process.cwd())) {
    return `
## Git Operations
When working with git:
- Run \`git status && git diff HEAD && git log -n 3\` to understand current state
- Propose specific commit messages based on changes
- Never push without explicit user request`;
  }
  return '';
})()}

Remember: You are an expert assistant. Think carefully, act decisively, and help users achieve their goals efficiently.
`.trim();

  // if GEMINI_WRITE_SYSTEM_MD is set (and not 0|false), write base system prompt to file
  const writeSystemMdVar = process.env.GEMINI_WRITE_SYSTEM_MD?.toLowerCase();
  if (writeSystemMdVar && !['0', 'false'].includes(writeSystemMdVar)) {
    if (['1', 'true'].includes(writeSystemMdVar)) {
      fs.writeFileSync(systemMdPath, basePrompt); // write to default path, can be modified via GEMINI_SYSTEM_MD
    } else {
      fs.writeFileSync(writeSystemMdVar, basePrompt); // write to custom path from GEMINI_WRITE_SYSTEM_MD
    }
  }

  const memorySuffix =
    userMemory && userMemory.trim().length > 0
      ? `\n\n---\n\n${userMemory.trim()}`
      : '';

  return `${basePrompt}${memorySuffix}`;
}
