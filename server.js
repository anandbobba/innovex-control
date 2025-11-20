// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// in-memory state (use DB if you need persistence across restarts)
const state = {
  endTimestamp: null,
  pausedRemaining: null,
  running: false,
  pendingClockMs: null,
  videoPlaying: false
};

function broadcastState() {
  io.emit('state', {
    endTimestamp: state.endTimestamp,
    pausedRemaining: state.pausedRemaining,
    running: state.running,
    pendingClockMs: state.pendingClockMs,
    videoPlaying: state.videoPlaying,
    serverTime: Date.now()
  });
}

function startClockFromMs(ms) {
  state.endTimestamp = Date.now() + ms;
  state.pausedRemaining = null;
  state.running = true;
  state.pendingClockMs = null;
  io.emit('control', { action: 'startClock', data: { endTimestamp: state.endTimestamp } });
  broadcastState();
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.emit('state', {
    endTimestamp: state.endTimestamp,
    pausedRemaining: state.pausedRemaining,
    running: state.running,
    pendingClockMs: state.pendingClockMs,
    videoPlaying: state.videoPlaying,
    serverTime: Date.now()
  });

  socket.on('control', (payload) => {
    if (!payload || !payload.action) return;
    const a = payload.action;
    const d = payload.data || {};
    console.log('CONTROL:', a, d);

    switch (a) {
      case 'playTeaserStartClockAfter':
        state.pendingClockMs = (typeof d.ms === 'number') ? d.ms : (24*60*60*1000);
        state.videoPlaying = true;
        io.emit('control', { action: 'playVideo' });
        broadcastState();
        break;

      case 'playVideo':
        state.videoPlaying = true;
        io.emit('control', { action: 'playVideo' });
        broadcastState();
        break;

      case 'stopVideo':
        state.videoPlaying = false;
        io.emit('control', { action: 'stopVideo' });
        broadcastState();
        break;

      case 'skipVideo':
        state.videoPlaying = false;
        io.emit('control', { action: 'skipVideo' });
        if (state.pendingClockMs) startClockFromMs(state.pendingClockMs);
        break;

      case 'startClock':
        startClockFromMs((typeof d.ms === 'number') ? d.ms : (24*60*60*1000));
        break;

      case 'pauseClock':
      case 'stopClock':
        if (state.running && state.endTimestamp) {
          state.pausedRemaining = Math.max(0, state.endTimestamp - Date.now());
          state.endTimestamp = null;
          state.running = false;
        }
        io.emit('control', { action: 'pauseClock', data: { pausedRemaining: state.pausedRemaining } });
        broadcastState();
        break;

      case 'resumeClock':
        if (state.pausedRemaining != null) {
          startClockFromMs(state.pausedRemaining);
          state.pausedRemaining = null;
        } else if (d.endTimestamp && typeof d.endTimestamp === 'number') {
          state.endTimestamp = d.endTimestamp;
          state.running = true;
          io.emit('control', { action: 'startClock', data: { endTimestamp: state.endTimestamp }});
          broadcastState();
        }
        break;

      case 'setRemaining':
        if (typeof d.ms === 'number') startClockFromMs(d.ms);
        break;

      case 'syncClock':
        if (typeof d.endTimestamp === 'number') {
          state.endTimestamp = d.endTimestamp;
          state.pausedRemaining = null;
          state.running = true;
          io.emit('control', { action: 'syncClock', data: { endTimestamp: state.endTimestamp }});
          broadcastState();
        }
        break;
    }
  });

  socket.on('status', (payload) => {
    if (!payload) return;
    if (payload.type === 'videoEnded') {
      state.videoPlaying = false;
      if (state.pendingClockMs) {
        startClockFromMs(state.pendingClockMs);
        state.pendingClockMs = null;
      }
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// HELPER get local IP (useful during local testing)
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, () => {
  console.log('\n====================================');
  console.log('    INNOVEX Server Running! 🚀');
  console.log('====================================\n');
  console.log('Public URL will be provided by Railway.');
  console.log(`Local test URLs (if running locally): http://localhost:${PORT}/display.html and http://localhost:${PORT}/controller.html`);
});
