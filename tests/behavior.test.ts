// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * AuraisAgent Behavioral Tests
 *
 * Tests the WebSocket lifecycle, message routing, heartbeat,
 * reconnection, and status management using a mocked WebSocket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock WebSocket using vi.hoisted() for ESM compatibility
// ---------------------------------------------------------------------------

const { mockWsInstances, WebSocketMock } = vi.hoisted(() => {
  // Simple EventEmitter inline (avoids external deps in hoisted scope)
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
      // Override removeAllListeners to also be a spy
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
  // The WebSocket constructor fires synchronously, so the instance is already available
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

describe("AuraisAgent behavioral", () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Connection lifecycle
  // =========================================================================

  describe("connect()", () => {
    it("transitions to connected state on successful open", async () => {
      const agent = createAgent();
      expect(agent.getConnectionState()).toBe("disconnected");

      await connectAgent(agent);

      expect(agent.getConnectionState()).toBe("connected");
      expect(agent.isConnected()).toBe(true);
      agent.disconnect();
    });

    it("emits connected event on first successful connection", async () => {
      const agent = createAgent();
      const connectedSpy = vi.fn();
      agent.on("connected", connectedSpy);

      await connectAgent(agent);

      expect(connectedSpy).toHaveBeenCalledOnce();
      agent.disconnect();
    });

    it("sends register message on connection open", async () => {
      const agent = createAgent({ capabilities: ["execute", "delegate"] });
      const ws = await connectAgent(agent);

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("register");
      expect(sent.payload.apiKey).toBe("test-key-123");
      expect(sent.payload.capabilities).toEqual(["execute", "delegate"]);
      agent.disconnect();
    });

    it("is idempotent when already connected", async () => {
      const agent = createAgent();
      await connectAgent(agent);

      // Second connect should return immediately
      await agent.connect();
      expect(agent.isConnected()).toBe(true);
      agent.disconnect();
    });
  });

  // =========================================================================
  // Disconnect
  // =========================================================================

  describe("disconnect()", () => {
    it("emits disconnected event and sets state", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const disconnectedSpy = vi.fn();
      agent.on("disconnected", disconnectedSpy);

      agent.disconnect();

      expect(agent.getConnectionState()).toBe("disconnected");
      expect(disconnectedSpy).toHaveBeenCalledWith("Manual disconnect");
    });

    it("cleans up WebSocket resources", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      agent.disconnect();

      expect(ws.removeAllListeners).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Message routing
  // =========================================================================

  describe("message routing", () => {
    it("emits task:assigned when server sends task:assigned", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const taskSpy = vi.fn();
      agent.on("task:assigned", taskSpy);

      const task = { id: "task-1", type: "test", description: "Do something" };
      simulateServerMessage(ws, { type: "task:assigned", payload: task });

      expect(taskSpy).toHaveBeenCalledWith(task);
      agent.disconnect();
    });

    it("emits decision:required when server sends decision:required", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const decisionSpy = vi.fn();
      agent.on("decision:required", decisionSpy);

      const request = { id: "req-1", action: "deploy", risk: "high" };
      simulateServerMessage(ws, {
        type: "decision:required",
        payload: request,
      });

      expect(decisionSpy).toHaveBeenCalledWith(request);
      agent.disconnect();
    });

    it("emits decision:result when server sends decision:result", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const resultSpy = vi.fn();
      agent.on("decision:result", resultSpy);

      const decision = { id: "req-1", approved: true };
      simulateServerMessage(ws, { type: "decision:result", payload: decision });

      expect(resultSpy).toHaveBeenCalledWith(decision);
      agent.disconnect();
    });

    it("emits config:updated when server sends config:updated", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const configSpy = vi.fn();
      agent.on("config:updated", configSpy);

      const config = { capabilities: ["execute"] };
      simulateServerMessage(ws, { type: "config:updated", payload: config });

      expect(configSpy).toHaveBeenCalledWith(config);
      agent.disconnect();
    });

    it("emits error on malformed JSON from server", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      ws.emit("message", "not-valid-json");

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorSpy.mock.calls[0][0].message).toContain("Failed to parse");
      agent.disconnect();
    });

    it("emits error on server error message", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      simulateServerMessage(ws, {
        type: "error",
        code: "RATE_LIMIT",
        message: "Too many requests",
      });

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0].message).toContain("Too many requests");
      agent.disconnect();
    });

    it("emits raw message event for all inbound messages", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const messageSpy = vi.fn();
      agent.on("message", messageSpy);

      const msg = { type: "task:assigned", payload: { id: "task-1" } };
      simulateServerMessage(ws, msg);

      expect(messageSpy).toHaveBeenCalledWith(msg);
      agent.disconnect();
    });

    it("responds to ping with pong", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      simulateServerMessage(ws, { type: "ping", timestamp: 1234567890 });

      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("pong");
      expect(sent.timestamp).toBe(1234567890);
      agent.disconnect();
    });

    it("resolves pending ack when server acknowledges", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // handleAck resolves the pending ack map entry
      // We can test indirectly: ack for unknown messageId does not throw
      simulateServerMessage(ws, {
        type: "ack",
        messageId: "unknown-id",
        success: true,
      });
      // No error emitted
      agent.disconnect();
    });
  });

  // =========================================================================
  // Status management
  // =========================================================================

  describe("updateStatus()", () => {
    it("throws when not connected", async () => {
      const agent = createAgent();
      await expect(agent.updateStatus("WORKING")).rejects.toThrow(
        "Not connected",
      );
    });

    it("emits status:changed when status transitions", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const statusSpy = vi.fn();
      agent.on("status:changed", statusSpy);

      await agent.updateStatus("WORKING");

      expect(statusSpy).toHaveBeenCalledWith("IDLE", "WORKING");
      expect(agent.getStatus()).toBe("WORKING");
      agent.disconnect();
    });

    it("does not emit status:changed when status unchanged", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const statusSpy = vi.fn();
      agent.on("status:changed", statusSpy);

      await agent.updateStatus("IDLE"); // same as initial

      expect(statusSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });

    it("sends status:update message over WebSocket", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("PAUSED", 50, "Waiting for input");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("status:update");
      expect(sent.payload.status).toBe("PAUSED");
      expect(sent.payload.progress).toBe(50);
      expect(sent.payload.message).toBe("Waiting for input");
      agent.disconnect();
    });
  });

  // =========================================================================
  // Task management
  // =========================================================================

  describe("task management", () => {
    it("reportProgress sends clamped progress value", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("task-1", 150, "Overdone");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:progress");
      expect(sent.payload.progress).toBe(100); // clamped to max
      agent.disconnect();
    });

    it("completeTask sends success result and emits event", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();
      const completeSpy = vi.fn();
      agent.on("task:completed", completeSpy);

      await agent.completeTask("task-1", { output: "done" });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:completed");
      expect(sent.payload.success).toBe(true);
      expect(sent.payload.result).toEqual({ output: "done" });
      expect(completeSpy).toHaveBeenCalledOnce();
      agent.disconnect();
    });

    it("failTask sends failure result and emits event", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();
      const completeSpy = vi.fn();
      agent.on("task:completed", completeSpy);

      await agent.failTask("task-1", "Something broke");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("task:completed");
      expect(sent.payload.success).toBe(false);
      expect(sent.payload.error).toBe("Something broke");
      expect(completeSpy).toHaveBeenCalledOnce();
      agent.disconnect();
    });
  });

  // =========================================================================
  // Action requests
  // =========================================================================

  describe("requestAction()", () => {
    it("sends action:request and returns messageId", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      const msgId = await agent.requestAction({
        type: "deploy",
        resource: "production",
        parameters: { version: "2.0" },
      });

      expect(msgId).toMatch(/^msg_/);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("action:request");
      expect(sent.payload.type).toBe("deploy");
      expect(sent.messageId).toBe(msgId);
      agent.disconnect();
    });
  });

  // =========================================================================
  // Reconnection
  // =========================================================================

  describe("reconnection", () => {
    it("schedules reconnect after close when autoReconnect is true", async () => {
      vi.useFakeTimers();
      try {
        const agent = createAgent({
          autoReconnect: true,
          maxReconnectAttempts: 3,
          reconnectBaseDelay: 100,
        });
        const ws = await connectAgent(agent);
        const reconnectSpy = vi.fn();
        agent.on("reconnecting", reconnectSpy);

        // Simulate server closing the connection
        ws.emit("close", 1006, "Abnormal closure");

        expect(agent.getConnectionState()).toBe("reconnecting");
        expect(reconnectSpy).toHaveBeenCalledWith(1, 3);

        agent.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reconnect when autoReconnect is false", async () => {
      const agent = createAgent({ autoReconnect: false });
      const ws = await connectAgent(agent);
      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      ws.emit("close", 1000, "Normal closure");

      expect(agent.getConnectionState()).toBe("disconnected");
      expect(reconnectSpy).not.toHaveBeenCalled();
      agent.disconnect();
    });
  });

  // =========================================================================
  // Heartbeat
  // =========================================================================

  describe("heartbeat", () => {
    it("sends heartbeat at configured interval", async () => {
      vi.useFakeTimers();
      try {
        const agent = createAgent({ heartbeatInterval: 1000 });
        const ws = await connectAgent(agent);
        ws.send.mockClear();

        await vi.advanceTimersByTimeAsync(1000);

        // Should have sent a heartbeat
        const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
        const heartbeat = calls.find((c: any) => c.type === "heartbeat");
        expect(heartbeat).toBeDefined();
        expect(heartbeat.payload.status).toBe("IDLE");

        agent.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops heartbeat after disconnect", async () => {
      vi.useFakeTimers();
      try {
        const agent = createAgent({ heartbeatInterval: 1000 });
        const ws = await connectAgent(agent);
        ws.send.mockClear();

        agent.disconnect();

        await vi.advanceTimersByTimeAsync(2000);

        // No heartbeat should have been sent after disconnect
        expect(ws.send).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
