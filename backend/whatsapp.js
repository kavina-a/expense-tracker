const axios    = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const BASE_URL = () =>
  `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}`;

const authHeaders = () => ({
  Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

// ─── Send text ────────────────────────────────────────────────────────────────

async function sendMessage(to, text) {
  try {
    await axios.post(
      `${BASE_URL()}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: authHeaders() }
    );
  } catch (err) {
    console.error('[WhatsApp] Send error:', err.response?.data || err.message);
  }
}

// ─── Upload a PNG buffer → get back a media ID ────────────────────────────────

async function uploadMedia(imageBuffer, mimeType = 'image/png') {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', imageBuffer, { filename: 'chart.png', contentType: mimeType });

  const { data } = await axios.post(
    `${BASE_URL()}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        ...form.getHeaders(),
      },
    }
  );
  return data.id; // WhatsApp media ID
}

// ─── Send an already-uploaded image by its media ID ───────────────────────────

async function sendImage(to, mediaId, caption = '') {
  try {
    await axios.post(
      `${BASE_URL()}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type:  'image',
        image: { id: mediaId, caption },
      },
      { headers: authHeaders() }
    );
  } catch (err) {
    console.error('[WhatsApp] Send image error:', err.response?.data || err.message);
  }
}

// ─── Convenience: generate + upload + send in one call ───────────────────────

async function sendChartImage(to, imageBuffer, caption = '') {
  try {
    const mediaId = await uploadMedia(imageBuffer);
    await sendImage(to, mediaId, caption);
  } catch (err) {
    console.error('[WhatsApp] sendChartImage error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── Download incoming media ──────────────────────────────────────────────────

async function downloadMedia(mediaId) {
  try {
    const { data: meta } = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
    const { data } = await axios.get(meta.url, {
      headers:      { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(data), mimeType: meta.mime_type };
  } catch (err) {
    console.error('[WhatsApp] Media download error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { sendMessage, sendChartImage, downloadMedia };
