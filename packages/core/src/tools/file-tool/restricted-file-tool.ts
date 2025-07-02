/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileTool } from './file-tool.js';
import { FileParams, FileResult } from './types.js';
import { Config } from '../../config/config.js';
import { FileDiscoveryService } from '../../services/fileDiscoveryService.js';
import { SchemaValidator } from '../schema-validator.js';

/**
 * A restricted version of FileTool that only allows read operations.
 * Used by the main orchestrator agent to prevent direct file modifications.
 */
export class RestrictedFileTool extends FileTool {
  static override readonly Name = 'file';
  
  constructor(
    targetDir: string,
    config: Config,
    flash?: { verifyEdit: (a: string, b: string, c: string) => Promise<any> },
    fileService?: FileDiscoveryService,
    validator?: SchemaValidator,
  ) {
    super(targetDir, config, flash, fileService, validator);
  }
  
  override async execute(
    params: FileParams,
    signal: AbortSignal,
    outputCallback?: (chunk: string) => void,
  ): Promise<FileResult> {
    // Only allow read operations
    if (params.operation !== 'read') {
      return {
        status: 'error',
        message: `Operation '${params.operation}' is not allowed. Main agent can only read files. To modify files, spawn a task agent.`,
        llmContent: `Error: Operation '${params.operation}' is not allowed. As the main orchestrator, you can only read files. To create, edit, or write files, you must spawn a task agent using the 'task_agent' tool.`,
        returnDisplay: `❌ Operation '${params.operation}' not allowed for main agent`,
      } as FileResult;
    }
    
    // Delegate to parent class for read operations
    return super.execute(params, signal, outputCallback);
  }
}