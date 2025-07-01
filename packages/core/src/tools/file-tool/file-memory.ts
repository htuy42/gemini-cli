/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { FileMemoryEntry } from './types.js';

/**
 * Manages file memory during a conversation session
 */
export class FileMemory {
  private memory: Map<string, FileMemoryEntry>;
  private readonly MAX_FILES = 100; // Limit number of tracked files
  private readonly MAX_SUMMARIES_PER_FILE = 10; // Limit summaries per file

  constructor() {
    this.memory = new Map();
  }

  /**
   * Get memory entry for a file
   */
  get(path: string): FileMemoryEntry | undefined {
    return this.memory.get(path);
  }

  /**
   * Update memory entry for a file
   */
  set(path: string, entry: FileMemoryEntry): void {
    // Check if we need to evict old entries
    if (this.memory.size >= this.MAX_FILES && !this.memory.has(path)) {
      // Evict the oldest accessed entry
      let oldestPath: string | null = null;
      let oldestTime = Infinity;
      
      for (const [p, e] of this.memory.entries()) {
        if (e.lastAccessed < oldestTime) {
          oldestTime = e.lastAccessed;
          oldestPath = p;
        }
      }
      
      if (oldestPath) {
        this.memory.delete(oldestPath);
      }
    }
    
    this.memory.set(path, entry);
  }

  /**
   * Check if a file has been read before
   */
  hasFile(path: string): boolean {
    return this.memory.has(path);
  }

  /**
   * Check if file content has changed based on hash
   */
  hasFileChanged(path: string, currentHash: string): boolean {
    const entry = this.memory.get(path);
    if (!entry) return true;
    return entry.contentHash !== currentHash;
  }

  /**
   * Get cached summary for a file and prompt
   */
  getCachedSummary(path: string, prompt: string): string | undefined {
    const entry = this.memory.get(path);
    if (!entry) return undefined;
    return entry.summaries.get(prompt);
  }

  /**
   * Cache a summary for a file and prompt
   */
  cacheSummary(path: string, prompt: string, summary: string): void {
    const entry = this.memory.get(path);
    if (entry) {
      // Limit number of summaries per file
      if (entry.summaries.size >= this.MAX_SUMMARIES_PER_FILE) {
        // Remove the oldest summary (first in insertion order)
        const firstKey = entry.summaries.keys().next().value;
        if (firstKey) {
          entry.summaries.delete(firstKey);
        }
      }
      entry.summaries.set(prompt, summary);
      entry.lastAccessed = Date.now();
    }
  }

  /**
   * Update file hash and clear summaries after edit
   */
  updateAfterEdit(path: string, newHash: string): void {
    const entry = this.memory.get(path);
    if (entry) {
      entry.contentHash = newHash;
      entry.lastModified = Date.now();
      entry.lastAccessed = Date.now();
      entry.summaries.clear(); // Clear summaries as content changed
    } else {
      this.set(path, {
        contentHash: newHash,
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
      });
    }
  }

  /**
   * Record which lines have been shown to the model
   */
  recordLinesShown(path: string, startLine: number, endLine: number): void {
    let entry = this.memory.get(path);
    if (!entry) {
      // Create a new entry if it doesn't exist
      entry = {
        contentHash: '',
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        summaries: new Map(),
        linesShown: new Set(),
      };
      this.memory.set(path, entry);
    }
    
    if (!entry.linesShown) {
      entry.linesShown = new Set();
    }
    
    for (let i = startLine; i <= endLine; i++) {
      entry.linesShown.add(i);
    }
    
    entry.lastAccessed = Date.now();
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.memory.clear();
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    filesTracked: number;
    totalSummaries: number;
    oldestAccess: number | null;
    newestAccess: number | null;
  } {
    let totalSummaries = 0;
    let oldestAccess: number | null = null;
    let newestAccess: number | null = null;

    for (const entry of this.memory.values()) {
      totalSummaries += entry.summaries.size;
      
      if (oldestAccess === null || entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
      }
      if (newestAccess === null || entry.lastAccessed > newestAccess) {
        newestAccess = entry.lastAccessed;
      }
    }

    return {
      filesTracked: this.memory.size,
      totalSummaries,
      oldestAccess,
      newestAccess,
    };
  }
}

/**
 * Calculate hash of file content
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}