# @vorionsys/agent-sdk

TypeScript SDK for connecting AI agents to Aurais Mission Control via WebSocket.

## Installation

```bash
npm install @vorionsys/agent-sdk
```

## Features

- **WebSocket connectivity** -- Persistent connection to Aurais Mission Control.
- **Auto-reconnection** -- Exponential backoff with configurable max attempts and jitter.
- **Heartbeat management** -- Automatic keepalive with ping/pong.
- **Type-safe messages** -- Strongly typed inbound/outbound message handling.
- **Event emitter** -- Subscribe to tasks, decisions, config changes, and connection events.
- **Task lifecycle** -- Report progress, complete, or fail assigned tasks.
- **Action requests** -- Submit actions that require human or governance approval.

## Quick Start

```typescript
import { AuraisAgent } from '@vorionsys/agent-sdk';

const agent = new AuraisAgent({
  apiKey: process.env.AURAIS_API_KEY!,
  capabilities: ['execute', 'external'],
  skills: ['web-dev', 'data-analysis'],
});

await agent.connect();
console.log('Connected, agent ID:', agent.getAgentId());
```

## Task Handling

Tasks are the primary unit of work. Aurais assigns tasks to your agent based on capabilities and skills.

```typescript
agent.on('task:assigned', async (task) => {
  console.log(`Received task: ${task.title} (priority: ${task.priority})`);

  // Update status to show you're working
  await agent.updateStatus('WORKING');

  try {
    // Report progress as you go (0-100)
    await agent.reportProgress(task.id, 25, 'Analyzing requirements');
    // ... do work ...
    await agent.reportProgress(task.id, 75, 'Generating output');
    // ... finish work ...

    // Complete the task with results
    await agent.completeTask(task.id, {
      output: 'Task completed successfully',
      artifacts: ['report.pdf'],
    });
  } catch (error) {
    // Report failure with error message
    await agent.failTask(task.id, error.message);
  }

  // Return to idle
  await agent.updateStatus('IDLE');
});
```

## Action Requests (Governance Approval)

When your agent needs to perform a governed action (e.g., external API call, data write), submit an action request. Aurais routes it through governance approval.

```typescript
// Submit an action that requires approval
const requestId = await agent.requestAction({
  title: 'Write customer data to CRM',
  description: 'Update 150 customer records with new contact info',
  riskLevel: 'medium',
  urgency: 'normal',
  metadata: {
    recordCount: 150,
    targetSystem: 'salesforce',
  },
});

// Listen for the governance decision
agent.on('decision:result', (decision) => {
  if (decision.decision === 'approved') {
    console.log(`Action approved by ${decision.decidedBy}`);
    // Proceed with the action
  } else {
    console.log(`Action denied: ${decision.reason}`);
  }
});

// You can also listen for when decisions are needed
agent.on('decision:required', (request) => {
  console.log(`Decision needed: ${request.title} (risk: ${request.riskLevel})`);
});
```

## Connection Lifecycle

```typescript
const agent = new AuraisAgent({
  apiKey: process.env.AURAIS_API_KEY!,
  autoReconnect: true,
  maxReconnectAttempts: 10,
});

// Connection events
agent.on('connected', () => {
  console.log('Connected to Aurais Mission Control');
});

agent.on('disconnected', (reason) => {
  console.log(`Disconnected: ${reason}`);
});

agent.on('reconnecting', (attempt, maxAttempts) => {
  console.log(`Reconnecting... attempt ${attempt}/${maxAttempts}`);
});

agent.on('reconnected', () => {
  console.log('Reconnected successfully');
});

// Error handling
agent.on('error', (error) => {
  console.error('Agent error:', error.message);
});

// Connect
await agent.connect();

// Check state at any time
console.log('Connected:', agent.isConnected());
console.log('State:', agent.getConnectionState()); // 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
console.log('Status:', agent.getStatus()); // 'IDLE' | 'WORKING' | 'PAUSED' | 'ERROR' | 'OFFLINE'

// Graceful disconnect
agent.disconnect();
```

## Configuration

| Option                 | Default                    | Description                            |
| ---------------------- | -------------------------- | -------------------------------------- |
| `apiKey`               | (required)                 | API key for authentication             |
| `capabilities`         | `['execute']`              | Agent capabilities                     |
| `skills`               | `[]`                       | Agent skills list                      |
| `serverUrl`            | `wss://api.aurais.ai/ws`  | WebSocket server URL                   |
| `autoReconnect`        | `true`                     | Enable auto-reconnection               |
| `maxReconnectAttempts`  | `10`                      | Max reconnection attempts              |
| `reconnectBaseDelay`   | `1000`                     | Base delay for reconnect backoff (ms)  |
| `reconnectMaxDelay`    | `30000`                    | Max delay for reconnect backoff (ms)   |
| `heartbeatInterval`    | `30000`                    | Heartbeat interval (ms)                |
| `connectionTimeout`    | `10000`                    | Connection timeout (ms)                |
| `metadata`             | `{}`                       | Custom metadata sent on registration   |

