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