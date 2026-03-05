// 分队算法 - 从 Python 移植

const PREFERENCE_WEIGHT = 2.0
const CAPTAIN_CHOICE_WEIGHT = 2.5
const MIN_WEIGHT = 0.1

// 生成唯一ID
export function generateId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
}

// 生成房间ID
export function generateRoomId() {
  return Date.now().toString().slice(-6)
}

// 队长选举
export function electCaptains(players, votes) {
  const voteCounts = {}
  players.forEach(p => voteCounts[p.id] = 0)

  votes.forEach(v => {
    v.candidateIds.forEach(cid => {
      if (cid in voteCounts) voteCounts[cid]++
    })
  })

  // 按票数排序，随机打破平局
  const sorted = [...players].sort((a, b) => {
    const diff = voteCounts[b.id] - voteCounts[a.id]
    if (diff !== 0) return diff
    return Math.random() - 0.5
  })

  if (sorted.length < 2) {
    throw new Error('至少需要2名玩家才能选举队长')
  }

  const captains = sorted.slice(0, 2)
  // 随机分配A/B
  if (Math.random() < 0.5) {
    captains[0].team = 'A'
    captains[1].team = 'B'
  } else {
    captains[0].team = 'B'
    captains[1].team = 'A'
  }
  captains[0].isCaptain = true
  captains[1].isCaptain = true

  return captains
}

// 分队算法
export function divideTeams(players, captains, playerPrefs, captainPrefs, dislikePunish = 0.5) {
  const logs = []
  const intensity = (1.0 - dislikePunish) * 100

  logs.push(`开始分队过程...`)
  logs.push(`规避强度配置: ${intensity.toFixed(0)}% (惩罚系数: ${dislikePunish.toFixed(2)})`)

  const [capA, capB] = captains[0].team === 'A'
    ? [captains[0], captains[1]]
    : [captains[1], captains[0]]

  logs.push(`队长 A: ${capA.name}, 队长 B: ${capB.name}`)

  const teamA = [capA.id]
  const teamB = [capB.id]

  // 待分配玩家（排除队长，随机排序）
  const remaining = players
    .filter(p => p.id !== capA.id && p.id !== capB.id)
    .sort(() => Math.random() - 0.5)

  logs.push(`待分配玩家随机排序: ${remaining.map(p => p.name).join(', ')}`)

  const maxTeamSize = Math.floor(players.length / 2)

  for (const player of remaining) {
    logs.push(`--- 正在分配玩家: ${player.name} ---`)

    // 强制平衡检查
    if (teamA.length >= maxTeamSize) {
      teamB.push(player.id)
      logs.push(`A队已满 (${maxTeamSize}人)，${player.name} 自动分配至 B队`)
      continue
    }
    if (teamB.length >= maxTeamSize) {
      teamA.push(player.id)
      logs.push(`B队已满 (${maxTeamSize}人)，${player.name} 自动分配至 A队`)
      continue
    }

    // 计算权重
    let weightA = 1.0
    let weightB = 1.0
    const details = []

    const pref = playerPrefs[player.id]
    if (pref) {
      // 个人倾向
      if (pref.preferredTeam === 'A') {
        weightA += PREFERENCE_WEIGHT
        details.push(`个人倾向 A队 (+${PREFERENCE_WEIGHT})`)
      } else if (pref.preferredTeam === 'B') {
        weightB += PREFERENCE_WEIGHT
        details.push(`个人倾向 B队 (+${PREFERENCE_WEIGHT})`)
      }

      // 不想同队惩罚
      if (pref.dislikePlayers && pref.dislikePlayers.length > 0) {
        const dislikedId = pref.dislikePlayers[0]
        const disliked = players.find(p => p.id === dislikedId)
        const name = disliked ? disliked.name : dislikedId

        if (teamA.includes(dislikedId)) {
          weightA *= dislikePunish
          details.push(`不想和 ${name} 同队，且其在 A队 (惩罚 x${dislikePunish.toFixed(2)})`)
        } else if (teamB.includes(dislikedId)) {
          weightB *= dislikePunish
          details.push(`不想和 ${name} 同队，且其在 B队 (惩罚 x${dislikePunish.toFixed(2)})`)
        }
      }
    }

    // 队长心仪加成
    const capAPref = captainPrefs[capA.id]
    const capBPref = captainPrefs[capB.id]

    if (capAPref && capAPref.desiredPlayers && capAPref.desiredPlayers.includes(player.id)) {
      weightA += CAPTAIN_CHOICE_WEIGHT
      details.push(`队长 ${capA.name} 想要该队员 (+${CAPTAIN_CHOICE_WEIGHT})`)
    }
    if (capBPref && capBPref.desiredPlayers && capBPref.desiredPlayers.includes(player.id)) {
      weightB += CAPTAIN_CHOICE_WEIGHT
      details.push(`队长 ${capB.name} 想要该队员 (+${CAPTAIN_CHOICE_WEIGHT})`)
    }

    // 权重保护
    weightA = Math.max(weightA, MIN_WEIGHT)
    weightB = Math.max(weightB, MIN_WEIGHT)

    logs.push(`权重详情: ${details.length > 0 ? details.join(', ') : '无加成'}`)
    logs.push(`最终权重 -> A队: ${weightA.toFixed(2)}, B队: ${weightB.toFixed(2)}`)

    // 概率判定
    const probA = weightA / (weightA + weightB)
    logs.push(`分配概率 -> A队: ${(probA * 100).toFixed(1)}%, B队: ${((1 - probA) * 100).toFixed(1)}%`)

    if (Math.random() < probA) {
      teamA.push(player.id)
      logs.push(`🎲 随机判定结果: A队`)
    } else {
      teamB.push(player.id)
      logs.push(`🎲 随机判定结果: B队`)
    }
  }

  logs.push(`分队完成。`)

  return {
    teamA,
    teamB,
    captains: [capA.id, capB.id],
    logs
  }
}
