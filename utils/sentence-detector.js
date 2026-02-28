/**
 * Sentence Boundary Detection Utility with Failsafes
 * Detects complete sentences in streaming text for real-time TTS generation
 */

export class SentenceDetector {
  constructor() {
    this.buffer = ''
    this.completeSentences = []
    this.sentenceEnders = /[.!?]+/
    this.minSentenceLength = 10
    this.maxBufferLength = 100
    this.maxWaitTime = 2000
    this.lastFlush = Date.now()
  }

  addChunk(chunk) {
    this.buffer += chunk
    const sentences = this.extractSentences()
    return sentences
  }

  extractSentences() {
    const sentences = []

    let match
    const regex = new RegExp(this.sentenceEnders, 'g')
    let lastIndex = 0

    while ((match = regex.exec(this.buffer)) !== null) {
      const endIndex = match.index + match[0].length
      const sentence = this.buffer.substring(lastIndex, endIndex).trim()

      if (sentence.length >= this.minSentenceLength) {
        sentences.push(sentence)
        lastIndex = endIndex
        this.lastFlush = Date.now()
      }
    }

    if (lastIndex > 0) {
      this.buffer = this.buffer.substring(lastIndex).trim()
    }

    if (this.buffer.length > this.maxBufferLength) {
      if (this.buffer.trim().length >= this.minSentenceLength) {
        console.log(`Warning: Sentence detector length failsafe triggered (${this.buffer.length} chars)`)
        sentences.push(this.buffer.trim())
        this.buffer = ''
        this.lastFlush = Date.now()
      }
    }

    const timeSinceLastFlush = Date.now() - this.lastFlush
    if (timeSinceLastFlush > this.maxWaitTime && this.buffer.length >= this.minSentenceLength) {
      console.log(`Warning: Sentence detector time failsafe triggered (${timeSinceLastFlush}ms)`)
      sentences.push(this.buffer.trim())
      this.buffer = ''
      this.lastFlush = Date.now()
    }

    return sentences
  }

  getRemainder() {
    const remainder = this.buffer.trim()
    this.buffer = ''
    return remainder
  }

  reset() {
    this.buffer = ''
    this.completeSentences = []
  }

  hasIncomplete() {
    return this.buffer.trim().length > 0
  }
}