## API Reference

### `AuraisAgent` Methods

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `connect()` | `() => Promise<void>` | Connect to Aurais Mission Control |
| `disconnect()` | `() => void` | Disconnect gracefully |
| `isConnected()` | `() => boolean` | Check if connected |
| `getConnectionState()` | `() => ConnectionState` | Get current connection state |
| `getAgentId()` | `() => string \| null` | Get agent ID (set after registration) |
| `getStructuredId()` | `() => string \| null` | Get structured agent ID |
| `getStatus()` | `() => AgentStatus` | Get current agent status |
| `updateStatus()` | `(status, progress?, message?) => Promise<void>` | Update agent status |
| `reportProgress()` | `(taskId, progress, message?) => Promise<void>` | Report task progress (0-100) |
| `completeTask()` | `(taskId, result, metrics?) => Promise<void>` | Mark task as completed |
| `failTask()` | `(taskId, error) => Promise<void>` | Mark task as failed |
| `requestAction()` | `(request) => Promise<string>` | Submit action for governance approval |

### Agent Capabilities

| Capability  | Description                     |
| ----------- | ------------------------------- |
| `execute`   | Can execute tasks locally       |
| `external`  | Can make external API calls     |
| `delegate`  | Can delegate to other agents    |
| `spawn`     | Can spawn sub-agents            |
| `admin`     | Administrative privileges       |

### Agent Statuses

| Status    | When to use                              |
| --------- | ---------------------------------------- |
| `IDLE`    | Ready for work, no active tasks          |
| `WORKING` | Actively processing a task               |
| `PAUSED`  | Temporarily paused (e.g., awaiting input)|
| `ERROR`   | In error state, needs attention          |
| `OFFLINE` | Not available for tasks                  |

### Events

| Event | Payload | Fired when |
| ----- | ------- | ---------- |
| `connected` | -- | WebSocket connection established |
| `disconnected` | `reason: string` | Connection lost |
| `reconnecting` | `attempt: number, max: number` | Reconnection attempt starting |
| `reconnected` | -- | Successfully reconnected |
| `task:assigned` | `Task` | New task assigned by Aurais |
| `task:completed` | `TaskResult` | Task marked complete or failed |
| `decision:required` | `ActionRequest` | Governance decision needed |
| `decision:result` | `ActionDecision` | Governance decision received |
| `config:updated` | `AgentConfig` | Agent configuration changed remotely |
| `status:changed` | `oldStatus, newStatus` | Agent status changed |
| `message` | `InboundMessage` | Any inbound message (raw) |
| `message:sent` | `OutboundMessage` | Any outbound message (raw) |
| `error` | `Error` | Connection or protocol error |

## Error Handling

```typescript
// Connection errors
try {
  await agent.connect();
} catch (error) {
  console.error('Failed to connect:', error.message);
  // Common: 'Connection timeout', network errors
}

// Runtime errors via event
agent.on('error', (error) => {
  if (error.message.includes('Server error')) {
    // Protocol-level error from Aurais
  } else if (error.message.includes('Not connected')) {
    // Tried to send while disconnected
  } else if (error.message.includes('Failed to parse')) {
    // Malformed message received
  }
});
```

## Integration with @vorionsys/sdk

Use `@vorionsys/agent-sdk` for real-time WebSocket communication with Aurais, and `@vorionsys/sdk` for REST-based governance operations:

```typescript
import { AuraisAgent } from '@vorionsys/agent-sdk';
import { createVorion } from '@vorionsys/sdk';

// Real-time connection for task assignment
const agent = new AuraisAgent({ apiKey: process.env.AURAIS_API_KEY! });
await agent.connect();

// REST client for governance operations
const vorion = createVorion({ mode: 'remote', apiUrl: 'https://api.cognigate.dev' });
const myAgent = vorion.agent('my-agent', { capabilities: ['read', 'write'] });

agent.on('task:assigned', async (task) => {
  // Use governance SDK to check if action is allowed
  const result = await myAgent.requestAction({
    type: task.actionType,
    resource: task.resource,
  });

  if (result.allowed) {
    // Execute and report back via WebSocket
    await agent.completeTask(task.id, { output: 'done' });
  } else {
    await agent.failTask(task.id, `Governance denied: ${result.reason}`);
  }
});
```

## Requirements

- Node.js >= 18
- WebSocket support (included via `ws` package)

## License

Apache-2.0
