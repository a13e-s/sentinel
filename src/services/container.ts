/**
 * Dependency Injection Container
 *
 * Provides a per-workflow container for service instances.
 * Services are wired with explicit constructor injection.
 *
 * Usage:
 *   const container = getOrCreateContainer(workflowId, sessionMetadata);
 *   const auditSession = new AuditSession(sessionMetadata);  // Per-agent
 *   await auditSession.initialize(workflowId);
 */

import type { SessionMetadata } from '../audit/utils.js';
import { ConfigLoaderService } from './config-loader.js';
import { ExploitationCheckerService } from './exploitation-checker.js';
import { AgentExecutionService } from './agent-execution.js';

/**
 * Dependencies required to create a Container.
 *
 * NOTE: AuditSession is NOT stored in the container.
 * Each agent execution receives its own AuditSession instance
 * because AuditSession uses instance state (currentAgentName) that
 * cannot be shared across parallel agents.
 */
export interface ContainerDependencies {
  readonly sessionMetadata: SessionMetadata;
}

/**
 * DI Container for a single workflow.
 *
 * Holds all service instances for the workflow lifecycle.
 * Services are instantiated once and reused across agent executions.
 *
 * NOTE: AuditSession is NOT stored here - it's passed per agent execution
 * to support parallel agents each having their own logging context.
 */
export class Container {
  readonly sessionMetadata: SessionMetadata;
  readonly configLoader: ConfigLoaderService;
  readonly exploitationChecker: ExploitationCheckerService;
  readonly agentExecution: AgentExecutionService;

  constructor(deps: ContainerDependencies) {
    this.sessionMetadata = deps.sessionMetadata;

    this.configLoader = new ConfigLoaderService();
    this.exploitationChecker = new ExploitationCheckerService();
    this.agentExecution = new AgentExecutionService(this.configLoader);
  }
}

/** Map of workflowId to Container instance. */
const containers = new Map<string, Container>();

/**
 * Get or create a Container for a workflow.
 *
 * If a container already exists for the workflowId, returns it.
 * Otherwise, creates a new container with the provided dependencies.
 */
export function getOrCreateContainer(
  workflowId: string,
  sessionMetadata: SessionMetadata
): Container {
  let container = containers.get(workflowId);

  if (!container) {
    container = new Container({ sessionMetadata });
    containers.set(workflowId, container);
  }

  return container;
}

/**
 * Remove a Container when a workflow completes.
 * Should be called in logWorkflowComplete to clean up resources.
 */
export function removeContainer(workflowId: string): void {
  containers.delete(workflowId);
}

/**
 * Get an existing Container for a workflow, if one exists.
 * Returns undefined if no container exists for the workflowId.
 */
export function getContainer(workflowId: string): Container | undefined {
  return containers.get(workflowId);
}
