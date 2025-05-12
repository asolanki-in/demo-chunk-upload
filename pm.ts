import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';

// ---- Configuration ----
const PORT = 3000;
const LOG_BUFFER_SIZE = 1000;      // max lines in memory per device
const BATCH_INTERVAL_MS = 100;     // ms between batches
const MAX_WS_BUFFERED = 5e6;       // 5 MB per socket

// ---- Types ----
interface DeviceState {
  process: ChildProcessWithoutNullStreams;
  buffer: string[];
  pending: string[];
  sockets: Set<WebSocket>;
  batchTimer: NodeJS.Timeout;
}

const devices = new Map<string, DeviceState>();

// ---- Start syslog streaming for given UDID ----
async function startIosStreaming(udid: string) {
  if (devices.has(udid)) return;
  // spawn idevicesyslog; requires libimobiledevice installed
  const proc = spawn('idevicesyslog', ['-u', udid]);
  const rl = readline.createInterface({ input: proc.stdout });

  const state: DeviceState = {
    process: proc,
    buffer: [],
    pending: [],
    sockets: new Set(),
    batchTimer: null as any
  };
  devices.set(udid, state);

  // On each log line
  rl.on('line', line => {
    state.buffer.push(line);
    if (state.buffer.length > LOG_BUFFER_SIZE) state.buffer.shift();
    state.pending.push(line);
  });

  // Handle process exit
  proc.on('error', err => {
    for (const ws of state.sockets) {
      ws.send(JSON.stringify({ event: 'log.error', data: err.message }));
    }
    teardown();
  });
  proc.on('close', (code, signal) => {
    for (const ws of state.sockets) {
      ws.send(JSON.stringify({ event: 'log.stop', data: { udid, code, signal } }));
    }
    teardown();
  });

  // Batch timer
  state.batchTimer = setInterval(() => {
    if (!state.pending.length) return;
    const batch = state.pending.splice(0);
    const msg = JSON.stringify({ event: 'log.batch', data: batch });
    for (const ws of state.sockets) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_WS_BUFFERED) {
        ws.send(msg, err => { if (err) console.error('WS send error:', err); });
      }
    }
  }, BATCH_INTERVAL_MS);

  function teardown() {
    clearInterval(state.batchTimer);
    rl.close();
    devices.delete(udid);
  }
}

// ---- HTTP & WebSocket setup ----
const app = express();
app.use(express.static(path.join(__dirname, '../public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Parse UDID from query: ws://host?udid=<udid>
  const url = new URL(req.url!, 'http://localhost');
  const udid = url.searchParams.get('udid');
  if (!udid) {
    ws.send(JSON.stringify({ event: 'error', data: 'Missing udid parameter' }));
    return ws.close();
  }

  // Start streaming if needed
  try {
    await startIosStreaming(udid);
  } catch (e: any) {
    ws.send(JSON.stringify({ event: 'log.error', data: e.message }));
    return ws.close();
  }

  const state = devices.get(udid)!;
  state.sockets.add(ws);

  // Send existing buffer as init batch
  if (state.buffer.length) {
    ws.send(JSON.stringify({ event: 'log.batch', data: state.buffer }));
  }

  ws.on('message', msg => {
    try {
      const m = JSON.parse(msg.toString());
      if (m.event === 'clear') {
        state.buffer = [];
        ws.send(JSON.stringify({ event: 'log.cleared', data: { udid } }));
      }
    } catch {}
  });

  ws.on('close', () => {
    state.sockets.delete(ws);
    if (!state.sockets.size) {
      // no clients → kill process & cleanup
      state.process.kill();
      clearInterval(state.batchTimer);
      devices.delete(udid);
    }
  });

  ws.on('error', err => console.error(`WS error for ${udid}:`, err));
});

server.listen(PORT, () => {
  console.log(`iOS Log Streamer running at http://localhost:${PORT}`);
});


<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>iOS Log Viewer</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="controls">
    UDID: <input id="deviceInput" placeholder="Enter iOS UDID">
    <button id="connectBtn">Connect</button>
    <button id="clearBtn">Clear</button>
  </div>
  <div id="logContainer">
    <table>
      <thead>
        <tr><th>#</th><th>Log Line</th></tr>
      </thead>
      <tbody id="logTableBody"></tbody>
    </table>
  </div>

  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="script.js"></script>
</body>
</html>

body {
  margin: 0;
  font: 14px/1.4 sans-serif;
}
#controls {
  padding: 8px;
  background: #eee;
}
#logContainer {
  height: 400px;
  overflow-y: scroll;
  background: #000;
  color: #fff;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 2px 4px;
  white-space: pre;
  font-family: monospace;
}
tr:nth-child(odd) td { opacity: 0.8; }



