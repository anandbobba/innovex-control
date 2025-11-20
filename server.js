const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

// Server state
let state = {
  endTimestamp: null,
  pausedRemaining: null,
  running: false,
  pendingClockMs: null,
  videoPlaying: false,
  videoType: null // 'teaser' or 'video'
};

// Serve static files
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/display.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/controller.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current state to new client
  socket.emit('state-update', state);
  
  // Play teaser
  socket.on('play-teaser', () => {
    console.log('Playing teaser video');
    state.videoPlaying = true;
    state.videoType = 'teaser';
    state.pendingClockMs = 24 * 60 * 60 * 1000; // 24 hours
    io.emit('state-update', state);
  });
  
  // Play video
  socket.on('play-video', () => {
    console.log('Playing video');
    state.videoPlaying = true;
    state.videoType = 'video';
    io.emit('state-update', state);
  });
  
  // Skip video
  socket.on('skip-video', () => {
    console.log('Skipping video');
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    
    // If teaser was skipped and clock was pending, start it
    if (wasTeaserWithPendingClock) {
      state.endTimestamp = Date.now() + state.pendingClockMs;
      state.running = true;
      state.pendingClockMs = null;
      console.log('Auto-starting clock after teaser skip');
    }
    
    io.emit('state-update', state);
  });
  
  // Stop video
  socket.on('stop-video', () => {
    console.log('Stopping video');
    state.videoPlaying = false;
    state.videoType = null;
    io.emit('state-update', state);
  });
  
  // Video ended (from display client)
  socket.on('video-ended', () => {
    console.log('Video ended');
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    
    // If teaser ended and clock was pending, start it
    if (wasTeaserWithPendingClock) {
      state.endTimestamp = Date.now() + state.pendingClockMs;
      state.running = true;
      state.pendingClockMs = null;
      console.log('Auto-starting clock after teaser ended');
    }
    
    io.emit('state-update', state);
  });
  
  // Video error (from display client)
  socket.on('video-error', () => {
    console.log('Video error - treating as ended');
    const wasTeaserWithPendingClock = state.videoType === 'teaser' && state.pendingClockMs;
    state.videoPlaying = false;
    state.videoType = null;
    
    // If teaser had error and clock was pending, start it
    if (wasTeaserWithPendingClock) {
      state.endTimestamp = Date.now() + state.pendingClockMs;
      state.running = true;
      state.pendingClockMs = null;
      console.log('Auto-starting clock after teaser error');
    }
    
    io.emit('state-update', state);
  });
  
  // Start clock
  socket.on('start-clock', (durationMs) => {
    console.log('Starting clock:', durationMs, 'ms');
    state.endTimestamp = Date.now() + durationMs;
    state.pausedRemaining = null;
    state.running = true;
    state.pendingClockMs = null;
    io.emit('state-update', state);
  });
  
  // Pause clock
  socket.on('pause-clock', () => {
    if (state.running && state.endTimestamp) {
      console.log('Pausing clock');
      state.pausedRemaining = state.endTimestamp - Date.now();
      state.running = false;
      io.emit('state-update', state);
    }
  });
  
  // Resume clock
  socket.on('resume-clock', () => {
    if (!state.running && state.pausedRemaining !== null) {
      console.log('Resuming clock');
      state.endTimestamp = Date.now() + state.pausedRemaining;
      state.pausedRemaining = null;
      state.running = true;
      io.emit('state-update', state);
    }
  });
  
  // Stop clock
  socket.on('stop-clock', () => {
    console.log('Stopping clock');
    state.endTimestamp = null;
    state.pausedRemaining = null;
    state.running = false;
    state.pendingClockMs = null;
    io.emit('state-update', state);
  });
  
  // Set remaining minutes
  socket.on('set-remaining', (minutes) => {
    console.log('Setting remaining time:', minutes, 'minutes');
    const ms = minutes * 60 * 1000;
    if (state.running) {
      state.endTimestamp = Date.now() + ms;
    } else {
      state.pausedRemaining = ms;
    }
    io.emit('state-update', state);
  });
  
  // Sync with exact timestamp
  socket.on('sync-timestamp', (timestamp) => {
    console.log('Syncing with timestamp:', new Date(timestamp));
    state.endTimestamp = timestamp;
    state.pausedRemaining = null;
    state.running = true;
    io.emit('state-update', state);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Get LAN IP
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, () => {
  const lanIP = getLanIP();
  console.log('\n' + '='.repeat(60));
  console.log('🚀 INNOVEX Server Running');
  console.log('='.repeat(60));
  console.log('Display (local):     http://localhost:' + PORT + '/display.html');
  console.log('Controller (local):  http://localhost:' + PORT + '/controller.html');
  console.log('Display (LAN):       http://' + lanIP + ':' + PORT + '/display.html');
  console.log('Controller (LAN):    http://' + lanIP + ':' + PORT + '/controller.html');
  console.log('='.repeat(60) + '\n');
});