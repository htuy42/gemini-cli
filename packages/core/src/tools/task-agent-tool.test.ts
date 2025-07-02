/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskAgentTool, TaskAgentParams } from './task-agent-tool.js';
import { Config } from '../config/config.js';

describe('TaskAgentTool', () => {
  let mockConfig: Config;
  let taskAgentTool: TaskAgentTool;

  beforeEach(() => {
    mockConfig = {
      getUserMemory: vi.fn().mockReturnValue('Test memory content'),
    } as unknown as Config;

    taskAgentTool = new TaskAgentTool(mockConfig);
  });

  describe('basic properties', () => {
    it('should have correct name and display name', () => {
      expect(taskAgentTool.name).toBe('task_agent');
      expect(taskAgentTool.displayName).toBe('TaskAgent');
    });

    it('should have a proper description', () => {
      expect(taskAgentTool.description).toContain('Spawn a task agent');
      expect(taskAgentTool.description).toContain('sub-task');
    });
  });

  describe('execute', () => {
    it('should return spawn_agent marker with task details', async () => {
      const params: TaskAgentParams = {
        task: 'Test task',
        prompt: 'Test prompt',
      };

      const result = await taskAgentTool.execute(params, new AbortController().signal);

      expect(result.returnDisplay).toBe('🤖 Spawning task agent for: "Test task"\n📋 Instructions: Test prompt');
      
      // Extract and parse the llmContent
      expect(Array.isArray(result.llmContent)).toBe(true);
      const parts = result.llmContent as Array<{ text: string }>;
      expect(parts.length).toBe(1);
      expect(parts[0].text).toBeDefined();
      
      const parsed = JSON.parse(parts[0].text);
      expect(parsed).toEqual({
        type: 'spawn_agent',
        task: 'Test task',
        prompt: 'Test prompt',
        maxTurns: 20,
        timeoutMs: 300000,
      });
    });

    it('should use custom maxTurns and timeoutMs when provided', async () => {
      const params: TaskAgentParams = {
        task: 'Test task',
        prompt: 'Test prompt',
        maxTurns: 10,
        timeoutMs: 60000,
      };

      const result = await taskAgentTool.execute(params, new AbortController().signal);
      
      const parts = result.llmContent as Array<{ text: string }>;
      const parsed = JSON.parse(parts[0].text);
      
      expect(parsed.maxTurns).toBe(10);
      expect(parsed.timeoutMs).toBe(60000);
    });
  });

  describe('parameter validation', () => {
    it('should require task and prompt parameters', () => {
      const schema = taskAgentTool.schema;
      expect(schema.parameters!.required).toContain('task');
      expect(schema.parameters!.required).toContain('prompt');
    });

    it('should have optional maxTurns and timeoutMs parameters', () => {
      const schema = taskAgentTool.schema;
      expect(schema.parameters!.properties!.maxTurns).toBeDefined();
      expect(schema.parameters!.properties!.timeoutMs).toBeDefined();
      expect(schema.parameters!.required).not.toContain('maxTurns');
      expect(schema.parameters!.required).not.toContain('timeoutMs');
    });
  });
});