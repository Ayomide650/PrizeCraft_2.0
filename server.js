const express = require('express');
const app = express();
require('dotenv').config(); // For local development, Render will inject PORT

const PORT = process.env.PORT || 3000;

// Start the Discord bot
require('./index.js');

app.get('/', (req, res) => {
  res.send('Giveaway Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
