// app.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const webhookRouter = require('./routes/webhook');
const logger = require('./utils/logger');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(bodyParser.json());

// If behind a proxy (Glitch/Heroku)
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests; please try again later.'
});
app.use(limiter);

app.use('/webhook', webhookRouter);

app.use((req, res) => {
  res.status(404).send('Not Found');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`ZP Pune Chatbot is running on port ${PORT}`);
});
