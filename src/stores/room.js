import * as Y from 'yjs'
import { generateId, generateRoomId, electCaptains, divideTeams } from '../utils/algorithm.js'

// Yjs 文档和共享类型
let ydoc = null
let yroom = null
let yplayers = null
let yvotes = null
let yplayerPrefs = null
let ycaptainPrefs = null
let yconfirmedVoters = null
let yconfirmedPrefVoters = null
let ylogs = null

// 状态回调
let stateChangeCallback = null

// 初始化房间（房主调用）
export function createRoom(ownerName, roomName) {
  const roomId = generateRoomId()
  initYjs(roomId)

  // 设置初始状态
  yroom.set('roomId', roomId)
  yroom.set('roomName', roomName || `${ownerName}的房间`)
  yroom.set('stage', 'election') // election | preference | result
  yroom.set('createdAt', Date.now())
  yroom.set('avoidanceIntensity', 50)
  yroom.set('captains', null)
  yroom.set('result', null)

  // 添加房主
  const owner = {
    id: generateId(),
    name: ownerName,
    isCaptain: false,
    team: null,
    isOwner: true
  }
  yplayers.set(owner.id, owner)
  yroom.set('ownerId', owner.id)

  return { roomId, playerId: owner.id }
}

// 加入房间
export function joinRoom(roomId, playerName) {
  initYjs(roomId)

  // 检查是否已存在同名玩家
  for (const [id, p] of yplayers) {
    if (p.name === playerName) {
      return { roomId, playerId: id, existing: true }
    }
  }

  const player = {
    id: generateId(),
    name: playerName,
    isCaptain: false,
    team: null,
    isOwner: false
  }
  yplayers.set(player.id, player)

  return { roomId, playerId: player.id }
}

// 初始化 Yjs
function initYjs(roomId) {
  if (ydoc) return

  ydoc = new Y.Doc()

  // 获取共享类型
  yroom = ydoc.getMap('room')
  yplayers = ydoc.getMap('players')
  yvotes = ydoc.getMap('votes')
  yplayerPrefs = ydoc.getMap('playerPrefs')
  ycaptainPrefs = ydoc.getMap('captainPrefs')
  yconfirmedVoters = ydoc.getArray('confirmedVoters')
  yconfirmedPrefVoters = ydoc.getArray('confirmedPrefVoters')
  ylogs = ydoc.getArray('logs')

  // 监听变化
  ydoc.on('update', () => {
    if (stateChangeCallback) {
      stateChangeCallback(getState())
    }
  })
}

// 获取当前状态
export function getState() {
  if (!ydoc) return null

  return {
    roomId: yroom.get('roomId'),
    roomName: yroom.get('roomName'),
    stage: yroom.get('stage'),
    ownerId: yroom.get('ownerId'),
    avoidanceIntensity: yroom.get('avoidanceIntensity'),
    captains: yroom.get('captains'),
    result: yroom.get('result'),
    players: Array.from(yplayers.values()),
    votes: Object.fromEntries(yvotes),
    playerPrefs: Object.fromEntries(yplayerPrefs),
    captainPrefs: Object.fromEntries(ycaptainPrefs),
    confirmedVoters: yconfirmedVoters.toArray(),
    confirmedPrefVoters: yconfirmedPrefVoters.toArray(),
    logs: ylogs.toArray()
  }
}

// 设置状态变化回调
export function onStateChange(callback) {
  stateChangeCallback = callback
}

// ===== 业务操作方法 =====

// 提交投票
export function submitVote(voterId, candidateIds) {
  yvotes.set(voterId, {
    voterId,
    candidateIds,
    timestamp: Date.now()
  })

  if (!yconfirmedVoters.includes(voterId)) {
    yconfirmedVoters.push(voterId)
  }

  // 检查是否全员确认
  checkAutoAdvance()
}

// 检查自动推进
function checkAutoAdvance() {
  const players = Array.from(yplayers.values())
  const stage = yroom.get('stage')

  if (stage === 'election') {
    if (yconfirmedVoters.length >= players.length && players.length >= 2) {
      // 自动选举队长
      const votes = Array.from(yvotes.values())
      const captains = electCaptains(players, votes)
      yroom.set('captains', captains)
      yroom.set('stage', 'preference')
    }
  } else if (stage === 'preference') {
    if (yconfirmedPrefVoters.length >= players.length) {
      // 自动分队
      runDivision()
    }
  }
}

// 提交玩家偏好
export function submitPlayerPref(playerId, preferredTeam, dislikePlayers) {
  yplayerPrefs.set(playerId, {
    playerId,
    preferredTeam,
    dislikePlayers,
    timestamp: Date.now()
  })

  if (!yconfirmedPrefVoters.includes(playerId)) {
    yconfirmedPrefVoters.push(playerId)
  }

  checkAutoAdvance()
}

// 提交队长偏好
export function submitCaptainPref(captainId, desiredPlayers) {
  ycaptainPrefs.set(captainId, {
    captainId,
    desiredPlayers,
    timestamp: Date.now()
  })

  if (!yconfirmedPrefVoters.includes(captainId)) {
    yconfirmedPrefVoters.push(captainId)
  }

  checkAutoAdvance()
}

// 运行分队算法（房主调用）
export function runDivision() {
  const players = Array.from(yplayers.values())
  const captains = yroom.get('captains')
  const playerPrefs = Object.fromEntries(yplayerPrefs)
  const captainPrefs = Object.fromEntries(ycaptainPrefs)
  const dislikePunish = 1.0 - (yroom.get('avoidanceIntensity') / 100)

  const result = divideTeams(players, captains, playerPrefs, captainPrefs, dislikePunish)

  yroom.set('result', {
    teamA: result.teamA,
    teamB: result.teamB,
    captains: result.captains
  })

  // 保存日志
  ylogs.delete(0, ylogs.length)
  result.logs.forEach(log => ylogs.push(log))

  yroom.set('stage', 'result')
}

// 移除玩家（房主）
export function removePlayer(playerId) {
  yplayers.delete(playerId)
  yvotes.delete(playerId)
  yplayerPrefs.delete(playerId)
  ycaptainPrefs.delete(playerId)

  const idx1 = yconfirmedVoters.indexOf(playerId)
  if (idx1 >= 0) yconfirmedVoters.delete(idx1)

  const idx2 = yconfirmedPrefVoters.indexOf(playerId)
  if (idx2 >= 0) yconfirmedPrefVoters.delete(idx2)
}

// 重新开始
export function resetRoom() {
  yroom.set('stage', 'election')
  yroom.set('captains', null)
  yroom.set('result', null)
  yvotes.clear()
  yplayerPrefs.clear()
  ycaptainPrefs.clear()
  yconfirmedVoters.delete(0, yconfirmedVoters.length)
  yconfirmedPrefVoters.delete(0, yconfirmedPrefVoters.length)

  // 重置玩家状态
  for (const [id, p] of yplayers) {
    yplayers.set(id, { ...p, isCaptain: false, team: null })
  }
}

// 设置规避强度
export function setAvoidanceIntensity(value) {
  yroom.set('avoidanceIntensity', value)
}

// 重新分队（用相同参数）
export function reshuffle() {
  runDivision()
}
