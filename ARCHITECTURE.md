# LOL内战分队系统 - 技术架构文档

> 本文档用于重构时参考，确保功能不丢失

---

## 一、系统概述

### 1.1 核心功能
- **多房间支持**：多个独立房间可同时运行
- **三阶段流程**：选举队长 → 提交偏好 → 智能分队
- **实时同步**：基于 Streamlit 自动刷新的"伪实时"同步
- **房主管理**：踢人、解散房间、配置算法参数

### 1.2 技术栈
- **前端**：Streamlit (Python-based Web UI)
- **后端**：纯 Python，无 Web 框架
- **状态存储**：内存 (Python 对象)
- **同步机制**：`st_autorefresh(interval=3000)` 轮询刷新

---

## 二、数据模型 (models.py)

### 2.1 枚举类型
```python
TeamChoice.A      # 倾向A队
TeamChoice.B      # 倾向B队
TeamChoice.NONE   # 随机/无倾向
```

### 2.2 核心实体

#### Player (玩家)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | str | 毫秒时间戳生成，如 "p1709123456789" |
| name | str | 玩家输入的昵称 |
| is_captain | bool | 是否为队长 |
| team | TeamChoice | 分配到的队伍 |

#### Vote (投票)
| 字段 | 类型 | 说明 |
|------|------|------|
| voter_id | str | 投票者ID |
| candidate_ids | List[str] | 投给的候选人ID列表，0-2人 |

#### PlayerPreference (玩家偏好)
| 字段 | 类型 | 说明 |
|------|------|------|
| player_id | str | 玩家ID |
| preferred_team | TeamChoice | 倾向的队伍（跟随某队长） |
| dislike_players | List[str] | 不想同队的玩家ID列表，**最多1人** |

#### CaptainPreference (队长偏好)
| 字段 | 类型 | 说明 |
|------|------|------|
| captain_id | str | 队长ID |
| desired_players | List[str] | 心仪队员列表，无数量限制 |

#### TeamDivisionResult (分队结果)
| 字段 | 类型 | 说明 |
|------|------|------|
| team_a | List[str] | A队玩家ID列表 |
| team_b | List[str] | B队玩家ID列表 |
| captains | List[str] | 两位队长ID |

---

## 三、状态管理 (state_manager.py)

### 3.1 SharedRoom (房间状态)

**核心属性：**
```python
room_id: str                    # 6位数字，基于时间戳
room_name: str                  # 房间名称
players: List[Player]           # 所有玩家
votes: List[Vote]               # 所有投票
confirmed_voters: List[str]     # 已确认投票的玩家ID
confirmed_pref_voters: List[str] # 已确认偏好的玩家ID
player_prefs: Dict[str, PlayerPreference]  # 玩家偏好映射
captain_prefs: Dict[str, CaptainPreference] # 队长偏好映射
captains: Tuple[Player, Player] # 两位队长（选出来后填充）
result: TeamDivisionResult      # 分队结果
owner_id: str                   # 房主ID
avoidance_intensity: int        # 规避强度 0-100，默认50
last_activity: float            # 最后活动时间戳
division_logs: List[str]        # 分队算法日志
```

**关键方法：**

#### add_player(name)
- 检查同名玩家已存在则返回现有玩家
- 生成ID：`f"p{int(time.time() * 1000)}"`
- 更新 last_activity

#### remove_player(player_id)
- 从 players 中移除
- 清理该玩家的 votes、confirmed_voters、confirmed_pref_voters
- 清理 player_prefs、captain_prefs 中该玩家的数据
- **注意：房主退出逻辑在 app.py 处理，不在此处**

### 3.2 RoomManager (房间管理)

**单例模式：** `_manager_instance` 全局唯一

#### create_room(owner_name, room_name)
- 生成 room_id：`str(int(time.time()))[-6:]` （取时间戳后6位）
- 创建 SharedRoom，自动添加房主为第一个玩家

