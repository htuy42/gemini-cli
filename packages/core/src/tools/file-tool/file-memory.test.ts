/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FileMemory, hashContent } from './file-memory.js';

describe('FileMemory', () => {
  let memory: FileMemory;

  beforeEach(() => {
    memory = new FileMemory();
  });

  describe('basic operations', () => {
    it('should store and retrieve file entries', () => {
      const entry = {
        contentHash: 'hash123',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map([['prompt1', 'summary1']]),
      };

      memory.set('/path/to/file', entry);
      expect(memory.get('/path/to/file')).toEqual(entry);
      expect(memory.hasFile('/path/to/file')).toBe(true);
    });

    it('should return undefined for non-existent files', () => {
      expect(memory.get('/non/existent')).toBeUndefined();
      expect(memory.hasFile('/non/existent')).toBe(false);
    });

    it('should clear all memory', () => {
      memory.set('/file1', {
        contentHash: 'hash1',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
      });
      memory.set('/file2', {
        contentHash: 'hash2',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
      });

      expect(memory.getStats().filesTracked).toBe(2);
      
      memory.clear();
      
      expect(memory.getStats().filesTracked).toBe(0);
      expect(memory.hasFile('/file1')).toBe(false);
      expect(memory.hasFile('/file2')).toBe(false);
    });
  });

  describe('change detection', () => {
    beforeEach(() => {
      memory.set('/file', {
        contentHash: 'original-hash',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
      });
    });

    it('should detect changed files', () => {
      expect(memory.hasFileChanged('/file', 'different-hash')).toBe(true);
      expect(memory.hasFileChanged('/file', 'original-hash')).toBe(false);
    });

    it('should treat non-existent files as changed', () => {
      expect(memory.hasFileChanged('/non-existent', 'any-hash')).toBe(true);
    });
  });

  describe('summary caching', () => {
    beforeEach(() => {
      memory.set('/file', {
        contentHash: 'hash',
        lastModified: Date.now(),
        lastAccessed: Date.now() - 1000,
        summaries: new Map([
          ['prompt1', 'summary1'],
          ['prompt2', 'summary2'],
        ]),
      });
    });

    it('should retrieve cached summaries', () => {
      expect(memory.getCachedSummary('/file', 'prompt1')).toBe('summary1');
      expect(memory.getCachedSummary('/file', 'prompt2')).toBe('summary2');
      expect(memory.getCachedSummary('/file', 'prompt3')).toBeUndefined();
    });

    it('should cache new summaries', () => {
      const beforeAccess = memory.get('/file')!.lastAccessed;
      
      memory.cacheSummary('/file', 'prompt3', 'summary3');
      
      expect(memory.getCachedSummary('/file', 'prompt3')).toBe('summary3');
      expect(memory.get('/file')!.lastAccessed).toBeGreaterThan(beforeAccess);
    });

    it('should return undefined for non-existent files', () => {
      expect(memory.getCachedSummary('/non-existent', 'prompt')).toBeUndefined();
    });
  });

  describe('edit tracking', () => {
    it('should update existing file after edit', () => {
      memory.set('/file', {
        contentHash: 'old-hash',
        lastModified: Date.now() - 1000,
        lastAccessed: Date.now() - 1000,
        summaries: new Map([['prompt', 'summary']]),
      });

      const beforeModified = memory.get('/file')!.lastModified;
      
      memory.updateAfterEdit('/file', 'new-hash');
      
      const entry = memory.get('/file')!;
      expect(entry.contentHash).toBe('new-hash');
      expect(entry.lastModified).toBeGreaterThan(beforeModified);
      expect(entry.summaries.size).toBe(0); // Cleared after edit
    });

    it('should create new entry for non-existent file', () => {
      memory.updateAfterEdit('/new-file', 'new-hash');
      
      const entry = memory.get('/new-file')!;
      expect(entry.contentHash).toBe('new-hash');
      expect(entry.summaries.size).toBe(0);
    });
  });

  describe('line tracking', () => {
    beforeEach(() => {
      memory.set('/file', {
        contentHash: 'hash',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
      });
    });

    it('should record lines shown', () => {
      memory.recordLinesShown('/file', 5, 10);
      
      const entry = memory.get('/file')!;
      expect(entry.linesShown).toBeDefined();
      expect(entry.linesShown!.has(5)).toBe(true);
      expect(entry.linesShown!.has(10)).toBe(true);
      expect(entry.linesShown!.size).toBe(6); // lines 5-10
    });

    it('should accumulate line ranges', () => {
      memory.recordLinesShown('/file', 1, 5);
      memory.recordLinesShown('/file', 10, 15);
      
      const entry = memory.get('/file')!;
      expect(entry.linesShown!.size).toBe(11); // 5 + 6 lines
      expect(entry.linesShown!.has(1)).toBe(true);
      expect(entry.linesShown!.has(15)).toBe(true);
      expect(entry.linesShown!.has(7)).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should provide accurate stats', () => {
      const now = Date.now();
      
      memory.set('/file1', {
        contentHash: 'hash1',
        lastModified: now - 2000,
        lastAccessed: now - 2000,
        summaries: new Map([['p1', 's1'], ['p2', 's2']]),
      });
      
      memory.set('/file2', {
        contentHash: 'hash2',
        lastModified: now - 1000,
        lastAccessed: now - 1000,
        summaries: new Map([['p3', 's3']]),
      });
      
      const stats = memory.getStats();
      expect(stats.filesTracked).toBe(2);
      expect(stats.totalSummaries).toBe(3);
      expect(stats.oldestAccess).toBe(now - 2000);
      expect(stats.newestAccess).toBe(now - 1000);
    });

    it('should handle empty memory', () => {
      const stats = memory.getStats();
      expect(stats.filesTracked).toBe(0);
      expect(stats.totalSummaries).toBe(0);
      expect(stats.oldestAccess).toBeNull();
      expect(stats.newestAccess).toBeNull();
    });
  });
});

describe('hashContent', () => {
  it('should generate consistent hashes', () => {
    const content = 'Hello, world!';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
  });

  it('should generate different hashes for different content', () => {
    const hash1 = hashContent('Hello, world!');
    const hash2 = hashContent('Hello, World!'); // Capital W
    
    expect(hash1).not.toBe(hash2);
  });

  it('should handle unicode content', () => {
    const content = '你好世界 🌍';
    const hash = hashContent(content);
    
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});