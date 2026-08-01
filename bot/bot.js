const mineflayer = require('mineflayer')
const autoEatPlugin = require('mineflayer-auto-eat').plugin
const fs = require('fs')
const path = require('path')

const settingsPath = path.join(__dirname, '..', 'settings.json')
function loadSettings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
}

let bot = null
let timers = []
let startTime = null
let deathCount = 0
let currentActivity = 'idle'
let status = 'offline'
let manualDisconnect = false
let reconnectDelay = 5000

function log(msg) {
  // Minimal logging on purpose - keeps CPU/memory low
  console.log(`[AFKbot] ${msg}`)
}

function clearTimers() {
  timers.forEach(clearInterval)
  timers = []
}

function connect() {
  const settings = loadSettings()
  manualDisconnect = false
  status = 'connecting'

  bot = mineflayer.createBot({
    host: settings.serverIp,
    port: settings.serverPort,
    username: settings.username,
    version: false // auto-detects the server's version
  })

  bot.loadPlugin(autoEatPlugin)

  bot.once('spawn', () => {
    status = 'online'
    startTime = Date.now()
    reconnectDelay = 5000
    currentActivity = 'wandering'
    log('Spawned and online')

    bot.autoEat.options = { priority: 'foodPoints', startAt: 16, bannedFood: [] }

    const m = settings.movement

    // Simple random wander - no pathfinding, just walk forward and turn randomly
    timers.push(setInterval(() => {
      if (!bot.entity) return
      const newYaw = bot.entity.yaw + (Math.random() * 2 - 1) * (Math.PI / 2)
      bot.look(newYaw, 0, true)
      bot.setControlState('forward', true)
      currentActivity = 'wandering'
      setTimeout(() => {
        if (bot) bot.setControlState('forward', false)
      }, m.walkDurationMs)
    }, m.wanderIntervalMs))

    // Occasional sprint
    timers.push(setInterval(() => {
      if (!bot.entity) return
      bot.setControlState('sprint', true)
      currentActivity = 'sprinting'
      setTimeout(() => {
        if (bot) bot.setControlState('sprint', false)
      }, 2000)
    }, m.sprintIntervalMs))

    // Occasional crouch
    timers.push(setInterval(() => {
      if (!bot.entity) return
      bot.setControlState('sneak', true)
      currentActivity = 'crouching'
      setTimeout(() => {
        if (bot) bot.setControlState('sneak', false)
      }, 2000)
    }, m.crouchIntervalMs))

    // Occasional block placement
    timers.push(setInterval(() => {
      placeRandomBlock()
    }, m.blockPlaceIntervalMs))
  })

  bot.on('death', () => {
    deathCount++
    currentActivity = 'respawning'
    log('Died - respawning')
    bot.respawn()
  })

  bot.on('kicked', (reason) => {
    log('Kicked: ' + JSON.stringify(reason))
  })

  bot.on('error', (err) => {
    log('Error: ' + err.message)
  })

  bot.on('end', () => {
    clearTimers()
    status = 'offline'
    currentActivity = 'idle'
    if (!manualDisconnect) {
      log(`Disconnected - reconnecting in ${reconnectDelay / 1000}s`)
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 1.5, 60000)
    }
  })
}

function placeRandomBlock() {
  if (!bot || !bot.entity) return
  const item = bot.inventory.items().find(i =>
    i.name.includes('_planks') ||
    i.name.includes('cobblestone') ||
    i.name.includes('dirt') ||
    i.name.includes('stone')
  )
  if (!item) {
    currentActivity = 'wandering'
    return
  }
  bot.equip(item, 'hand').then(() => {
    const belowBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (belowBlock) {
      currentActivity = 'building'
      bot.placeBlock(belowBlock, { x: 0, y: 1, z: 0 }).catch(() => {})
    }
  }).catch(() => {})
}

function disconnect() {
  manualDisconnect = true
  clearTimers()
  if (bot) {
    try {
      if (typeof bot.quit === 'function') {
        bot.quit()
      } else if (bot._client && typeof bot._client.end === 'function') {
        bot._client.end()
      }
    } catch (e) {
      log('Error while disconnecting: ' + e.message)
    }
  }
  status = 'offline'
  currentActivity = 'idle'
}
function reconnect() {
  disconnect()
  setTimeout(connect, 1000)
}

function getState() {
  if (!bot || status === 'offline') {
    return {
      status: 'offline',
      health: 0,
      food: 0,
      position: null,
      dimension: null,
      activity: 'idle',
      uptimeMs: 0,
      deaths: deathCount,
      ping: 0,
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    }
  }
  return {
    status,
    health: bot.health || 0,
    food: bot.food || 0,
    position: bot.entity ? {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z
    } : null,
    dimension: bot.game ? bot.game.dimension : null,
    activity: currentActivity,
    uptimeMs: startTime ? Date.now() - startTime : 0,
    deaths: deathCount,
    ping: (bot.player && bot.player.ping) || 0,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  }
}

module.exports = { connect, disconnect, reconnect, getState }