#### get_room(room_id)
- 获取房间
- **自动清理**：1小时无活动或玩家为空时删除房间

#### delete_room(room_id)
- 从 rooms 字典中删除

### 3.3 状态同步机制

**当前实现：客户端轮询**
```python
st_autorefresh(interval=3000, key="datarefresh")
```
- 每3秒强制刷新页面
- 从 RoomManager 重新获取 room 对象
- 根据状态重新渲染 UI

**⚠️ 重构注意：**
- P2P方案需要改为 WebRTC 数据通道同步
- 需要处理冲突（多人同时修改）

---

## 四、核心业务逻辑 (engine.py)

### 4.1 权重常量
```python
PREFERENCE_WEIGHT = 2.0      # 个人倾向加成
CAPTAIN_CHOICE_WEIGHT = 2.5  # 队长心仪加成
MIN_WEIGHT = 0.1             # 权重保护下限
dislike_punish: float        # 惩罚系数，由房主配置 (0.0-1.0)
```

### 4.2 阶段一：队长选举 (elect_captains)

**输入：** players, votes
**输出：** Tuple[Player, Player] (captain_a, captain_b)

**算法流程：**
1. 初始化所有玩家票数为0
2. 遍历 votes，累加票数
3. 按票数降序排序，`random.random()` 作为平局打破
4. 取前两名作为队长
5. 随机打乱 A/B 分配（票数高的不一定是A队）
6. 设置 `is_captain=True` 和 `team` 属性

**边界情况：**
- 无人投票：随机选两人
- 只有1人得票：第二人随机选

### 4.3 阶段三：分队算法 (divide_teams)

**输入：**
- players, captains, player_prefs, captain_prefs, dislike_punish

**输出：** Tuple[TeamDivisionResult, List[str]] (结果, 日志)

**算法流程：**

#### 1. 初始化
```python
team_a = [captain_a.id]
team_b = [captain_b.id]
remaining_players = [非队长玩家]  # 随机打乱顺序
max_team_size = len(players) // 2
```

#### 2. 逐个分配玩家
对于每个待分配玩家：

**A. 强制平衡检查**
- 如果 A队已满 → 自动分配至 B队
- 如果 B队已满 → 自动分配至 A队

**B. 计算权重**
```
初始: weight_a = 1.0, weight_b = 1.0

个人倾向加成：
  - 倾向A队: weight_a += 2.0
  - 倾向B队: weight_b += 2.0

不想同队惩罚：
  - 不想同队的人在A队: weight_a *= dislike_punish (默认0.5)
  - 不想同队的人在B队: weight_b *= dislike_punish

队长心仪加成：
  - 队长A想要: weight_a += 2.5
  - 队长B想要: weight_b += 2.5

权重保护: weight = max(weight, 0.1)
```

**C. 概率随机判定**
```python
prob_a = weight_a / (weight_a + weight_b)
if random.random() < prob_a:
    分配至 A队
else:
    分配至 B队
```

**日志记录：**
- 每个玩家的权重详情
- 分配概率
- 随机判定结果

---

## 五、UI交互流程 (app.py)

### 5.1 全局设置

**页面配置：**
```python
st.set_page_config(page_title="LOL内战分队 - 多房间版", layout="wide")
st_autorefresh(interval=3000, key="datarefresh")  # 3秒刷新
```

**Session State：**
```python
st.session_state.my_player    # 当前玩家对象
st.session_state.room_id      # 当前房间ID
```

### 5.2 登录/房间选择界面

**触发条件：** `not st.session_state.my_player or not st.session_state.room_id`

**两个 Tab：**

#### 加入已有房间
- 显示所有活跃房间列表
- 输入昵称
- 点击房间卡片上的"加入房间"按钮
- 调用 `room.add_player(name)`

