const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();
const OpenAI = require("openai");
const path = require('path');
const bodyParser = require('body-parser');
const upload = multer({ dest: 'uploads/' });
const { spawn } = require('child_process');
const { clear } = require('console');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors({
    origin: "*",
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Final-Chunk']
}));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

let audioChunks = []; 
let isRecordingComplete = false;

app.post('/transcribe-audio', (req, res) => {
    const audioChunks = [];
    req.setTimeout(0);
  
    const convertAudioToWav = (inputPath, outputPath) => {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(inputPath)) {
            console.log('Input file not found');
        }
            
        if (!fs.existsSync(outputPath)) {
        console.log('Output file not found');
        }
        console.log(inputPath, outputPath)
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
            '-f', 'matroska',
            '-err_detect', 'ignore_err',
            '-i', inputPath,
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            '-y', outputPath
            ]);

            ffmpeg.stdout.on('data', (data) => {
                console.log(`FFmpeg stdout: ${data}`);
            });
        
            ffmpeg.stderr.on('data', (data) => {
                console.log(`FFmpeg stderr: ${data}`);
            });
    
            ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(outputPath);
            } else {
                console.log('FFmpeg conversion failed');
                resolve(''); // Return empty result
            }
            });
    
            ffmpeg.on('error', (err) => {
            console.error('FFmpeg error:', err);
            resolve(''); // Return empty result
            });
        });
    };
  
    try {
      const isFinalChunk = req.headers['x-final-chunk'] === 'true';
  
      req.on('data', (chunk) => {
        audioChunks.push(chunk);
      });
  
      req.on('end', async () => {
        console.log('REQUEST END EVENT TRIGGERED');
  
        if (isFinalChunk) {
          const combinedAudio = Buffer.concat(audioChunks);
          const uploadDir = path.resolve(__dirname, 'uploads');
            const tempFilePath = path.join(uploadDir, `temp-audio-${uuidv4()}.webm`);
            const tempWavPath = path.join(uploadDir, `temp-audio-${uuidv4()}.wav`);
            // const tempFilePath = path.resolve(__dirname, `temp-audio-${uuidv4()}.webm`);
            // const tempWavPath = path.resolve(__dirname, `temp-audio-${uuidv4()}.wav`);
  
          try {
            fs.writeFileSync(tempFilePath, combinedAudio);
            const stats = fs.statSync(tempFilePath);
            console.log('File Write Success:', {
              size: stats.size,
              path: tempFilePath
            });
  
            if (stats.size === 0) {
              console.log('Input file is empty');
              return res.json({ text: '' });
            }
  
            const fileType = getFileType(tempFilePath);
            if (!['webm', 'audio/webm'].includes(fileType)) {
              console.log('Invalid file type');
              return res.json({ text: '' }); 
            }
  
            const wavFilePath = await convertAudioToWav(tempFilePath, tempWavPath);

            try {
              const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(wavFilePath),
                model: "whisper-1",
              });
              console.log('Transcription result:', transcription.text);
              return res.json({ text: transcription.text });
            } catch (transcriptionError) {
              console.error('Transcription error:', transcriptionError);
              return res.json({ text: '' }); 
            }
  
          } catch (writeError) {
            console.error('File Write Error:', writeError);
            return res.status(500).json({ error: 'Failed to write audio file' });
          }
        } else {
          console.log('Not final chunk, waiting for more...');
        }
      });
    } catch (error) {
      console.error('Error processing audio chunks:', error);
      return res.status(500).json({ error: 'Failed to process audio chunks' });
    }
});
  
  // Function to get file type
function getFileType(filePath) {
const fileExtension = path.extname(filePath);
const mimeType = getMimeType(fileExtension);
return mimeType;

// Map file extensions to MIME types
function getMimeType(extension) {
    switch (extension) {
    case '.webm':
        return 'audio/webm';
    default:
        return null;
    }
}
}


module.exports = app;
