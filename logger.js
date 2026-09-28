import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Returns today's date formatted as YYYY-MM-DD in the local timezone.
 * @returns {string} e.g. "2026-09-28"
 */
export function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fetches Git commit messages made since 00:00:00 today.
 * Gracefully handles scenarios where Git is not installed or repo has no commits today.
 * 
 * @param {string} repoPath - Directory of the git repository
 * @returns {string|null} - Formatted git commits or null if none found
 */
export function fetchGitCommitsToday(repoPath = '.') {
  try {
    // Check if path is in a git repository
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    // Extract commits authored today with commit hash, author, and subject
    const gitCmd = 'git log --since="00:00:00" --pretty=format:"• [%h] %s (%an)"';
    const output = execSync(gitCmd, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    return output.length > 0 ? output : null;
  } catch (error) {
    // Git might not be initialized, directory doesn't exist, or no commits yet
    return null;
  }
}

/**
 * Reads local markdown work log.
 * If file contains date headers like '## 2026-09-28' or '## Today', extracts that section.
 * Otherwise, returns the entire non-empty content of the log file.
 * 
 * @param {string} filePath - Absolute or relative path to work_log.md
 * @returns {string|null} - Content of the log or null if file doesn't exist/empty
 */
export function fetchMarkdownLog(filePath = './work_log.md') {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8').trim();
    if (!rawContent) return null;

    const today = getTodayDateString();

    // Check if markdown has sections demarcated by date or "Today"
    // e.g., "## 2026-09-28" or "### 2026-09-28" or "## Today"
    const sectionRegex = new RegExp(
      `(?:^|\\n)#{1,4}\\s+(?:${today}|Today|TODAY)\\b([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`,
      'i'
    );
    const match = rawContent.match(sectionRegex);

    if (match && match[1].trim()) {
      return match[1].trim();
    }

    // Fallback: Return full file content if no specific today section found
    return rawContent;
  } catch (error) {
    console.error(`[Logger] Error reading markdown log at ${resolvedPath}:`, error.message);
    return null;
  }
}

/**
 * Ingestion Engine: Aggregates both local markdown notes and Git commits.
 * Combines available sources and returns structured raw text for AI analysis.
 * 
 * @param {object} options
 * @param {string} [options.logFilePath='./work_log.md']
 * @param {boolean} [options.enableGit=true]
 * @param {string} [options.repoPath='.']
 * @returns {Promise<{ hasData: boolean, rawContent: string, sources: string[] }>}
 */
export async function getAggregatedDailyWork(options = {}) {
  const {
    logFilePath = process.env.LOG_FILE_PATH || './work_log.md',
    enableGit = process.env.ENABLE_GIT_COMMITS !== 'false',
    repoPath = process.env.GIT_REPO_PATH || '.',
  } = options;

  const todayStr = getTodayDateString();
  const sources = [];
  const segments = [];

  // 1. Ingest Markdown Work Log
  const markdownLogs = fetchMarkdownLog(logFilePath);
  if (markdownLogs) {
    sources.push(`Markdown log (${logFilePath})`);
    segments.push(`### MANUAL NOTES & TASK LOG:\n${markdownLogs}`);
  }

  // 2. Ingest Git Commits
  if (enableGit) {
    const gitLogs = fetchGitCommitsToday(repoPath);
    if (gitLogs) {
      sources.push('Git commits');
      segments.push(`### GIT COMMITS TODAY:\n${gitLogs}`);
    }
  }

  // Handle fallback if no entries were detected
  if (segments.length === 0) {
    return {
      hasData: false,
      rawContent: `No activity logged for ${todayStr}. No entries found in "${logFilePath}" and no Git commits detected for today.`,
      sources: [],
    };
  }

  const rawContent = `Date: ${todayStr}\n\n` + segments.join('\n\n');

  return {
    hasData: true,
    rawContent,
    sources,
  };
}

/**
 * Helper to append a quick task entry to the local work_log.md
 * @param {string} entry - Task or achievement note
 * @param {string} filePath - Path to work_log.md
 */
export function appendDailyLogEntry(entry, filePath = './work_log.md') {
  const resolvedPath = path.resolve(filePath);
  const today = getTodayDateString();
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const formattedLine = `- [${timestamp}] ${entry}\n`;

  if (!fs.existsSync(resolvedPath)) {
    fs.writeFileSync(resolvedPath, `# Daily Work Log\n\n## ${today}\n${formattedLine}`, 'utf-8');
    return;
  }

  const currentContent = fs.readFileSync(resolvedPath, 'utf-8');
  const sectionHeader = `## ${today}`;

  if (currentContent.includes(sectionHeader)) {
    // Append under existing section
    const updated = currentContent.replace(
      sectionHeader,
      `${sectionHeader}\n${formattedLine.trimEnd()}`
    );
    fs.writeFileSync(resolvedPath, updated, 'utf-8');
  } else {
    // Append new section at top or bottom
    fs.appendFileSync(resolvedPath, `\n\n${sectionHeader}\n${formattedLine}`, 'utf-8');
  }
}