#### 创建新房间
- 输入昵称
- 输入房间名称（默认："{name}的内战房间"）
- 点击"立即创建并进入"
- 调用 `manager.create_room()`

### 5.3 房间内主逻辑

**进入条件：** 已登录且有有效房间

**自动阶段控制：**
```python
if not room.captains and len(room.players) >= 2:
    if len(room.confirmed_voters) >= len(room.players):
        # 全员确认投票 → 自动选举队长

elif not room.result:
    if len(room.confirmed_pref_voters) >= len(room.players):
        # 全员确认偏好 → 自动分队
```

#### 阶段判断逻辑：
| 条件 | 阶段 |
|------|------|
| not room.captains | election (选举) |
| captains 存在但 result 不存在 | preference (偏好) |
| result 存在 | result (结果) |

### 5.4 侧边栏 (sidebar)

**显示内容：**
- 房间号
- 当前玩家名
- 房主标识（如果是房主）
- 退出房间按钮
- 成员列表（带状态图标）

**成员状态图标逻辑：**
```
选举阶段:
  - 在 confirmed_voters 中 → ✓ 勾选
  - 不在 → ⏳ 旋转加载圈

偏好阶段:
  - 在 confirmed_pref_voters 中 → ✓ 勾选
  - 不在 → ⏳ 旋转加载圈
```

**房主专属区域：**
- 踢人功能：选择玩家 → 确认踢出
- 解散房间按钮
- 规避强度滑块：0-100%，实时保存到 `room.avoidance_intensity`

### 5.5 阶段一：队长选举 (election)

**UI组件：**
- 说明文字
- 多选框：选择 0-2 名队长候选人
- 确认投票按钮（点击后禁用）
- 圆形进度条：显示投票进度百分比

**交互逻辑：**
```python
if 点击确认投票:
    保存/更新 vote 到 room.votes
    将玩家ID加入 room.confirmed_voters
    st.rerun()  # 刷新页面
```

**房主特权：**
- "提前结束投票并生成队长"按钮
- 无需等待所有人确认，立即触发选举

### 5.6 阶段二：偏好提交 (preference)

**显示选举结果：**
- 展开器显示所有玩家得票数
- 宣布两位队长（A队和B队）
- 房主可"废除结果并重新选举"

#### 队长界面：
- 显示"你是队长，无需选队"
- 多选框：选择心仪队员（可多选）
- 确认锁定 / 重新修改 按钮

#### 普通玩家界面：
- **倾向选择**：下拉框
  - 🎲 随机
  - 🚩 跟随队长A (A队)
  - 🚩 跟随队长B (B队)
- **不想同队**：多选框，最多选1人（排除自己和两位队长）
- 确认锁定 / 重新修改 按钮

**交互逻辑：**
```python
确认锁定时:
    保存 PlayerPreference 到 room.player_prefs
    将玩家ID加入 room.confirmed_pref_voters

重新修改时:
    从 room.confirmed_pref_voters 移除玩家ID
```

**房主特权：**
- "开始最终分队"按钮（手动触发）
- 即使不是全员确认，房主也可强制分队

### 5.7 阶段三：分队结果 (result)

**显示内容：**
- 投票详情展开器
- 两队卡片（A队蓝色边框，B队红色边框）
- 每个队员显示名称，队长额外标注

**房主操作：**
- "重新打乱分队"：用相同参数重新运行算法
- "彻底重来"：清空所有状态，回到选举阶段

**房主专属：**
- 算法逻辑日志展开器
- 显示每个玩家的权重计算、概率、判定结果

### 5.8 异常处理

| 场景 | 处理 |
|------|------|
| 房间不存在 | 显示错误，清空 session，返回首页按钮 |
| 玩家被踢出 | 显示警告，清空 session，返回首页按钮 |
| 房间过期 | get_room 返回 None，同"房间不存在"处理 |

---

## 六、关键交互细节

### 6.1 玩家重名处理
- `add_player` 检查同名则返回现有玩家对象
- 允许重复进入，保持同一身份

