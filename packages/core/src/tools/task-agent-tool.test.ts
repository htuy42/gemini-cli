/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskAgentTool, TaskAgentParams } from './task-agent-tool.js';
import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';
import { ContentGenerator } from '../core/contentGenerator.js';
import { GeminiChat } from '../core/geminiChat.js';
import { Content } from '@google/genai';

describe('TaskAgentTool', () => {
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let taskAgentTool: TaskAgentTool;

  beforeEach(() => {
    // Mock the GeminiClient
    mockGeminiClient = {
      getHistory: vi.fn().mockResolvedValue([]),
    } as unknown as GeminiClient;

    // Mock the Config
    mockConfig = {
      getUserMemory: vi.fn().mockReturnValue('Test memory content'),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
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
    it('should return error when dependencies are not available', async () => {
      const params: TaskAgentParams = {
        task: 'Test task',
        prompt: 'Test prompt',
      };

      const result = await taskAgentTool.execute(params, new AbortController().signal);

      // Since we haven't mocked all the dependencies (ContentGenerator, TaskAgentRunner, etc.),
      // the tool should return an error
      expect(result.returnDisplay).toContain('Task Agent failed to execute');
      expect(Array.isArray(result.llmContent)).toBe(true);
      const parts = result.llmContent as Array<{ text: string }>;
      expect(parts[0].text).toContain('Task Agent failed to execute');
    });

    it('should handle custom maxTurns and timeoutMs parameters', async () => {
      const params: TaskAgentParams = {
        task: 'Test task',
        prompt: 'Test prompt',
        maxTurns: 10,
        timeoutMs: 60000,
      };

      // Just verify that the tool accepts these parameters without error
      const result = await taskAgentTool.execute(params, new AbortController().signal);
      expect(result).toBeDefined();
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