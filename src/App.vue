<template>
  <div class="app">
    <!-- 登录/创建房间界面 -->
    <div v-if="!isInRoom" class="login-container">
      <div class="card">
        <h1>🎮 LOL内战分队系统</h1>
        <p class="subtitle">P2P版本 - 无需服务器</p>

        <div class="tabs">
          <button :class="{ active: activeTab === 'join' }" @click="activeTab = 'join'">
            加入房间
          </button>
          <button :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">
            创建房间
          </button>
        </div>

        <!-- 加入房间 -->
        <div v-if="activeTab === 'join'" class="tab-content">
          <input v-model="playerName" placeholder="你的昵称" maxlength="20" />
          <input v-model="inputRoomId" placeholder="房间号 (6位数字)" maxlength="6" />
          <button class="primary" @click="joinRoom" :disabled="!canJoin">
            加入房间
          </button>
        </div>

        <!-- 创建房间 -->
        <div v-else class="tab-content">
          <input v-model="playerName" placeholder="你的昵称" maxlength="20" />
          <input v-model="roomName" placeholder="房间名称 (可选)" maxlength="30" />
          <button class="primary" @click="createRoom" :disabled="!canCreate">
            创建房间
          </button>
        </div>
      </div>
    </div>

    <!-- 房间内界面 -->
    <div v-else class="room-container">
      <!-- 顶部信息 -->
      <header class="room-header">
        <div class="room-info">
          <h2>{{ state.roomName }}</h2>
          <span class="room-id">房间号: {{ state.roomId }}</span>
        </div>
        <div class="player-info">
          <span>你好, {{ myPlayer?.name }}</span>
          <span v-if="isOwner" class="owner-badge">房主</span>
          <button class="small" @click="leaveRoom">退出</button>
        </div>
      </header>

      <!-- 阶段指示器 -->
      <div class="stage-indicator">
        <div class="stage" :class="{ active: state.stage === 'election', done: stageIndex > 0 }">
          <span class="num">1</span>
          <span>选队长</span>
        </div>
        <div class="arrow">→</div>
        <div class="stage" :class="{ active: state.stage === 'preference', done: stageIndex > 1 }">
          <span class="num">2</span>
          <span>填偏好</span>
        </div>
        <div class="arrow">→</div>
        <div class="stage" :class="{ active: state.stage === 'result' }">
          <span class="num">3</span>
          <span>看结果</span>
        </div>
      </div>

      <div class="main-content">
        <!-- 侧边栏: 成员列表 -->
        <aside class="sidebar">
          <h3>成员 ({{ state.players.length }})</h3>
          <ul class="player-list">
            <li v-for="p in state.players" :key="p.id" :class="{ me: p.id === myPlayerId, owner: p.id === state.ownerId }">
              <span class="name">{{ p.name }}{{ p.id === myPlayerId ? ' (我)' : '' }}</span>
              <span v-if="p.id === state.ownerId" class="badge">房主</span>
              <span v-if="p.isCaptain" class="badge captain">队长</span>
              <span v-if="isConfirmed(p.id)" class="check">✓</span>
              <span v-else class="pending">⋯</span>
            </li>
          </ul>

          <!-- 房主控制 -->
          <div v-if="isOwner" class="owner-controls">
            <h4>房主设置</h4>
            <label>
              规避强度: {{ state.avoidanceIntensity }}%
              <input type="range" v-model.number="avoidanceIntensity" min="0" max="100" step="5" @change="updateIntensity" />
            </label>
            <select v-model="kickTarget">
              <option value="">选择要踢出的玩家</option>
              <option v-for="p in otherPlayers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <button v-if="kickTarget" @click="kickPlayer" class="danger small">踢出</button>
            <button @click="resetRoom" class="warning small">重新开始</button>
          </div>
        </aside>

        <!-- 主内容区 -->
        <main class="stage-content">
          <!-- 阶段1: 选举队长 -->
          <div v-if="state.stage === 'election'" class="stage-panel">
            <h3>🗳️ 第一阶段：选举队长</h3>
            <p class="hint">每人可投 0-2 票，点击确认后不可修改</p>

            <div v-if="!hasVoted" class="vote-section">
              <p>选择你想让谁当队长:</p>
              <div class="checkbox-list">
                <label v-for="p in otherPlayersForVote" :key="p.id" class="checkbox-item">
                  <input type="checkbox" v-model="selectedCandidates" :value="p.id" :disabled="selectedCandidates.length >= 2 && !selectedCandidates.includes(p.id)" />
                  <span>{{ p.name }}</span>
                </label>
              </div>
              <button class="primary" @click="submitVote" :disabled="!canSubmitVote">
                确认投票 ({{ selectedCandidates.length }}/2)
              </button>
            </div>

            <div v-else class="done-section">
              <p class="success">✓ 你已投票，等待其他人...</p>
              <button v-if="isOwner" class="secondary" @click="forceElect">
                提前结束投票并选举
              </button>
            </div>

            <div class="progress">
              <div class="progress-bar">
                <div class="fill" :style="{ width: voteProgress + '%' }"></div>
              </div>
              <p>{{ confirmedVotersCount }}/{{ state.players.length }} 人已投票</p>
            </div>
          </div>

          <!-- 阶段2: 偏好设置 -->
          <div v-if="state.stage === 'preference'" class="stage-panel">
            <h3>📋 第二阶段：提交偏好</h3>

            <!-- 显示选举结果 -->
            <div class="captains-info">
              <p>🎉 队长已选出：</p>
              <div class="captain-badges">
                <span class="captain-a">🔵 {{ captainA?.name }} (A队)</span>
                <span class="captain-b">🔴 {{ captainB?.name }} (B队)</span>
              </div>
              <details v-if="voteDetails.length > 0">
                <summary>查看票数详情</summary>
                <div class="vote-details">
                  <span v-for="v in voteDetails" :key="v.id" :class="{ captain: v.isCaptain }">
                    {{ v.name }}: {{ v.count }}票
                  </span>
                </div>
              </details>
            </div>

            <!-- 队长界面 -->
            <div v-if="isCaptain" class="captain-form">
              <p>你是队长，请选择心仪的队员：</p>
              <div class="checkbox-list">
                <label v-for="p in nonCaptains" :key="p.id" class="checkbox-item">
                  <input type="checkbox" v-model="desiredPlayers" :value="p.id" />
                  <span>{{ p.name }}</span>
                </label>
              </div>
              <button v-if="!hasPrefConfirmed" class="primary" @click="submitCaptainPref">
                确认意向
              </button>
              <button v-else class="secondary" @click="reopenPref">
                重新修改
              </button>
            </div>

            <!-- 普通玩家界面 -->
            <div v-else class="player-form">
              <div class="form-group">
                <label>倾向队伍：</label>
                <select v-model="preferredTeam">
                  <option value="">🎲 随机</option>
                  <option value="A">🔵 跟随 {{ captainA?.name }} (A队)</option>
                  <option value="B">🔴 跟随 {{ captainB?.name }} (B队)</option>
                </select>
              </div>

              <div class="form-group">
                <label>不想同队 (最多1人):</label>
                <select v-model="dislikePlayer">
                  <option value="">无</option>
                  <option v-for="p in dislikablePlayers" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select>
              </div>

              <button v-if="!hasPrefConfirmed" class="primary" @click="submitPlayerPref">
                确认偏好
              </button>
              <button v-else class="secondary" @click="reopenPref">
                重新修改
              </button>
            </div>

            <button v-if="isOwner" class="primary" @click="forceDivide">
              开始最终分队
            </button>
          </div>

          <!-- 阶段3: 分队结果 -->
          <div v-if="state.stage === 'result'" class="stage-panel">
            <h3>⚖️ 第三阶段：分队结果</h3>

            <div class="teams-display">
              <div class="team team-a">
                <h4>🔵 A队</h4>
                <ul>
                  <li v-for="id in state.result.teamA" :key="id" :class="{ captain: isCaptainId(id) }">
                    {{ getPlayerName(id) }} {{ isCaptainId(id) ? '(队长)' : '' }}
                  </li>
                </ul>
              </div>
              <div class="team team-b">
                <h4>🔴 B队</h4>
                <ul>
                  <li v-for="id in state.result.teamB" :key="id" :class="{ captain: isCaptainId(id) }">
                    {{ getPlayerName(id) }} {{ isCaptainId(id) ? '(队长)' : '' }}
                  </li>
                </ul>
              </div>
            </div>

            <div v-if="isOwner" class="result-actions">
              <button class="secondary" @click="reshuffle">🎲 重新打乱</button>
              <button class="secondary" @click="resetRoom">🔄 彻底重来</button>
            </div>

            <!-- 房主日志 -->
            <details v-if="isOwner && state.logs.length > 0" class="logs">
              <summary>算法日志</summary>
              <pre>{{ state.logs.join('\n') }}</pre>
            </details>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import * as roomStore from './stores/room.js'
