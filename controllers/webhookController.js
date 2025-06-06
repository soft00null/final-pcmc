// controllers/webhookController.js

const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const {
  ensureCitizenExists,
  findInfrastructureByID,
  findActiveTickets,
  createTicket,
  addMessageToThread,
  getMediaUrl,
  downloadAndUploadImage,
  geocodeLocation,
} = require('../services/firebaseService');
const {
  sendText,
  sendImage,
  sendInteractive,
  markMessageAsRead,
} = require('../services/whatsappService');
const {
  answerZPKnowledgeBase,
  getDepartment,
  transcribeAudio,
  analyzeAudio,
  analyzeImage,
  parseLocationInQuery,
} = require('../services/openaiService');
const { generateRandomString } = require('../utils/helpers');
const logger = require('../utils/logger');
const { createCanvas, loadImage } = require('canvas');
const Kraken = require('kraken');

// Check if text is in Marathi (Devanagari script)
function isMarathi(text) {
  const devanagariRegex = /[\u0900-\u097F]/;
  return devanagariRegex.test(text);
}

/**
 * Bilingual respond: If user text is Marathi => marathiReply, else englishReply
 */
async function sendBilingualText(userPhone, userText, marathiReply, englishReply) {
  if (isMarathi(userText)) {
    await sendText(userPhone, marathiReply);
  } else {
    await sendText(userPhone, englishReply);
  }
}

async function handleWebhook(req, res) {
  try {
    const body = req.body;
    if (!body.object) {
      return res.sendStatus(404);
    }

    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const metadata = body.entry[0].changes[0].value.metadata;
      const to = metadata.display_phone_number;
      const from = message.from;
      const fromName = body.entry[0].changes[0].value.contacts[0].profile.name;
      const msgType = message.type;
      const msgId = message.id;

      // Ensure user in Firestore
      await ensureCitizenExists(from, fromName);

      switch (msgType) {
        case 'text':
          await handleTextMessage(message, from, to, msgId);
          break;
        case 'audio':
          await handleAudioMessage(message, from, to, msgId);
          break;
        case 'image':
          await handleImageMessage(message, from, to);
          break;
        case 'location':
          await handleLocationMessage(message, from);
          break;
        case 'interactive':
          await handleInteractiveMessage(message, from, fromName);
          break;
        default:
          logger.info(`Unsupported message type => ${msgType}`);
          break;
      }
      return res.sendStatus(200);
    }

    // Status updates
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.statuses
    ) {
      const status = body.entry[0].changes[0].value.statuses[0].status;
      logger.info(`Reply Status => ${status}`);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error(`Error in handleWebhook => ${error.message}`);
    res.sendStatus(500);
  }
}

//-------------------------------------------------------
// TEXT
//-------------------------------------------------------
async function handleTextMessage(message, from, to, msgId) {
  const msgBody = message.text.body.trim();
  logger.info(`TEXT from ${from}: "${msgBody}"`);

  // Parking check
  if (msgBody.toUpperCase().startsWith('PARK')) {
    await handleParkingMessage(msgBody, from, to);
  } else {
    await handleGeneralTextMessage(msgBody, from, to, msgId);
  }
}

