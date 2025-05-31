// server.js
const express = require('express');
const app = express();
require('dotenv').config(); // For local development, Render will inject PORT

const PORT = process.env.PORT || 3000; // Render provides process.env.PORT

// Start the Discord bot
require('./index.js'); // This line executes your main bot code

app.get('/', (req, res) => {
  res.send('Giveaway Bot is alive!');
});

app.listen(PORT, () => {
  // This log message is crucial. If you don't see it in your Render logs,
  // the server isn't successfully starting to listen.
  console.log(`Server listening on port ${PORT}. Health check available at /`);
});