import * as webrtc from './utils/webrtc.js'
import { electCaptains } from './utils/algorithm.js'

// ===== 状态 =====
const activeTab = ref('join')
const playerName = ref('')
const roomName = ref('')
const inputRoomId = ref('')

const isInRoom = ref(false)
const myPlayerId = ref('')
const myPlayer = computed(() => state.value?.players.find(p => p.id === myPlayerId.value))
const isOwner = computed(() => myPlayerId.value === state.value?.ownerId)

const state = ref(null)
const avoidanceIntensity = ref(50)
const kickTarget = ref('')

// 投票相关
const selectedCandidates = ref([])
const hasVoted = computed(() => state.value?.confirmedVoters.includes(myPlayerId.value))

// 偏好相关
const preferredTeam = ref('')
const dislikePlayer = ref('')
const desiredPlayers = ref([])
const hasPrefConfirmed = computed(() => state.value?.confirmedPrefVoters.includes(myPlayerId.value))

// ===== 计算属性 =====
const canJoin = computed(() => playerName.value.trim() && inputRoomId.value.trim().length === 6)
const canCreate = computed(() => playerName.value.trim())

const canSubmitVote = computed(() => selectedCandidates.value.length <= 2)
const confirmedVotersCount = computed(() => state.value?.confirmedVoters.length || 0)
const voteProgress = computed(() => {
  if (!state.value || state.value.players.length === 0) return 0
  return (confirmedVotersCount.value / state.value.players.length) * 100
})

