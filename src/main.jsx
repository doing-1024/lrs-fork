import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ROLES = {
  WEREWOLF: '狼人',
  SEER: '预言家',
  WITCH: '女巫',
  HUNTER: '猎人',
  GUARD: '守卫',
  VILLAGER: '村民',
  IDIOT: '白痴',
};

const ROLE_POOL = [
  ROLES.WEREWOLF,
  ROLES.WEREWOLF,
  ROLES.WEREWOLF,
  ROLES.SEER,
  ROLES.WITCH,
  ROLES.HUNTER,
  ROLES.GUARD,
  ROLES.VILLAGER,
  ROLES.VILLAGER,
  ROLES.IDIOT,
];

const PHASES = {
  READY: '准备',
  NIGHT: '夜晚',
  DAY: '白天讨论',
  VOTE: '投票',
  OVER: '结束',
};

const STORAGE_KEY = 'werewolf-ai-web-settings';

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  models: Array.from({ length: 10 }, () => 'gpt-4o-mini'),
  temperature: 0.7,
  maxTokens: 180,
};

function normalizeModels(value, fallbackModel = 'gpt-4o-mini') {
  const models = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => String(models[index] || fallbackModel).trim() || fallbackModel);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createPlayers() {
  const roles = shuffle(ROLE_POOL);
  return roles.map((role, id) => ({ id, role, alive: true }));
}

function extractTarget(text, alivePlayers, fallback = -1) {
  const match = String(text).match(/-?\d+/);
  if (!match) return fallback;
  const value = Number(match[0]);
  if (value === -1) return -1;
  return alivePlayers.some((player) => player.id === value) ? value : fallback;
}

