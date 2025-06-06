// services/whatsappService.js

const axios = require('axios');
const logger = require('../utils/logger');

const whatsAppToken = process.env.WHATSAPP_TOKEN || '';
const phoneNumberApiUrl = `https://graph.facebook.com/v19.0/${
  process.env.WA_PHONE_NUMBER_ID || '116898241348063'
}/messages`;

async function sendText(to, body) {
  const data = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false }
  };

  try {
    const response = await axios.post(phoneNumberApiUrl, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsAppToken}`
      }
    });
    logger.info(`Sent text to ${to}: ${body}`);
    return response.data;
  } catch (error) {
    logger.error(
      `Error sendText => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

async function sendImage(to, imageUrl, caption = '') {
  const data = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: imageUrl, caption }
  };

  try {
    const response = await axios.post(phoneNumberApiUrl, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsAppToken}`
      }
    });
    logger.info(`Sent image to ${to}`);
    return response.data;
  } catch (error) {
    logger.error(
      `Error sendImage => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

async function sendInteractive(data) {
  try {
    const response = await axios.post(phoneNumberApiUrl, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsAppToken}`
      }
    });
    logger.info(`Sent interactive message`);
    return response.data;
  } catch (error) {
    logger.error(
      `Error sendInteractive => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

async function markMessageAsRead(phoneNumberId, messageId) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const data = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };

  try {
    const response = await axios.post(url, data, {
      headers: { 'Content-Type': 'application/json' }
    });
    logger.info(`Marked message ${messageId} as read`);
    return response.data;
  } catch (error) {
    logger.error(
      `Error markMessageAsRead => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

module.exports = {
  sendText,
  sendImage,
  sendInteractive,
  markMessageAsRead
};
