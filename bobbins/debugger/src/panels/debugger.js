// Message storage
let messages = []
let isPaused = false
let filters = {
  events: true,
  requests: true,
  responses: true
}
let currentConfig = null

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Debugger] Panel loaded and listening for messages')
  updateUI()
  initTheme()
})

// Theme and config handling
function initTheme() {
  console.log('[Debugger] Initializing config listener')
  
  // Check if we're in an iframe and request config from parent
  if (window.parent !== window) {
    console.log('[Debugger] Requesting config from parent')
    window.parent.postMessage({
      namespace: 'SHELL',
      type: 'SHELL_CONFIG_REQUEST',
      payload: {},
      metadata: {
        source: 'debugger',
        timestamp: Date.now()
      }
    }, '*')
  }
  
  // Listen for config and theme changes from parent shell
  window.addEventListener('message', (event) => {
    const msg = event.data
    
    // Handle new message envelope format
    if (msg && msg.namespace === 'SHELL') {
      console.log('[Debugger] Received shell message:', msg.type)
      
      if (msg.type === 'SHELL_INIT') {
        console.log('[Debugger] Received initial config:', msg.payload.config)
        currentConfig = msg.payload.config
        applyTheme(msg.payload.config.theme)
      } else if (msg.type === 'SHELL_CONFIG_RESPONSE') {
        console.log('[Debugger] Received config response:', msg.payload.config)
        currentConfig = msg.payload.config
        applyTheme(msg.payload.config.theme)
      } else if (msg.type === 'SHELL_THEME_UPDATE') {
        console.log('[Debugger] Applying theme update:', msg.payload.theme)
        applyTheme(msg.payload.theme)
      }
    }
  })
}

function applyTheme(theme) {
  console.log('[Debugger] Applying theme:', theme, 'to body element')
  if (theme === 'dark') {
    document.body.classList.add('dark')
  } else {
    document.body.classList.remove('dark')
  }
  console.log('[Debugger] Body classes after theme:', document.body.className)
}

// Listen for all messages
window.addEventListener('message', (event) => {
  if (isPaused) return

  const data = event.data
  
  // Handle new message envelope format
  if (data && data.namespace && data.type && data.metadata) {
    const message = {
      timestamp: new Date().toISOString(),
      type: data.type,
      namespace: data.namespace,
      source: data.metadata.source,
      target: data.metadata.target || 'broadcast',
      topic: data.type,
      payload: data.payload,
      id: data.metadata.requestId || Date.now()
    }

    messages.unshift(message)
    
    // Keep only last 100 messages
    if (messages.length > 100) {
      messages = messages.slice(0, 100)
    }

    updateUI()
    return
  }

  // Only capture messages with our legacy bus structure
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
    if (msg.type === 'BUS_EVENT' && !filters.events) return false
    if (msg.type.includes('REQUEST') && !filters.requests) return false
    if (msg.type.includes('RESPONSE') && !filters.responses) return false
    return true
  })

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No messages (try interacting with the app)</div>'
  } else {
    container.innerHTML = filtered.map(msg => {
      // Add namespace badge if present
      const namespaceBadge = msg.namespace ? 
        `<span class="message-namespace">[${msg.namespace}]</span> ` : ''
      
      return `
      <div class="message">
        <div class="message-header">
          ${namespaceBadge}<span class="message-type">${escapeHtml(msg.type)}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        ${msg.topic ? `<div class="message-topic">Topic: ${escapeHtml(msg.topic)}</div>` : ''}
        <div class="message-source">${escapeHtml(msg.source)} → ${escapeHtml(msg.target)}</div>
        ${msg.payload ? `<div class="message-data">${escapeHtml(JSON.stringify(msg.payload, null, 2))}</div>` : ''}
      </div>
    `
    }).join('')
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
