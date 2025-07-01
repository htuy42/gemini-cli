/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Create a simple unified diff between two strings
 */
export function createDiff(
  original: string,
  modified: string,
  originalPath: string = 'original',
  modifiedPath: string = 'modified'
): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  
  const diff: string[] = [];
  diff.push(`--- ${originalPath}`);
  diff.push(`+++ ${modifiedPath}`);
  
  // Simple line-by-line comparison
  // In a real implementation, we'd use a proper diff algorithm
  let i = 0;
  let j = 0;
  
  while (i < originalLines.length || j < modifiedLines.length) {
    if (i >= originalLines.length) {
      // Added lines at end
      diff.push(`+${modifiedLines[j]}`);
      j++;
    } else if (j >= modifiedLines.length) {
      // Removed lines at end
      diff.push(`-${originalLines[i]}`);
      i++;
    } else if (originalLines[i] === modifiedLines[j]) {
      // Same line
      diff.push(` ${originalLines[i]}`);
      i++;
      j++;
    } else {
      // Changed line - show as remove + add
      diff.push(`-${originalLines[i]}`);
      diff.push(`+${modifiedLines[j]}`);
      i++;
      j++;
    }
  }
  
  return diff.join('\n');
}