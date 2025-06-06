// routes/webhook.js
const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/webhookController');
const logger = require('../utils/logger');

router.post('/', handleWebhook);

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      logger.info('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(404);
});

module.exports = router;
