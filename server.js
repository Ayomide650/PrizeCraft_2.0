const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'Bot is running!', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'discord-giveaway-bot',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
