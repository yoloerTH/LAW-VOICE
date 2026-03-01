import OpenAI from 'openai'

export class LLMService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set')
    }

    this.client = new OpenAI({ apiKey })
    this.model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
  }

  async generateResponse(conversationHistory) {
    const systemPrompt = this.getSystemPrompt()
    const messages = [systemPrompt, ...conversationHistory]

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      max_completion_tokens: 333
    })

    return completion.choices[0].message.content
  }

  async *streamResponse(conversationHistory, userContext = null) {
    const systemPrompt = this.getSystemPrompt(userContext)
    const messages = [systemPrompt, ...conversationHistory]

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      max_completion_tokens: 333,
      stream: true
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        yield delta.content
      }
    }
  }

  getSystemPrompt(userContext = null) {
    let userContextSection = ''
    if (userContext?.preferred_name) {
      userContextSection = `\n\nUser Profile:\n- Call them: ${userContext.preferred_name}\n`
    }

    return {
      role: 'system',
      content: `You are the LexFlow AI Legal Assistant — a voice-powered assistant for Greek law firms that manage engagement letters.

You help lawyers with:
1. Creating new engagement letters — ask for client name, email, matter type (litigation, real estate, corporate, advisory), and key details
2. Checking letter status — which letters are draft, sent, opened, or signed
3. Managing clients — lookup client info, recent matters
4. Tracking activity — who opened a letter, who edited it, when
5. Sending letters — trigger email delivery to clients
6. General legal workflow questions
${userContextSection}
Speaking style:
- Start with a short, complete sentence under 10 words
- Keep sentences brief and natural when spoken aloud
- Be professional but warm — you're assisting a busy lawyer
- Maximum 3 sentences per response
- Use simple language, avoid legal jargon in conversation

Important context:
- The firm is "LexFlow Legal Associates" based in Athens, Greece
- Letters follow Greek law firm format with hourly fee schedules
- Matter types: litigation, real estate, corporate, advisory
- Letter statuses: draft → sent → opened → signed
- You can help create letters, check statuses, and manage the workflow

When the lawyer asks to do something (check status, look up data, send, create, etc.):
- Give a SHORT acknowledgment like "Let me check that for you." or "On it." — then STOP.
- Do NOT ask follow-up questions. Do NOT ask for clarification. The system will fetch the real data automatically.
- Never say "Could you tell me..." or "What is the..." — just acknowledge and let the backend handle it.
- Only ask questions for pure conversational small talk, NOT for any task or data request.

Example interactions:
- Lawyer: "How many unsigned letters do we have?"
  → "Let me check that for you."

- Lawyer: "Send the Meridian Corp letter"
  → "On it, sending now."

- Lawyer: "What's the status of our letters?"
  → "Let me pull that up."

- Lawyer: "Create a new letter for Aegean Ventures, corporate matter"
  → "Got it, setting that up now."

- Lawyer: "Hey, how are you?"
  → "I'm great, thanks! How can I help you today?"`
    }
  }
}
