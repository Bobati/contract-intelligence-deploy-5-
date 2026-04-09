import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables - try .env first, then .env.local
const envPath = path.join(__dirname, '.env');
const envLocalPath = path.join(__dirname, '.env.local');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

console.log('=== API Server Starting ===');
console.log('Gemini_API_KEY loaded:', process.env.Gemini_API_KEY ? 'YES ✓' : 'NO ✗');
console.log('Env Path Used:', fs.existsSync(envPath) ? '.env' : fs.existsSync(envLocalPath) ? '.env.local' : 'NONE');
console.log('============================');

const app = express();
app.use(cors());
app.use(express.json());

// Import API handler
import chatHandler from './api/chat.js';

// API routes
app.post('/api/chat', async (req, res) => {
  try {
    await chatHandler(req, res);
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fetch-url', async (req, res) => {
  try {
    const url = req.body.url;
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }
    const response = await fetch(url);
    const text = await response.text();
    res.json({ content: text });
  } catch (error) {
    console.error('Fetch URL error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});