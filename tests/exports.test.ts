// SPDX-License-Identifier: LicenseRef-Vorion-Proprietary
// Copyright 2024-2026 Vorion LLC

import { describe, it, expect } from "vitest";
import { AuraisAgent } from "../src/index.js";

describe("agent-sdk exports", () => {
  it("exports AuraisAgent class", () => {
    expect(AuraisAgent).toBeDefined();
    expect(typeof AuraisAgent).toBe("function");
  });
});

describe("AuraisAgent", () => {
  describe("constructor", () => {
    it("throws when apiKey is missing", () => {
      expect(() => new AuraisAgent({ apiKey: "" })).toThrow(
        "API key is required",
      );
    });

    it("constructs with valid apiKey", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent).toBeInstanceOf(AuraisAgent);
    });

    it("defaults to disconnected state", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent.getConnectionState()).toBe("disconnected");
    });

    it("defaults to IDLE status", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent.getStatus()).toBe("IDLE");
    });

    it("isConnected returns false initially", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent.isConnected()).toBe(false);
    });

    it("getAgentId returns null before connection", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent.getAgentId()).toBeNull();
    });

    it("getStructuredId returns null before connection", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      expect(agent.getStructuredId()).toBeNull();
    });
  });

  describe("disconnect", () => {
    it("emits disconnected event", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      let emitted = false;
      agent.on("disconnected", () => {
        emitted = true;
      });
      agent.disconnect();
      expect(emitted).toBe(true);
    });

    it("sets connection state to disconnected", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      agent.disconnect();
      expect(agent.getConnectionState()).toBe("disconnected");
    });
  });

  describe("event emitter", () => {
    it("supports on/emit for status:changed", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      let oldStatus: string | undefined;
      let newStatus: string | undefined;

      agent.on("status:changed", (old, next) => {
        oldStatus = old;
        newStatus = next;
      });

      // Trigger status change through internal mechanism
      // We can't call updateStatus (requires connection), but we can verify
      // event emitter works
      agent.emit("status:changed", "IDLE", "WORKING");
      expect(oldStatus).toBe("IDLE");
      expect(newStatus).toBe("WORKING");
    });

    it("supports on/emit for error", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      let caughtError: Error | undefined;

      agent.on("error", (err) => {
        caughtError = err;
      });
      agent.emit("error", new Error("test error"));

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe("test error");
    });

    it("supports removeAllListeners", () => {
      const agent = new AuraisAgent({ apiKey: "test-key" });
      let count = 0;

      agent.on("connected", () => {
        count++;
      });
      agent.removeAllListeners("connected");
      agent.emit("connected");

      expect(count).toBe(0);
    });
  });

  describe("config defaults", () => {
    it("accepts custom config options", () => {
      const agent = new AuraisAgent({
        apiKey: "test-key",
        capabilities: ["execute", "admin"],
        skills: ["web-dev"],
        serverUrl: "wss://custom-server.example.com/ws",
        autoReconnect: false,
        maxReconnectAttempts: 5,
        heartbeatInterval: 15000,
        connectionTimeout: 5000,
        metadata: { env: "test" },
      });
      expect(agent).toBeInstanceOf(AuraisAgent);
    });
  });
});
