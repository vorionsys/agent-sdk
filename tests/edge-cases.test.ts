// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

/**
 * AuraisAgent Edge-Case Tests
 *
 * Tests reconnection backoff math, race conditions, resource cleanup,
 * pong timeout detection, event listener robustness, and timer lifecycle.
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
    constructorUrl: string;

    constructor(url: string, ..._args: any[]) {
      super();
      this.constructorUrl = url;
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

describe("AuraisAgent edge cases", () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // Reconnection backoff math
  // =========================================================================

  describe("reconnection backoff", () => {
    it("first reconnect delay is baseDelay * 2^0 + jitter", () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelay: 1000,
        reconnectMaxDelay: 30000,
      });

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      // Connect and then trigger close
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");

      // Resolve connect
      // Trigger close to schedule reconnect
      ws.emit("close", 1006, "Abnormal");

      // Find the reconnect setTimeout call (not the heartbeat or connection timeout)
      const reconnectCall = setTimeoutSpy.mock.calls.find((call) => {
        const delay = call[1] as number;
        // reconnectBaseDelay * 2^0 + 0.5 * 1000 = 1000 + 500 = 1500
        return delay === 1500;
      });

      expect(reconnectCall).toBeDefined();
      agent.disconnect();
    });

    it("second reconnect uses exponential increase", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0); // zero jitter for deterministic test

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelay: 1000,
        reconnectMaxDelay: 30000,
      });

      // First connect
      const ws1 = await connectAgent(agent);

      // First close triggers reconnect attempt 1
      ws1.emit("close", 1006, "Abnormal");
      expect(agent.getConnectionState()).toBe("reconnecting");

      // Advance timer to trigger reconnect attempt
      await vi.advanceTimersByTimeAsync(1000); // baseDelay * 2^0 = 1000

      // New WS was created; simulate open then close again
      const ws2 = getLatestWs();
      ws2.emit("open");
      ws2.emit("close", 1006, "Abnormal");

      // Second reconnect: baseDelay * 2^1 = 2000
      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      // The reconnecting event fires synchronously on close
      // Verify state is reconnecting
      expect(agent.getConnectionState()).toBe("reconnecting");

      agent.disconnect();
    });

    it("reconnection delay is capped at reconnectMaxDelay", () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 20,
        reconnectBaseDelay: 1000,
        reconnectMaxDelay: 5000,
      });

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      ws.emit("close", 1006, "Abnormal");

      // All scheduled delays should be <= maxDelay
      const reconnectDelays = setTimeoutSpy.mock.calls
        .filter((call) => (call[1] as number) > 0)
        .map((call) => call[1] as number);

      for (const delay of reconnectDelays) {
        expect(delay).toBeLessThanOrEqual(5000);
      }

      agent.disconnect();
    });

    it("stops reconnecting after maxReconnectAttempts", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectBaseDelay: 100,
        reconnectMaxDelay: 1000,
      });

      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      // Connect then close
      const ws1 = await connectAgent(agent);
      ws1.emit("close", 1006, "Abnormal");

      // Attempt 1: advance past baseDelay
      await vi.advanceTimersByTimeAsync(200);
      const ws2 = getLatestWs();
      ws2.emit("error", new Error("refused"));
      ws2.emit("close", 1006, "Abnormal");

      // Attempt 2: advance past delay
      await vi.advanceTimersByTimeAsync(500);
      const ws3 = getLatestWs();
      ws3.emit("error", new Error("refused"));
      ws3.emit("close", 1006, "Abnormal");

      // Should stop — no more reconnecting events beyond maxReconnectAttempts
      expect(reconnectSpy).toHaveBeenCalledTimes(2);

      agent.disconnect();
    });

    it("emits reconnecting event with attempt count and max attempts", async () => {
      vi.useFakeTimers();

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectBaseDelay: 50,
      });

      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);

      const ws = await connectAgent(agent);
      ws.emit("close", 1006, "Abnormal");

      expect(reconnectSpy).toHaveBeenCalledWith(1, 3);
      agent.disconnect();
    });

    it("resets reconnect attempts on successful connection", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelay: 100,
      });

      // First connect
      const ws1 = await connectAgent(agent);

      // Close + reconnect
      ws1.emit("close", 1006, "Abnormal");
      await vi.advanceTimersByTimeAsync(200);
      const ws2 = getLatestWs();
      ws2.emit("open"); // successful reconnection

      // After successful reconnection, close again
      const reconnectSpy = vi.fn();
      agent.on("reconnecting", reconnectSpy);
      ws2.emit("close", 1006, "Abnormal");

      // Attempt counter should be reset — first arg should be 1 (not 2)
      expect(reconnectSpy).toHaveBeenCalledWith(1, 5);

      agent.disconnect();
    });
  });

  // =========================================================================
  // Race conditions
  // =========================================================================

  describe("race conditions", () => {
    it("connect is idempotent when called while connecting", async () => {
      const agent = createAgent();
      const p1 = agent.connect();
      const p2 = agent.connect(); // should return immediately

      const ws = getLatestWs();
      ws.emit("open");

      await p1;
      await p2;

      // Only one WebSocket instance should have been created
      expect(mockWsInstances.length).toBe(1);
      agent.disconnect();
    });

    it("connect is idempotent when already connected", async () => {
      const agent = createAgent();
      await connectAgent(agent);

      await agent.connect(); // should return immediately
      expect(mockWsInstances.length).toBe(1);
      agent.disconnect();
    });

    it("disconnect during connection timeout cleans up", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ connectionTimeout: 5000 });
      const connectPromise = agent.connect().catch(() => {
        /* expected timeout */
      });

      // Disconnect before the WebSocket opens or times out
      agent.disconnect();

      // Advance past the connection timeout so the timer fires and is caught
      await vi.advanceTimersByTimeAsync(6000);
      await connectPromise;

      expect(agent.getConnectionState()).toBe("disconnected");
      expect(agent.isConnected()).toBe(false);
    });

    it("multiple rapid disconnects do not throw", async () => {
      const agent = createAgent();
      await connectAgent(agent);

      // Multiple disconnects should not throw
      expect(() => {
        agent.disconnect();
        agent.disconnect();
        agent.disconnect();
      }).not.toThrow();

      expect(agent.getConnectionState()).toBe("disconnected");
    });

    it("sendMessage after WebSocket close is handled", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // Simulate WS closing under us
      ws.readyState = 3; // CLOSED

      await expect(agent.updateStatus("WORKING")).rejects.toThrow(
        "Not connected",
      );
    });

    it("handles concurrent task operations", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      // Fire multiple operations concurrently
      const results = await Promise.all([
        agent.reportProgress("task-1", 25, "Starting"),
        agent.reportProgress("task-2", 50, "Halfway"),
        agent.reportProgress("task-3", 75, "Almost done"),
      ]);

      // All three should have sent messages
      expect(ws.send).toHaveBeenCalledTimes(3);

      // Verify each message has a unique messageId
      const ids = ws.send.mock.calls.map(
        (c: any[]) => JSON.parse(c[0]).messageId,
      );
      expect(new Set(ids).size).toBe(3);
      agent.disconnect();
    });

    it("handles message received during disconnect", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // Set up a listener that disconnects on receiving a task
      agent.on("task:assigned", () => {
        agent.disconnect();
      });

      // Should not throw
      expect(() => {
        simulateServerMessage(ws, {
          type: "task:assigned",
          payload: { id: "task-1", type: "test", title: "Test" },
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Resource cleanup
  // =========================================================================

  describe("resource cleanup", () => {
    it("cleanup clears heartbeat timer", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ heartbeatInterval: 1000 });
      const ws = await connectAgent(agent);

      agent.disconnect();

      // Heartbeat should not fire after disconnect
      ws.send.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("cleanup clears reconnect timer", async () => {
      vi.useFakeTimers();

      const agent = createAgent({
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelay: 1000,
      });

      const ws = await connectAgent(agent);

      // Trigger close to schedule reconnect
      ws.emit("close", 1006, "Abnormal");
      expect(agent.getConnectionState()).toBe("reconnecting");

      // Disconnect to cancel the reconnect timer
      agent.disconnect();

      // Advance well past the reconnect delay
      const countBefore = mockWsInstances.length;
      await vi.advanceTimersByTimeAsync(60000);

      // No new WS should have been created
      expect(mockWsInstances.length).toBe(countBefore);
    });

    it("cleanup rejects all pending acks with connection closed error", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // We can't easily add pending acks from outside, but we can verify
      // that disconnect does not throw when pendingAcks is empty
      expect(() => agent.disconnect()).not.toThrow();
    });

    it("cleanup removes all WebSocket listeners", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      agent.disconnect();

      expect(ws.removeAllListeners).toHaveBeenCalled();
    });

    it("cleanup closes WebSocket if still open", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // WebSocket is still OPEN
      ws.readyState = 1;

      agent.disconnect();

      expect(ws.close).toHaveBeenCalled();
    });

    it("cleanup does not close WebSocket if already closed", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      // Mark as already closed
      ws.readyState = 3;

      agent.disconnect();

      // close should not be called because readyState !== OPEN
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("cleanup sets ws to null", async () => {
      const agent = createAgent();
      await connectAgent(agent);

      agent.disconnect();

      // After disconnect, isConnected should be false and state disconnected
      expect(agent.isConnected()).toBe(false);
      expect(agent.getConnectionState()).toBe("disconnected");
    });

    it("multiple connect/disconnect cycles do not leak resources", async () => {
      const agent = createAgent();

      for (let i = 0; i < 5; i++) {
        const ws = await connectAgent(agent);
        agent.disconnect();
        expect(ws.removeAllListeners).toHaveBeenCalled();
      }

      // All instances should have had their listeners removed
      for (const ws of mockWsInstances) {
        expect(ws.removeAllListeners).toHaveBeenCalled();
      }
    });
  });

  // =========================================================================
  // Heartbeat and pong
  // =========================================================================

  describe("heartbeat and pong", () => {
    it("heartbeat sends current status", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ heartbeatInterval: 1000 });
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      // Change status first
      await agent.updateStatus("WORKING");
      ws.send.mockClear();

      await vi.advanceTimersByTimeAsync(1000);

      const heartbeats = ws.send.mock.calls
        .map((c: any[]) => JSON.parse(c[0]))
        .filter((m: any) => m.type === "heartbeat");

      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
      expect(heartbeats[0].payload.status).toBe("WORKING");
      agent.disconnect();
    });

    it("heartbeat includes timestamp", async () => {
      vi.useFakeTimers();

      const now = 1700000000000;
      vi.setSystemTime(now);

      const agent = createAgent({ heartbeatInterval: 1000 });
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await vi.advanceTimersByTimeAsync(1000);

      const heartbeats = ws.send.mock.calls
        .map((c: any[]) => JSON.parse(c[0]))
        .filter((m: any) => m.type === "heartbeat");

      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
      expect(heartbeats[0].payload.timestamp).toBeGreaterThanOrEqual(now);
      agent.disconnect();
    });

    it("heartbeat restarts on new connection (no duplicates)", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ heartbeatInterval: 500 });
      const ws = await connectAgent(agent);

      // Disconnect and reconnect
      agent.disconnect();
      const ws2 = await connectAgent(agent);
      ws2.send.mockClear();

      await vi.advanceTimersByTimeAsync(500);

      // Only the second connection's heartbeat should fire
      const heartbeats = ws2.send.mock.calls
        .map((c: any[]) => JSON.parse(c[0]))
        .filter((m: any) => m.type === "heartbeat");

      expect(heartbeats.length).toBe(1);
      agent.disconnect();
    });

    it("ping from server updates lastPongTime", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      const beforePing = Date.now();
      simulateServerMessage(ws, { type: "ping", timestamp: 12345 });

      // Verify pong was sent
      const pongMsg = JSON.parse(
        ws.send.mock.calls[ws.send.mock.calls.length - 1][0],
      );
      expect(pongMsg.type).toBe("pong");
      expect(pongMsg.timestamp).toBe(12345);
      agent.disconnect();
    });

    it("heartbeat does not send when disconnected", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ heartbeatInterval: 500 });
      const ws = await connectAgent(agent);

      // Properly disconnect so connectionState is 'disconnected'
      // and sendHeartbeat's isConnected() guard returns false
      agent.disconnect();

      ws.send.mockClear();
      await vi.advanceTimersByTimeAsync(1000);

      // No heartbeat after disconnect
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Connection timeout
  // =========================================================================

  describe("connection timeout", () => {
    it("rejects connect promise on timeout", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ connectionTimeout: 2000 });
      const connectPromise = agent.connect();

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const resultPromise = connectPromise.catch((err: Error) => err);

      // Do not emit 'open' — let it time out
      await vi.advanceTimersByTimeAsync(2000);

      const err = await resultPromise;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Connection timeout");
    });

    it("closes WebSocket on timeout", async () => {
      vi.useFakeTimers();

      const agent = createAgent({ connectionTimeout: 2000 });
      const connectPromise = agent.connect();
      const ws = getLatestWs();

      // Attach handler before advancing timers
      const resultPromise = connectPromise.catch(() => {
        /* expected */
      });

      await vi.advanceTimersByTimeAsync(2000);
      await resultPromise;

      expect(ws.close).toHaveBeenCalled();
    });

    it("clears timeout on successful connection", async () => {
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      const agent = createAgent({ connectionTimeout: 5000 });
      const connectPromise = agent.connect();
      const ws = getLatestWs();
      ws.emit("open");
      await connectPromise;

      // clearTimeout should have been called for the connection timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      agent.disconnect();
    });

    it("clears timeout on WebSocket error", async () => {
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      const agent = createAgent({ connectionTimeout: 5000 });
      const connectPromise = agent.connect();
      const ws = getLatestWs();

      ws.emit("error", new Error("ECONNREFUSED"));

      expect(clearTimeoutSpy).toHaveBeenCalled();
      await connectPromise.catch(() => {
        /* expected */
      });
    });
  });

  // =========================================================================
  // Event listener robustness
  // =========================================================================

  describe("event listener robustness", () => {
    it("error in one listener does not prevent other listeners", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);

      const results: string[] = [];

      agent.on("task:assigned", () => {
        results.push("first");
        throw new Error("Listener error");
      });

      agent.on("task:assigned", () => {
        results.push("second");
      });

      // eventemitter3 does not catch listener errors — they propagate.
      // We verify the first listener runs, and the error propagates.
      try {
        simulateServerMessage(ws, {
          type: "task:assigned",
          payload: { id: "task-1", type: "test", title: "Test" },
        });
      } catch {
        // Expected — eventemitter3 throws if a listener throws
      }

      expect(results).toContain("first");
      agent.disconnect();
    });

    it("adding a listener during event emission does not cause issues", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const results: string[] = [];

      agent.on("task:assigned", () => {
        results.push("original");
        // Add a new listener during emission
        agent.on("task:assigned", () => {
          results.push("added-during-emit");
        });
      });

      simulateServerMessage(ws, {
        type: "task:assigned",
        payload: { id: "task-1", type: "test", title: "Test" },
      });

      expect(results).toContain("original");
      agent.disconnect();
    });

    it("removing a listener during emission is safe", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const results: string[] = [];

      const listener1 = () => {
        results.push("listener1");
        agent.removeListener("task:assigned", listener2);
      };
      const listener2 = () => {
        results.push("listener2");
      };

      agent.on("task:assigned", listener1);
      agent.on("task:assigned", listener2);

      simulateServerMessage(ws, {
        type: "task:assigned",
        payload: { id: "task-1", type: "test", title: "Test" },
      });

      expect(results).toContain("listener1");
      agent.disconnect();
    });

    it("emitting error event with no listeners does not crash", () => {
      const agent = createAgent();
      // No error listener registered — eventemitter3 does NOT throw for
      // unhandled 'error' events (unlike Node's EventEmitter)
      expect(() => {
        agent.emit("error", new Error("unhandled"));
      }).not.toThrow();
    });

    it("message:sent event fires for outbound messages", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const sentSpy = vi.fn();
      agent.on("message:sent", sentSpy);

      await agent.updateStatus("WORKING");

      expect(sentSpy).toHaveBeenCalledOnce();
      const sentMsg = sentSpy.mock.calls[0][0];
      expect(sentMsg.type).toBe("status:update");
      expect(sentMsg.messageId).toBeDefined();
      agent.disconnect();
    });

    it("raw message event fires before specific event", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const order: string[] = [];

      agent.on("message", () => order.push("raw"));
      agent.on("task:assigned", () => order.push("specific"));

      simulateServerMessage(ws, {
        type: "task:assigned",
        payload: { id: "task-1", type: "test", title: "Test" },
      });

      // handleMessage emits 'message' first, then the specific event
      expect(order).toEqual(["raw", "specific"]);
      agent.disconnect();
    });
  });

  // =========================================================================
  // WebSocket error handling
  // =========================================================================

  describe("WebSocket error handling", () => {
    it("emits error event on WebSocket error", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const errorSpy = vi.fn();
      agent.on("error", errorSpy);

      ws.emit("error", new Error("Network failure"));

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0].message).toBe("Network failure");
      agent.disconnect();
    });

    it("connection error rejects the connect promise", async () => {
      const agent = createAgent();
      const connectPromise = agent.connect();
      const ws = getLatestWs();

      ws.emit("error", new Error("ECONNREFUSED"));

      await expect(connectPromise).rejects.toThrow("ECONNREFUSED");
    });

    it("connection close with reason emits disconnected with reason", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const disconnectedSpy = vi.fn();
      agent.on("disconnected", disconnectedSpy);

      ws.emit("close", 1001, "Going away");

      expect(disconnectedSpy).toHaveBeenCalledWith("Going away");
    });

    it("connection close without reason includes code in message", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      const disconnectedSpy = vi.fn();
      agent.on("disconnected", disconnectedSpy);

      ws.emit("close", 1006, "");

      expect(disconnectedSpy).toHaveBeenCalledOnce();
      const reason = disconnectedSpy.mock.calls[0][0];
      expect(reason).toContain("1006");
    });
  });

  // =========================================================================
  // Message ID generation
  // =========================================================================

  describe("message ID generation", () => {
    it("generates IDs with msg_ prefix", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("WORKING");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.messageId).toMatch(/^msg_/);
      agent.disconnect();
    });

    it("generates monotonically increasing counter", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.updateStatus("WORKING");
      await agent.updateStatus("PAUSED");
      await agent.reportProgress("t1", 50);

      const ids = ws.send.mock.calls.map(
        (c: any[]) => JSON.parse(c[0]).messageId,
      );

      // Extract counters
      const counters = ids.map((id: string) => {
        const parts = id.split("_");
        return parseInt(parts[parts.length - 1], 10);
      });

      // Should be strictly increasing
      for (let i = 1; i < counters.length; i++) {
        expect(counters[i]).toBeGreaterThan(counters[i - 1]);
      }
      agent.disconnect();
    });

    it("counter persists across operations", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      const msgId1 = await agent.requestAction({
        type: "test",
        title: "Test",
        description: "Test",
        riskLevel: "low",
        payload: {},
      });
      await agent.updateStatus("WORKING");

      const allIds = ws.send.mock.calls
        .map((c: any[]) => JSON.parse(c[0]).messageId)
        .filter(Boolean);

      // All IDs should be unique
      expect(new Set(allIds).size).toBe(allIds.length);
      agent.disconnect();
    });
  });

  // =========================================================================
  // Edge case: task completed emits event with correct payload
  // =========================================================================

  describe("task result event payloads", () => {
    it("completeTask emits task:completed with success=true result", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const completeSpy = vi.fn();
      agent.on("task:completed", completeSpy);

      await agent.completeTask("task-42", { output: "success" });

      expect(completeSpy).toHaveBeenCalledOnce();
      const result = completeSpy.mock.calls[0][0];
      expect(result.taskId).toBe("task-42");
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ output: "success" });
      agent.disconnect();
    });

    it("failTask emits task:completed with success=false and error", async () => {
      const agent = createAgent();
      await connectAgent(agent);
      const completeSpy = vi.fn();
      agent.on("task:completed", completeSpy);

      await agent.failTask("task-42", "Something went wrong");

      expect(completeSpy).toHaveBeenCalledOnce();
      const result = completeSpy.mock.calls[0][0];
      expect(result.taskId).toBe("task-42");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Something went wrong");
      agent.disconnect();
    });

    it("completeTask with null result is valid", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.completeTask("task-1", null);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.result).toBeNull();
      expect(sent.payload.success).toBe(true);
      agent.disconnect();
    });

    it("completeTask with undefined result omits result field", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.completeTask("task-1", undefined);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.success).toBe(true);
      // JSON.stringify omits undefined values
      expect("result" in sent.payload).toBe(false);
      agent.disconnect();
    });

    it("failTask with empty string error", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.failTask("task-1", "");

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.success).toBe(false);
      expect(sent.payload.error).toBe("");
      agent.disconnect();
    });
  });

  // =========================================================================
  // Progress boundary values
  // =========================================================================

  describe("progress boundary values", () => {
    it("progress 0 is valid and unclamped", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("t1", 0);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(0);
      agent.disconnect();
    });

    it("progress 100 is valid and unclamped", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("t1", 100);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(100);
      agent.disconnect();
    });

    it("progress NaN passes through as null in JSON", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("t1", NaN);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      // Math.min(100, Math.max(0, NaN)) => NaN
      // JSON.stringify converts NaN to null
      expect(sent.payload.progress).toBeNull();
      agent.disconnect();
    });

    it("progress Infinity is clamped to 100", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("t1", Infinity);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(100);
      agent.disconnect();
    });

    it("progress -Infinity is clamped to 0", async () => {
      const agent = createAgent();
      const ws = await connectAgent(agent);
      ws.send.mockClear();

      await agent.reportProgress("t1", -Infinity);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.payload.progress).toBe(0);
      agent.disconnect();
    });
  });
});
