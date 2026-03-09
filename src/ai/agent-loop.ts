/**
 * Provider-agnostic agent loop.
 *
 * Custom while-loop over BaseChatModel.invoke() with tool calling,
 * cost tracking, turn limits, and heartbeat support.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import { calculateCost, type CostResult } from './cost-tracker.js';
import type { ProviderName } from '../types/providers.js';
import {
  protectToolOutput,
  type ToolOutputSanitizationMode,
} from '../security/tool-output-policy.js';

export interface AgentLoopConfig {
  maxTurns: number;
  maxCostUsd: number;
  provider?: ProviderName;
  model?: string;
  heartbeat?: () => void;
  heartbeatIntervalMs?: number;
  onTurnComplete?: (turn: number, cost: CostResult) => void;
  toolOutputSanitizationMode?: ToolOutputSanitizationMode;
}

export interface AgentLoopResult {
  success: boolean;
  result: string;
  turns: number;
  totalCost: CostResult;
  toolCalls: number;
  reason: 'complete' | 'max_turns' | 'max_cost' | 'error';
  error?: string;
}

/** Maximum retries for rate limit (429) errors before giving up. */
const RATE_LIMIT_MAX_RETRIES = 5;

/** Base delay in ms for rate limit backoff (doubles each retry). */
const RATE_LIMIT_BASE_DELAY_MS = 15_000;

/** Check if an error is a rate limit (429) error. */
function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.includes('rate_limit');
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a tool-calling agent loop until completion, turn limit, or cost limit. */
export async function runAgentLoop(
  model: BaseChatModel,
  prompt: string,
  tools: StructuredToolInterface[],
  config: AgentLoopConfig,
): Promise<AgentLoopResult> {
  const provider = config.provider ?? 'ollama';
  const modelName = config.model ?? 'unknown';

  // 1. Build initial messages and bind tools
  const messages: BaseMessage[] = [new HumanMessage(prompt)];
  const toolsBindable = tools.length > 0 && model.bindTools != null;
  const modelWithTools = toolsBindable ? model.bindTools!(tools) : model;

  console.log(`[agent-loop] Starting: provider=${provider} model=${modelName} tools=${tools.length} toolsBindable=${toolsBindable}`);

  // 2. Build tool lookup map
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }

  // 3. Loop state
  let turns = 0;
  let totalToolCalls = 0;
  const totalCost: CostResult = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let lastHeartbeat = Date.now();

  while (turns < config.maxTurns) {
    turns++;

    // 4. Call the model (with rate limit retry)
    let response: AIMessage;
    let rateLimitRetries = 0;

    while (true) {
      try {
        response = (await modelWithTools.invoke(messages)) as AIMessage;
        break;
      } catch (error) {
        if (isRateLimitError(error) && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
          rateLimitRetries++;
          const delayMs = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, rateLimitRetries - 1);
          console.log(`[agent-loop] Turn ${turns}: rate limited, retry ${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES} in ${delayMs / 1000}s`);
          // Heartbeat during wait to prevent Temporal activity timeout
          if (config.heartbeat != null) {
            config.heartbeat();
          }
          await sleep(delayMs);
          continue;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[agent-loop] Turn ${turns}: model error: ${errorMessage}`);
        return {
          success: false,
          result: '',
          turns,
          totalCost,
          toolCalls: totalToolCalls,
          reason: 'error',
          error: errorMessage,
        };
      }
    }

    // Log turn details
    const turnToolCalls = (response.tool_calls as ToolCall[] | undefined) ?? [];
    const responsePreview = extractText(response).slice(0, 200);
    console.log(
      `[agent-loop] Turn ${turns}: tool_calls=${turnToolCalls.length}` +
      (turnToolCalls.length > 0 ? ` tools=[${turnToolCalls.map(t => t.name).join(', ')}]` : '') +
      ` response=${responsePreview.length > 0 ? `"${responsePreview}..."` : '(empty)'}`,
    );

    // 5. Track cost
    const turnCost = calculateCost(provider, modelName, response);
    totalCost.inputTokens += turnCost.inputTokens;
    totalCost.outputTokens += turnCost.outputTokens;
    totalCost.costUsd += turnCost.costUsd;

    config.onTurnComplete?.(turns, turnCost);

    // 6. Check cost limit
    if (config.maxCostUsd > 0 && totalCost.costUsd >= config.maxCostUsd) {
      const text = extractText(response);
      return {
        success: false,
        result: text,
        turns,
        totalCost,
        toolCalls: totalToolCalls,
        reason: 'max_cost',
      };
    }

    // 7. Heartbeat
    if (config.heartbeat != null && config.heartbeatIntervalMs != null) {
      const now = Date.now();
      if (now - lastHeartbeat >= config.heartbeatIntervalMs) {
        config.heartbeat();
        lastHeartbeat = now;
      }
    }

    // 8. Check for tool calls
    const toolCalls = response.tool_calls as ToolCall[] | undefined;
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — model is done. Return success regardless of whether
      // tools were called. The execution service handles auto-saving the
      // response text as a deliverable if the model didn't call save_deliverable.
      const text = extractText(response);
      return {
        success: true,
        result: text,
        turns,
        totalCost,
        toolCalls: totalToolCalls,
        reason: 'complete',
      };
    }

    // 9. Execute tool calls and collect results
    messages.push(response);
    totalToolCalls += toolCalls.length;

    for (const toolCall of toolCalls) {
      const toolInstance = toolMap.get(toolCall.name);
      let toolResult: string;

      if (!toolInstance) {
        toolResult = `Error: Tool "${toolCall.name}" not found`;
      } else {
        try {
          toolResult = await toolInstance.invoke(toolCall.args);
        } catch (error) {
          toolResult = `Error executing tool "${toolCall.name}": ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }

      const protectedToolOutput = protectToolOutput(
        toolResult,
        config.toolOutputSanitizationMode,
      );

      if (protectedToolOutput.detection.wasModified || protectedToolOutput.wasEnforced) {
        console.warn(
          `[agent-loop] Tool "${toolCall.name}" output flagged in ${protectedToolOutput.mode} mode` +
          ` enforced=${protectedToolOutput.wasEnforced}`,
        );
      }

      messages.push(
        new ToolMessage({
          content: protectedToolOutput.content,
          tool_call_id: toolCall.id ?? toolCall.name,
        }),
      );
    }
  }

  // 10. Reached max turns
  return {
    success: false,
    result: '',
    turns,
    totalCost,
    toolCalls: totalToolCalls,
    reason: 'max_turns',
  };
}

function extractText(message: AIMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  // Content blocks — extract text from all text blocks
  if (Array.isArray(message.content)) {
    return message.content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          typeof block === 'object' && 'type' in block && block.type === 'text',
      )
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}