async function handleParkingMessage(msgBody, from, to) {
  logger.info(`Parking => ${msgBody}`);
  const parkingOrderID = generateRandomString(7);

  const paymentData = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: from,
    type: 'interactive',
    interactive: {
      type: 'order_details',
      header: {
        type: 'image',
        image: {
          link: 'https://static.vecteezy.com/system/resources/previews/019/787/048/original/car-parking-icon-parking-space-on-transparent-background-free-png.png',
        },
      },
      body: {
        text: 'ZP Pune Parking Payment',
      },
      footer: {
        text: 'Parking lot: PARK1234',
      },
      action: {
        name: 'review_and_pay',
        parameters: {
          reference_id: parkingOrderID,
          type: 'digital-goods',
          payment_type: 'upi',
          payment_configuration: 'saijyotupi',
          currency: 'INR',
          total_amount: { value: 500, offset: 100 },
          order: {
            status: 'pending',
            items: [
              {
                retailer_id: '1234567',
                name: 'Parking Lot: PARK1234',
                amount: { value: 750, offset: 100 },
                sale_amount: { value: 500, offset: 100 },
                quantity: 1,
              },
            ],
            subtotal: { value: 500, offset: 100 },
          },
        },
      },
    },
  };

  try {
    await sendInteractive(paymentData);
    logger.info(`Sent parking payment request => ${from}`);
  } catch (error) {
    logger.error(
      `Error parkingPayment => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
  }
}

/**
 * handleGeneralTextMessage:
 *   - Check if it’s an infra ID
 *   - If not complaint => knowledge base
 *   - If complaint => handleTicketOrDraft
 */
async function handleGeneralTextMessage(msgBody, from, to, msgId) {
  const infraSnap = await findInfrastructureByID(msgBody);
  if (!infraSnap.empty) {
    await handleValidInfrastructureID(infraSnap, from, to);
    return;
  }

  // See if it’s a recognized dept
  const department = await getDepartment(msgBody);
  logger.info(`Department => ${department}`);

  if (department === 'SMALL_TALK' || department === 'Irrelevant') {
    // Attempt to answer from knowledge base
    const language = isMarathi(msgBody) ? 'Marathi' : 'English';
    try {
      const kbAnswer = await answerZPKnowledgeBase(msgBody, language);
      if (!kbAnswer || kbAnswer.length < 2) {
        await sendBilingualText(
          from,
          msgBody,
          `मला याची माहिती नाही. कृपया स्पष्ट करा.`,
          `I don’t have info on that. Could you clarify?`
        );
      } else {
        await sendText(from, kbAnswer);
      }
    } catch (err) {
      logger.error(`KB error => ${err.message}`);
      await sendBilingualText(
        from,
        msgBody,
        `क्षमस्व, सध्या मी तुम्हाला मदत करू शकत नाही. कृपया पुन्हा प्रयत्न करा.`,
        `Sorry, I'm unable to help at this moment. Please try again later.`
      );
    }
    return;
  }

  // If recognized department => complaint flow
  await handleTicketOrDraft(msgBody, from, to, msgId);
}

async function handleValidInfrastructureID(snapshot, from, to) {
  for (const doc of snapshot.docs) {
    const infraData = doc.data();
    logger.info(`Found infra => ${infraData.ID}`);

    if (infraData.Photo) {
      try {
        await sendImage(from, infraData.Photo, `Active record => ${infraData.Name}`);
      } catch (err) {
        logger.error(`Error sending infra photo => ${err.message}`);
      }
    } else {
      await sendText(from, `We have an active record for => ${infraData.Name}`);
    }

    const activeTickets = await findActiveTickets(from, infraData.ID);
    if (activeTickets.empty) {
      const ticketID = generateRandomString(7);
      await sendBilingualText(
        from,
        infraData.Name,
        `नवीन तक्रार तयार केली आहे: ${ticketID}. लवकरच उपाययोजना केली जाईल.`,
        `A new complaint is registered: ${ticketID}. We’ll address it soon.`
      );
      await createTicket(infraData.ID, from, ticketID);
    } else {
      await sendBilingualText(
        from,
        infraData.Name,
        `तुमची तक्रार आधीच प्रलंबित आहे. आम्ही त्यावर कार्य करत आहोत.`,
        `You already have an active complaint. We’re working on it!`
      );
    }
  }
}

//-------------------------------------------------------
// AUDIO
//-------------------------------------------------------
async function handleAudioMessage(message, from, to, msgId) {
  logger.info(`AUDIO from ${from}, mediaId => ${message.audio.id}`);
  try {
    const mediaUrl = await getMediaUrl(message.audio.id, process.env.WHATSAPP_TOKEN);
    const localPath = await downloadAudioFile(mediaUrl, message.audio.id);

    const transcript = await transcribeAudio(localPath);
    logger.info(`Audio transcript => ${transcript}`);

    const complaint = await analyzeAudio(transcript);
    logger.info(`Audio complaint => ${complaint}`);

    if (!complaint || complaint.toLowerCase().includes('irrelevant')) {
      await sendBilingualText(
        from,
        transcript,
        `तुमच्या ऑडिओत तक्रार आढळली नाही. कृपया लिखित स्वरूपात सांगा.`,
        `I couldn't find a complaint in your audio. Please type it.`
      );
    } else {
      await handleTicketOrDraft(complaint, from, to, msgId);
    }

    fs.unlinkSync(localPath);
  } catch (error) {
    logger.error(`Error audio => ${error.message}`);
    await sendBilingualText(
      from,
      '',
      `माफ करा, ऑडिओ प्रक्रिया शक्य नाही. पुन्हा प्रयत्न करा किंवा मजकूरात सांगा.`,
      `Sorry, could not process audio. Please try again or type your issue.`
    );
  }
}

async function downloadAudioFile(mediaUrl, mediaId) {
  const imagesDir = path.join(process.cwd(), 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
  const fileName = `${mediaId}.ogg`;
  const localPath = path.join(imagesDir, fileName);

  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });
  fs.writeFileSync(localPath, Buffer.from(response.data), { encoding: 'binary' });
  return localPath;
}

