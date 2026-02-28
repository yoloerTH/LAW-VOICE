import axios from 'axios'

export class WebhookService {
  constructor() {
    // LexFlow chat agent webhook (same as the web UI chat)
    this.chatWebhookUrl = process.env.N8N_CHAT_WEBHOOK_URL || 'https://n8nsaved-production.up.railway.app/webhook/Hackathon'

    console.log('LexFlow Chat Webhook URL:', this.chatWebhookUrl)
  }

  async sendChatMessage(message, sessionId) {
    try {
      console.log('Sending voice message to n8n:', { sessionId, message: message.substring(0, 100) })

      const response = await axios.post(this.chatWebhookUrl, {
        sessionId: sessionId,
        message: message,
        source: 'voice',
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      })

      console.log('Message sent to n8n successfully')
      return { success: true, data: response.data }

    } catch (error) {
      console.error('Failed to send message to n8n:', error.message)
      throw new Error('Failed to send message')
    }
  }
}
