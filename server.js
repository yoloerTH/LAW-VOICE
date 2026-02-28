import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import { DeepgramService } from './services/deepgram.js'
import { LLMService } from './services/llm.js'
import { CartesiaService } from './services/cartesia.js'
import { WebhookService } from './services/webhook.js'
import { AsyncQueue } from './utils/async-queue.js'
import { SentenceDetector } from './utils/sentence-detector.js'

dotenv.config()

const app = express()
const httpServer = createServer(app)

// Configure CORS
const allowedOrigins = [
  'https://candid-tiramisu-94f8cb.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173'
]

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      console.log('CORS blocked origin:', origin)
      callback(null, false)
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8,
  transports: ['websocket', 'polling'],
  allowEIO3: true
})

const PORT = process.env.PORT || 3001

// Middleware
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'lexflow-voice', timestamp: new Date().toISOString() })
})

// Store active sessions
const activeSessions = new Map()

// Socket.io connection handler
io.on('connection', async (socket) => {
  console.log(`Client connected: ${socket.id}`)

  let session
  try {
    session = {
      id: socket.id,
      conversationHistory: [],
      deepgram: null,
      llm: new LLMService(),
      cartesia: new CartesiaService(),
      webhook: new WebhookService(),
      isCallActive: false,
      lastActivity: Date.now()
    }
    activeSessions.set(socket.id, session)
  } catch (error) {
    console.error(`Error initializing session [${socket.id}]:`, error)
    socket.emit('error', { message: 'Server configuration error.' })
    return
  }

  // Handle call start
  socket.on('call-start', async () => {
    console.log(`Call started: ${socket.id}`)
    session.isCallActive = true

    let audioChunkCount = 0
    let audioBuffer = []
    let deepgramReady = false

    try {
      // Initialize Deepgram
      session.deepgram = new DeepgramService()

      // Transcript handling with barge-in support
      let transcriptBuffer = ''
      let isProcessing = false
      let aiSpeaking = false
      let currentPipeline = null
      let lastProcessedText = ''
      let lastTriggerTime = 0

      session.deepgram.onTranscript((data) => {
        const { text, is_final, speech_final, confidence } = data

        if (!is_final) {
          console.log(`Interim [${socket.id}]: "${text.substring(0, 50)}..." (conf: ${confidence.toFixed(2)})`)
        } else {
          console.log(`Final [${socket.id}]: "${text}"`)
        }

        // Barge-in detection
        if (aiSpeaking && text.trim().length > 5 && !text.startsWith(lastProcessedText)) {
          console.log(`BARGE-IN detected [${socket.id}]!`)

          if (currentPipeline) {
            currentPipeline.abort()
            currentPipeline = null
          }

          socket.emit('barge-in')
          aiSpeaking = false
          isProcessing = false
          transcriptBuffer = text
          lastProcessedText = ''
          lastTriggerTime = 0
          return
        }

        if (!isProcessing) {
          transcriptBuffer = text
        }

        if (isProcessing) return

        // Duplicate prevention
        const now = Date.now()
        const timeSinceLastTrigger = now - lastTriggerTime

        const normalizeText = (str) => {
          return str.trim().replace(/\.{3,}$/g, '.').replace(/[.!?]+$/g, '').toLowerCase()
        }

        const normalizedText = normalizeText(text)
        const normalizedLast = normalizeText(lastProcessedText)
        const isSameText = normalizedText === normalizedLast
        const isRapidFire = timeSinceLastTrigger < 1000

        if (isSameText || isRapidFire) return

        // Aggressive triggering
        const shouldTrigger = (
          is_final ||
          (confidence > 0.85 && speech_final) ||
          (text.length > 15 && /[.!?]$/.test(text) && confidence > 0.8)
        )

        if (shouldTrigger && transcriptBuffer.trim().length > 0) {
          isProcessing = true
          lastProcessedText = text
          lastTriggerTime = now

          console.log(`Triggering LLM (is_final: ${is_final}, conf: ${confidence.toFixed(2)})`)

          socket.emit('transcript', { text: transcriptBuffer })

          const textToProcess = transcriptBuffer
          transcriptBuffer = ''

          let aborted = false
          currentPipeline = {
            abort: () => { aborted = true },
            isAborted: () => aborted
          }

          aiSpeaking = true

          handleUserMessage(socket, session, textToProcess, currentPipeline)
            .finally(() => {
              isProcessing = false
              aiSpeaking = false
              currentPipeline = null

              if (!aborted) {
                setTimeout(() => { lastProcessedText = '' }, 2000)
              }
            })
        }
      })

      session.deepgram.onError((error) => {
        console.error(`Deepgram error [${socket.id}]:`, error)
        socket.emit('error', { message: 'Speech recognition error' })
      })

      // Start Deepgram with format options
      const audioFormat = socket.handshake.query?.audioFormat
      const deepgramOptions = audioFormat === 'pcm' ? {
        encoding: socket.handshake.query?.encoding || 'linear16',
        sample_rate: parseInt(socket.handshake.query?.sampleRate) || 16000,
        channels: parseInt(socket.handshake.query?.channels) || 1
      } : {}

      await session.deepgram.connect(deepgramOptions)

      socket.emit('status', 'Connected - Start speaking!')

      // Send greeting
      const greetingText = "Hello, I'm the LexFlow assistant. I can help you create engagement letters, check letter statuses, manage clients, and more. How can I assist you today?"
      session.conversationHistory.push({ role: 'assistant', content: greetingText })
      socket.emit('ai-response', { text: greetingText })

      // Generate greeting audio
      const greetingAudio = await session.cartesia.textToSpeech(greetingText)
      socket.emit('audio-response', greetingAudio)

      // Store audio handlers on session for the audio-stream event
      session._audioChunkCount = 0
      session._audioBuffer = []
      session._deepgramReady = false

    } catch (error) {
      console.error(`Error starting call [${socket.id}]:`, error)
      socket.emit('error', { message: 'Failed to start call' })
    }
  })

  // Handle audio stream
  socket.on('audio-stream', async (audioData) => {
    if (!session._audioChunkCount) session._audioChunkCount = 0
    session._audioChunkCount++

    if (session._audioChunkCount === 1) {
      console.log(`Receiving audio from client [${socket.id}]`)
    }

    if (session.deepgram && session.isCallActive) {
      let audioBuffer_decoded
      try {
        audioBuffer_decoded = Buffer.from(audioData, 'base64')
      } catch (error) {
        console.error(`Failed to decode audio [${socket.id}]:`, error)
        return
      }

      const connectionState = session.deepgram.getReadyState()

      if (connectionState === 1) {
        if (!session._deepgramReady && session._audioBuffer && session._audioBuffer.length > 0) {
          console.log(`Deepgram ready! Flushing ${session._audioBuffer.length} buffered chunks`)
          session._deepgramReady = true

          for (const bufferedAudio of session._audioBuffer) {
            try {
              const bufferedDecoded = Buffer.from(bufferedAudio, 'base64')
              session.deepgram.send(bufferedDecoded)
            } catch (error) {
              console.error('Error sending buffered audio:', error)
            }
          }
          session._audioBuffer = []
        }

        try {
          session.deepgram.send(audioBuffer_decoded)
        } catch (error) {
          console.error(`Error processing audio [${socket.id}]:`, error)
        }
      } else {
        if (!session._audioBuffer) session._audioBuffer = []
        session._audioBuffer.push(audioData)
        if (session._audioBuffer.length > 20) {
          session._audioBuffer.shift()
        }
      }
    }
  })

  // Handle text message (alternative to voice)
  socket.on('text-message', async ({ text }) => {
    if (!text || !text.trim()) return

    const message = text.trim()
    console.log(`Text message [${socket.id}]: "${message}"`)

    session.lastActivity = Date.now()
    socket.emit('ai-response', { text: message, partial: false, isUserMessage: true })

    await handleUserMessage(socket, session, message)
  })

  // Handle call end
  socket.on('call-end', () => {
    console.log(`Call ended: ${socket.id}`)
    session.isCallActive = false
    session.lastActivity = Date.now()

    if (session.deepgram) {
      session.deepgram.disconnect()
      session.deepgram = null
    }

    socket.emit('status', 'Call ended')
  })

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)

    if (session.deepgram) {
      session.deepgram.disconnect()
    }

    activeSessions.delete(socket.id)
  })
})

