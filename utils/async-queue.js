/**
 * AsyncQueue - Non-blocking queue for pipeline processing
 * Allows producer (LLM) to continue without waiting for consumer (TTS)
 */

export class AsyncQueue {
  constructor() {
    this.queue = []
    this.waiting = []
    this.closed = false
  }

  push(item) {
    if (this.closed) {
      console.warn('AsyncQueue: Attempted to push to closed queue')
      return
    }

    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()
      resolve({ value: item, done: false })
    } else {
      this.queue.push(item)
    }
  }

  async next() {
    if (this.queue.length > 0) {
      return { value: this.queue.shift(), done: false }
    }

    if (this.closed) {
      return { done: true }
    }

    return new Promise(resolve => {
      this.waiting.push(resolve)
    })
  }

  close() {
    this.closed = true
    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift()
      resolve({ done: true })
    }
  }

  clear() {
    this.queue = []
    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift()
      resolve({ done: true })
    }
  }

  size() {
    return this.queue.length
  }

  isEmpty() {
    return this.queue.length === 0 && this.waiting.length === 0
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const result = await this.next()
      if (result.done) break
      yield result.value
    }
  }
}
