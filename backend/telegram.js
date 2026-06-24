const axios = require('axios');
require('dotenv').config();

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ─── Send text ────────────────────────────────────────────────────────────────

async function sendMessage(chatId, text) {
  try {
    await axios.post(`${BASE()}/sendMessage`, {
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('[Telegram] Send error:', err.response?.data || err.message);
  }
}

// ─── Send a chart image (PNG buffer) ─────────────────────────────────────────

async function sendChartImage(chatId, imageBuffer, caption = '') {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', imageBuffer, { filename: 'chart.png', contentType: 'image/png' });
    if (caption) form.append('caption', caption);

    await axios.post(`${BASE()}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
  } catch (err) {
    console.error('[Telegram] Send photo error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── Download a photo sent by the user ───────────────────────────────────────

async function downloadMedia(fileId) {
  try {
    const { data: fileInfo } = await axios.get(`${BASE()}/getFile?file_id=${fileId}`);
    const filePath = fileInfo.result.file_path;
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    return { buffer: Buffer.from(data), mimeType: 'image/jpeg' };
  } catch (err) {
    console.error('[Telegram] Download error:', err.response?.data || err.message);
    return null;
  }
}

// ─── Register webhook with Telegram ──────────────────────────────────────────

async function registerWebhook(webhookUrl) {
  const { data } = await axios.post(`${BASE()}/setWebhook`, {
    url:          webhookUrl,
    secret_token: process.env.TELEGRAM_SECRET_TOKEN || '',
    allowed_updates: ['message'],
  });
  return data;
}

module.exports = { sendMessage, sendChartImage, downloadMedia, registerWebhook };
