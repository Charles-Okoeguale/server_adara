const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();
const OpenAI = require("openai");
const path = require('path');

const app = express();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const upload = multer({ dest: "/tmp/uploads/" });

app.use(cors({
    origin: ['https://frontend-adara.vercel.app'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.post("/transcribe-audio", upload.single("audio"), async (req, res) => {
    try {
        const originalPath = req.file.path;
        const newPath = `${originalPath}.webm`;
        await fs.promises.rename(originalPath, newPath);
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(newPath),
            model: "whisper-1",
        });
        await fs.promises.unlink(newPath);

        res.json({ text: transcription.text });
    } catch (error) {
        console.error("Error during transcription:", error);
        res.status(500).json({ error: "Failed to transcribe audio" });
    }
});

module.exports = app;
