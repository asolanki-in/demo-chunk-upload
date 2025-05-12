// public/script.js
$(function() {
  const socketUrl = `${location.protocol}//${location.host}`;
  let socket, autoScroll = true, lineNo = 0;

  const $container = $('#logContainer');
  const containerEl = $container[0];
  const tbody = document.getElementById('logTableBody');

  // 1) Render queue & state
  const renderQueue = [];
  let rendering = false;
  const LINES_PER_FRAME = 20;  // tweak this up or down

  // 2) Schedule a new RAF render if not already running
  function scheduleRender() {
    if (!rendering) {
      rendering = true;
      requestAnimationFrame(renderFrame);
    }
  }

  // 3) The actual render loop: draw up to LINES_PER_FRAME each frame
  function renderFrame() {
    const fragment = document.createDocumentFragment();
    let count = 0;
    while (count < LINES_PER_FRAME && renderQueue.length) {
      const line = renderQueue.shift();
      lineNo++;

      // build <tr><td>#</td><td>line</td></tr>
      const tr = document.createElement('tr');
      const tdNum = document.createElement('td');
      tdNum.textContent = String(lineNo);
      const tdLine = document.createElement('td');
      tdLine.textContent = line;
      tr.appendChild(tdNum);
      tr.appendChild(tdLine);
      fragment.appendChild(tr);

      count++;
    }

    tbody.appendChild(fragment);

    // Trim old rows
    while (tbody.children.length > 1000) {
      tbody.removeChild(tbody.firstChild!);
    }

    // Auto-scroll if we're at (or near) bottom
    if (autoScroll) {
      containerEl.scrollTop = containerEl.scrollHeight;
    }

    // Continue if there's still work
    if (renderQueue.length) {
      requestAnimationFrame(renderFrame);
    } else {
      rendering = false;
    }
  }

  // 4) Wire up scroll to pause auto-scroll
  $container.on('scroll', () => {
    autoScroll = containerEl.scrollHeight - containerEl.scrollTop
               <= containerEl.clientHeight + 5;
  });

  // 5) Connect button
  $('#connectBtn').on('click', () => {
    const udid = $('#deviceInput').val()?.toString().trim();
    if (!udid) return alert('Enter a UDID');
    lineNo = 0;
    tbody.innerHTML = '';   // clear existing

    socket = io(socketUrl, { query: { udid } });

    socket.on('connect_error', err => {
      alert('Connection error: ' + err.message);
    });

    // Push entire batch into our renderQueue, then schedule a render
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

  // 6) Clear button
  $('#clearBtn').on('click', () => {
    tbody.innerHTML = '';
    lineNo = 0;
    renderQueue.length = 0;
    if (socket && socket.connected) {
      socket.emit('clear');
    }
  });
});