const stageIndex = computed(() => {
  const stages = ['election', 'preference', 'result']
  return stages.indexOf(state.value?.stage)
})

const otherPlayers = computed(() => state.value?.players.filter(p => p.id !== myPlayerId.value) || [])
const otherPlayersForVote = computed(() => state.value?.players.filter(p => p.id !== myPlayerId.value) || [])
const nonCaptains = computed(() => state.value?.players.filter(p => !p.isCaptain) || [])
const isCaptain = computed(() => myPlayer.value?.isCaptain)

const captains = computed(() => state.value?.captains || [])
const captainA = computed(() => captains.value.find(c => c.team === 'A'))
const captainB = computed(() => captains.value.find(c => c.team === 'B'))

const dislikablePlayers = computed(() => {
  if (!state.value) return []
  return state.value.players.filter(p => {
    return p.id !== myPlayerId.value && !p.isCaptain
  })
})

const voteDetails = computed(() => {
  if (!state.value) return []
  const counts = {}
  state.value.players.forEach(p => counts[p.id] = 0)
  Object.values(state.value.votes).forEach(v => {
    v.candidateIds?.forEach(id => {
      if (id in counts) counts[id]++
    })
  })
  return state.value.players
    .map(p => ({
      id: p.id,
      name: p.name,
      count: counts[p.id],
      isCaptain: p.isCaptain
    }))
    .sort((a, b) => b.count - a.count)
})

