import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'

export class DeepgramService {
  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY
    if (!this.apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not set')
    }

    this.client = createClient(this.apiKey)
    this.connection = null
    this.transcriptCallback = null
    this.errorCallback = null
    this.audioSent = false
  }

  async connect(options = {}) {
    try {
      console.log('Connecting to Deepgram...')

      const config = {
        model: 'nova-3',
        language: 'en',
        punctuate: true,
        smart_format: true,
        vad_events: true,
        interim_results: true,
        endpointing: 300,
        encoding: options.encoding || 'linear16',
        sample_rate: options.sample_rate || 16000,
        channels: options.channels || 1
      }

      this.connection = this.client.listen.live(config)

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('Deepgram connection opened successfully')
      })

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        try {
          const transcript = data.channel?.alternatives?.[0]?.transcript

          if (transcript && transcript.trim() !== '') {
            if (this.transcriptCallback) {
              this.transcriptCallback({
                text: transcript,
                is_final: data.is_final,
                speech_final: data.speech_final,
                confidence: data.channel?.alternatives?.[0]?.confidence || 0
              })
            }
          }
        } catch (error) {
          console.error('Error processing transcript:', error)
        }
      })

      this.connection.on(LiveTranscriptionEvents.Error, (error) => {
        console.error('Deepgram WebSocket error:', error)
        if (this.errorCallback) {
          this.errorCallback(error)
        }
      })

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('Deepgram connection closed')
      })

      await Promise.race([
        new Promise((resolve, reject) => {
          const openHandler = () => {
            this.connection.off(LiveTranscriptionEvents.Error, errorHandler)
            resolve()
          }
          const errorHandler = (error) => {
            this.connection.off(LiveTranscriptionEvents.Open, openHandler)
            reject(error)
          }

          this.connection.once(LiveTranscriptionEvents.Open, openHandler)
          this.connection.once(LiveTranscriptionEvents.Error, errorHandler)
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Deepgram connection timeout after 10s')), 10000)
        )
      ])

      console.log('Deepgram connection established successfully')

    } catch (error) {
      console.error('Failed to connect to Deepgram:', error)
      throw new Error(`Deepgram connection failed: ${error.message || 'Unknown error'}`)
    }
  }

  getReadyState() {
    return this.connection ? this.connection.getReadyState() : -1
  }

  send(audioData) {
    try {
      if (this.connection && this.connection.getReadyState() === 1) {
        this.connection.send(audioData)
        if (!this.audioSent) {
          console.log('Started sending audio to Deepgram')
          this.audioSent = true
        }
      } else {
        console.warn('Deepgram connection not ready, state:', this.connection?.getReadyState())
      }
    } catch (error) {
      console.error('Error sending audio to Deepgram:', error)
    }
  }

  disconnect() {
    try {
      if (this.connection) {
        console.log('Disconnecting from Deepgram...')
        this.connection.finish()
        this.connection = null
      }
    } catch (error) {
      console.error('Error disconnecting from Deepgram:', error)
    }
  }

  onTranscript(callback) {
    this.transcriptCallback = callback
  }

  onError(callback) {
    this.errorCallback = callback
  }
}
