// Message storage
let messages = []
let isPaused = false
let filters = {
  events: true,
  requests: true,
  responses: true
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Debugger] Panel loaded and listening for messages')
  updateUI()
})

// Listen for all messages
window.addEventListener('message', (event) => {
  if (isPaused) return

  const data = event.data
  
  // Only capture messages with our bus structure
  if (data && data.type && data.source && data.target) {
    const message = {
      timestamp: new Date().toISOString(),
      type: data.type,
      source: data.source,
      target: data.target,
      topic: data.topic || data.type,
      payload: data.data || data.payload,
      id: data.id
    }

    messages.unshift(message)
    
    // Keep only last 100 messages
    if (messages.length > 100) {
      messages = messages.slice(0, 100)
    }

    updateUI()
  }
})

function updateUI() {
  const container = document.getElementById('messages')
  const filtered = messages.filter(msg => {
    if (msg.type === 'bus:event' && !filters.events) return false
    if (msg.type.includes('request') && !filters.requests) return false
    if (msg.type.includes('response') && !filters.responses) return false
    return true
  })

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No messages (try interacting with the app)</div>'
  } else {
    container.innerHTML = filtered.map(msg => `
      <div class="message">
        <div class="message-header">
          <span class="message-type">${escapeHtml(msg.type)}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        ${msg.topic ? `<div class="message-topic">Topic: ${escapeHtml(msg.topic)}</div>` : ''}
        <div class="message-source">${escapeHtml(msg.source)} → ${escapeHtml(msg.target)}</div>
        ${msg.payload ? `<div class="message-data">${escapeHtml(JSON.stringify(msg.payload, null, 2))}</div>` : ''}
      </div>
    `).join('')
  }

  // Update stats
  document.getElementById('messageCount').textContent = `${messages.length} messages`
  document.getElementById('status').textContent = isPaused ? 'Paused' : 'Listening'
}

function clearMessages() {
  messages = []
  updateUI()
}

function togglePause() {
  isPaused = !isPaused
  document.getElementById('pauseText').textContent = isPaused ? 'Resume' : 'Pause'
  updateUI()
}

function updateFilters() {
  filters.events = document.getElementById('filterEvents').checked
  filters.requests = document.getElementById('filterRequests').checked
  filters.responses = document.getElementById('filterResponses').checked
  updateUI()
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
