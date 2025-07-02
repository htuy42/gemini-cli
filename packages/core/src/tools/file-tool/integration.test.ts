/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../config/config.js';
import { createToolRegistry } from '../../config/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FileReadResult, FileWriteResult, FileEditResult } from './types.js';
import { tmpdir } from 'os';

describe('FileTool Integration', () => {
  let testDir: string;
  let config: Config;
  
  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(tmpdir(), 'file-tool-test-'));
    
    config = new Config({
      sessionId: 'test-session',
      targetDir: testDir,
      debugMode: false,
      cwd: testDir,
      model: 'gemini-1.5-flash',
    });
  });
  
  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  it('should register file tool', async () => {
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    expect(fileTool).toBeDefined();
    expect(fileTool?.name).toBe('file');
  });
  
  it('should execute read operation', async () => {
    // Create a test file
    const testFile = path.join(testDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello, world!');
    
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    if (!fileTool) {
      throw new Error('File tool not found');
    }
    
    const result = await fileTool.execute(
      {
        operation: 'read',
        path: testFile,
      },
      new AbortController().signal
    ) as FileReadResult;
    
    expect(result.llmContent).toContain('Hello, world!');
  });
  
  it('should execute write operation', async () => {
    const testFile = path.join(testDir, 'new-file.txt');
    
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    if (!fileTool) {
      throw new Error('File tool not found');
    }
    
    const result = await fileTool.execute(
      {
        operation: 'write',
        path: testFile,
        content: 'New content',
      },
      new AbortController().signal
    ) as FileWriteResult;
    
    expect(result.status).toBe('success');
    
    // Verify file was created
    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('New content');
  });
  
  it('should execute edit operation', async () => {
    // Create a test file
    const testFile = path.join(testDir, 'edit-test.txt');
    await fs.writeFile(testFile, 'Line 1\nLine 2\nLine 3');
    
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    if (!fileTool) {
      throw new Error('File tool not found');
    }
    
    const result = await fileTool.execute(
      {
        operation: 'edit',
        path: testFile,
        changes: [
          { line: 2, operation: 'replace', content: 'Modified Line 2' }
        ],
      },
      new AbortController().signal
    ) as FileEditResult;
    
    expect(result.status).toBe('success');
    
    // Verify file was edited
    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('Line 1\nModified Line 2\nLine 3');
  });
  
  it('should enforce security - reject paths outside root', async () => {
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    if (!fileTool) {
      throw new Error('File tool not found');
    }
    
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
  
  it('should handle binary files correctly', async () => {
    // Create a binary file
    const testFile = path.join(testDir, 'binary.jpg');
    await fs.writeFile(testFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); // JPEG header
    
    const registry = await createToolRegistry(config, true);
    const fileTool = registry.getTool('file');
    
    if (!fileTool) {
      throw new Error('File tool not found');
    }
    
    const result = await fileTool.execute(
      {
        operation: 'read',
        path: testFile,
      },
      new AbortController().signal
    ) as FileReadResult;
    
    expect(result.status).toBe('error');
    expect(result.message).toContain('Cannot read image file');
    expect(result.message).toContain('This tool only supports text files');
  });
});