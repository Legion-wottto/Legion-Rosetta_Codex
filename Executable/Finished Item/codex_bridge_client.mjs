#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// WebSocket is a stable global from Node v22. On older versions, provide a
// minimal RFC-6455 client built on node:net so the file stays dependency-free.
const WebSocket = globalThis.WebSocket ?? await (async () => {
  const { createConnection } = await import("node:net");
  const { randomBytes } = await import("node:crypto");

  return class NodeWebSocket extends EventTarget {
    #socket = null;
    #buf = Buffer.alloc(0);
    #ready = false;

    constructor(url) {
      super();
      const u = new URL(url);
      const port = u.port ? Number(u.port) : (u.protocol === "wss:" ? 443 : 80);
      const host = u.hostname;
      const resource = (u.pathname || "/") + (u.search || "");
      const key = randomBytes(16).toString("base64");
      const socket = createConnection(port, host);
      this.#socket = socket;
      socket.once("connect", () => {
        socket.write(
          `GET ${resource} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      socket.on("data", (chunk) => {
        this.#buf = Buffer.concat([this.#buf, chunk]);
        if (!this.#ready) {
          const end = this.#buf.indexOf("\r\n\r\n");
          if (end === -1) return;
          const status = this.#buf.subarray(0, this.#buf.indexOf("\r\n")).toString();
          if (!status.includes("101")) {
            this.dispatchEvent(Object.assign(new Event("error"), { error: new Error(status) }));
            socket.destroy();
            return;
          }
          this.#ready = true;
          this.#buf = this.#buf.subarray(end + 4);
          this.dispatchEvent(new Event("open"));
        }
        this.#drain();
      });
      socket.on("close", () => this.dispatchEvent(new Event("close")));
      socket.on("error", (err) => this.dispatchEvent(Object.assign(new Event("error"), { error: err })));
    }

    #drain() {
      while (this.#buf.length >= 2) {
        let len = this.#buf[1] & 0x7f;
        let cur = 2;
        if (len === 126) {
          if (this.#buf.length < 4) return;
          len = this.#buf.readUInt16BE(2); cur = 4;
        } else if (len === 127) {
          if (this.#buf.length < 10) return;
          len = Number(this.#buf.readBigUInt64BE(2)); cur = 10;
        }
        if (this.#buf.length < cur + len) return;
        const op = this.#buf[0] & 0x0f;
        const payload = this.#buf.subarray(cur, cur + len);
        this.#buf = this.#buf.subarray(cur + len);
        if (op === 1 || op === 2) {
          this.dispatchEvent(Object.assign(new Event("message"), { data: payload.toString("utf8") }));
        } else if (op === 8) {
          this.#socket.end();
        } else if (op === 9) {
          this.#socket.write(this.#mkframe(0xA, Buffer.alloc(0)));
        }
      }
    }

    #mkframe(op, data) {
      const mask = randomBytes(4);
      const body = Buffer.from(data);
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      let hdr;
      if (body.length < 126) {
        hdr = Buffer.from([0x80 | op, 0x80 | body.length]);
      } else if (body.length <= 0xffff) {
        hdr = Buffer.alloc(4);
        hdr[0] = 0x80 | op; hdr[1] = 0x80 | 126;
        hdr.writeUInt16BE(body.length, 2);
      } else {
        hdr = Buffer.alloc(10);
        hdr[0] = 0x80 | op; hdr[1] = 0x80 | 127;
        hdr.writeBigUInt64BE(BigInt(body.length), 2);
      }
      return Buffer.concat([hdr, mask, body]);
    }

    send(data) { this.#socket.write(this.#mkframe(1, Buffer.from(data, "utf8"))); }
    close() { this.#socket.write(this.#mkframe(8, Buffer.alloc(0))); this.#socket.end(); }
  };
})();

const BASE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(BASE, "state");
const CLIENT_STATE_PATH = path.join(STATE_DIR, "client-state.json");

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readClientState() {
  try {
    return JSON.parse(fs.readFileSync(CLIENT_STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeClientState(nextState) {
  ensureStateDir();
  fs.writeFileSync(CLIENT_STATE_PATH, JSON.stringify(nextState, null, 2) + "\n", "utf8");
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return { positionals, options };
}

function usage() {
  console.error(`Usage:
  codex_bridge_client.mjs probe --url ws://127.0.0.1:8765
  codex_bridge_client.mjs remote-status --url ws://127.0.0.1:8765
  codex_bridge_client.mjs thread-start --url ws://127.0.0.1:8765 [--cwd /path] [--approval never]
  codex_bridge_client.mjs turn-start --url ws://127.0.0.1:8765 --text "hello" [--thread-id id]
  codex_bridge_client.mjs raw --url ws://127.0.0.1:8765 --method thread/list [--params-json '{}']
  codex_bridge_client.mjs events --url ws://127.0.0.1:8765 [--thread-id id]`);
}

class CodexBridgeClient {
  constructor(url, opts = {}) {
    this.url = url;
    this.debug = Boolean(opts.debug);
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(event.error || new Error("websocket connection failed"));
      };
      const cleanup = () => {
        this.ws.removeEventListener("open", onOpen);
        this.ws.removeEventListener("error", onError);
      };
      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("error", onError);
    });
    this.ws.addEventListener("message", (event) => this.#onMessage(event.data.toString()));
    this.ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("websocket closed"));
      }
      this.pending.clear();
    });
  }

  async close() {
    if (!this.ws) return;
    await new Promise((resolve) => {
      const ws = this.ws;
      ws.addEventListener("close", () => resolve(), { once: true });
      ws.close();
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "codex-bridge-client",
        title: "Codex Bridge Client",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
    return result;
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (this.debug) {
      console.error(">>", JSON.stringify(payload));
    }
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method, params = {}) {
    const payload = { method, params };
    if (this.debug) {
      console.error(">>", JSON.stringify(payload));
    }
    this.ws.send(JSON.stringify(payload));
  }

  waitForNotification(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        const idx = this.notifications.findIndex((item) => item.method === method);
        if (idx >= 0) {
          const [hit] = this.notifications.splice(idx, 1);
          resolve(hit.params);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`timed out waiting for notification: ${method}`));
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  async threadStart(params = {}) {
    const result = await this.request("thread/start", params);
    if (result?.thread?.id) {
      const state = readClientState();
      state.lastThreadId = result.thread.id;
      writeClientState(state);
    }
    return result;
  }

  async turnStart(threadId, text, params = {}) {
    const merged = {
      threadId,
      input: [{ type: "text", text }],
      ...params,
    };
    return this.request("turn/start", merged);
  }

  #onMessage(raw) {
    if (this.debug) {
      console.error("<<", raw);
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (error) {
      console.error(`invalid json from server: ${error}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(msg, "id")) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (Object.prototype.hasOwnProperty.call(msg, "error")) {
        pending.reject(new Error(JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (msg.method) {
      this.notifications.push({
        method: msg.method,
        params: msg.params ?? {},
      });
      if (msg.method === "thread/started" && msg.params?.thread?.id) {
        const state = readClientState();
        state.lastThreadId = msg.params.thread.id;
        writeClientState(state);
      }
      if (msg.method === "error") {
        console.error(JSON.stringify(msg.params, null, 2));
      }
    }
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function getRequired(options, key) {
  const value = options[key];
  if (!value || value === true) {
    throw new Error(`missing required option --${key}`);
  }
  return value;
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command) {
    usage();
    process.exit(1);
  }

  const url = options.url || process.env.CODEX_BRIDGE_URL || "ws://127.0.0.1:8765";
  const client = new CodexBridgeClient(url, { debug: options.debug });
  await client.connect();
  const initializeResult = await client.initialize();

  try {
    if (command === "probe") {
      printJson({
        initialize: initializeResult,
      });
      return;
    }

    if (command === "remote-status") {
      const result = await client.request("remoteControl/status/read", {});
      printJson(result);
      return;
    }

    if (command === "thread-start") {
      const cwd = options.cwd || process.cwd();
      const approvalPolicy = options.approval || "never";
      const result = await client.threadStart({
        cwd,
        approvalPolicy,
        sandbox: options.sandbox || "danger-full-access",
      });
      printJson(result);
      return;
    }

    if (command === "turn-start") {
      const text = getRequired(options, "text");
      const state = readClientState();
      const threadId = options["thread-id"] || state.lastThreadId;
      if (!threadId) {
        throw new Error("no thread id available; start a thread first or pass --thread-id");
      }
      const result = await client.turnStart(threadId, text);
      printJson(result);
      return;
    }

    if (command === "raw") {
      const method = getRequired(options, "method");
      const paramsJson = options["params-json"] && options["params-json"] !== true ? options["params-json"] : "{}";
      const params = JSON.parse(paramsJson);
      const result = await client.request(method, params);
      printJson(result);
      return;
    }

    if (command === "events") {
      const state = readClientState();
      if (options["thread-id"] || state.lastThreadId) {
        console.error(`watching events for thread ${options["thread-id"] || state.lastThreadId}`);
      }
      for (;;) {
        const hit = await client.waitForNotification("turn/completed", 3600_000).catch(() => null);
        if (hit) {
          printJson({ method: "turn/completed", params: hit });
          break;
        }
      }
      return;
    }

    throw new Error(`unsupported command: ${command}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