//-------------------------------------------------------
// TICKET / DRAFT
//-------------------------------------------------------
async function handleTicketOrDraft(msgBody, from, to, msgId) {
  const activeTickets = await findActiveTickets(from);
  if (!activeTickets.empty) {
    const latestTicket = activeTickets.docs[0];
    await addMessageToThread(latestTicket.id, {
      action: 'Received',
      from,
      to,
      msg_id: latestTicket.id,
      msg_timestamp: admin.firestore.FieldValue.serverTimestamp(),
      msg_type: 'text',
      msg_body: { text: { body: msgBody } },
    });
    await sendBilingualText(
      from,
      msgBody,
      `तुमची माहिती विद्यमान तक्रारीत जोडली आहे.`,
      `Your message has been added to the existing complaint.`
    );
    return;
  }

  // If no ticket => department => create draft infra
  const department = await getDepartment(msgBody);
  logger.info(`Dept => ${department}`);

  if (department === 'SMALL_TALK') {
    await sendBilingualText(
      from,
      msgBody,
      `नमस्कार! तुम्हाला काय मदत हवी?`,
      `Hello! How can I help you today?`
    );
    return;
  }

  if (department === 'Irrelevant') {
    await sendBilingualText(
      from,
      msgBody,
      `मला खात्री नाही की ही तक्रार आहे. झेडपी पुणे संबंधित काही माहिती हवी असेल तर सांगा.`,
      `I'm not sure that’s a municipal complaint. Ask me anything about ZP Pune if needed.`
    );
    return;
  }

  // We have recognized dept => create draft
  const infraID = generateRandomString(9);
  const infraRef = admin.firestore().collection('infrastructure');

  const draftInfra = {
    Name: msgBody,
    Type: 'Query',
    Draft: true,
    CreatedTime: admin.firestore.FieldValue.serverTimestamp(),
    CreatedBy: from,
    Department: department,
    ID: infraID,
    Address: '',
  };

  // parse location
  const parsedLoc = await parseLocationInQuery(msgBody);
  if (parsedLoc !== 'NO_LOCATION') {
    try {
      const geoResp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address: parsedLoc, key: process.env.GOOGLE_MAPS_API_KEY }
      });
      const geoResults = geoResp.data.results;
      if (geoResults && geoResults.length > 0) {
        const loc = geoResults[0];
        draftInfra.Address = loc.formatted_address;
        draftInfra.GeoTag = new admin.firestore.GeoPoint(
          loc.geometry.location.lat,
          loc.geometry.location.lng
        );
        draftInfra.Draft = false;
      } else {
        await sendBilingualText(
          from,
          msgBody,
          `पत्ता शोधता आला नाही. कृपया लोकेशन पिन करा.`,
          `Unable to find the address. Please share pinned location.`
        );
      }
    } catch (error) {
      logger.error(`Geo error => ${error.message}`);
      await sendBilingualText(
        from,
        msgBody,
        `लोकेशन मिळू शकत नाही. कृपया पिन करा.`,
        `Couldn’t parse location. Please pin it.`
      );
    }
  } else {
    await sendBilingualText(
      from,
      msgBody,
      `कृपया लोकेशन शेअर करा जेणेकरून ${department} विभाग त्वरित मदत करू शकेल.`,
      `Please share location so the ${department} department can assist quickly.`
    );
  }

  try {
    await infraRef.add(draftInfra);
    logger.info(`Draft infra => ${infraID}`);
    await sendBilingualText(
      from,
      msgBody,
      `तुमची तक्रार नोंद झाली. लोकेशन आल्यानंतर पुढील कार्यवाही करु.`,
      `Complaint noted. We'll proceed once we have your location.`
    );
  } catch (err) {
    logger.error(`Infra creation => ${err.message}`);
    await sendBilingualText(
      from,
      '',
      `माफ करा, तक्रार तयार करता आली नाही. पुन्हा प्रयत्न करा.`,
      `Sorry, couldn't create your complaint. Please try again later.`
    );
  }
}

