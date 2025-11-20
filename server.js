// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// static files
app.use(express.static(path.join(__dirname, 'public')));

// simple health check
app.get('/status', (req, res) => res.json({ status: 'ok' }));

/* ------------------------
   In-memory server state
   authoritative for countdown
-------------------------*/
const state = {
  endTimestamp: null,     // unix ms when countdown ends; null if not running
  pausedRemaining: null,  // ms remaining when paused or stopped
  running: false,         // boolean - clock ticking or not
  pendingClockMs: null,   // ms to start once teaser ends (set by controller)
  videoPlaying: false     // flag: server asked displays to play teaser
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
  state.videoPlaying = false;
  io.emit('control', { action: 'startClock', data: { endTimestamp: state.endTimestamp }});
  broadcastState();
}

/* ------------------------
   Socket.IO handlers
-------------------------*/
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // send current state immediately
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
    const action = payload.action;
    const data = payload.data || {};
    console.log('CONTROL:', action, data);

    switch (action) {
      case 'playTeaserStartClockAfter':
        // controller triggers teaser across displays and requests that after video ends server starts clock with ms
        state.pendingClockMs = (typeof data.ms === 'number') ? data.ms : (24*60*60*1000);
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
        // stops video and treat as ended -> start pending clock if set
        state.videoPlaying = false;
        io.emit('control', { action: 'skipVideo' });
        if (state.pendingClockMs) startClockFromMs(state.pendingClockMs);
        break;

      case 'startClock':
        // start immediately with ms or default 24h
        startClockFromMs((typeof data.ms === 'number') ? data.ms : (24*60*60*1000));
        break;

      case 'pauseClock':
      case 'stopClock':
        // freeze the clock at current remaining time
        if (state.running && state.endTimestamp) {
          state.pausedRemaining = Math.max(0, state.endTimestamp - Date.now());
          state.endTimestamp = null;
          state.running = false;
        }
        io.emit('control', { action: 'pauseClock', data: { pausedRemaining: state.pausedRemaining }});
        broadcastState();
        break;

      case 'resumeClock':
        // resume from pausedRemaining
        if (state.pausedRemaining != null) {
          startClockFromMs(state.pausedRemaining);
          state.pausedRemaining = null;
        } else if (typeof data.endTimestamp === 'number') {
          state.endTimestamp = data.endTimestamp;
          state.running = true;
          io.emit('control', { action: 'startClock', data: { endTimestamp: state.endTimestamp }});
          broadcastState();
        }
        break;

      case 'setRemaining':
        // set remaining ms from now and start
        if (typeof data.ms === 'number') {
          startClockFromMs(data.ms);
        }
        break;

      case 'syncClock':
        // set absolute endTimestamp
        if (typeof data.endTimestamp === 'number') {
          state.endTimestamp = data.endTimestamp;
          state.pausedRemaining = null;
          state.running = true;
          io.emit('control', { action: 'syncClock', data: { endTimestamp: state.endTimestamp }});
          broadcastState();
        }
        break;

      case 'resetTo24h':
        // reset to full 24 hours and start immediately
        startClockFromMs(24*60*60*1000);
        break;

      default:
        console.log('Unknown control action:', action);
    }
  });

  // displays report video ended (or error treated like ended)
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

/* ------------------------
   Helper: local IP
-------------------------*/
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

/* ------------------------
   Start server
-------------------------*/
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log('');
  console.log('====================================');
  console.log('    INNOVEX Server Running! 🚀');
  console.log('====================================\n');
  console.log('Public URL will be provided by your host (Railway).');
  console.log(`Local test URLs (if running locally): http://localhost:${PORT}/display.html and http://localhost:${PORT}/controller.html`);
});
