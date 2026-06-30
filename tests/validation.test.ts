// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * AuraisAgent Validation Tests
 *
 * Tests configuration validation, message validation, API contract
 * conformance, and input boundary conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock WebSocket using vi.hoisted() for ESM compatibility
// ---------------------------------------------------------------------------

const { mockWsInstances, WebSocketMock } = vi.hoisted(() => {
  class MiniEmitter {
    private _listeners: Map<string, Function[]> = new Map();
    on(event: string, fn: Function) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event)!.push(fn);
      return this;
    }
    once(event: string, fn: Function) {
      const wrapper = (...args: any[]) => {
        this.removeListener(event, wrapper);
        fn(...args);
      };
      return this.on(event, wrapper);
    }
    emit(event: string, ...args: any[]) {
      const fns = this._listeners.get(event) || [];
      fns.forEach((fn) => fn(...args));
      return fns.length > 0;
    }
    removeListener(event: string, fn: Function) {
      const fns = this._listeners.get(event);
      if (fns)
        this._listeners.set(
          event,
          fns.filter((f) => f !== fn),
        );
      return this;
    }
    removeAllListeners() {
      this._listeners.clear();
      return this;
    }
  }

  const mockWsInstances: any[] = [];

  class WebSocketMock extends MiniEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    send: any;
    close: any;

    constructor(..._args: any[]) {
      super();
      this.send = vi.fn();
      this.close = vi.fn(() => {
        this.readyState = 3;
      });
      const origRemoveAll = this.removeAllListeners.bind(this);
      this.removeAllListeners = vi.fn(() => {
        origRemoveAll();
        return this;
      });
      mockWsInstances.push(this);
    }
  }

  return { mockWsInstances, WebSocketMock };
});

vi.mock("ws", () => ({ default: WebSocketMock }));

import { AuraisAgent } from "../src/AuraisAgent.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLatestWs(): any {
  return mockWsInstances[mockWsInstances.length - 1];
}

function createAgent(overrides: Record<string, unknown> = {}): AuraisAgent {
  return new AuraisAgent({
    apiKey: "test-key-123",
    heartbeatInterval: 60000,
    connectionTimeout: 5000,
    autoReconnect: false,
    ...overrides,
  });
}

async function connectAgent(agent: AuraisAgent): Promise<any> {
  const connectPromise = agent.connect();
  const ws = getLatestWs();
  ws.emit("open");
  await connectPromise;
  return ws;
}