$(function() {
  let socket;
  let autoScroll = true;
  const $container = $('#logContainer');
  const $body = $('#logTableBody');
  let lineNo = 0;

  // Pause auto-scroll when user scrolls up
  $container.on('scroll', () => {
    autoScroll = $container[0].scrollHeight - $container[0].scrollTop <= $container[0].clientHeight + 5;
  });

  function appendLine(line) {
    lineNo++;
    const $tr = $('<tr>')
      .append($('<td>').text(lineNo))
      .append($('<td>').text(line));
    $body.append($tr);
    if ($body.children().length > 1000) {
      $body.children().first().remove();
    }
    if (autoScroll) {
      $container.scrollTop($container[0].scrollHeight);
    }
  }

  $('#connectBtn').click(() => {
    const udid = $('#deviceInput').val().toString().trim();
    if (!udid) return alert('Please enter a UDID.');
    lineNo = 0;
    $body.empty();
    socket = new WebSocket(`ws://${location.host}?udid=${encodeURIComponent(udid)}`);

    socket.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.event === 'log.batch') {
        msg.data.forEach(appendLine);
      } else if (msg.event === 'log.error' || msg.event === 'log.stop') {
        alert(msg.data.error || 'Log streaming stopped.');
      }
    };
    socket.onerror = () => alert('WebSocket error; check console.');
  });

  $('#clearBtn').click(() => {
    $body.empty();
    lineNo = 0;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'clear' }));
    }
  });
});

// public/logWorker.js

// Maximum lines we’ll keep in worker memory (optional)
const MAX_BUFFER = 2000;  

// This buffer is private to the worker
let buffer = [];

self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'log.batch') {
    // Append new lines
    buffer.push(...data);
    // Trim if too large
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER);
    }
    // Send back just the new batch (so main thread can append)
    self.postMessage({ type: 'render', data });
  }
};

$(function() {
  let socket;
  let autoScroll = true;
  let lineNo = 0;

  const $container = $('#logContainer');
  const $body      = $('#logTableBody');

  // 1) Spin up the worker
  const worker = new Worker('logWorker.js');
  worker.onmessage = function(e) {
    const { type, data } = e.data;
    if (type === 'render') {
      // data is an array of new lines
      data.forEach(appendLine);
    }
  };

  // Pause auto-scroll when user scrolls up
  $container.on('scroll', () => {
    autoScroll = $container[0].scrollHeight - $container[0].scrollTop
               <= $container[0].clientHeight + 5;
  });

  // Append a single log line
  function appendLine(line) {
    lineNo++;
    const $tr = $('<tr>')
      .append($('<td>').text(lineNo))
      .append($('<td>').text(line));
    $body.append($tr);

    // Keep DOM rows under 1000
    if ($body.children().length > 1000) {
      $body.children().first().remove();
    }

    if (autoScroll) {
      $container.scrollTop($container[0].scrollHeight);
    }
  }

  // Connect button
  $('#connectBtn').click(() => {
    const udid = $('#deviceInput').val().toString().trim();
    if (!udid) return alert('Please enter a UDID.');
    lineNo = 0;
    $body.empty();

    // connect socket.io
    socket = io({ query: { udid } });

    socket.on('connect_error', err => {
      alert('Connection error: ' + err.message);
    });

    // Instead of directly appending, POST batches into the worker
    socket.on('log.batch', batch => {
      worker.postMessage({ type: 'log.batch', data: batch });
    });

    socket.on('log.error', msg => {
      alert('Error: ' + msg);
    });

    socket.on('log.stop', () => {
      alert('Log stream stopped by server.');
    });
  });

  // Clear button
  $('#clearBtn').click(() => {
    $body.empty();
    lineNo = 0;
    if (socket && socket.connected) {
      socket.emit('clear');
    }
  });
});

