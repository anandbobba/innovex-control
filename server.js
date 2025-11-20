// server.js (Railway-ready)
// Only server-side changes here. UI files remain untouched.
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// IMPORTANT: no strict CORS required for same-origin usage; socket.io will be served from this server
const io = new Server(server, {
  // defaults are fine; you can enable cors if you access from different origin:
  // cors: { origin: "*" }
});

// Serve static UI files from /public
app.use(express.static(path.join(__dirname, 'public')));

// health check for Railway / uptime monitoring
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

/* -------------------------
   Authoritative server state
   (unchanged semantics your UI expects)
   - state-update events are used by client
   - controller emits: play-teaser, play-video, skip-video, stop-video,
                      start-clock, pause-clock, resume-clock, stop-clock,
                      set-remaining, sync-timestamp
   - display emits: video-ended, video-error
--------------------------*/
let state = {
  endTimestamp: null,
  pausedRemaining: null,
  running: false,
  pendingClockMs: null,
  videoPlaying: false,
  videoType: null // 'teaser' or 'video'
};

function broadcastState() {
  io.emit('state-update', state);
}

// Helper to start clock from ms
function startClockFromMs(ms) {
  state.endTimestamp = Date.now() + ms;
  state.pausedRemaining = null;
  state.running = true;
  state.pendingClockMs = null;
  state.videoPlaying = false;
  state.videoType = null;
  broadcastState();
}

// Socket.IO
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  // send current state immediately
  socket.emit('state-update', state);

  // CONTROLS from controller UI
  socket.on('play-teaser', () => {
    console.log('control: play-teaser');
    state.videoPlaying = true;
    state.videoType = 'teaser';
    // keep pendingClockMs as it was or default to 24h
    if (!state.pendingClockMs) state.pendingClockMs = 24 * 60 * 60 * 1000;
    broadcastState();
  });

  socket.on('play-video', () => {
    console.log('control: play-video');
    state.videoPlaying = true;
    state.videoType = 'video';
    broadcastState();
  });

  socket.on('skip-video', () => {
    console.log('control: skip-video');
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    if (wasTeaserWithPendingClock) {
      console.log('Starting clock because teaser skipped (pendingClockMs present)');
      startClockFromMs(state.pendingClockMs);
    } else {
      broadcastState();
    }
  });

  socket.on('stop-video', () => {
    console.log('control: stop-video');
    state.videoPlaying = false;
    state.videoType = null;
    broadcastState();
  });

  socket.on('start-clock', (durationMs) => {
    // if controller calls with a number
    const ms = (typeof durationMs === 'number') ? durationMs : 24*60*60*1000;
    console.log('control: start-clock', ms);
    startClockFromMs(ms);
  });

  socket.on('pause-clock', () => {
    console.log('control: pause-clock');
    if (state.running && state.endTimestamp) {
      state.pausedRemaining = Math.max(0, state.endTimestamp - Date.now());
      state.endTimestamp = null;
      state.running = false;
    }
    broadcastState();
  });

  socket.on('resume-clock', () => {
    console.log('control: resume-clock');
    if (state.pausedRemaining != null) {
      startClockFromMs(state.pausedRemaining);
    } else {
      // nothing to resume
      broadcastState();
    }
  });

  socket.on('stop-clock', () => {
    console.log('control: stop-clock');
    state.endTimestamp = null;
    state.pausedRemaining = null;
    state.running = false;
    state.pendingClockMs = null;
    broadcastState();
  });

  socket.on('set-remaining', (minutes) => {
    // controller sends minutes (your controller does)
    const mins = Number(minutes);
    if (Number.isFinite(mins)) {
      const ms = Math.max(0, mins * 60 * 1000);
      console.log('control: set-remaining', mins, 'minutes ->', ms, 'ms');
      if (state.running) {
        state.endTimestamp = Date.now() + ms;
      } else {
        state.pausedRemaining = ms;
      }
      broadcastState();
    }
  });

  socket.on('sync-timestamp', (timestamp) => {
    const ts = Number(timestamp);
    if (!Number.isNaN(ts) && ts > 0) {
      console.log('control: sync-timestamp', new Date(ts).toISOString());
      state.endTimestamp = ts;
      state.pausedRemaining = null;
      state.running = true;
      broadcastState();
    }
  });

  // Display emits when video ends or errors
  socket.on('video-ended', () => {
    console.log('status: video-ended from', socket.id);
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    if (wasTeaserWithPendingClock) {
      console.log('Auto-starting clock after teaser ended (pendingClockMs was set)');
      startClockFromMs(state.pendingClockMs);
    } else {
      broadcastState();
    }
  });

  socket.on('video-error', () => {
    console.log('status: video-error from', socket.id);
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    if (wasTeaserWithPendingClock) {
      console.log('Auto-starting clock after teaser error (pendingClockMs was set)');
      startClockFromMs(state.pendingClockMs);
    } else {
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Get LAN IP for local logs (useful for local tests)
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Use process.env.PORT for Railway; listen on 0.0.0.0
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n====================================');
  console.log('    INNOVEX Server Running! 🚀');
  console.log('====================================\n');
  console.log(`Bound to port: ${PORT}`);
  console.log(`Local Display: http://localhost:${PORT}/display.html`);
  console.log(`Local Controller: http://localhost:${PORT}/controller.html`);
  const ip = getLocalIP();
  console.log(`LAN Display: http://${ip}:${PORT}/display.html`);
  console.log(`LAN Controller: http://${ip}:${PORT}/controller.html`);
  console.log('\nPublic URL will be provided by Railway (click Generate Domain in Railway UI).');
});
