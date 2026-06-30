// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * @vorionsys/agent-sdk
 *
 * TypeScript SDK for connecting AI agents to Aurais Mission Control.
 * Provides WebSocket connectivity with auto-reconnection, heartbeat
 * management, and type-safe message handling.
 *
 * @packageDocumentation
 */

// Main class
export { AuraisAgent } from "./AuraisAgent.js";

// All types
export type {
  // Configuration
  AuraisAgentConfig,
  AgentCapability,
  AgentStatus,
  ConnectionState,

  // Tasks
  Task,
  TaskPriority,
  TaskResult,
  TaskMetrics,
  TaskProgress,

  // Action Requests
  ActionRequest,
  ActionRequestSubmission,
  ActionDecision,
  RiskLevel,
  Urgency,

  // Configuration
  AgentConfig,

  // Messages
  InboundMessage,
  OutboundMessage,
  TaskAssignedMessage,
  DecisionRequiredMessage,
  DecisionResultMessage,
  ConfigUpdatedMessage,
  PingMessage,
  ErrorMessage,
  AcknowledgeMessage,
  StatusUpdateMessage,
  ActionRequestMessage,
  TaskCompletedMessage,
  TaskProgressMessage,
  HeartbeatMessage,
  PongMessage,
  RegisterMessage,

  // Metrics
  AgentMetrics,

  // Events
  AgentEvents,

  // Registration
  RegistrationResponse,
} from "./types.js";
