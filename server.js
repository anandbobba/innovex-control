const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Server state
let state = {
    endTimestamp: null,
    pausedRemaining: null,
    running: false,
    pendingClockMs: null,
    videoPlaying: false,
    videoType: null // 'teaser' or 'video'
};

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

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current state to newly connected client
    socket.emit('state', state);
    
    // Controller actions
    socket.on('play-teaser', () => {
        console.log('Playing teaser video');
        state.videoPlaying = true;
        state.videoType = 'teaser';
        state.pendingClockMs = 24 * 60 * 60 * 1000; // Auto-start 24h after teaser
        io.emit('state', state);
    });
    
    socket.on('play-video', () => {
        console.log('Playing video');
        state.videoPlaying = true;
        state.videoType = 'video';
        io.emit('state', state);
    });
    
    socket.on('skip-video', () => {
        console.log('Skipping video');
        if (state.videoType === 'teaser' && state.pendingClockMs) {
            // Start clock immediately
            state.endTimestamp = Date.now() + state.pendingClockMs;
            state.running = true;
            state.pendingClockMs = null;
        }
        state.videoPlaying = false;
        state.videoType = null;
        io.emit('state', state);
    });
    
    socket.on('stop-video', () => {
        console.log('Stopping video');
        state.videoPlaying = false;
        state.videoType = null;
        io.emit('state', state);
    });
    
    socket.on('video-ended', () => {
        console.log('Video ended on client');
        if (state.videoType === 'teaser' && state.pendingClockMs) {
            // Auto-start clock after teaser
            state.endTimestamp = Date.now() + state.pendingClockMs;
            state.running = true;
            state.pendingClockMs = null;
            console.log('Auto-starting 24h clock after teaser');
        }
        state.videoPlaying = false;
        state.videoType = null;
        io.emit('state', state);
    });
    
    socket.on('video-error', () => {
        console.log('Video error on client');
        if (state.videoType === 'teaser' && state.pendingClockMs) {
            // Auto-start clock if teaser fails
            state.endTimestamp = Date.now() + state.pendingClockMs;
            state.running = true;
            state.pendingClockMs = null;
            console.log('Auto-starting 24h clock (video error)');
        }
        state.videoPlaying = false;
        state.videoType = null;
        io.emit('state', state);
    });
    
    socket.on('start-clock', (data) => {
        const hours = data.hours || 24;
        const ms = hours * 60 * 60 * 1000;
        state.endTimestamp = Date.now() + ms;
        state.running = true;
        state.pausedRemaining = null;
        console.log(`Starting ${hours}h clock`);
        io.emit('state', state);
    });
    
    socket.on('pause-clock', () => {
        if (state.running && state.endTimestamp) {
            state.pausedRemaining = state.endTimestamp - Date.now();
            state.running = false;
            console.log('Clock paused');
            io.emit('state', state);
        }
    });
    
    socket.on('resume-clock', () => {
        if (!state.running && state.pausedRemaining) {
            state.endTimestamp = Date.now() + state.pausedRemaining;
            state.running = true;
            state.pausedRemaining = null;
            console.log('Clock resumed');
            io.emit('state', state);
        }
    });
    
    socket.on('stop-clock', () => {
        state.endTimestamp = null;
        state.pausedRemaining = null;
        state.running = false;
        console.log('Clock stopped');
        io.emit('state', state);
    });
    
    socket.on('set-minutes', (data) => {
        const minutes = data.minutes || 0;
        const ms = minutes * 60 * 1000;
        state.endTimestamp = Date.now() + ms;
        state.running = true;
        state.pausedRemaining = null;
        console.log(`Setting clock to ${minutes} minutes`);
        io.emit('state', state);
    });
    
    socket.on('set-custom-time', (data) => {
        const ms = data.ms || 0;
        if (ms > 0) {
            state.endTimestamp = Date.now() + ms;
            state.running = true;
            state.pausedRemaining = null;
            const hours = Math.floor(ms / 3600000);
            const mins = Math.floor((ms % 3600000) / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            console.log(`Setting custom time: ${hours}h ${mins}m ${secs}s`);
            io.emit('state', state);
        }
    });
    
    socket.on('sync-timestamp', (data) => {
        state.endTimestamp = data.timestamp;
        state.running = true;
        state.pausedRemaining = null;
        console.log('Syncing with timestamp:', new Date(data.timestamp));
        io.emit('state', state);
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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    const lanIP = getLanIP();
    console.log('\n' + '='.repeat(60));
    console.log('🎯 INNOVEX Control Server Running');
    console.log('='.repeat(60));
    console.log('\n📺 DISPLAY PAGE (For Big Screen):');
    console.log(`   Local:  http://localhost:${PORT}/display.html`);
    console.log(`   LAN:    http://${lanIP}:${PORT}/display.html`);
    console.log('\n🎮 CONTROLLER PAGE (For Organizers):');
    console.log(`   Local:  http://localhost:${PORT}/controller.html`);
    console.log(`   LAN:    http://${lanIP}:${PORT}/controller.html`);
    console.log('\n' + '='.repeat(60) + '\n');
});