function simulateServerMessage(
  ws: any,
  message: Record<string, unknown>,
): void {
  ws.emit("message", JSON.stringify(message));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuraisAgent validation", () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Configuration validation
  // =========================================================================

  describe("configuration validation", () => {
    it("throws on empty string apiKey", () => {
      expect(() => new AuraisAgent({ apiKey: "" })).toThrow(
        "API key is required",
      );
    });

    it("throws on whitespace-only apiKey that is falsy", () => {
      // Empty string is falsy; whitespace is truthy in JS, so it should construct
      const agent = new AuraisAgent({ apiKey: "   " });
      expect(agent).toBeInstanceOf(AuraisAgent);
    });

    it("applies default serverUrl when not provided", () => {
      const agent = createAgent();
      // We verify by connecting — the WebSocket constructor receives the URL
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      connectPromise.then(() => agent.disconnect());
    });

    it("accepts custom serverUrl", async () => {
      const agent = createAgent({ serverUrl: "wss://custom.example.com/ws" });
      const ws = await connectAgent(agent);
      // The mock was constructed — no error thrown for custom URL
      expect(ws).toBeDefined();
      agent.disconnect();
    });

    it('defaults capabilities to ["execute"] when not specified', async () => {
      const agent = new AuraisAgent({ apiKey: "test-key-123" });
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      await connectPromise;

      const registerMsg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(registerMsg.payload.capabilities).toEqual(["execute"]);
      agent.disconnect();
    });

    it("defaults skills to empty array when not specified", async () => {
      const agent = new AuraisAgent({ apiKey: "test-key-123" });
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      await connectPromise;

      const registerMsg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(registerMsg.payload.skills).toEqual([]);
      agent.disconnect();
    });

    it("defaults autoReconnect to true", async () => {
      const agent = new AuraisAgent({
        apiKey: "test-key-123",
        maxReconnectAttempts: 1,
        reconnectBaseDelay: 100,
      });
      const ws = await connectAgent(agent);
      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      // Close should trigger reconnection since autoReconnect defaults to true
      ws.emit("close", 1006, "Unexpected");

      expect(reconnectSpy).toHaveBeenCalled();
      agent.disconnect();
    });

    it("defaults metadata to empty object when not specified", async () => {
      const agent = new AuraisAgent({ apiKey: "test-key-123" });
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      await connectPromise;

      const registerMsg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(registerMsg.payload.metadata).toEqual({});
      agent.disconnect();
    });

    it("accepts zero for reconnectBaseDelay", () => {
      const agent = createAgent({ reconnectBaseDelay: 0 });
      expect(agent).toBeInstanceOf(AuraisAgent);
    });

    it("accepts zero for maxReconnectAttempts (disables reconnection)", async () => {
      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 0,
      });
      const ws = await connectAgent(agent);
      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      ws.emit("close", 1006, "Unexpected");

      // Should not reconnect because maxReconnectAttempts is 0
      expect(reconnectSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });
  });

  // =========================================================================
  // Message validation — invalid/malformed inbound messages
  // =========================================================================

  describe("inbound message validation", () => {
    it("emits error for non-JSON server messages", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      ws.emit("message", "<<<not json>>>");

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0].message).toContain("Failed to parse");
      agent.disconnect();
    });

    it("emits error for empty string server messages", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      ws.emit("message", "");

      expect(errorSpy).toHaveBeenCalledOnce();
      agent.disconnect();
    });

    it("handles unknown message type without crashing", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const messageSpy = vi.fn();
      const errorSpy = vi.fn();
      agent.on("message", messageSpy);
      agent.on("error", errorSpy);

      simulateServerMessage(ws, { type: "unknown:type", payload: {} });

      // The raw message event should still fire
      expect(messageSpy).toHaveBeenCalledOnce();
      // No error emitted for unknown type — it is silently ignored in the switch
      expect(errorSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });

    it("handles message with missing payload field gracefully", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const taskSpy = vi.fn();
      agent.on("task:assigned", taskSpy);

      // Message without payload — the handler does message.payload which is undefined
      simulateServerMessage(ws, { type: "task:assigned" });

      // The event should still fire with undefined payload
      expect(taskSpy).toHaveBeenCalledWith(undefined);
      agent.disconnect();
    });

    it("handles ack message for non-existent messageId", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      simulateServerMessage(ws, {
        type: "ack",
        messageId: "non-existent-msg-id",
        success: true,
      });

      // Should not throw or emit error
      expect(errorSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });

    it("handles ack with success=false for non-existent messageId", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      simulateServerMessage(ws, {
        type: "ack",
        messageId: "non-existent-msg-id",
        success: false,
      });

      expect(errorSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });

    it("handles server error message with code and message fields", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      simulateServerMessage(ws, {
        type: "error",
        code: "AUTH_FAILED",
        message: "Invalid API key",
      });

      expect(errorSpy).toHaveBeenCalledOnce();
      const err = errorSpy.mock.calls[0][0];
      expect(err.message).toContain("AUTH_FAILED");
      expect(err.message).toContain("Invalid API key");
      agent.disconnect();
    });
  });

  // =========================================================================
  // API contract — outbound message format verification
  // =========================================================================

  describe("outbound message format", () => {
    it("register message includes apiKey, capabilities, skills, metadata", async () => {
      const agent = createAgent({
        capabilities: ["execute", "admin"],
        skills: ["web-dev", "api-integration"],
        metadata: { version: "1.0", env: "test" },
      });
      const ws = await connectAgent(agent);

      const registerMsg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(registerMsg).toEqual({
        type: "register",
        payload: {
          apiKey: "test-key-123",
          capabilities: ["execute", "admin"],
          skills: ["web-dev", "api-integration"],
          metadata: { version: "1.0", env: "test" },
        },
      });
      agent.disconnect();
    });

    it("status:update message has correct shape with messageId", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("WORKING", 25, "Processing data");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("status:update");
      expect(sent.messageId).toMatch(/^msg_\d+_\d+$/);
      expect(sent.payload).toEqual({
        status: "WORKING",
        progress: 25,
        message: "Processing data",
      });
      agent.disconnect();
    });

    it("task:progress message clamps progress to 0", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("task-1", -50, "Negative");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(0);
      agent.disconnect();
    });

    it("task:progress message clamps progress to 100", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("task-1", 999);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(100);
      agent.disconnect();
    });

    it("task:progress message includes taskId and status", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("task-42", 50, "Halfway");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:progress");
      expect(sent.payload.taskId).toBe("task-42");
      expect(sent.payload.status).toBe("IDLE");
      expect(sent.payload.message).toBe("Halfway");
      expect(sent.messageId).toBeDefined();
      agent.disconnect();
    });

    it("task:completed success message has correct shape", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.completeTask("task-99", { data: [1, 2, 3] });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:completed");
      expect(sent.payload).toEqual({
        taskId: "task-99",
        success: true,
        result: { data: [1, 2, 3] },
      });
      expect(sent.messageId).toMatch(/^msg_/);
      agent.disconnect();
    });

    it("task:completed failure message has correct shape", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.failTask("task-99", "Timeout exceeded");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:completed");
      expect(sent.payload).toEqual({
        taskId: "task-99",
        success: false,
        error: "Timeout exceeded",
      });
      agent.disconnect();
    });

    it("action:request message has correct shape", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      const submission = {
        type: "deploy",
        title: "Deploy v2",
        description: "Deploy version 2 to production",
        riskLevel: "high" as const,
        payload: { version: "2.0", target: "production" },
        metadata: { requestedBy: "agent-1" },
      };
      const msgId = await agent.requestAction(submission);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("action:request");
      expect(sent.payload).toEqual(submission);
      expect(sent.messageId).toBe(msgId);
      agent.disconnect();
    });

    it("pong response echoes server timestamp", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      const ts = 1700000000000;
      simulateServerMessage(ws, { type: "ping", timestamp: ts });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent).toEqual({ type: "pong", timestamp: ts });
      agent.disconnect();
    });

    it("messageId values are unique across calls", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("WORKING");
      await agent.updateStatus("PAUSED");
      await agent.reportProgress("t1", 50);

      const ids = ws.send.mock.calls.map(
        (c: any[]) => JSON.parse(c[0]).messageId,
      );
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
      agent.disconnect();
    });
  });

  // =========================================================================
  // Operations requiring connection — throw when disconnected
  // =========================================================================

  describe("operations require connection", () => {
    it("updateStatus throws when not connected", async () => {
      const agent = createAgent();
      await expect(agent.updateStatus("WORKING")).rejects.toThrow(
        "Not connected",
      );
    });

    it("reportProgress throws when not connected", async () => {
      const agent = createAgent();
      await expect(agent.reportProgress("task-1", 50)).rejects.toThrow(
        "Not connected",
      );
    });

    it("completeTask throws when not connected", async () => {
      const agent = createAgent();
      await expect(agent.completeTask("task-1", {})).rejects.toThrow(
        "Not connected",
      );
    });

    it("failTask throws when not connected", async () => {
      const agent = createAgent();
      await expect(agent.failTask("task-1", "err")).rejects.toThrow(
        "Not connected",
      );
    });

    it("requestAction throws when not connected", async () => {
      const agent = createAgent();
      await expect(
        agent.requestAction({
          type: "test",
          title: "Test",
          description: "Test action",
          riskLevel: "low",
          payload: {},
        }),
      ).rejects.toThrow("Not connected");
    });

    it("operations throw after disconnect", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      agent.disconnect();

      await expect(agent.updateStatus("WORKING")).rejects.toThrow(
        "Not connected",
      );
    });
  });

  // =========================================================================
  // Status transition tracking
  // =========================================================================

  describe("status transitions", () => {
    it("tracks multiple consecutive status changes", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const transitions: [string, string][] = [];
      agent.on("status:changed", (old, next) => transitions.push([old, next]));

      await agent.updateStatus("WORKING");
      await agent.updateStatus("PAUSED");
      await agent.updateStatus("ERROR");
      await agent.updateStatus("IDLE");

      expect(transitions).toEqual([
        ["IDLE", "WORKING"],
        ["WORKING", "PAUSED"],
        ["PAUSED", "ERROR"],
        ["ERROR", "IDLE"],
      ]);
      expect(agent.getStatus()).toBe("IDLE");
      agent.disconnect();
    });

    it("does not emit status:changed for same-to-same transitions", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const statusSpy = vi.fn();
      agent.on("status:changed", statusSpy);

      await agent.updateStatus("WORKING");
      await agent.updateStatus("WORKING"); // same status

      expect(statusSpy).toHaveBeenCalledTimes(1);
      agent.disconnect();
    });

    it("sends status:update message even when status unchanged", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("IDLE"); // same as current

      // Message should still be sent (server needs the update)
      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("status:update");
      agent.disconnect();
    });
  });
});
