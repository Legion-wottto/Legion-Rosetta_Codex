#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";

const HOST = process.env.CODEX_RC_EMULATOR_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_RC_EMULATOR_PORT || "8787");
const BASE_PATH = process.env.CODEX_RC_EMULATOR_BASE_PATH || "/backend-api";
const AUTO_THREAD_CWD = process.env.CODEX_RC_EMULATOR_THREAD_CWD || process.cwd();
const AUTO_TURN_TEXT =
  process.env.CODEX_RC_EMULATOR_TURN_TEXT ||
  "Say hello from the remote-control emulator in one short sentence.";

const enrollments = new Map();

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function logJson(label, value) {
  console.log(`${label} ${JSON.stringify(value, null, 2)}`);
}

function decodeMaybeBase64(value) {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function frame(opcode, payloadBuffer) {
  const payload = payloadBuffer ?? Buffer.alloc(0);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const masked = Boolean(second & 0x80);
    let mask;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (masked && mask) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function buildEnrollment(headers, bodyText) {
  const body = JSON.parse(bodyText || "{}");
  const serverName = body.name || "codex-host";
  const enrollment = {
    accountId: headers["chatgpt-account-id"] || "unknown-account",
    installationId: headers["x-codex-installation-id"] || randomId("inst"),
    serverName,
    serverId: randomId("srv_e"),
    environmentId: randomId("env_e"),
    body,
    updatedAt: Date.now(),
  };
  enrollments.set(enrollment.serverId, enrollment);
  return enrollment;
}

function createSession(socket, request) {
  const headers = request.headers;
  const serverId = headers["x-codex-server-id"];
  const enrollment = serverId ? enrollments.get(serverId) : null;
  const session = {
    socket,
    request,
    headers,
    enrollment,
    clientId: "emulator-client",
    streamId: randomId("stream"),
    buffer: Buffer.alloc(0),
    ackedSeqId: 0,
    outboundSeqId: 0,
    threadId: null,
    initializeSent: false,
    initializedSent: false,
    threadStartSent: false,
    turnStartSent: false,
  };
  const metadata = {
    path: request.url,
    host: headers.host,
    serverId,
    installationId: headers["x-codex-installation-id"] || null,
    protocolVersion: headers["x-codex-protocol-version"] || null,
    serverNameDecoded: decodeMaybeBase64(headers["x-codex-name"]) || null,
    subscribeCursor: headers["x-codex-subscribe-cursor"] || null,
    authHeaderPresent: Boolean(headers.authorization),
    accountIdPrefix: String(headers["chatgpt-account-id"] || "").slice(0, 8),
  };
  logJson("remote-control websocket connected", metadata);
  return session;
}

function sendText(socket, object) {
  socket.write(frame(0x1, Buffer.from(JSON.stringify(object), "utf8")));
}

function sendClientMessage(session, payload) {
  session.outboundSeqId += 1;
  const envelope = {
    type: "client_message",
    client_id: session.clientId,
    stream_id: session.streamId,
    ...payload,
  };
  sendText(session.socket, envelope);
  logJson("emulator -> codex", envelope);
}

function sendAck(session, seqId, segmentId = null) {
  const envelope = {
    type: "ack",
    client_id: session.clientId,
    stream_id: session.streamId,
    seq_id: seqId,
  };
  if (segmentId !== null) envelope.segment_id = segmentId;
  sendText(session.socket, envelope);
}

function bootstrap(session) {
  if (session.initializeSent) return;
  session.initializeSent = true;
  sendClientMessage(session, {
    message: {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-rc-emulator",
          title: "Codex RC Emulator",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    },
  });
}

function maybeContinueBootstrap(session, message) {
  if (message?.id === 1 && Object.prototype.hasOwnProperty.call(message, "result")) {
    if (!session.initializedSent) {
      session.initializedSent = true;
      sendClientMessage(session, {
        message: {
          method: "initialized",
          params: {},
        },
      });
    }
    if (!session.threadStartSent) {
      session.threadStartSent = true;
      sendClientMessage(session, {
        message: {
          id: 2,
          method: "thread/start",
          params: {
            cwd: AUTO_THREAD_CWD,
            approvalPolicy: "never",
            sandbox: "danger-full-access",
          },
        },
      });
    }
    return;
  }

  if (message?.id === 2 && message?.result?.thread?.id && !session.turnStartSent) {
    session.threadId = message.result.thread.id;
    session.turnStartSent = true;
    sendClientMessage(session, {
      message: {
        id: 3,
        method: "turn/start",
        params: {
          threadId: session.threadId,
          input: [
            {
              type: "text",
              text: AUTO_TURN_TEXT,
            },
          ],
        },
      },
    });
  }
}

function handleServerEnvelope(session, envelope) {
  logJson("codex -> emulator", envelope);
  if (typeof envelope.seq_id === "number") {
    session.ackedSeqId = envelope.seq_id;
    sendAck(session, envelope.seq_id, envelope.segment_id ?? null);
  }
  if (envelope.type === "server_message" && envelope.message) {
    maybeContinueBootstrap(session, envelope.message);
  }
}

function handleSocketData(session, chunk) {
  session.buffer = Buffer.concat([session.buffer, chunk]);
  const parsed = parseFrames(session.buffer);
  session.buffer = parsed.rest;
  for (const frameItem of parsed.frames) {
    if (frameItem.opcode === 0x1) {
      const text = frameItem.payload.toString("utf8");
      try {
        const payload = JSON.parse(text);
        handleServerEnvelope(session, payload);
      } catch (error) {
        console.error(`invalid emulator inbound json: ${error}`);
      }
    } else if (frameItem.opcode === 0x8) {
      session.socket.end(frame(0x8, frameItem.payload));
    } else if (frameItem.opcode === 0x9) {
      session.socket.write(frame(0xA, frameItem.payload));
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/readyz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (
    req.method === "POST" &&
    req.url === `${BASE_PATH}/wham/remote/control/server/enroll`
  ) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const enrollment = buildEnrollment(req.headers, bodyText);
      logJson("remote-control enroll", {
        path: req.url,
        accountIdPrefix: enrollment.accountId.slice(0, 8),
        installationId: enrollment.installationId,
        serverId: enrollment.serverId,
        environmentId: enrollment.environmentId,
        serverName: enrollment.serverName,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          server_id: enrollment.serverId,
          environment_id: enrollment.environmentId,
        }),
      );
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (request, socket) => {
  if (request.url !== `${BASE_PATH}/wham/remote/control/server`) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );

  const session = createSession(socket, request);
  socket.on("data", (chunk) => handleSocketData(session, chunk));
  socket.on("close", () => console.log("remote-control websocket closed"));
  socket.on("error", (error) => console.error(`remote-control websocket error: ${error.message}`));
  setTimeout(() => bootstrap(session), 300);
});

server.listen(PORT, HOST, () => {
  console.log(
    `codex remote-control emulator listening on http://${HOST}:${PORT}${BASE_PATH}`,
  );
  console.log(`readyz: http://${HOST}:${PORT}/readyz`);
});
