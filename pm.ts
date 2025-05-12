import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import adb from '@devicefarmer/adbkit';
import { LogcatEntry } from '@devicefarmer/adbkit-logcat';

// ---- Configuration ----
const PORT = 3000;
const LOG_BUFFER_SIZE = 1000;
const BATCH_INTERVAL_MS = 100;
const MAX_WS_BUFFERED_AMOUNT = 5e6; // 5 MB

// ---- Types ----
interface DeviceState {
  reader: any;
  buffer: LogcatEntry[];
  sockets: Set<WebSocket>;
  pending: LogcatEntry[];
  batchTimer: NodeJS.Timeout;
}
const devices = new Map<string, DeviceState>();

// ---- ADB Client ----
const adbClient = adb.createClient();

// ---- Start logcat + batching for a device ----
async function startStreaming(serial: string) {
  if (devices.has(serial)) return;

  const state: DeviceState = {
    reader: null as any,
    buffer: [],
    sockets: new Set(),
    pending: [],
    batchTimer: null as any
  };
  devices.set(serial, state);

  try {
    const reader = await adbClient.openLogcat(serial, { clear: true });
    state.reader = reader;

    reader.on('entry', (entry: LogcatEntry) => {
      (entry as any).serial = serial;
      // Buffer for new clients
      state.buffer.push(entry);
      if (state.buffer.length > LOG_BUFFER_SIZE) {
        state.buffer.shift();
      }
      // Queue for batch send
      state.pending.push(entry);
    });

    const teardown = (event: string, err?: Error) => {
      clearInterval(state.batchTimer);
      for (const ws of state.sockets) {
        const payload = err
          ? { event: 'logcat.error', data: { serial, error: err.message } }
          : { event: 'logcat.stop', data: { serial, reason: event } };
        try { ws.send(JSON.stringify(payload)); } catch {}
      }
      devices.delete(serial);
    };

    reader.on('end', () => teardown('ended'));
    reader.on('error', (err: Error) => teardown('error', err));

    // Batch timer
    state.batchTimer = setInterval(() => {
      if (state.pending.length === 0) return;
      const batch = state.pending.splice(0);
      const msg = JSON.stringify({ event: 'logcat.batch', data: batch });
      for (const ws of state.sockets) {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_WS_BUFFERED_AMOUNT) {
          ws.send(msg, err => { if (err) console.error('WS send error:', err); });
        }
      }
    }, BATCH_INTERVAL_MS);

    console.log(`Started logcat streaming for device ${serial}`);
  } catch (err: any) {
    devices.delete(serial);
    throw err;
  }
}

// ---- Express + Static Files ----
const app = express();
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- WebSocket Handling ----
wss.on('connection', async (ws, req) => {
  // Parse serial from URL ?serial=<serial>
  const params = new URLSearchParams((req.url || '').slice(2));
  const serial = params.get('serial');
  if (!serial) {
    ws.send(JSON.stringify({ event: 'error', data: 'Missing serial parameter' }));
    return ws.close();
  }

  try {
    await startStreaming(serial);
  } catch (err: any) {
    ws.send(JSON.stringify({ event: 'logcat.error', data: { serial, error: err.message } }));
    return ws.close();
  }

  const state = devices.get(serial)!;
  state.sockets.add(ws);

  // Send buffered log history
  if (state.buffer.length) {
    ws.send(JSON.stringify({ event: 'logcat.batch', data: state.buffer }));
  }

  ws.on('message', msg => {
    try {
      const m = JSON.parse(msg.toString());
      if (m.event === 'clear') {
        state.buffer = [];
        ws.send(JSON.stringify({ event: 'logcat.cleared', data: { serial } }));
      }
    } catch {}
  });

  ws.on('close', () => {
    state.sockets.delete(ws);
    if (state.sockets.size === 0) {
      clearInterval(state.batchTimer);
      try { state.reader.end(); } catch {}
      devices.delete(serial);
      console.log(`Stopped streaming for ${serial} (no more clients)`);
    }
  });

  ws.on('error', err => {
    console.error(`WebSocket error for ${serial}:`, err);
  });
});

// ---- Global Error Handling ----
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled Rejection:', err));

// ---- Start Server ----
server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});



<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Android Log Viewer</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="controls">
    Device: <input id="deviceInput" placeholder="Enter device serial">
    <button id="connectBtn">Connect</button>
    <button id="clearBtn">Clear</button>
  </div>
  <div id="logContainer">
    <table>
      <thead>
        <tr><th>Time</th><th>Lvl</th><th>Tag</th><th>PID</th><th>Msg</th></tr>
      </thead>
      <tbody id="logTableBody"></tbody>
    </table>
  </div>

  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="script.js"></script>
</body>
</html>




$(function() {
  let socket;
  let autoScroll = true;

  const $container = $('#logContainer');
  const $body = $('#logTableBody');

  // Auto-scroll toggle
  $container.on('scroll', function() {
    const nearBottom = this.scrollHeight - this.scrollTop <= this.clientHeight + 5;
    autoScroll = nearBottom;
  });

  // Append one log entry
  function append(entry) {
    const date = new Date(entry.date * 1000);
    const time = date.toTimeString().split(' ')[0] + '.' +
                 date.getMilliseconds().toString().padStart(3, '0');
    const prioMap = {2:'V',3:'D',4:'I',5:'W',6:'E',7:'F'};
    const lvl = prioMap[entry.priority] || entry.priority;
    const $tr = $('<tr>')
      .addClass('level-' + lvl)
      .append($('<td>').text(time))
      .append($('<td>').text(lvl))
      .append($('<td>').text(entry.tag || ''))
      .append($('<td>').text(entry.pid || ''))
      .append($('<td>').text(entry.message || ''));
    $body.append($tr);
    // Trim old rows
    if ($body.children().length > 1000) {
      $body.children().first().remove();
    }
    if (autoScroll) {
      $container.scrollTop($container[0].scrollHeight);
    }
  }

  // Connect button
  $('#connectBtn').click(function() {
    const serial = $('#deviceInput').val().toString().trim();
    if (!serial) return alert('Please enter a device serial.');
    socket = new WebSocket(`ws://${location.host}?serial=${encodeURIComponent(serial)}`);

    socket.onmessage = function(evt) {
      const msg = JSON.parse(evt.data);
      if (msg.event === 'logcat.batch') {
        msg.data.forEach(append);
      } else if (msg.event === 'logcat.error' || msg.event === 'logcat.stop') {
        alert(msg.data.error || 'Log stream stopped.');
      }
    };
    socket.onerror = () => alert('WebSocket error. Check console.');
    socket.onclose = () => console.warn('WebSocket closed.');
  });

  // Clear button
  $('#clearBtn').click(function() {
    $body.empty();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'clear' }));
    }
  });
});

