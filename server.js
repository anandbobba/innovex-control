// server.js - FIXED VERSION
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// Global state
let state = {
  endTimestamp: null,
  pausedRemaining: null,
  running: false,
  pendingClockMs: null,
  videoPlaying: false,
  videoType: null
};

// Broadcast state to all connected clients
function broadcastState() {
  console.log('SERVER: Broadcasting state:', state);
  io.emit('state-update', state);
}

// Start clock from milliseconds
function startClockFromMs(ms) {
  state.endTimestamp = Date.now() + ms;
  state.pausedRemaining = null;
  state.running = true;
  state.pendingClockMs = null;
  state.videoPlaying = false;
  state.videoType = null;
  console.log('SERVER: Clock started, endTimestamp:', new Date(state.endTimestamp));
  broadcastState();
}

io.on('connection', (socket) => {
  console.log('SERVER: Client connected:', socket.id);
  
  // Per-socket debounce tracking
  socket._lastFakePress = 0;

  // Send initial state to new client
  socket.emit('state-update', state);

  // FIXED: Fake press with acknowledgment
  socket.on('fake-press', () => {
    const now = Date.now();
    
    // Debounce: ignore presses within 800ms from same socket
    if (now - (socket._lastFakePress || 0) < 800) {
      console.log('SERVER: fake-press debounced from', socket.id);
      return;
    }
    socket._lastFakePress = now;

    console.log('SERVER: fake-press received from', socket.id);
    
    // Broadcast to all clients (including sender for consistency)
    io.emit('fake-press');
    
    // FIXED: Send acknowledgment back to sender
    socket.emit('fake-press-ack', { 
      from: 'server', 
      timestamp: now,
      socketId: socket.id 
    });
    
    console.log('SERVER: fake-press-ack sent to', socket.id);
  });

  // Play teaser video (sets pending clock)
  socket.on('play-teaser', (data) => {
    const ms = (data && typeof data.ms === 'number') ? data.ms : (24*60*60*1000);
    state.pendingClockMs = ms;
    state.videoPlaying = true;
    state.videoType = 'teaser';
    console.log('SERVER: play-teaser - pendingClockMs set to', ms, 'ms');
    broadcastState();
  });

  // Play main video
  socket.on('play-video', () => {
    state.videoPlaying = true;
    state.videoType = 'video';
    console.log('SERVER: play-video');
    broadcastState();
  });

  // Skip video
  socket.on('skip-video', () => {
    console.log('SERVER: skip-video');
    const wasTeaser = (state.videoType === 'teaser' && state.pendingClockMs);
    state.videoPlaying = false;
    state.videoType = null;
    
    if (wasTeaser) {
      console.log('SERVER: Teaser skipped, starting pending clock');
      startClockFromMs(state.pendingClockMs);
    } else {
      broadcastState();
    }
  });

  // Stop video
  socket.on('stop-video', () => {
    console.log('SERVER: stop-video');
    state.videoPlaying = false;
    state.videoType = null;
    broadcastState();
  });

  // Start clock manually
  socket.on('start-clock', (durationMs) => {
    const ms = (typeof durationMs === 'number') ? durationMs : 24*60*60*1000;
    console.log('SERVER: start-clock command, duration:', ms, 'ms');
    
    if (state.videoPlaying) {
      console.log('SERVER: Video playing - queueing clock as pendingClockMs');
      state.pendingClockMs = ms;
      broadcastState();
      return;
    }
    
    startClockFromMs(ms);
  });

  // Pause clock
  socket.on('pause-clock', () => {
    console.log('SERVER: pause-clock');
    if (state.running && state.endTimestamp) {
      state.pausedRemaining = Math.max(0, state.endTimestamp - Date.now());
      state.endTimestamp = null;
      state.running = false;
      console.log('SERVER: Clock paused, remaining:', state.pausedRemaining, 'ms');
    }
    broadcastState();
  });

  // Resume clock
  socket.on('resume-clock', () => {
    console.log('SERVER: resume-clock');
    if (state.pausedRemaining != null) {
      startClockFromMs(state.pausedRemaining);
    } else {
      console.log('SERVER: No paused time to resume');
      broadcastState();
    }
  });

  // Stop clock
  socket.on('stop-clock', () => {
    console.log('SERVER: stop-clock');
    state.endTimestamp = null;
    state.pausedRemaining = null;
    state.running = false;
    state.pendingClockMs = null;
    broadcastState();
  });

  // Set remaining time
  socket.on('set-remaining', (minutesOrMs) => {
    let ms = null;
    if (typeof minutesOrMs === 'number') {
      // If large number, treat as milliseconds; otherwise as minutes
      if (minutesOrMs > 100000) {
        ms = minutesOrMs;
      } else {
        ms = Math.max(0, Math.floor(minutesOrMs) * 60 * 1000);
      }
    }
    
    if (ms === null) {
      console.log('SERVER: set-remaining - invalid value');
      return;
    }
    
    console.log('SERVER: set-remaining to', ms, 'ms');
    
    if (state.running) {
      state.endTimestamp = Date.now() + ms;
    } else {
      state.pausedRemaining = ms;
    }
    
    broadcastState();
  });

  // Sync to exact timestamp
  socket.on('sync-timestamp', (timestamp) => {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) {
      console.log('SERVER: sync-timestamp - invalid timestamp');
      return;
    }
    
    console.log('SERVER: sync-timestamp to', new Date(ts));
    
    if (state.videoPlaying) {
      console.log('SERVER: Video playing - setting pendingClockMs from timestamp');
      state.pendingClockMs = Math.max(0, ts - Date.now());
      broadcastState();
      return;
    }
    
    state.endTimestamp = ts;
    state.pausedRemaining = null;
    state.running = true;
    broadcastState();
  });

  // FIXED: Video ended handler - start pending clock
  socket.on('video-ended', () => {
    console.log('SERVER: video-ended from', socket.id);
    
    state.videoPlaying = false;
    state.videoType = null;
    
    if (state.pendingClockMs) {
      console.log('SERVER: Starting clock from pendingClockMs:', state.pendingClockMs, 'ms');
      startClockFromMs(state.pendingClockMs);
    } else {
      console.log('SERVER: No pending clock to start');
      broadcastState();
    }
  });

  // Video error handler
  socket.on('video-error', () => {
    console.log('SERVER: video-error from', socket.id);
    
    state.videoPlaying = false;
    state.videoType = null;
    
    if (state.pendingClockMs) {
      console.log('SERVER: Video error - starting pending clock anyway');
      startClockFromMs(state.pendingClockMs);
    } else {
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    console.log('SERVER: Client disconnected:', socket.id);
  });
});

// Get local network IP
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Start server
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n====================================');
  console.log('    INNOVEX Server Running! 🚀');
  console.log('====================================\n');
  console.log(`Bound to port: ${PORT}`);
  console.log(`\nLocal URLs:`);
  console.log(`  Display:    http://localhost:${PORT}/display.html`);
  console.log(`  Controller: http://localhost:${PORT}/controller.html`);
  console.log(`\nLAN URLs:`);
  console.log(`  Display:    http://${ip}:${PORT}/display.html`);
  console.log(`  Controller: http://${ip}:${PORT}/controller.html`);
  console.log('\nPublic URL will be provided by Railway.');
  console.log('(Generate Domain in Railway settings)\n');
});