// Handle user message with pipelined streaming
async function handleUserMessage(socket, session, userMessage, pipeline = null) {
  try {
    session.conversationHistory.push({
      role: 'user',
      content: userMessage
    })

    socket.emit('status', 'AI is thinking...')

    const ttsQueue = new AsyncQueue()
    const detector = new SentenceDetector()
    let fullResponse = ''

    const ttsWorkerPromise = startTTSWorker(socket, session, ttsQueue, pipeline)

    try {
      console.log('Starting LLM stream...')
      for await (const chunk of session.llm.streamResponse(session.conversationHistory)) {
        if (pipeline && pipeline.isAborted()) {
          console.log('Pipeline aborted during LLM streaming')
          break
        }

        fullResponse += chunk

        const sentences = detector.addChunk(chunk)

        for (const sentence of sentences) {
          if (pipeline && pipeline.isAborted()) break

          console.log(`Sentence detected: "${sentence.substring(0, 50)}..."`)
          socket.emit('ai-response', { text: sentence, partial: true })
          ttsQueue.push(sentence)
        }

        if (pipeline && pipeline.isAborted()) break
      }

      // Handle remaining text
      const remainder = detector.getRemainder()
      if (remainder && remainder.length > 0 && (!pipeline || !pipeline.isAborted())) {
        fullResponse += remainder
        socket.emit('ai-response', { text: remainder, partial: true })
        ttsQueue.push(remainder)
      }

    } finally {
      ttsQueue.close()
      await ttsWorkerPromise
    }

    if (!pipeline || !pipeline.isAborted()) {
      session.conversationHistory.push({
        role: 'assistant',
        content: fullResponse
      })
      socket.emit('status', 'Listening...')
    }

  } catch (error) {
    console.error(`Error handling message [${socket.id}]:`, error)
    socket.emit('error', { message: 'Failed to generate response' })
    socket.emit('status', 'Error - Please try again')
  }
}

