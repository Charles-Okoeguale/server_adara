const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const { spawn } = require('child_process');
require('dotenv').config();

(async () => {
    try {
        await fs.access('uploads');
    } catch {
        await fs.mkdir('uploads');
        console.log('Created uploads directory');
    }
})();


process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const allowedOrigins = [
    'https://frontend-adara.vercel.app',
    'http://localhost:3000'
];
app.use(cors({
    origin: '*',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
// app.use(cors({
//     origin: function (origin, callback) {
//       if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//         callback(null, true);
//       } else {
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     credentials: true,
//     allowedHeaders: ['Content-Type', 'Authorization']
// }));

const getPythonPath = async () => {
    try {
        const { stdout } = await execPromise('which python3.11');
        return stdout.trim();
    } catch (error) {
        console.error('Error finding Python path:', error);
        throw new Error('Python not found');
    }
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

const ensureUploadsDir = async () => {
    try {
        await fs.access('uploads');
    } catch {
        await fs.mkdir('uploads');
    }
};

ensureUploadsDir();


const fileExists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const transcribeAudio = async (inputPath, timeoutSeconds = 300) => {
    const uploadsDir = path.resolve('uploads');
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    const wavPath = path.join(uploadsDir, `${baseFileName}.wav`);
    const jsonPath = path.join(uploadsDir, `${baseFileName}.json`);
    let whisperProcess = null;

    try {
        console.log('Step 1: Getting Python path...');
        const pythonPath = await getPythonPath();
        
        console.log('Step 2: Starting WAV conversion...');
        await execPromise(`ffmpeg -i "${inputPath}" -ac 1 -ar 16000 "${wavPath}"`);
        console.log('WAV conversion complete');

        console.log('Step 3: Preparing transcription...');
        
        const transcriptionPromise = new Promise((resolve, reject) => {
            const stdout = [];
            const stderr = [];
            
            whisperProcess = spawn(pythonPath, [
                '-m',
                'whisper',
                wavPath,
                '--model',
                'tiny',
                '--output_format',
                'json',
                '--output_dir',
                uploadsDir,
                '--device',
                'cpu',
                '--threads',
                '2',
                '--temperature',
                '0',
                '--best_of',
                '1'
            ]);

            whisperProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                stdout.push(output);
                console.log('Whisper progress:', output);
            });

            whisperProcess.stderr.on('data', (data) => {
                const error = data.toString().trim();
                stderr.push(error);
                console.warn('Whisper warning:', error);
            });

            whisperProcess.on('error', (error) => {
                console.error('Whisper process error:', error);
                reject(error);
            });

            whisperProcess.on('exit', async (code) => {
                if (code === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    resolve({
                        stdout: stdout.join('\n'),
                        stderr: stderr.join('\n')
                    });
                } else {
                    reject(new Error(`Whisper process exited with code ${code}`));
                }
            });
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                if (whisperProcess) {
                    whisperProcess.kill('SIGTERM');
                }
                reject(new Error(`Transcription timed out after ${timeoutSeconds} seconds`));
            }, timeoutSeconds * 1000);
        });

        console.log('Waiting for transcription...');
        await Promise.race([transcriptionPromise, timeoutPromise]);
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('Checking for output file at:', jsonPath);
        const fileExists = await fs.access(jsonPath).then(() => true).catch(() => false);
        if (!fileExists) {
            throw new Error('Transcription output file not found');
        }

        console.log('JSON file found');
        const transcriptionData = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        return transcriptionData;

    } catch (error) {
        console.error('Transcription error:', error);
        if (whisperProcess) {
            try {
                whisperProcess.kill('SIGTERM');
            } catch (killError) {
                console.error('Error killing whisper process:', killError);
            }
        }
        throw error;
    }
};

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }

        const inputPath = req.file.path;
        console.log(inputPath, "input path")
        const transcriptionData = await transcribeAudio(inputPath);
        
        res.json({
            transcription: transcriptionData.text,
            segments: transcriptionData.segments
        });
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ 
            error: error.message, 
            stack: error.stack 
        });
    }
});

module.exports = app;