function countVotes(votes) {
  const counts = new Map();
  for (const target of Object.values(votes)) {
    if (target < 0) continue;
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  let winner = -1;
  let max = 0;
  let tied = false;
  for (const [target, count] of counts) {
    if (count > max) {
      winner = target;
      max = count;
      tied = false;
    } else if (count === max) {
      tied = true;
    }
  }
  return tied ? -1 : winner;
}

function checkWinner(players) {
  const aliveWerewolves = players.filter((player) => player.alive && player.role === ROLES.WEREWOLF).length;
  const aliveGood = players.filter((player) => player.alive && player.role !== ROLES.WEREWOLF).length;
  if (aliveWerewolves === 0) return '好人阵营获胜：所有狼人已死亡。';
  if (aliveWerewolves >= aliveGood) return '狼人阵营获胜：狼人数量已不少于好人。';
  return '';
}

function normalizeBaseUrl(url) {
  if (!url) return 'https://api.openai.com/v1/chat/completions';
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned.startsWith('http')) {
    cleaned = 'https://' + cleaned;
  }
  if (!cleaned.includes('/v1/')) {
    cleaned = cleaned.replace(/\/v1$/, '') + '/v1';
  }
  if (!cleaned.endsWith('/chat/completions')) {
    cleaned = cleaned.replace(/\/chat\/completions$/, '') + '/chat/completions';
  }
  return cleaned;
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const fallbackModel = stored.model || DEFAULT_SETTINGS.models[0];
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      models: normalizeModels(stored.models, fallbackModel),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function askAi(settings, model, systemPrompt, userPrompt, signal) {
  const response = await fetch(settings.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: Number(settings.temperature),
      max_tokens: Number(settings.maxTokens),
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `请求失败：${response.status}`);
  }
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [settingsOpen, setSettingsOpen] = useState(!settings.apiKey);
  const [players, setPlayers] = useState(() => createPlayers());
  const [phase, setPhase] = useState(PHASES.READY);
  const [round, setRound] = useState(1);
  const [logs, setLogs] = useState([]);
  const [speeches, setSpeeches] = useState([]);
  const [running, setRunning] = useState(false);
  const [winner, setWinner] = useState('');
  const abortRef = useRef(null);
  const logEndRef = useRef(null);

  const alivePlayers = useMemo(() => players.filter((player) => player.alive), [players]);
  const deadPlayers = useMemo(() => players.filter((player) => !player.alive), [players]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function addLog(type, title, content, playerId = null) {
    setLogs((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random()}`,
        round,
        phase,
        type,
        title,
        content,
        playerId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      },
    ]);
  }

  function saveSettings(event) {
    event.preventDefault();
    const next = {
      ...settingsDraft,
      baseUrl: normalizeBaseUrl(settingsDraft.baseUrl),
      apiKey: settingsDraft.apiKey.trim(),
      models: normalizeModels(settingsDraft.models),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSettings(next);
    setSettingsOpen(false);
  }

  function updateDraftModel(index, value) {
    const models = normalizeModels(settingsDraft.models);
    models[index] = value;
    setSettingsDraft({ ...settingsDraft, models });
  }

  function fillAllDraftModels() {
    const firstModel = normalizeModels(settingsDraft.models)[0];
    setSettingsDraft({ ...settingsDraft, models: Array.from({ length: 10 }, () => firstModel) });
  }

  function resetGame() {
    abortRef.current?.abort();
    setPlayers(createPlayers());
    setPhase(PHASES.READY);
    setRound(1);
    setLogs([]);
    setSpeeches([]);
    setWinner('');
    setRunning(false);
  }

  function stopGame() {
    abortRef.current?.abort();
    addLog('system', '游戏已停止', '当前运行已由用户手动停止。');
    setRunning(false);
  }

  function makeSystemPrompt(player, visibleSpeeches = speeches) {
    const aliveList = alivePlayers.map((item) => `玩家${item.id}`).join('、');
    const history = visibleSpeeches.length
      ? visibleSpeeches.map((item) => `第${item.round}天 玩家${item.playerId}: ${item.content}`).join('\n')
      : '暂无公开发言。';
    const wolfMates = players
      .filter((item) => item.alive && item.role === ROLES.WEREWOLF && item.id !== player.id)
      .map((item) => `玩家${item.id}`)
      .join('、') || '无';

    return [
      `你正在进行 10 人 AI 狼人杀，你是玩家${player.id}，身份是【${player.role}】。`,
      '角色配置：3狼人、1预言家、1女巫、1猎人、1守卫、2村民、1白痴。',
      `存活玩家：${aliveList}`,
      player.role === ROLES.WEREWOLF ? `你的狼同伴：${wolfMates}` : '',
      `公开讨论记录：\n${history}`,
      '保持角色立场。夜晚和投票必须按要求只输出目标数字或指定格式。白天发言用中文，30到70字。',
    ].filter(Boolean).join('\n');
  }

  async function requestPlayer(activeSettings, player, userPrompt, fallback, visibleSpeeches = speeches) {
    const model = activeSettings.models[player.id] || activeSettings.models[0];
    addLog('thinking', `玩家${player.id} 思考中`, `${userPrompt}\n模型：${model}`, player.id);
    try {
      const answer = await askAi(activeSettings, model, makeSystemPrompt(player, visibleSpeeches), userPrompt, abortRef.current.signal);
      addLog('speech', `玩家${player.id} · ${player.role} · ${model}`, answer || fallback, player.id);
      return answer || fallback;
    } catch (error) {
      const message = error.name === 'AbortError' ? '游戏已停止。' : error.message;
      addLog('error', `玩家${player.id} 请求失败`, `${message} 已使用默认行动：${fallback}`, player.id);
      return fallback;
    }
  }

  function eliminate(playerIds) {
    const uniqueIds = [...new Set(playerIds.filter((id) => id >= 0))];
    if (!uniqueIds.length) return;
    setPlayers((current) => current.map((player) => (
      uniqueIds.includes(player.id) ? { ...player, alive: false } : player
    )));
  }

  async function runGame() {
    const latestSettings = loadSettings();
    setSettings(latestSettings);
    setSettingsDraft(latestSettings);
    
    addLog('system', '点击开始游戏', `正在读取配置。Base URL: ${latestSettings.baseUrl}, 模型: ${latestSettings.models[0]}`);

    if (!latestSettings.apiKey) {
      setSettingsOpen(true);
      addLog('error', '缺少 API Key', '请先在设置中填写 OpenAI 兼容 API Key。');
      return;
    }

    if (!latestSettings.baseUrl) {
      setSettingsOpen(true);
      addLog('error', '缺少 Base URL', '请先在设置中填写接口地址。');
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setRunning(true);
    setWinner('');
    addLog('system', '游戏开始', `角色已随机分配，所有 AI 玩家进入第一夜。已配置 ${latestSettings.models.length} 个玩家模型。`);

    let localPlayers = players;
    let localSpeeches = speeches;
    let currentRound = round;

    let completed = false;
    while (!abortRef.current.signal.aborted && currentRound <= 20) {
      setRound(currentRound);
      setPhase(PHASES.NIGHT);
      addLog('night', `第 ${currentRound} 夜`, '夜幕降临，狼人、预言家、女巫、守卫依次行动。');

      const localAlive = localPlayers.filter((player) => player.alive);
      const wolves = localAlive.filter((player) => player.role === ROLES.WEREWOLF);
      const wolfActor = wolves[0];
      let wolfTarget = -1;
      if (wolfActor) {
        const candidates = localAlive.filter((player) => player.role !== ROLES.WEREWOLF);
        const fallback = candidates[0]?.id ?? localAlive[0]?.id ?? -1;
        const answer = await requestPlayer(latestSettings, wolfActor, `今晚选择击杀目标。只回复一个玩家数字，可选：${localAlive.map((item) => item.id).join(', ')}`, String(fallback), localSpeeches);
        wolfTarget = extractTarget(answer, localAlive, fallback);
      }

      const seer = localAlive.find((player) => player.role === ROLES.SEER);
      if (seer) {
        const fallback = localAlive.find((player) => player.id !== seer.id)?.id ?? -1;
        const answer = await requestPlayer(latestSettings, seer, `今晚选择查验目标。只回复一个玩家数字，可选：${localAlive.map((item) => item.id).join(', ')}`, String(fallback), localSpeeches);
        const target = extractTarget(answer, localAlive, fallback);
        const checked = localPlayers.find((player) => player.id === target);
        if (checked) addLog('system', '预言家查验', `玩家${target} 的身份是 ${checked.role}。`, seer.id);
      }

      const guard = localAlive.find((player) => player.role === ROLES.GUARD);
      let guardTarget = -1;
      if (guard) {
        const fallback = guard.id;
        const answer = await requestPlayer(latestSettings, guard, `今晚选择守护目标。只回复一个玩家数字，可选：${localAlive.map((item) => item.id).join(', ')}`, String(fallback), localSpeeches);
        guardTarget = extractTarget(answer, localAlive, fallback);
      }

      const witch = localAlive.find((player) => player.role === ROLES.WITCH);
      let witchPoison = -1;
      let witchSave = false;
      if (witch) {
        const fallback = 'pass';
        const answer = await requestPlayer(
          latestSettings,
          witch,
          `狼人今晚攻击玩家${wolfTarget}。你可以回复 "save ${wolfTarget}" 救人，回复 "poison X" 毒杀一名存活玩家，或回复 "pass"。`,
          fallback,
          localSpeeches,
        );
        const lower = answer.toLowerCase();
        witchSave = lower.includes('save') && wolfTarget >= 0;
        witchPoison = lower.includes('poison') ? extractTarget(answer, localAlive, -1) : -1;
      }

      const nightDeaths = [];
      if (wolfTarget >= 0 && wolfTarget !== guardTarget && !witchSave) nightDeaths.push(wolfTarget);
      if (witchPoison >= 0) nightDeaths.push(witchPoison);

      if (nightDeaths.length) {
        eliminate(nightDeaths);
        localPlayers = localPlayers.map((player) => nightDeaths.includes(player.id) ? { ...player, alive: false } : player);
        addLog('death', '夜晚结算', `玩家 ${[...new Set(nightDeaths)].join('、')} 死亡。`);
      } else {
        addLog('safe', '夜晚结算', '今晚是平安夜，无人死亡。');
      }

      let result = checkWinner(localPlayers);
      if (result) {
        setWinner(result);
        setPhase(PHASES.OVER);
        addLog('result', '游戏结束', result);
        completed = true;
        break;
      }

      setPhase(PHASES.DAY);
      addLog('day', `第 ${currentRound} 天`, '所有存活玩家依次发言。');
      const dayAlive = localPlayers.filter((player) => player.alive);
      for (const player of dayAlive) {
        const answer = await requestPlayer(latestSettings, player, `现在是第${currentRound}天白天讨论。请基于局势发言，中文30到70字。`, '我先观察大家发言，重点看投票和夜晚死亡信息。', localSpeeches);
        const record = { round: currentRound, playerId: player.id, content: answer };
        localSpeeches = [...localSpeeches, record];
        setSpeeches(localSpeeches);
      }

      setPhase(PHASES.VOTE);
      addLog('vote', `第 ${currentRound} 天投票`, '所有存活玩家开始投票放逐。');
      const votes = {};
      for (const player of dayAlive) {
        const candidates = dayAlive.filter((item) => item.id !== player.id);
        const fallback = candidates[0]?.id ?? -1;
        const answer = await requestPlayer(latestSettings, player, `请投票放逐一名存活玩家，只回复数字，弃权回复 -1。可选：${dayAlive.map((item) => item.id).join(', ')}`, String(fallback), localSpeeches);
        votes[player.id] = extractTarget(answer, dayAlive, -1);
      }
      const votedOut = countVotes(votes);
      addLog('vote', '投票结果', Object.entries(votes).map(([voter, target]) => `玩家${voter}->${target}`).join('，'));
      if (votedOut >= 0) {
        eliminate([votedOut]);
        localPlayers = localPlayers.map((player) => player.id === votedOut ? { ...player, alive: false } : player);
        addLog('death', '放逐结算', `玩家${votedOut} 被放逐，身份是 ${localPlayers.find((player) => player.id === votedOut)?.role}。`);
      } else {
        addLog('safe', '放逐结算', '平票或弃权，本轮无人被放逐。');
      }

      result = checkWinner(localPlayers);
      if (result) {
        setWinner(result);
        setPhase(PHASES.OVER);
        addLog('result', '游戏结束', result);
        completed = true;
        break;
      }
      currentRound += 1;
    }

    if (currentRound > 20 && !completed && !abortRef.current.signal.aborted) {
      setWinner('游戏超过 20 轮，强制结束。');
      setPhase(PHASES.OVER);
    }
    setRunning(false);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI Werewolf Web Fork</p>
          <h1>AI 狼人杀网页版</h1>
          <p className="subtitle">10 名 AI 玩家自动完成夜晚行动、白天发言与投票，游戏进程实时展示在可视化时间线中。</p>
        </div>
        <div className="actions">
          <button className="secondary" type="button" onClick={() => setSettingsOpen(true)}>API 设置</button>
          <button className="secondary" type="button" onClick={resetGame} disabled={running}>重开</button>
          <button className="secondary" type="button" onClick={stopGame} disabled={!running}>停止</button>
          <button className="primary" type="button" onClick={runGame} disabled={running}>{running ? '游戏运行中' : '开始游戏'}</button>
        </div>
      </section>

      <section className="dashboard">
        <article className="status-card phase-card">
          <span>当前阶段</span>
          <strong>{phase}</strong>
          <small>第 {round} 轮</small>
        </article>
        <article className="status-card">
          <span>存活</span>
          <strong>{alivePlayers.length}</strong>
          <small>{alivePlayers.map((player) => `#${player.id}`).join(' ')}</small>
        </article>
        <article className="status-card">
          <span>出局</span>
          <strong>{deadPlayers.length}</strong>
          <small>{deadPlayers.map((player) => `#${player.id}`).join(' ') || '暂无'}</small>
        </article>
        <article className="status-card result-card">
          <span>胜负</span>
          <strong>{winner || '未分出'}</strong>
        </article>
      </section>

      <section className="content-grid">
        <aside className="panel roster">
          <div className="panel-title">
            <h2>玩家席位</h2>
            <span>身份仅供观战</span>
          </div>
          <div className="players">
            {players.map((player) => (
              <div className={`player-card ${player.alive ? 'alive' : 'dead'} ${player.role === ROLES.WEREWOLF ? 'wolf' : ''}`} key={player.id}>
                <span className="avatar">{player.id}</span>
                <div>
                  <strong>玩家 {player.id}</strong>
                  <small>{player.role} · {player.alive ? '存活' : '出局'}</small>
                  <small className="model-name">{settings.models[player.id] || settings.models[0]}</small>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="panel timeline-panel">
          <div className="panel-title">
            <h2>游戏进程</h2>
            <span>{logs.length} 条事件</span>
          </div>
          <div className="timeline">
            {logs.length === 0 && <div className="empty">点击“开始游戏”后，AI 行动、发言和投票会显示在这里。</div>}
            {logs.map((log) => (
              <article className={`event ${log.type}`} key={log.id}>
                <div className="event-dot" />
                <div className="event-body">
                  <div className="event-head">
                    <strong>{log.title}</strong>
                    <span>{log.time}</span>
                  </div>
                  <p>{log.content}</p>
                </div>
              </article>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      </section>

      {settingsOpen && (
        <div className="modal-backdrop">
          <form className="settings-modal" onSubmit={saveSettings}>
            <div className="panel-title">
              <h2>API 设置</h2>
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>关闭</button>
            </div>
            <label>
              <span>Base URL <small style={{ opacity: 0.6, fontWeight: 400 }}>（保存时自动修正）</small></span>
              <input value={settingsDraft.baseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, baseUrl: event.target.value })} placeholder="api.openai.com / https://api.openai.com/v1" />
            </label>
            <label>
              <span>API Key</span>
              <input type="password" value={settingsDraft.apiKey} onChange={(event) => setSettingsDraft({ ...settingsDraft, apiKey: event.target.value })} placeholder="sk-..." />
            </label>
            <div className="model-settings">
              <div className="model-settings-head">
                <span>玩家模型</span>
                <button type="button" className="ghost compact" onClick={fillAllDraftModels}>用玩家0填充全部</button>
              </div>
              <div className="model-grid">
                {normalizeModels(settingsDraft.models).map((model, index) => (
                  <label className="model-field" key={index}>
                    <span>玩家 {index}</span>
                    <input value={model} onChange={(event) => updateDraftModel(index, event.target.value)} placeholder="gpt-4o-mini / deepseek-chat" />
                  </label>
                ))}
              </div>
            </div>
            <div className="inline-fields">
              <label>
                <span>Temperature</span>
                <input type="number" step="0.1" min="0" max="2" value={settingsDraft.temperature} onChange={(event) => setSettingsDraft({ ...settingsDraft, temperature: event.target.value })} />
              </label>
              <label>
                <span>Max Tokens</span>
                <input type="number" min="32" max="1000" value={settingsDraft.maxTokens} onChange={(event) => setSettingsDraft({ ...settingsDraft, maxTokens: event.target.value })} />
              </label>
            </div>
            <p className="hint">配置会保存到浏览器 localStorage，不再写死在代码里。注意浏览器直连接口需要 API 服务允许 CORS。</p>
            <button className="primary full" type="submit">保存设置</button>
          </form>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
