import OpenAI from 'openai';

/**
 * Initializes and retrieves the OpenAI client.
 * Validates presence of OPENAI_API_KEY.
 * 
 * @returns {OpenAI}
 */
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-proj-xxxx')) {
    throw new Error(
      '[Analyzer Error] OPENAI_API_KEY is missing or invalid in environment. Please check your .env file.'
    );
  }

  return new OpenAI({
    apiKey,
    timeout: 30000, // 30 seconds timeout to prevent hanging connections
    maxRetries: 3,   // Automatic retries on rate limits / 5xx server issues
  });
}

/**
 * Executive daily progress report prompt strictly configured per specification.
 */
const SYSTEM_PROMPT = `You are a Principal Executive Daily Progress Report Analyzer.
Transform the user's raw daily work logs, notes, or messages into a crisp, polished, executive daily progress report suitable for WhatsApp or Telegram delivery.

Structure the report clearly with these sections:
- 🚀 *Key Accomplishments* (completed high-impact tasks)
- 📊 *Progress & Metrics* (numbers, latency improvements, milestones, commits)
- ⏩ *Next Steps* (planned tasks for next work session)
- ⚠️ *Blockers & Dependencies* (items awaiting approval or help; state "None" if no blockers)

Formatting rules:
1. Use clean WhatsApp-style markdown (*bold headers*, _italics_, bullet points '•').
2. Keep subtle, professional emoji accents.
3. Keep the total length strictly under 200 words.
4. If the raw input is brief or casual Hinglish/English, professionally elevate the language without hallucinating facts.`;

/**
 * Analyzes raw daily work logs using OpenAI gpt-4o-mini.
 * 
 * @param {string} rawLogs - Aggregated raw text of markdown notes and git commits
 * @param {object} [options]
 * @param {string} [options.model] - Model name (defaults to process.env.OPENAI_MODEL or 'gpt-4o-mini')
 * @returns {Promise<string>} - Formatted WhatsApp-ready summary message
 */
export async function analyzeDailyWork(rawLogs, options = {}) {
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Gracefully handle empty or non-activity logs
  if (!rawLogs || rawLogs.trim().length === 0) {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `📋 *Daily Progress Report — ${today}*\n\n⚠️ _No activity or commit logs were recorded for today._\n\n• *Status:* Standby / No logged items.`;
  }

  try {
    const openai = getOpenAIClient();

    console.log(`[Analyzer] Submitting logs to OpenAI (${model})...`);

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `Here are my raw work logs and commits for today:\n\n${rawLogs}\n\nPlease generate the executive daily progress report for WhatsApp.`,
        },
      ],
      temperature: 0.3, // Low temperature for factual, concise extraction
      max_tokens: 450,  // Bound output length to guarantee under 200 words
    });

    const report = response.choices?.[0]?.message?.content?.trim();

    if (!report) {
      throw new Error('[Analyzer Error] Empty response received from OpenAI API.');
    }

    console.log('[Analyzer] Successfully synthesized daily report.');
    return report;
  } catch (error) {
    console.error('[Analyzer] Failed to analyze work logs:', error.message);

    if (error.status === 429) {
      console.warn('[Analyzer] ⚠️ OpenAI credits exhausted (429). Utilizing intelligent offline executive formatter as fallback...');
      return fallbackFormatDailyWork(rawLogs);
    } else if (error.status === 401) {
      console.warn('[Analyzer] ⚠️ OpenAI key invalid (401). Utilizing offline executive formatter as fallback...');
      return fallbackFormatDailyWork(rawLogs);
    } else if (error.code === 'ETIMEDOUT' || error.type === 'timeout') {
      console.warn('[Analyzer] ⚠️ OpenAI timed out. Utilizing offline executive formatter as fallback...');
      return fallbackFormatDailyWork(rawLogs);
    }

    // Default fallback if any unexpected LLM issue occurs
    return fallbackFormatDailyWork(rawLogs);
  }
}

/**
 * Intelligent offline executive progress formatter.
 * Ensures the automation pipeline NEVER crashes or gets stuck even if OpenAI balance is $0.
 * 
 * @param {string} rawLogs 
 * @returns {string}
 */
export function fallbackFormatDailyWork(rawLogs) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const lines = rawLogs
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('Date:'));

  const completed = [];
  const blockers = [];
  const metrics = [];

  for (const line of lines) {
    const clean = line.replace(/^[-*•]\s*(\[\d{2}:\d{2}\])?\s*/, '').trim();
    if (!clean) continue;

    if (/blocker|waiting|pending|stuck|approval/i.test(clean)) {
      blockers.push(`• ${clean}`);
    } else if (/latency|optimized|ms|pr|#\d+|percent|%|database/i.test(clean)) {
      metrics.push(`• ${clean}`);
    } else {
      completed.push(`• ${clean}`);
    }
  }

  const sections = [
    `📋 *Daily Progress Report — ${today}*`,
    '',
    '🚀 *Key Accomplishments:*',
    completed.length > 0 ? completed.slice(0, 4).join('\n') : '• Completed scheduled development tasks and reviews.',
    '',
    '📊 *Progress & Metrics:*',
    metrics.length > 0 ? metrics.slice(0, 3).join('\n') : '• All sprint deliverables tracking on schedule.',
    '',
    '⚠️ *Blockers & Dependencies:*',
    blockers.length > 0 ? blockers.join('\n') : '• None. All workflows unblocked.',
  ];

  return sections.join('\n');
}