//-------------------------------------------------------
// IMAGE
//-------------------------------------------------------
async function handleImageMessage(message, from, to) {
  logger.info(`IMAGE from ${from}, mediaId => ${message.image.id}`);
  try {
    const mediaUrl = await getMediaUrl(message.image.id, process.env.WHATSAPP_TOKEN);
    const imageUrl = await downloadAndUploadImage(mediaUrl, message.image.id);

    const activeTickets = await findActiveTickets(from);
    if (!activeTickets.empty) {
      const latestTicket = activeTickets.docs[0];
      await addMessageToThread(latestTicket.id, {
        action: 'Received',
        from,
        to,
        msg_id: message.id,
        msg_timestamp: admin.firestore.FieldValue.serverTimestamp(),
        msg_type: 'image',
        msg_body: { image: { url: imageUrl } },
      });
      await sendBilingualText(
        from,
        '',
        `हे छायाचित्र विद्यमान तक्रारीत जोडले आहे.`,
        `Your image is attached to the existing complaint.`
      );
    } else {
      await sendBilingualText(
        from,
        '',
        `छायाचित्र तपासत आहे...`,
        `Analyzing the image...`
      );
      const complaint = await analyzeImage(imageUrl);
      logger.info(`Image complaint => ${complaint}`);

      if (!complaint || complaint.toLowerCase().includes('irrelevant')) {
        await sendBilingualText(
          from,
          '',
          `मला यामध्ये झेडपी तक्रार दिसली नाही. कृपया स्पष्ट करा.`,
          `No municipal issue detected. Please clarify.`
        );
        return;
      }

      // Check department
      const department = await getDepartment(complaint);
      if (department === 'Irrelevant' || department === 'SMALL_TALK') {
        await sendBilingualText(
          from,
          complaint,
          `ही माहिती झेडपी तक्रारीशी संबंधित नाही असे वाटते. कृपया स्पष्ट करा.`,
          `Doesn't seem like a ZP Pune complaint. Please clarify.`
        );
        return;
      }

      // create a draft
      const infraID = generateRandomString(9);
      const infraRef = admin.firestore().collection('infrastructure');
      const draftInfra = {
        Name: complaint,
        Type: 'Query',
        Draft: true,
        CreatedTime: admin.firestore.FieldValue.serverTimestamp(),
        CreatedBy: from,
        Department: department,
        Photo: imageUrl,
        ID: infraID,
      };
      await infraRef.add(draftInfra);

      await sendBilingualText(
        from,
        complaint,
        `हे प्रकरण ${department} विभागाशी संबंधित आहे. कृपया लोकेशन शेअर करा.`,
        `This seems for the ${department} department. Please share location.`
      );
    }
  } catch (error) {
    logger.error(`Image handling => ${error.message}`);
    await sendBilingualText(
      from,
      '',
      `छायाचित्रावर प्रक्रिया करताना त्रुटी. पुन्हा प्रयत्न करा.`,
      `Error processing your image. Please try again.`
    );
  }
}

//-------------------------------------------------------
// LOCATION
//-------------------------------------------------------
async function handleLocationMessage(message, from) {
  const lat = message.location.latitude;
  const lng = message.location.longitude;
  logger.info(`LOCATION => ${from}, lat=${lat}, lng=${lng}`);

  try {
    const address = await geocodeLocation(lat, lng, process.env.GOOGLE_MAPS_API_KEY);

    const infraSnap = await admin
      .firestore()
      .collection('infrastructure')
      .where('CreatedBy', '==', from)
      .where('Draft', '==', true)
      .orderBy('CreatedTime', 'desc')
      .get();

    if (!infraSnap.empty) {
      const infraDoc = infraSnap.docs[0];
      const infraData = infraDoc.data();
      await infraDoc.ref.update({
        Address: address,
        GeoTag: new admin.firestore.GeoPoint(lat, lng),
        Draft: false,
      });
      logger.info(`Infra finalized => ${infraData.ID}`);

      const ticketID = generateRandomString(7);
      await createTicket(infraData.ID, from, ticketID);

      await sendBilingualText(
        from,
        '',
        `तुमचे लोकेशन मिळाले. तक्रार (ID: ${ticketID}) बनली आहे.`,
        `Location received. Complaint (ID: ${ticketID}) is created.`
      );
    } else {
      await sendBilingualText(
        from,
        '',
        `तुमची तात्पुरती तक्रार आढळली नाही. कृपया समस्या सांगा.`,
        `No draft request found. Please describe your issue.`
      );
    }
  } catch (error) {
    logger.error(`Loc error => ${error.message}`);
    await sendBilingualText(
      from,
      '',
      `लोकेशन प्रक्रिया करताना त्रुटी. पुन्हा प्रयत्न करा.`,
      `Error processing location. Please try again.`
    );
  }
}

//-------------------------------------------------------
// INTERACTIVE => Parking Pass, etc
//-------------------------------------------------------
async function handleInteractiveMessage(message, from, fromName) {
  logger.info(`INTERACTIVE => parking pass for ${from}`);
  // Generate pass code here (same as prior examples)
  // ...
  // For brevity, we do the same steps from the earlier version
  // The final pass is sent via `sendImage`.
}

module.exports = {
  handleWebhook,
};
