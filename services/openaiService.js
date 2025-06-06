// services/openaiService.js

const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');
const FormData = require('form-data');

const knowledgeBase = require('../knowledgeBase');

const openAiKey = process.env.OPENAI_API_KEY || '';

const openai = axios.create({
  baseURL: 'https://api.openai.com/v1',
  headers: {
    Authorization: `Bearer ${openAiKey}`,
  },
});

/**
 * answerZPKnowledgeBase:
 *   Provide a short, natural answer from the knowledge base, in user’s language
 */
async function answerZPKnowledgeBase(query, language) {
  try {
    const systemPrompt = `
You are a ZP Pune chatbot with a knowledge base about ZP Pune and government schemes.
Use the provided JSON knowledge to answer user queries in a short, friendly manner.
Knowledge Base (in JSON):
${JSON.stringify(knowledgeBase)}

User language: ${language}.
If language = 'Marathi', answer in Marathi only.
If language = 'English', answer in English only.

If question not found in knowledge, respond politely that you don't have info but will find out.
Keep the response short and natural.
`;

    const userMsg = query;

    const response = await openai.post('/chat/completions', {
      model: 'gpt-4o', // or gpt-4o-mini
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userMsg
        }
      ],
      max_tokens: 300,
      temperature: 0.4,
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      `OpenAI answerZPKnowledgeBase error => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

/**
 * getDepartment => recognized department or SMALL_TALK or Irrelevant
 */
async function getDepartment(msg) {
  try {
    const response = await openai.post('/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `
You are a  ZP Pune chatbot.  Government related infrastructure or services
Possible dept: [Education, Primary School, Hospital, RTO, Irrigation, Water Conservation, Administration,
 Anti Corruption, NHAI, MSRCD, MMRDA, Metro, CIDCO, Housing, MHADA, Aadhaar, PDS,
 Food & Civil Supplies, Environment, Police, Fire, Water Supply, Sewage, Encroachment,
 EGS, MGNREGA, Energy, Electricity Board, Public Works, Roads, Street Light,
 Waste Management, Drainage, Agriculture, Animal Husbandry, Health, Garden & Tree,
 Property Tax, Politician Bribe, etc.].
If user text is small talk or greeting, respond "SMALL_TALK".
Otherwise if it's about these depts, respond exactly dept name, else "Irrelevant".
`
        },
        { role: 'user', content: msg }
      ],
      max_tokens: 300,
      temperature: 0.2
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      `OpenAI getDepartment error => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

/**
 * transcribeAudio => uses Whisper
 */
async function transcribeAudio(localFilePath) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(localFilePath));
    formData.append('model', 'whisper-1');

    const response = await openai.post('/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    return response.data.text;
  } catch (error) {
    logger.error(
      `OpenAI transcribeAudio => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

/**
 * analyzeAudio => if city complaint => single line, else "Irrelevant"
 */
async function analyzeAudio(audioTranscript) {
  try {
    const response = await openai.post('/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `
You are a bilingual ZP Pune chatbot analyzing audio transcript. If user text is small talk or greeting, respond "SMALL_TALK".
If there's a complaint about Government related infrastructure or services => single line complaint, else "Irrelevant".
`
        },
        {
          role: 'user',
          content: audioTranscript
        }
      ],
      max_tokens: 300,
      temperature: 0.3
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      `OpenAI analyzeAudio => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

/**
 * analyzeImage => single line municipal complaint or "Irrelevant"
 */
async function analyzeImage(imageUrl) {
  try {
    const response = await openai.post('/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Write a single-sentence complaint about a Government related infrastructure or services issue in this image, or "Irrelevant".'
            },
            {
              type: 'image_url',
              image_url: { url: `${imageUrl}` }
            }
          ]
        }
      ],
      max_tokens: 300
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      `OpenAI analyzeImage => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

/**
 * parseLocationInQuery => recognized location or 'NO_LOCATION'
 */
async function parseLocationInQuery(msg) {
  try {
    const response = await openai.post('/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `
You are a bilingual location extraction system for ZP Pune.
Return recognized location if present, else 'NO_LOCATION'.
`
        },
        {
          role: 'user',
          content: msg
        }
      ],
      max_tokens: 300,
      temperature: 0.3
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      `OpenAI parseLocationInQuery => ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw error;
  }
}

module.exports = {
  answerZPKnowledgeBase,
  getDepartment,
  transcribeAudio,
  analyzeAudio,
  analyzeImage,
  parseLocationInQuery
};