### 6.2 投票修改
- 点击"确认投票"前可多选框自由修改
- 确认后按钮禁用，无法修改
- 只有房主"重新选举"可重置所有投票

### 6.3 偏好修改
- 普通玩家和队长都有"重新修改"按钮
- 点击后从 confirmed_pref_voters 移除，解除锁定

### 6.4 队伍人数保证
- 算法确保两队人数相等
- 优先强制平衡，不考虑偏好

### 6.5 规避强度计算
```python
# UI显示: 0-100%
# 算法使用: 1.0-0.0
punish_factor = 1.0 - (room.avoidance_intensity / 100.0)

# 示例:
# 0%   → punish_factor = 1.0 (无惩罚)
# 50%  → punish_factor = 0.5 (默认)
# 100% → punish_factor = 0.0 (极力避免)
```

---

## 七、重构注意事项

### 7.1 必须保留的核心逻辑

1. **三阶段流程**：选举 → 偏好 → 结果
2. **自动推进**：全员确认后自动进入下一阶段
3. **房主特权**：踢人、解散、提前结束、重新选举、强制分队
4. **权重算法**：基础1.0 + 个人倾向2.0 + 队长心仪2.5 + 规避惩罚
5. **人数平衡**：必须严格两队人数相等
6. **房间生命周期**：1小时无活动自动清理

### 7.2 需要重新设计的部分

| 原实现 | P2P重构方案 |
|--------|-------------|
| Streamlit 轮询 | WebRTC 数据通道实时同步 |
| 服务器内存存储 | Yjs CRDT 分布式状态 |
| 房主中心化管理 | 房主作为"主机节点" |
| Python 算法 | 移植为 JavaScript |
| CSS 样式 | Vue/React + Tailwind |

### 7.3 状态同步冲突处理

**当前无冲突（单服务器）：** 所有操作原子性执行

**P2P需要处理：**
- 多人同时投票：Yjs 自动合并数组
- 房主踢人时有人提交偏好：需要冲突解决策略
- 建议：房主操作优先级最高，覆盖其他操作

### 7.4 算法确定性

分队算法使用 `random.random()`，需要确保：
- 所有客户端使用相同随机种子，或
- 只在房主端执行算法，广播结果

**推荐：** 保持只在"主机"执行算法，结果广播给所有节点

### 7.5 数据持久化

**当前：** 纯内存，重启丢失
**P2P可选：**
- 纯内存（房主关闭即消失）
- localStorage 备份（房主刷新页面可恢复）

---

## 八、文件清单

| 文件 | 功能 | 重构方式 |
|------|------|----------|
| app.py | Streamlit UI (645行) | 重写为 Vue 组件 |
| engine.py | 分队算法 (137行) | 移植为 JS |
| models.py | 数据模型 (33行) | 移植为 JS + 类型定义 |
| state_manager.py | 房间管理 (79行) | 替换为 Yjs Store |
| requirements.txt | 依赖列表 | 替换为 package.json |
| install.bat | 安装脚本 | 删除（纯前端无需安装） |
| run.bat | 启动脚本 | 删除 |

---

## 九、快速参考：核心数据流

```
创建房间
  ↓
房主进入 → 显示房间号
  ↓
其他玩家加入（通过房间号或房间列表）
  ↓
阶段1: 所有人投票选队长 → 确认
  ↓
全员确认 → 自动选举（得票前2名）
  ↓
阶段2:
  - 普通玩家: 选倾向队伍 + 不想同队的人 → 确认
  - 队长: 选心仪队员 → 确认
  ↓
全员确认（或房主强制）→ 运行分队算法
  ↓
阶段3: 显示分队结果 + 算法日志
  ↓
可选: 重新打乱 / 彻底重来 / 解散房间
```

---

*文档版本: 1.0*
*最后更新: 2026-03-05*
