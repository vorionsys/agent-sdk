// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * Aurais Agent SDK - Main Agent Class
 *
 * Provides easy WebSocket connection to Aurais Mission Control with:
 * - Auto-reconnection with exponential backoff
 * - Type-safe message handling
 * - Event emitter pattern
 * - Heartbeat management
 *
 * @packageDocumentation
 */

import { EventEmitter } from "eventemitter3";
import WebSocket from "ws";
import {
  type AuraisAgentConfig,
  type AgentEvents,
  type AgentStatus,
  type ConnectionState,
  type Task,
  type TaskResult,
  type TaskProgress,
  type ActionRequest,
  type ActionRequestSubmission,
  type ActionDecision,
  type AgentConfig,
  type AgentMetrics,
  type InboundMessage,
  type OutboundMessage,
  type AgentCapability,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SERVER_URL = "wss://api.aurais.ai/ws";
const DEFAULT_HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DEFAULT_CONNECTION_TIMEOUT = 10000; // 10 seconds
const DEFAULT_RECONNECT_BASE_DELAY = 1000; // 1 second
const DEFAULT_RECONNECT_MAX_DELAY = 30000; // 30 seconds
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

// ============================================================================
// AuraisAgent Class
// ============================================================================

export class AuraisAgent extends EventEmitter<AgentEvents> {
  private config: Required<AuraisAgentConfig>;
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private status: AgentStatus = "IDLE";
  private agentId: string | null = null;
  private structuredId: string | null = null;

  // Reconnection state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongTime: number = 0;

  // Message tracking
  private messageCounter = 0;
  private pendingAcks: Map<
    string,
    {
      resolve: (value: boolean) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  constructor(config: AuraisAgentConfig) {
    super();

    if (!config.apiKey) {
      throw new Error("API key is required");
    }

    this.config = {
      apiKey: config.apiKey,
      capabilities: config.capabilities ?? ["execute"],
      skills: config.skills ?? [],
      serverUrl: config.serverUrl ?? DEFAULT_SERVER_URL,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts:
        config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectBaseDelay:
        config.reconnectBaseDelay ?? DEFAULT_RECONNECT_BASE_DELAY,
      reconnectMaxDelay:
        config.reconnectMaxDelay ?? DEFAULT_RECONNECT_MAX_DELAY,
      heartbeatInterval: config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      connectionTimeout: config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      metadata: config.metadata ?? {},
    };
  }

  // =========================================================================
  // Connection Management
  // =========================================================================

  /**
   * Connect to Aurais Mission Control
   */
  async connect(): Promise<void> {
    if (
      this.connectionState === "connected" ||
      this.connectionState === "connecting"
    ) {
      return;
    }

    this.connectionState = "connecting";
    this.reconnectAttempts = 0;

    return this.establishConnection();
  }

  /**
   * Disconnect from Aurais Mission Control
   */
  disconnect(): void {
    this.cleanup();
    this.connectionState = "disconnected";
    this.emit("disconnected", "Manual disconnect");
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Get agent ID (available after successful registration)
   */
  getAgentId(): string | null {
    return this.agentId;
  }

  /**
   * Get structured agent ID (available after successful registration)
   */
  getStructuredId(): string | null {
    return this.structuredId;
  }

  // =========================================================================
  // Status Updates
  // =========================================================================

  /**
   * Update agent status
   */
  async updateStatus(
    status: AgentStatus,
    progress?: number,
    message?: string,
  ): Promise<void> {
    const oldStatus = this.status;
    this.status = status;

    if (oldStatus !== status) {
      this.emit("status:changed", oldStatus, status);
    }

    await this.sendMessage({
      type: "status:update",
      payload: { status, progress, message },
      messageId: this.generateMessageId(),
    });
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  // =========================================================================
  // Task Management
  // =========================================================================

  /**
   * Report task progress
   */
  async reportProgress(
    taskId: string,
    progress: number,
    message?: string,
  ): Promise<void> {
    const payload: TaskProgress = {
      taskId,
      status: this.status,
      progress: Math.min(100, Math.max(0, progress)),
      message,
    };

    await this.sendMessage({
      type: "task:progress",
      payload,
      messageId: this.generateMessageId(),
    });
  }

  /**
   * Complete a task
   */
  async completeTask(
    taskId: string,
    result: unknown,
    metrics?: TaskProgress["currentStep"] extends string ? never : object,
  ): Promise<void> {
    const taskResult: TaskResult = {
      taskId,
      success: true,
      result,
      metrics: metrics as TaskResult["metrics"],
    };

    await this.sendMessage({
      type: "task:completed",
      payload: taskResult,
      messageId: this.generateMessageId(),
    });

    this.emit("task:completed", taskResult);
  }

  /**
   * Fail a task
   */
  async failTask(taskId: string, error: string): Promise<void> {
    const taskResult: TaskResult = {
      taskId,
      success: false,
      error,
    };

    await this.sendMessage({
      type: "task:completed",
      payload: taskResult,
      messageId: this.generateMessageId(),
    });

    this.emit("task:completed", taskResult);
  }

  // =========================================================================
  // Action Requests
  // =========================================================================

  /**
   * Request an action that requires approval
   */
  async requestAction(request: ActionRequestSubmission): Promise<string> {
    const messageId = this.generateMessageId();

    await this.sendMessage({
      type: "action:request",
      payload: request,
      messageId,
    });

    return messageId;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.serverUrl);
      url.searchParams.set("apiKey", this.config.apiKey);

      const connectionTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
        }
        reject(new Error("Connection timeout"));
      }, this.config.connectionTimeout);

      try {
        this.ws = new WebSocket(url.toString());

        this.ws.on("open", () => {
          clearTimeout(connectionTimeout);
          this.onOpen();
          resolve();
        });

        this.ws.on("message", (data) => {
          this.onMessage(data.toString());
        });

        this.ws.on("close", (code, reason) => {
          clearTimeout(connectionTimeout);
          this.onClose(code, reason.toString());
        });

        this.ws.on("error", (error) => {
          clearTimeout(connectionTimeout);
          this.onError(error);
          reject(error);
        });
      } catch (error) {
        clearTimeout(connectionTimeout);
        reject(error);
      }
    });
  }

  private onOpen(): void {
    this.connectionState = "connected";
    this.reconnectAttempts = 0;
    this.lastPongTime = Date.now();

    // Start heartbeat
    this.startHeartbeat();

    // Send registration message
    this.sendMessage({
      type: "register",
      payload: {
        apiKey: this.config.apiKey,
        capabilities: this.config.capabilities,
        skills: this.config.skills,
        metadata: this.config.metadata,
      },
    });

    if (this.reconnectAttempts > 0) {
      this.emit("reconnected");
    } else {
      this.emit("connected");
    }
  }

  private onMessage(data: string): void {
    try {
      const message = JSON.parse(data) as InboundMessage;
      this.handleMessage(message);
    } catch (error) {
      this.emit("error", new Error(`Failed to parse message: ${error}`));
    }
  }

  private onClose(code: number, reason: string): void {
    this.cleanup();

    const wasConnected = this.connectionState === "connected";
    this.connectionState = "disconnected";

    if (wasConnected) {
      this.emit("disconnected", reason || `Connection closed (code: ${code})`);
    }

    // Attempt reconnection if enabled
    if (
      this.config.autoReconnect &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    }
  }

  private onError(error: Error): void {
    this.emit("error", error);
  }

  private handleMessage(message: InboundMessage): void {
    this.emit("message", message);

    switch (message.type) {
      case "task:assigned":
        this.emit("task:assigned", message.payload as Task);
        break;

      case "decision:required":
        this.emit("decision:required", message.payload as ActionRequest);
        break;

      case "decision:result":
        this.emit("decision:result", message.payload as ActionDecision);
        break;

      case "config:updated":
        this.emit("config:updated", message.payload as AgentConfig);
        break;

      case "ping":
        this.sendPong(message.timestamp);
        break;

      case "ack":
        this.handleAck(message.messageId, message.success);
        break;

      case "error":
        this.emit(
          "error",
          new Error(`Server error: ${message.message} (${message.code})`),
        );
        break;
    }
  }

  private async sendMessage(
    message: OutboundMessage | { type: "register"; payload: object },
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const data = JSON.stringify(message);
    this.ws.send(data);

    if ("messageId" in message) {
      this.emit("message:sent", message as OutboundMessage);
    }
  }

  private sendPong(timestamp: number): void {
    this.lastPongTime = Date.now();
    this.sendMessage({
      type: "pong",
      timestamp,
    } as OutboundMessage);
  }

  private handleAck(messageId: string, success: boolean): void {
    const pending = this.pendingAcks.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingAcks.delete(messageId);
      pending.resolve(success);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.isConnected()) return;

    try {
      this.sendMessage({
        type: "heartbeat",
        payload: {
          timestamp: Date.now(),
          status: this.status,
        },
      } as OutboundMessage);
    } catch {
      // Connection may have closed
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    this.connectionState = "reconnecting";

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1) +
        Math.random() * 1000,
      this.config.reconnectMaxDelay,
    );

    this.emit(
      "reconnecting",
      this.reconnectAttempts,
      this.config.maxReconnectAttempts,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.establishConnection();
      } catch {
        // Will trigger onClose which will schedule another reconnect
      }
    }, delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear pending acks
    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingAcks.clear();

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${++this.messageCounter}`;
  }
}
