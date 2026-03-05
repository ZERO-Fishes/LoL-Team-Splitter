// WebRTC P2P 连接管理
// 使用 PeerJS 简化信令过程

let peer = null
let connections = []
let isHost = false
let roomId = null

// 回调函数
let onDataReceived = null
let onPeerConnected = null
let onPeerDisconnected = null

// 初始化（房主调用）
export function initHost(rId, callbacks) {
  roomId = rId
  isHost = true
  setupCallbacks(callbacks)

  peer = new Peer(roomId, {
    host: 'peerjs-server.herokuapp.com',
    port: 443,
    secure: true,
    debug: 1
  })

  peer.on('open', (id) => {
    console.log('Host ready, room ID:', id)
  })

  peer.on('connection', (conn) => {
    handleConnection(conn)
  })

  peer.on('error', (err) => {
    console.error('Host error:', err)
  })
}

// 初始化（普通玩家调用）
export function joinRoom(rId, callbacks) {
  roomId = rId
  isHost = false
  setupCallbacks(callbacks)

  peer = new Peer({
    host: 'peerjs-server.herokuapp.com',
    port: 443,
    secure: true,
    debug: 1
  })

  peer.on('open', () => {
    console.log('Connecting to host...')
    const conn = peer.connect(roomId, {
      reliable: true,
      serialization: 'json'
    })

    conn.on('open', () => {
      handleConnection(conn)
    })

    conn.on('error', (err) => {
      console.error('Connection error:', err)
    })
  })

  peer.on('error', (err) => {
    console.error('Peer error:', err)
  })
}

// 设置回调
function setupCallbacks(callbacks) {
  onDataReceived = callbacks.onData || (() => {})
  onPeerConnected = callbacks.onConnect || (() => {})
  onPeerDisconnected = callbacks.onDisconnect || (() => {})
}

// 处理连接
function handleConnection(conn) {
  connections.push(conn)

  conn.on('open', () => {
    console.log('Peer connected:', conn.peer)
    onPeerConnected(conn.peer)

    // 如果是房主，发送当前状态给新玩家
    if (isHost) {
      // 延迟一点确保连接稳定
      setTimeout(() => {
        broadcastState()
      }, 500)
    }
  })

  conn.on('data', (data) => {
    console.log('Received:', data.type)
    onDataReceived(data, conn.peer)
  })

  conn.on('close', () => {
    console.log('Peer disconnected:', conn.peer)
    connections = connections.filter(c => c !== conn)
    onPeerDisconnected(conn.peer)
  })

  conn.on('error', (err) => {
    console.error('Connection error:', err)
  })
}

// 广播状态给所有连接
export function broadcastState(state) {
  const data = {
    type: 'state',
    timestamp: Date.now(),
    payload: state
  }

  connections.forEach(conn => {
    if (conn.open) {
      conn.send(data)
    }
  })
}

// 发送操作给房主
export function sendAction(action) {
  if (isHost) {
    // 房主本地处理
    return
  }

  // 找到到房主的连接
  const hostConn = connections.find(c => c.peer === roomId)
  if (hostConn && hostConn.open) {
    hostConn.send({
      type: 'action',
      timestamp: Date.now(),
      payload: action
    })
  }
}

// 断开所有连接
export function disconnect() {
  connections.forEach(conn => conn.close())
  connections = []

  if (peer) {
    peer.destroy()
    peer = null
  }
}

// 检查是否连接
export function isConnected() {
  return connections.some(c => c.open)
}

// 获取连接数
export function getConnectionCount() {
  return connections.filter(c => c.open).length
}
