import fetch from 'node-fetch'

export class CartesiaService {
  constructor() {
    this.apiKey = process.env.CARTESIA_API_KEY
    if (!this.apiKey) {
      throw new Error('CARTESIA_API_KEY is not set')
    }

    this.apiUrl = 'https://api.cartesia.ai/tts/bytes'
    this.voiceId = process.env.CARTESIA_VOICE_ID || 'e07c00bc-4134-4eae-9ea4-1a55fb45746b'
  }

  async textToSpeech(text) {
    try {
      console.log('Generating speech with Cartesia...')

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2025-04-16',
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_id: 'sonic-3',
          transcript: text,
          voice: {
            mode: 'id',
            id: this.voiceId
          },
          output_format: {
            container: 'wav',
            encoding: 'pcm_s16le',
            sample_rate: 44100
          }
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Cartesia API error (${response.status}): ${errorText}`)
      }

      const audioBuffer = await response.arrayBuffer()
      const base64Audio = Buffer.from(audioBuffer).toString('base64')

      console.log(`Cartesia audio generated: ${text.substring(0, 50)}...`)
      return base64Audio

    } catch (error) {
      console.error('Cartesia error:', error.message)
      throw error
    }
  }
}
