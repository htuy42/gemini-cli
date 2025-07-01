/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolResult } from '../tools.js';

/**
 * Mode for file reading operations
 */
export type FileReadMode = 'full' | 'lines' | 'summary';

/**
 * Options for file read operations
 */
export interface FileReadOptions {
  mode?: FileReadMode;
  lines?: {
    start: number;
    end: number;
  };
  prompt?: string;
  includeLineNumbers?: boolean;
}

/**
 * Result from file read operations
 */
export interface FileReadResult extends ToolResult {
  status?: 'success' | 'already_read' | 'error';
  content?: string;
  message?: string;
  metadata?: {
    totalLines?: number;
    fileSize?: number;
    lastModified?: number;
  };
}

/**
 * Types of edit operations
 */
export type EditOperation = 'replace' | 'insert' | 'delete';

/**
 * Single edit change
 */
export interface EditChange {
  line: number;
  operation: EditOperation;
  content?: string;
}

/**
 * Options for smart edit operations
 */
export interface SmartEditRequest {
  find?: string;
  task?: string;
  change?: string;
  verify?: boolean;
}

/**
 * Result from edit operations
 */
export interface FileEditResult extends ToolResult {
  status?: 'success' | 'error' | 'needs_confirmation' | 'completed_with_warnings';
  diff?: string;
  message?: string;
  warnings?: string[];
  suggestion?: string;
  suggestedEdits?: EditChange[];
}

/**
 * Result from smart edit operations
 */
export interface SmartEditResult extends FileEditResult {
  confidence?: number;
}

/**
 * Result from write operations
 */
export interface FileWriteResult extends ToolResult {
  status?: 'success' | 'error';
  message?: string;
  metadata?: {
    fileSize: number;
    created: boolean;
  };
}

/**
 * File memory entry
 */
export interface FileMemoryEntry {
  contentHash: string;
  lastModified: number;
  lastAccessed: number;
  summaries: Map<string, string>;
  linesShown?: Set<number>;
}

/**
 * Flash response for finding edit locations
 */
export interface FlashEditResponse {
  status: 'success' | 'unsure' | 'not_found';
  confidence: number;
  edits?: EditChange[];
  message?: string;
}

/**
 * Flash response for edit verification
 */
export interface FlashVerifyResponse {
  hasIssues: boolean;
  issues?: string[];
  suggestion?: string;
}