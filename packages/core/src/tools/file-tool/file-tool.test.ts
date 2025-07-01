/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileTool } from './file-tool.js';
import { FileMemory } from './file-memory.js';
import { FlashIntegration } from './flash-integration.js';
import { Config } from '../../config/config.js';
import * as fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import * as path from 'path';
import { GeminiClient } from '../../core/client.js';
import { FileReadResult, FileEditResult, SmartEditResult, FileWriteResult } from './types.js';

// Mock modules
vi.mock('fs/promises');
vi.mock('fs');
vi.mock('./flash-integration.js');
vi.mock('../../core/client.js');

describe('FileTool', () => {
  let fileTool: FileTool;
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let mockFlashIntegration: FlashIntegration;
  const rootPath = '/test/root';
  const testFilePath = '/test/root/file.ts';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock config
    mockGeminiClient = {
      generateContent: vi.fn(),
      generateJson: vi.fn(),
    } as any;
    
    mockConfig = {
      getGeminiClient: () => mockGeminiClient,
    } as any;
    
    // Create mock Flash integration
    mockFlashIntegration = {
      generateSummary: vi.fn(),
      findEditLocation: vi.fn(),
      verifyEdit: vi.fn(),
    } as any;
    
    // Create file tool with injected dependencies
    fileTool = new FileTool(rootPath, mockConfig, undefined, mockFlashIntegration);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('read operation', () => {
    const mockFileContent = `function hello() {
  return 'world';
}

export { hello };`;

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);
      vi.mocked(fs.readFile).mockResolvedValue(mockFileContent);
    });

    it('should read full file content with line numbers', async () => {
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('success');
      expect(result.llmContent).toContain('1: function hello() {');
      expect(result.llmContent).toContain('2:   return \'world\';');
      expect(result.metadata?.totalLines).toBe(5);
    });

    it('should indicate when file is already read and unchanged', async () => {
      // First read
      await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      // Second read
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('already_read');
      expect(result.message).toContain('File already read (unchanged)');
    });

    it('should read specific lines', async () => {
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
          options: {
            mode: 'lines',
            lines: { start: 1, end: 2 },
          },
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('success');
      expect(result.llmContent).toContain('1: function hello() {');
      expect(result.llmContent).toContain('2:   return \'world\';');
      expect(result.llmContent).not.toContain('3:');
    });

    it('should validate line ranges', async () => {
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
          options: {
            mode: 'lines',
            lines: { start: 10, end: 20 },
          },
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid line range');
    });

    it('should generate summary using Flash', async () => {
      const mockSummary = 'File exports hello function that returns "world"';
      mockFlashIntegration.generateSummary = vi.fn().mockResolvedValue(mockSummary);

      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
          options: {
            mode: 'summary',
            prompt: 'What does this file export?',
          },
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('success');
      expect(result.llmContent).toBe(mockSummary);
      expect(mockFlashIntegration.generateSummary).toHaveBeenCalledWith(
        testFilePath,
        mockFileContent,
        'What does this file export?'
      );
    });

    it('should cache summaries', async () => {
      const mockSummary = 'File exports hello function';
      mockFlashIntegration.generateSummary = vi.fn().mockResolvedValue(mockSummary);

      // First summary
      await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
          options: {
            mode: 'summary',
            prompt: 'What does this file export?',
          },
        },
        new AbortController().signal
      ) as FileReadResult;

      // Second summary with same prompt
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
          options: {
            mode: 'summary',
            prompt: 'What does this file export?',
          },
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.message).toBe('Using cached summary');
      expect(mockFlashIntegration.generateSummary).toHaveBeenCalledTimes(1);
    });

    it('should handle file not found', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('File not found');
    });

    it('should handle directory paths', async () => {
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);

      const result = await fileTool.execute(
        {
          operation: 'read',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Path is a directory');
    });
  });

  describe('edit operation', () => {
    const mockFileContent = `line 1
line 2
line 3
line 4
line 5`;

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(mockFileContent);
      vi.mocked(fs.writeFile).mockResolvedValue();
    });

    it('should replace a line', async () => {
      const result = await fileTool.execute(
        {
          operation: 'edit',
          path: testFilePath,
          changes: [
            { line: 2, operation: 'replace', content: 'new line 2' },
          ],
        },
        new AbortController().signal
      ) as FileEditResult;

      expect(result.status).toBe('success');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        testFilePath,
        'line 1\nnew line 2\nline 3\nline 4\nline 5',
        'utf-8'
      );
      expect(result.diff).toContain('-line 2');
      expect(result.diff).toContain('+new line 2');
    });

    it('should insert a line', async () => {
      const result = await fileTool.execute(
        {
          operation: 'edit',
          path: testFilePath,
          changes: [
            { line: 3, operation: 'insert', content: 'inserted line' },
          ],
        },
        new AbortController().signal
      ) as FileEditResult;

      expect(result.status).toBe('success');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        testFilePath,
        'line 1\nline 2\ninserted line\nline 3\nline 4\nline 5',
        'utf-8'
      );
    });

    it('should delete a line', async () => {
      const result = await fileTool.execute(
        {
          operation: 'edit',
          path: testFilePath,
          changes: [
            { line: 3, operation: 'delete' },
          ],
        },
        new AbortController().signal
      ) as FileEditResult;

      expect(result.status).toBe('success');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        testFilePath,
        'line 1\nline 2\nline 4\nline 5',
        'utf-8'
      );
    });

    it('should apply multiple changes in correct order', async () => {
      const result = await fileTool.execute(
        {
          operation: 'edit',
          path: testFilePath,
          changes: [
            { line: 2, operation: 'delete' },
            { line: 4, operation: 'replace', content: 'new line 4' },
          ],
        },
        new AbortController().signal
      ) as FileEditResult;

      expect(result.status).toBe('success');
      // Changes should be applied in reverse order (line 4 first, then line 2)
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        testFilePath,
        'line 1\nline 3\nnew line 4\nline 5',
        'utf-8'
      );
    });

    it('should validate line numbers', async () => {
      const result = await fileTool.execute(
        {
          operation: 'edit',
          path: testFilePath,
          changes: [
            { line: 10, operation: 'replace', content: 'out of range' },
          ],
        },
        new AbortController().signal
      ) as FileEditResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Line 10 out of range');
    });
  });

  describe('smartEdit operation', () => {
    const mockFileContent = `function authenticate(user, pass) {
  return db.users.find(user);
}`;

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(mockFileContent);
      vi.mocked(fs.writeFile).mockResolvedValue();
    });

    it('should perform successful smart edit', async () => {
      mockFlashIntegration.findEditLocation = vi.fn().mockResolvedValue({
        status: 'success',
        confidence: 0.9,
        edits: [
          { line: 2, operation: 'replace', content: '  return await db.users.find(user);' },
        ],
      });

      const result = await fileTool.execute(
        {
          operation: 'smartEdit',
          path: testFilePath,
          smartEditRequest: {
            find: 'database call',
            change: 'add await',
          },
        },
        new AbortController().signal
      ) as SmartEditResult;

      expect(result.status).toBe('success');
      expect(result.confidence).toBe(0.9);
    });

    it('should handle not found case', async () => {
      mockFlashIntegration.findEditLocation = vi.fn().mockResolvedValue({
        status: 'not_found',
        confidence: 0,
        message: 'Could not find database call',
      });

      const result = await fileTool.execute(
        {
          operation: 'smartEdit',
          path: testFilePath,
          smartEditRequest: {
            find: 'database call',
            change: 'add await',
          },
        },
        new AbortController().signal
      ) as SmartEditResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Could not find database call');
    });

    it('should handle low confidence case', async () => {
      mockFlashIntegration.findEditLocation = vi.fn().mockResolvedValue({
        status: 'unsure',
        confidence: 0.5,
        edits: [
          { line: 2, operation: 'replace', content: '  return await db.users.find(user);' },
        ],
        message: 'Not confident about this change',
      });

      const result = await fileTool.execute(
        {
          operation: 'smartEdit',
          path: testFilePath,
          smartEditRequest: {
            find: 'database call',
            change: 'add await',
          },
        },
        new AbortController().signal
      ) as SmartEditResult;

      expect(result.status).toBe('needs_confirmation');
      expect(result.suggestedEdits).toHaveLength(1);
      expect(result.confidence).toBe(0.5);
    });

    it('should verify edits when requested', async () => {
      mockFlashIntegration.findEditLocation = vi.fn().mockResolvedValue({
        status: 'success',
        confidence: 0.9,
        edits: [
          { line: 2, operation: 'replace', content: '  return await db.users.find(user);' },
        ],
      });

      mockFlashIntegration.verifyEdit = vi.fn().mockResolvedValue({
        hasIssues: true,
        issues: ['Missing try-catch for async operation'],
        suggestion: 'Wrap in try-catch block',
      });

      const result = await fileTool.execute(
        {
          operation: 'smartEdit',
          path: testFilePath,
          smartEditRequest: {
            find: 'database call',
            change: 'add await',
            verify: true,
          },
        },
        new AbortController().signal
      ) as SmartEditResult;

      expect(result.status).toBe('completed_with_warnings');
      expect(result.warnings).toContain('Missing try-catch for async operation');
      expect(result.suggestion).toBe('Wrap in try-catch block');
    });
  });

  describe('write operation', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue();
    });

    it('should create a new file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await fileTool.execute(
        {
          operation: 'write',
          path: testFilePath,
          content: 'new file content',
        },
        new AbortController().signal
      ) as FileWriteResult;

      expect(result.status).toBe('success');
      expect(result.message).toBe('File created');
      expect(result.metadata?.created).toBe(true);
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        testFilePath,
        'new file content',
        'utf-8'
      );
    });

    it('should overwrite existing file', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await fileTool.execute(
        {
          operation: 'write',
          path: testFilePath,
          content: 'updated content',
        },
        new AbortController().signal
      ) as FileWriteResult;

      expect(result.status).toBe('success');
      expect(result.message).toBe('File overwritten');
      expect(result.metadata?.created).toBe(false);
    });

    it('should create directories if needed', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await fileTool.execute(
        {
          operation: 'write',
          path: '/test/root/deep/nested/file.ts',
          content: 'content',
        },
        new AbortController().signal
      );

      expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(
        '/test/root/deep/nested',
        { recursive: true }
      );
    });
  });

  describe('security checks', () => {
    it('should reject paths outside root', async () => {
      const result = await fileTool.execute(
        {
          operation: 'read',
          path: '/etc/passwd',
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Path must be within project root');
    });

    it('should handle relative paths', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);
      vi.mocked(fs.readFile).mockResolvedValue('content');

      const result = await fileTool.execute(
        {
          operation: 'read',
          path: './subdir/file.ts',
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('success');
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.resolve(rootPath, './subdir/file.ts'),
        'utf-8'
      );
    });
  });

  describe('parameter validation', () => {
    it('should require operation and path', async () => {
      await expect(
        fileTool.execute(
          { operation: 'read' },
          new AbortController().signal
        )
      ).rejects.toThrow('operation and path are required');
    });

    it('should reject unknown operations', async () => {
      const result = await fileTool.execute(
        {
          operation: 'unknown',
          path: testFilePath,
        },
        new AbortController().signal
      ) as FileReadResult;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Unknown operation');
    });
  });
});