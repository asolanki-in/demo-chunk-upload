// public/script.js
$(function() {
  const socketUrl = `${location.protocol}//${location.host}`;
  let socket, autoScroll = true, lineNo = 0;

  const $container = $('#logContainer');
  const containerEl = $container[0];
  const tbody = document.getElementById('logTableBody');

  // Render queue & state
  const renderQueue = [];
  let rendering = false;
  const LINES_PER_FRAME   = 20;   // how many lines to render per RAF
  const MAX_VISIBLE_LINES = 100;  // cap visible rows at 100

  // Schedule a render if needed
  function scheduleRender() {
    if (!rendering) {
      rendering = true;
      requestAnimationFrame(renderFrame);
    }
  }

  // Render up to LINES_PER_FRAME each animation frame
  function renderFrame() {
    const fragment = document.createDocumentFragment();
    let count = 0;

    while (count < LINES_PER_FRAME && renderQueue.length) {
      const line = renderQueue.shift();
      lineNo++;

      const tr    = document.createElement('tr');
      const tdNum = document.createElement('td');
      tdNum.textContent    = String(lineNo);
      const tdLine = document.createElement('td');
      tdLine.textContent   = line;

      tr.appendChild(tdNum);
      tr.appendChild(tdLine);
      fragment.appendChild(tr);
      count++;
    }

    tbody.appendChild(fragment);

    // **Trim down to only the latest 100 rows**
    while (tbody.children.length > MAX_VISIBLE_LINES) {
      tbody.removeChild(tbody.firstChild!);
    }

    // Auto‐scroll if at (or near) bottom
    if (autoScroll) {
      containerEl.scrollTop = containerEl.scrollHeight;
    }

    if (renderQueue.length) {
      requestAnimationFrame(renderFrame);
    } else {
      rendering = false;
    }
  }

  // Pause auto‐scroll when user scrolls up
  $container.on('scroll', () => {
    autoScroll = containerEl.scrollHeight - containerEl.scrollTop
               <= containerEl.clientHeight + 5;
  });

  // Connect button
  $('#connectBtn').on('click', () => {
    const udid = $('#deviceInput').val()?.toString().trim();
    if (!udid) return alert('Enter a UDID');
    lineNo = 0;
    tbody.innerHTML = '';      // clear UI
    renderQueue.length = 0;    // clear pending

    socket = io(socketUrl, { query: { udid } });

    socket.on('connect_error', err => {
      alert('Connection error: ' + err.message);
    });

    // enqueue incoming batches
    socket.on('log.batch', batch => {
      renderQueue.push(...batch);
      scheduleRender();
    });

    socket.on('log.error', msg => {
      alert('Error: ' + msg);
    });

    socket.on('log.stop', () => {
      alert('Log stream stopped.');
    });
  });

  // Clear button
  $('#clearBtn').on('click', () => {
    tbody.innerHTML = '';
    lineNo = 0;
    renderQueue.length = 0;
    if (socket && socket.connected) {
      socket.emit('clear');
    }
  });
});


$(function() {
  const socketUrl = `${location.protocol}//${location.host}`;
  let socket;
  let paused = false;
  let lineNo = 0;

  // Playback speed (ms per line) from the slider
  let playbackInterval = parseInt($('#speedRange').val(), 10);

  // Queue of incoming lines
  const renderQueue = [];

  // DOM references
  const $container = $('#logContainer');
  const containerEl = $container[0];
  const tbody = document.getElementById('logTableBody');

  // Cap visible rows at 100
  const MAX_VISIBLE = 100;

  // === Playback loop ===
  let playbackTimer = null;
  function startPlayback() {
    if (playbackTimer) clearInterval(playbackTimer);
    playbackTimer = setInterval(() => {
      if (paused) return;
      const line = renderQueue.shift();
      if (!line) return;
      appendLine(line);
    }, playbackInterval);
  }

  // === Append a single line ===
  function appendLine(line) {
    lineNo++;
    const tr = document.createElement('tr');
    const tdNum  = document.createElement('td');
    const tdLine = document.createElement('td');
    tdNum.textContent  = String(lineNo);
    tdLine.textContent = line;
    tr.appendChild(tdNum);
    tr.appendChild(tdLine);
    tbody.appendChild(tr);

    // Trim old rows beyond MAX_VISIBLE
    while (tbody.children.length > MAX_VISIBLE) {
      tbody.removeChild(tbody.firstChild);
    }
    // Auto‐scroll if at bottom
    if (containerEl.scrollTop + containerEl.clientHeight >= containerEl.scrollHeight - 5) {
      containerEl.scrollTop = containerEl.scrollHeight;
    }
  }

  // === UI Event Handlers ===

  // Connect → open socket, start playback
  $('#connectBtn').click(() => {
    const udid = $('#deviceInput').val()?.toString().trim();
    if (!udid) {
      return alert('Please enter a UDID.');
    }
    // Reset state
    lineNo = 0;
    tbody.innerHTML = '';
    renderQueue.length = 0;
    paused = false;
    $('#pauseBtn').text('Pause');

    socket = io(socketUrl, { query: { udid } });

    socket.on('connect_error', err => {
      alert('Connection error: ' + err.message);
    });

    socket.on('log.batch', batch => {
      // Enqueue all lines, but let playback loop render at controlled rate
      renderQueue.push(...batch);
    });

    socket.on('log.error', msg => {
      alert('Error: ' + msg);
    });

    socket.on('log.stop', () => {
      alert('Log stream stopped.');
    });

    startPlayback();
  });

  // Pause/Resume toggle
  $('#pauseBtn').click(() => {
    paused = !paused;
    $('#pauseBtn').text(paused ? 'Resume' : 'Pause');
  });

  // Clear logs
  $('#clearBtn').click(() => {
    tbody.innerHTML = '';
    lineNo = 0;
    renderQueue.length = 0;
    if (socket && socket.connected) {
      socket.emit('clear');
    }
  });

  // Speed slider
  $('#speedRange').on('input', function() {
    playbackInterval = parseInt(this.value, 10);
    $('#speedLabel').text(`${playbackInterval}ms/line`);
    startPlayback();  // restart interval with new speed
  });

  // Pause auto‐scroll when user scrolls up
  $container.on('scroll', () => {
    // do nothing special here—appendLine already checks if we're at bottom
  });
});