// TTS Worker - processes queue sequentially
async function startTTSWorker(socket, session, ttsQueue, pipeline = null) {
  let sentenceCount = 0

  try {
    for await (const sentence of ttsQueue) {
      if (pipeline && pipeline.isAborted()) {
        console.log('TTS worker aborted')
        break
      }

      if (!sentence) break

      sentenceCount++

      if (sentenceCount === 1) {
        socket.emit('status', 'AI is speaking...')
      }

      try {
        const audio = await session.cartesia.textToSpeech(sentence)

        if (pipeline && pipeline.isAborted()) break

        socket.emit('audio-response', audio)
      } catch (err) {
        console.error(`TTS error for sentence ${sentenceCount}:`, err.message)
      }
    }
  } finally {
    const status = (pipeline && pipeline.isAborted()) ? 'aborted' : 'completed'
    console.log(`TTS worker ${status} (processed ${sentenceCount} sentences)`)
  }
}

// Cleanup stale sessions every minute
setInterval(() => {
  const now = Date.now()
  activeSessions.forEach((session, socketId) => {
    if (!session.isCallActive && session.lastActivity && (now - session.lastActivity) > 30 * 60 * 1000) {
      if (session.deepgram) {
        session.deepgram.disconnect()
      }
      activeSessions.delete(socketId)
      console.log(`Cleaned stale session: ${socketId}`)
    }
  })
}, 60 * 1000)

// Start server
httpServer.listen(PORT, () => {
  console.log(`LexFlow Voice Backend running on port ${PORT}`)
  console.log(`WebSocket server ready`)
  console.log(`LLM Model: ${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}`)
  console.log(`Server ready to accept connections`)
})
