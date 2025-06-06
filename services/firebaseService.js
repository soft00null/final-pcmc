// services/firebaseService.js

const admin = require('firebase-admin');
const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '../serviceAccountKey.json';
const serviceAccount = require(serviceAccountPath);

const storageBucket = 'gs://dwellers-j829ks.appspot.com'; // or your actual bucket

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function ensureCitizenExists(phone, name) {
  const snap = await db.collection('citizen').where('Phone', '==', phone).get();
  if (snap.empty) {
    try {
      await db.collection('citizen').add({
        Phone: phone,
        Name: name,
        created_timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info(`Created new citizen doc => ${phone}`);
    } catch (error) {
      logger.error(`Error create citizen => ${error.message}`);
      throw error;
    }
  }
}

async function findInfrastructureByID(id) {
  return db.collection('infrastructure').where('ID', '==', id).get();
}

async function findActiveTickets(phone, infraId = null) {
  let query = db.collection('tickets')
    .where('citizen', '==', phone)
    .where('active', '==', true);

  if (infraId) {
    query = query.where('infrastructure', '==', infraId);
  }
  return query.orderBy('createdTime', 'desc').get();
}

async function createTicket(infrastructureId, phone, ticketID) {
  try {
    await db.collection('tickets').add({
      infrastructure: infrastructureId,
      active: true,
      createdTime: admin.firestore.FieldValue.serverTimestamp(),
      citizen: phone,
      ticketID
    });
    logger.info(`Created ticket => ${ticketID}, infra => ${infrastructureId}`);
  } catch (error) {
    logger.error(`Error createTicket => ${error.message}`);
    throw error;
  }
}

async function addMessageToThread(ticketId, messageData) {
  try {
    const threadRef = db.collection('tickets').doc(ticketId).collection('thread');
    await threadRef.add(messageData);
    logger.info(`Added message to ticket => ${ticketId}`);
  } catch (error) {
    logger.error(`Error addMessageToThread => ${error.message}`);
    throw error;
  }
}

async function getMediaUrl(mediaId, token) {
  try {
    const response = await axios.get(`https://graph.facebook.com/v16.0/${mediaId}`, {
      params: { access_token: token },
    });
    return response.data.url;
  } catch (error) {
    logger.error(`Error getMediaUrl => ${error.message}`);
    throw error;
  }
}

async function downloadAndUploadImage(mediaUrl, imageId) {
  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    const buffer = Buffer.from(response.data, 'binary');
    const file = bucket.file(`${imageId}.png`);
    await file.save(buffer);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2055'
    });
    return url;
  } catch (error) {
    logger.error(`Error uploading image => ${error.message}`);
    throw error;
  }
}

async function geocodeLocation(lat, lng, googleMapsApiKey) {
  try {
    const resp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${lat},${lng}`, key: googleMapsApiKey }
    });
    const results = resp.data.results;
    if (results && results.length > 0) {
      return results[0].formatted_address;
    }
    return 'Unknown Location';
  } catch (error) {
    logger.error(`Error geocoding => ${error.message}`);
    throw error;
  }
}

module.exports = {
  ensureCitizenExists,
  findInfrastructureByID,
  findActiveTickets,
  createTicket,
  addMessageToThread,
  getMediaUrl,
  downloadAndUploadImage,
  geocodeLocation
};
