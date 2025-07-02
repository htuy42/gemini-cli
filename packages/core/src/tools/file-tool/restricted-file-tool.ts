/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileTool } from './file-tool.js';
import { Config } from '../../config/config.js';
import { ToolResult } from '../tools.js';
import { FlashIntegration } from './flash-integration.js';
import { FileReadResult } from './types.js';

/**
 * A restricted version of FileTool that only allows read operations.
 * Used by the main orchestrator agent to prevent direct file modifications.
 */
export class RestrictedFileTool extends FileTool {
  static override readonly Name = 'file';
  
  constructor(
    rootPath: string,
    config: Config,
    flash?: FlashIntegration,
  ) {
    super(rootPath, config, flash);
  }
  
  override async execute(
    args: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    // Parse args to check operation
    const params = this.validateAndParseArgs(args);
    
    // Only allow read operations
    if (params.operation !== 'read') {
      return {
        status: 'error',
        message: `Operation '${params.operation}' is not allowed. Main agent can only read files. To modify files, spawn a task agent.`,
        llmContent: `Error: Operation '${params.operation}' is not allowed. As the main orchestrator, you can only read files. To create, edit, or write files, you must spawn a task agent using the 'task_agent' tool.`,
        returnDisplay: `❌ Operation '${params.operation}' not allowed for main agent`,
      } as FileReadResult;
    }
    
    // Delegate to parent class for read operations
    return super.execute(args, signal);
  }
}