// ===== 方法 =====
function createRoom() {
  const { roomId, playerId } = roomStore.createRoom(playerName.value.trim(), roomName.value.trim())
  myPlayerId.value = playerId
  isInRoom.value = true
  state.value = roomStore.getState()

  // 作为房主初始化 WebRTC
  webrtc.initHost(roomId, {
    onData: handlePeerData,
    onConnect: (peerId) => console.log('Player connected:', peerId),
    onDisconnect: (peerId) => console.log('Player disconnected:', peerId)
  })

  // 监听状态变化
  roomStore.onStateChange((newState) => {
    state.value = newState
    // 广播给所有连接
    webrtc.broadcastState(newState)
  })
}

function joinRoom() {
  const result = roomStore.joinRoom(inputRoomId.value.trim(), playerName.value.trim())
  myPlayerId.value = result.playerId
  isInRoom.value = true
  state.value = roomStore.getState()

  // 作为玩家连接到房主
  webrtc.joinRoom(inputRoomId.value.trim(), {
    onData: handlePeerData,
    onConnect: () => console.log('Connected to host'),
    onDisconnect: () => alert('与房主断开连接')
  })
}

function leaveRoom() {
  if (confirm('确定要退出房间吗？')) {
    webrtc.disconnect()
    isInRoom.value = false
    myPlayerId.value = ''
    state.value = null
  }
}

function handlePeerData(data, peerId) {
  // 处理来自其他玩家的数据
  if (data.type === 'state') {
    state.value = data.payload
  }
}

function isConfirmed(playerId) {
  if (!state.value) return false
  if (state.value.stage === 'election') {
    return state.value.confirmedVoters.includes(playerId)
  }
  if (state.value.stage === 'preference') {
    return state.value.confirmedPrefVoters.includes(playerId)
  }
  return true
}

function submitVote() {
  roomStore.submitVote(myPlayerId.value, selectedCandidates.value)
  state.value = roomStore.getState()
}

function forceElect() {
  const votes = Object.values(state.value.votes)
  const captains = electCaptains(state.value.players, votes)
  state.value.captains = captains
  state.value.stage = 'preference'
}

function submitPlayerPref() {
  roomStore.submitPlayerPref(
    myPlayerId.value,
    preferredTeam.value,
    dislikePlayer.value ? [dislikePlayer.value] : []
  )
  state.value = roomStore.getState()
}

function submitCaptainPref() {
  roomStore.submitCaptainPref(myPlayerId.value, desiredPlayers.value)
  state.value = roomStore.getState()
}

function reopenPref() {
  // 重新打开偏好设置
  const idx = state.value.confirmedPrefVoters.indexOf(myPlayerId.value)
  if (idx > -1) {
    state.value.confirmedPrefVoters.splice(idx, 1)
  }
}

function forceDivide() {
  roomStore.runDivision()
  state.value = roomStore.getState()
}

function kickPlayer() {
  if (confirm(`确定要踢出 ${getPlayerName(kickTarget.value)} 吗？`)) {
    roomStore.removePlayer(kickTarget.value)
    kickTarget.value = ''
    state.value = roomStore.getState()
  }
}

function updateIntensity() {
  roomStore.setAvoidanceIntensity(avoidanceIntensity.value)
}

function resetRoom() {
  if (confirm('确定要重新开始吗？所有进度将重置。')) {
    roomStore.resetRoom()
    selectedCandidates.value = []
    preferredTeam.value = ''
    dislikePlayer.value = ''
    desiredPlayers.value = []
    state.value = roomStore.getState()
  }
}

function reshuffle() {
  roomStore.reshuffle()
  state.value = roomStore.getState()
}

function getPlayerName(id) {
  return state.value?.players.find(p => p.id === id)?.name || id
}

function isCaptainId(id) {
  return state.value?.captains?.some(c => c.id === id)
}

// 初始化
onMounted(() => {
  roomStore.onStateChange((newState) => {
    state.value = newState
  })
})
</script>

<style>
.app {
  min-height: 100vh;
  padding: 20px;
}

/* 登录界面 */
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
}

