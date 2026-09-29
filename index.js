import 'dotenv/config';
import http from 'node:http';
import { app, rescheduleAllCronJobs, rescheduleCronJob } from './server.js';
import { store } from './store.js';
import { getAggregatedDailyWork } from './logger.js';
import { analyzeDailyWork } from './analyzer.js';
import { dispatchReport } from './dispatcher.js';
import {
  destroyWhatsAppClient,
} from './whatsapp.js';

const PORT = process.env.PORT || 3000;
const ENABLE_WHATSAPP = process.env.ENABLE_WHATSAPP !== 'false';

// Prevent server crash from Puppeteer file locks (e.g. EBUSY on unlink during logout)
process.on('unhandledRejection', (reason) => {
  console.warn('[Process] Handled unhandledRejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.warn('[Process] Handled uncaughtException:', err?.message || err);
});

/**
 * CLI Orchestrator: Ingests activity -> Analyzes with LLM -> Dispatches report
 * 
 * @param {object} [options]
 * @param {boolean} [options.testOnly=false] - If true, skips WhatsApp dispatch and logs to console
 * @returns {Promise<string>} - The generated report
 */
export async function executeDailyReportWorkflow(options = {}) {
  const { testOnly = false } = options;

  console.log('\n=============================================================');
  console.log(`[Workflow] 🚀 Starting Daily Progress Report Pipeline: ${new Date().toLocaleString()}`);
  console.log('=============================================================');

  try {
    // Step 1: Work Ingestion
    console.log('[Workflow] Step 1: Reading daily work activities & git logs...');
    const aggregated = await getAggregatedDailyWork();
    
    if (aggregated.sources.length > 0) {
      console.log(`[Workflow] Ingested sources: ${aggregated.sources.join(', ')}`);
    } else {
      console.log('[Workflow] Notice: No local work logs or git commits detected for today.');
    }

    // Step 2: AI Work Analyzer
    console.log('[Workflow] Step 2: Analyzing work log with OpenAI (gpt-4o-mini)...');
    const structuredReport = await analyzeDailyWork(aggregated.rawContent);

    console.log('\n--- [AI GENERATED DAILY REPORT] ---');
    console.log(structuredReport);
    console.log('-----------------------------------\n');

    store.update({
      rawText: aggregated.rawContent,
      enhancedDraft: structuredReport,
    });

    if (testOnly) {
      console.log('[Workflow] Test-only mode enabled. Dispatch skipped.');
      return structuredReport;
    }

    // Step 3: Dispatch Report via configured channel
    const currentState = store.getState();
    const result = await dispatchReport({
      text: structuredReport,
      channel: currentState.dispatchChannel,
      recipient: currentState.recipient,
    });

    console.log('[Workflow] ✅ Daily report workflow finished:', result);
    return structuredReport;
  } catch (error) {
    console.error('[Workflow] ❌ Error executing daily report pipeline:', error.message);
    throw error;
  }
}

/**
 * Main application bootstrap function.
 */
async function main() {
  const args = process.argv.slice(2);
  const isRunNow = args.includes('--run-now') || args.includes('-r');
  const isTestOnly = args.includes('--test-only') || args.includes('-t');

  console.log('─────────────────────────────────────────────────────────────');
  console.log('       🤖 AUTOREPORT AI: WEB DASHBOARD & AUTOMATION          ');
  console.log('─────────────────────────────────────────────────────────────');

  // Test-only mode: Run synthesis in terminal and exit
  if (isTestOnly) {
    console.log('[App] Running in TEST-ONLY mode (dry run without dispatch)...');
    try {
      await executeDailyReportWorkflow({ testOnly: true });
      process.exit(0);
    } catch (err) {
      console.error('[App] Test failed:', err.message);
      process.exit(1);
    }
  }

  // 1. Start HTTP Server for Mobile/Web Dashboard
  let currentPort = Number(PORT);
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${currentPort} is already in use. Retrying on port ${currentPort + 1}...`);
      currentPort += 1;
      setTimeout(() => {
        server.listen(currentPort);
      }, 500);
    } else {
      console.error('[Server Error]:', err.message);
    }
  });

  server.listen(currentPort, () => {
    console.log(`[Server] 🌐 Dashboard & REST API live at: http://localhost:${currentPort}`);
    console.log(`[Server] Mobile & Laptop access ready on port ${currentPort}`);
  });

  // 2. Initialize Cron Schedulers for all active workspaces from persistent state
  rescheduleAllCronJobs();

  // 3. WhatsApp clients are lazily initialized per-user when they open the QR modal.
  // No auto-init on boot — saves server resources for multi-user mode.
  if (ENABLE_WHATSAPP) {
    console.log('[WhatsApp] Per-user lazy initialization enabled. Sessions start when users scan QR.');
  } else {
    console.log('[WhatsApp] WhatsApp Web client disabled via ENABLE_WHATSAPP=false (Using Cloud/Telegram/Console).');
  }

  // 4. If '--run-now' passed, trigger immediately
  if (isRunNow) {
    console.log('[App] Immediate execution triggered via --run-now flag...');
    try {
      await executeDailyReportWorkflow({ testOnly: false });
    } catch (err) {
      console.error('[App] Immediate run failed:', err.message);
    }
  }
}

// Graceful termination handling
const handleShutdown = async (signal) => {
  console.log(`\n[App] Received ${signal}. Initiating graceful shutdown...`);
  try {
    await destroyWhatsAppClient();
  } finally {
    console.log('[App] Exited cleanly.');
    process.exit(0);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

main();
