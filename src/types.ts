// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * Vorion Agent SDK - Type Definitions
 *
 * Type definitions for connecting AI agents to Aurais Mission Control.
 *
 * @packageDocumentation
 */

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AuraisAgentConfig {
  /** API key for authentication */
  apiKey: string;
  /** Agent capabilities (e.g., 'execute', 'external', 'delegate') */
  capabilities?: AgentCapability[];
  /** Agent skills (e.g., 'web-dev', 'api-integration') */
  skills?: string[];
  /** WebSocket server URL (defaults to wss://api.aurais.ai/ws) */
  serverUrl?: string;
  /** Enable auto-reconnection (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Base reconnection delay in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  reconnectMaxDelay?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number;
  /** Agent metadata */
  metadata?: Record<string, unknown>;
}

export type AgentCapability =
  | "execute"
  | "external"
  | "delegate"
  | "spawn"
  | "admin";

export type AgentStatus = "IDLE" | "WORKING" | "PAUSED" | "ERROR" | "OFFLINE";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ============================================================================
// Task Types
// ============================================================================

export interface Task {
  id: string;
  type: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  assignedAt: string;
  deadline?: string;
  metadata?: Record<string, unknown>;
}

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  metrics?: TaskMetrics;
}

export interface TaskMetrics {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  resourcesUsed?: Record<string, number>;
}

export interface TaskProgress {
  taskId: string;
  status: AgentStatus;
  progress: number; // 0-100
  message?: string;
  currentStep?: string;
  totalSteps?: number;
  currentStepIndex?: number;
}

// ============================================================================
// Action Request Types
// ============================================================================

export interface ActionRequest {
  id: string;
  type: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  urgency: Urgency;
  payload: Record<string, unknown>;
  requestedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Urgency = "queued" | "immediate";

export interface ActionRequestSubmission {
  type: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ActionDecision {
  requestId: string;
  decision: "approved" | "denied";
  reason?: string;
  decidedBy: string;
  decidedAt: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface AgentConfig {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

// Inbound messages (server → agent)
export type InboundMessage =
  | TaskAssignedMessage
  | DecisionRequiredMessage
  | DecisionResultMessage
  | ConfigUpdatedMessage
  | PingMessage
  | ErrorMessage
  | AcknowledgeMessage;

export interface TaskAssignedMessage {
  type: "task:assigned";
  payload: Task;
  messageId: string;
}

export interface DecisionRequiredMessage {
  type: "decision:required";
  payload: ActionRequest;
  messageId: string;
}

export interface DecisionResultMessage {
  type: "decision:result";
  payload: ActionDecision;
  messageId: string;
}

export interface ConfigUpdatedMessage {
  type: "config:updated";
  payload: AgentConfig;
  messageId: string;
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AcknowledgeMessage {
  type: "ack";
  messageId: string;
  success: boolean;
}

// Outbound messages (agent → server)
export type OutboundMessage =
  | StatusUpdateMessage
  | ActionRequestMessage
  | TaskCompletedMessage
  | TaskProgressMessage
  | HeartbeatMessage
  | PongMessage
  | RegisterMessage;

export interface StatusUpdateMessage {
  type: "status:update";
  payload: {
    status: AgentStatus;
    progress?: number;
    message?: string;
    taskId?: string;
  };
  messageId: string;
}

export interface ActionRequestMessage {
  type: "action:request";
  payload: ActionRequestSubmission;
  messageId: string;
}

export interface TaskCompletedMessage {
  type: "task:completed";
  payload: TaskResult;
  messageId: string;
}

export interface TaskProgressMessage {
  type: "task:progress";
  payload: TaskProgress;
  messageId: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  payload: {
    timestamp: number;
    status: AgentStatus;
    metrics?: AgentMetrics;
  };
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export interface RegisterMessage {
  type: "register";
  payload: {
    apiKey: string;
    capabilities: AgentCapability[];
    skills: string[];
    metadata?: Record<string, unknown>;
  };
}

// ============================================================================
// Agent Metrics
// ============================================================================

export interface AgentMetrics {
  cpuUsage?: number;
  memoryUsage?: number;
  taskQueue?: number;
  activeTasks?: number;
  uptime?: number;
  customMetrics?: Record<string, number>;
}

// ============================================================================
// Event Types
// ============================================================================

export interface AgentEvents {
  // Connection events
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  reconnected: () => void;
  error: (error: Error) => void;

  // Task events
  "task:assigned": (task: Task) => void;
  "task:completed": (result: TaskResult) => void;

  // Decision events
  "decision:required": (request: ActionRequest) => void;
  "decision:result": (decision: ActionDecision) => void;

  // Config events
  "config:updated": (config: AgentConfig) => void;

  // Status events
  "status:changed": (oldStatus: AgentStatus, newStatus: AgentStatus) => void;

  // Message events
  message: (message: InboundMessage) => void;
  "message:sent": (message: OutboundMessage) => void;
}

// ============================================================================
// Registration Response
// ============================================================================

export interface RegistrationResponse {
  success: boolean;
  agentId?: string;
  structuredId?: string;
  error?: string;
}