.card {
  background: white;
  border-radius: 16px;
  padding: 40px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

h1 {
  text-align: center;
  margin-bottom: 8px;
  color: #333;
}

.subtitle {
  text-align: center;
  color: #666;
  margin-bottom: 24px;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.tabs button {
  flex: 1;
  padding: 12px;
  border: none;
  background: #f0f0f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.tabs button.active {
  background: #4a90d9;
  color: white;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

input, select {
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
}

button {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

button.primary {
  background: #4a90d9;
  color: white;
}

button.primary:hover:not(:disabled) {
  background: #357abd;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary {
  background: #f0f0f0;
  color: #333;
}

button.danger {
  background: #e74c3c;
  color: white;
}

button.small {
  padding: 6px 12px;
  font-size: 12px;
}

/* 房间内界面 */
.room-container {
  max-width: 1200px;
  margin: 0 auto;
}

.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  padding: 16px 24px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.room-info h2 {
  margin: 0;
  font-size: 20px;
}

.room-id {
  color: #666;
  font-size: 14px;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.owner-badge {
  background: #ffd700;
  color: #333;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

/* 阶段指示器 */
.stage-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 20px;
  background: white;
  padding: 16px;
  border-radius: 12px;
}

.stage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  opacity: 0.5;
}

.stage.active {
  background: #4a90d9;
  color: white;
  opacity: 1;
}

.stage.done {
  opacity: 1;
  color: #27ae60;
}

.stage .num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: currentColor;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
}

.arrow {
  font-size: 20px;
  color: #999;
}

/* 主内容区 */
.main-content {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
}

.sidebar {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.sidebar h3, .sidebar h4 {
  margin-top: 0;
}

.player-list {
  list-style: none;
  padding: 0;
}

.player-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.player-list li.me {
  font-weight: bold;
}

.badge {
  background: #ffd700;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.badge.captain {
  background: #9b59b6;
  color: white;
}

.check {
  color: #27ae60;
  margin-left: auto;
}

.pending {
  color: #999;
  margin-left: auto;
}

.owner-controls {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #eee;
}

.owner-controls label {
  display: block;
  margin-bottom: 12px;
}

.owner-controls input[type="range"] {
  width: 100%;
}

/* 阶段内容 */
.stage-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.stage-panel h3 {
  margin-top: 0;
  margin-bottom: 16px;
}

.hint {
  color: #666;
  margin-bottom: 20px;
}

.success {
  color: #27ae60;
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
}

.checkbox-item:hover {
  background: #f5f5f5;
}

.progress {
  margin-top: 24px;
}

.progress-bar {
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar .fill {
  height: 100%;
  background: #4a90d9;
  transition: width 0.3s;
}

.captains-info {
  background: #f8f9fa;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.captain-badges {
  display: flex;
  gap: 12px;
  margin: 12px 0;
}

.captain-a, .captain-b {
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: bold;
}

.captain-a {
  background: #e3f2fd;
  color: #1976d2;
}

.captain-b {
  background: #ffebee;
  color: #d32f2f;
}

.vote-details {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.vote-details span {
  padding: 4px 8px;
  background: #f0f0f0;
  border-radius: 4px;
  font-size: 13px;
}

.vote-details span.captain {
  background: #e8d5f2;
  color: #7b1fa2;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.teams-display {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.team {
  padding: 20px;
  border-radius: 12px;
}

.team-a {
  background: #e3f2fd;
  border-left: 4px solid #1976d2;
}

.team-b {
  background: #ffebee;
  border-left: 4px solid #d32f2f;
}

.team h4 {
  margin-top: 0;
  margin-bottom: 12px;
}

.team ul {
  list-style: none;
  padding: 0;
}

.team li {
  padding: 8px 0;
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.team li.captain {
  font-weight: bold;
}

.result-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.logs {
  margin-top: 20px;
}

.logs pre {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .main-content {
    grid-template-columns: 1fr;
  }

  .teams-display {
    grid-template-columns: 1fr;
  }
}
</style>
