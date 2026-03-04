#!/usr/bin/env node

/**
 * Temporal worker for Sentinel pentest pipeline.
 *
 * Polls the 'sentinel-pipeline' task queue and executes activities.
 * Handles up to 25 concurrent activities to support multiple parallel workflows.
 *
 * Usage:
 *   npm run temporal:worker
 *   # or
 *   node dist/temporal/worker.js
 *
 * Environment:
 *   TEMPORAL_ADDRESS - Temporal server address (default: localhost:7233)
 */

import { NativeConnection, Worker, bundleWorkflowCode } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import * as activities from './activities.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runWorker(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  console.log(`Connecting to Temporal at ${address}...`);

  const connection = await NativeConnection.connect({ address });

  console.log('Bundling workflows...');
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.join(__dirname, 'workflows.js'),
  });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    workflowBundle,
    activities,
    taskQueue: 'sentinel-pipeline',
    maxConcurrentActivityTaskExecutions: 25,
  });

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down worker...');
    worker.shutdown();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Sentinel worker started');
  console.log('Task queue: sentinel-pipeline');
  console.log('Press Ctrl+C to stop\n');

  try {
    await worker.run();
  } finally {
    await connection.close();
    console.log('Worker stopped');
  }
}

runWorker().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
