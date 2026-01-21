'use strict'

const BLE = {
  name: 'XIAO-MOTOR',
  namePrefix: 'XIAO',
  serviceUUID: '19B10000-E8F2-537E-4F6C-D104768A1214',
  commandCharUUID: '19B10001-E8F2-537E-4F6C-D104768A1214',
  tapCharUUID: '19B10002-E8F2-537E-4F6C-D104768A1214'
}

const CMD = { stop: 0, chance: 1, pinch: 2 }

const KEY = {
  logs: 'pinc_logs_v1',
  debug: 'pinc_debug_v1',
  match: 'pinc_match_v1'
}

const state = {
  device: null,
  server: null,
  commandChar: null,
  tapChar: null,
  connected: false,
  tapCount: 0,
  lastDeviceTapCount: 0,
  logs: [],
  debug: false,
  matchLabel: ''
}

const el = (id) => document.getElementById(id)

function toast(msg){
  const t = el('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 1800)
}

function showSheet(on){
  const s = el('sheet')
  if(on){
    s.hidden = false
    requestAnimationFrame(() => s.classList.add('open'))
  }else{
    s.classList.remove('open')
    setTimeout(() => { s.hidden = true }, 120)
  }
}

function showScreen(name){
  const map = { home: 'screen-home', live: 'screen-live', history: 'screen-history' }
  Object.values(map).forEach((id) => el(id).classList.remove('active'))
  el(map[name]).classList.add('active')

  const navItems = Array.from(document.querySelectorAll('.navItem'))
  navItems.forEach((n) => n.classList.remove('active'))
  if(name === 'home') navItems[0].classList.add('active')
  if(name === 'history') navItems[1].classList.add('active')

  if(name === 'live'){
    el('backBtn').style.visibility = 'visible'
    el('topTitle').textContent = 'わたしのバット'
  }else{
    el('backBtn').style.visibility = 'hidden'
    el('topTitle').textContent = name === 'history' ? 'ふりかえり' : 'わたしのバット'
  }
}

function setConnected(on){
  state.connected = on
  const badge1 = el('connBadge')
  const badge2 = el('connBadge2')
  const txt1 = el('connText')
  const txt2 = el('connText2')
  const btnText = el('connectBtnText')

  if(on){
    badge1.classList.remove('off')
    badge2.classList.remove('off')
    txt1.textContent = 'つながっている'
    txt2.textContent = 'つながっている'
    btnText.textContent = 'つなぎなおす'
  }else{
    badge1.classList.add('off')
    badge2.classList.add('off')
    txt1.textContent = 'つながっていない'
    txt2.textContent = 'つながっていない'
    btnText.textContent = 'つなぐ'
  }

  const enable = on
  const b1 = el('sendChanceBtn')
  const b2 = el('sendPinchBtn')
  const b3 = el('stopBtn')
  if(b1) b1.disabled = !enable
  if(b2) b2.disabled = !enable
  if(b3) b3.disabled = !enable
}

function clamp01(x){
  if(x < 0) return 0
  if(x > 1) return 1
  return x
}

function mul(a, b){
  return a / (1 / b)
}

function nowMs(){
  return Date.now()
}

function loadPersist(){
  try{
    const raw = localStorage.getItem(KEY.logs)
    if(raw){
      const arr = JSON.parse(raw)
      if(Array.isArray(arr)) state.logs = arr
    }
  }catch(e){}

  try{
    const d = localStorage.getItem(KEY.debug)
    state.debug = d === '1'
  }catch(e){}

  try{
    const m = localStorage.getItem(KEY.match)
    if(m) state.matchLabel = m
  }catch(e){}
}

function saveLogs(){
  try{
    localStorage.setItem(KEY.logs, JSON.stringify(state.logs))
  }catch(e){}
}

function addLog(type){
  state.logs.push({ t: nowMs(), type })
  if(state.logs.length > 5000) state.logs.shift()
  saveLogs()
  syncDerivedFromLogsOnly()
}

function clearLogs(){
  state.logs = []
  saveLogs()
  syncDerivedFromLogsOnly()
  toast('ログをけした')
}

function setDebug(on){
  state.debug = on
  try{ localStorage.setItem(KEY.debug, on ? '1' : '0') }catch(e){}
  syncDebug()
}

function syncDebug(){
  const a = el('debugBlock')
  const b = el('debugLive')
  if(a) a.hidden = !state.debug
  if(b) b.hidden = !state.debug
}

function updateLive(){
  el('liveCount').textContent = String(state.tapCount)
}

function syncMatchLabel(){
  const label = state.matchLabel || '9/5 vs ○○'
  el('matchLabel').textContent = label
  el('matchInput').value = state.matchLabel
}

function setMatchLabel(v){
  state.matchLabel = String(v || '')
  try{ localStorage.setItem(KEY.match, state.matchLabel) }catch(e){}
  syncMatchLabel()
}

function syncDerivedFromLogsOnly(){
  const taps = state.logs.filter((x) => x.type === 'tap').length
  state.tapCount = taps
  updateLive()
  el('totalTapCount').innerHTML = String(taps) + '<span class="countUnit">回</span>'

  const c = state.logs.filter((x) => x.type === 'chance').length
  const p = state.logs.filter((x) => x.type === 'pinch').length
  const ch = document.getElementById('chanceHint')
  const ph = document.getElementById('pinchHint')
  if(ch) ch.textContent = String(c) + 'かい'
  if(ph) ph.textContent = String(p) + 'かい'

  drawHistoryChart()
}

function exportCsv(){
  const header = 't,type\n'
  const rows = state.logs.map((x) => String(x.t) + ',' + x.type).join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pinc_logs.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast('CSVをつくった')
}

function safeText(err){
  const s = String(err || '')
  if(!s) return ''
  return s.slice(0, 180)
}

function bleSupportHint(){
  if(!('bluetooth' in navigator)){
    return 'Bluetoothがつかえないブラウザです。Bluefyでひらいてください。'
  }
  return 'つなぐ をおして、XIAO-MOTOR をえらびます。'
}

function readU32LE(dataView){
  const b0 = dataView.getUint8(0)
  const b1 = dataView.getUint8(1)
  const b2 = dataView.getUint8(2)
  const b3 = dataView.getUint8(3)
  return (b0) + (b1 << 8) + (b2 << 16) + ((b3 << 24) >>> 0)
}

function onTapNotify(e){
  const v = e.target.value
  if(!v || v.byteLength < 4) return

  const newCount = readU32LE(v)
  const prev = state.lastDeviceTapCount
  state.lastDeviceTapCount = newCount

  if(newCount < prev){
    toast('カウントがリセットされた')
    return
  }

  const delta = newCount - prev
  if(delta <= 0) return

  const t = nowMs()

  // ここが改善点：同時刻に固まらないように少しずつ時刻をずらす
  for(let i = 0; i < delta; i++){
    state.logs.push({ t: t + i * 20, type: 'tap' })
  }

  if(state.logs.length > 5000) state.logs = state.logs.slice(state.logs.length - 5000)

  saveLogs()
  syncDerivedFromLogsOnly()
}

async function connectBLE(){
  if(!('bluetooth' in navigator)){
    toast('Bluetoothにたいおうしていない')
    return
  }

  try{
    toast('さがしている…')

    let device = null

    try{
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: BLE.name }],
        optionalServices: [BLE.serviceUUID]
      })
    }catch(e1){
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE.namePrefix }],
        optionalServices: [BLE.serviceUUID]
      })
    }

    state.device = device
    state.device.addEventListener('gattserverdisconnected', onDisconnected)

    state.server = await device.gatt.connect()
    const service = await state.server.getPrimaryService(BLE.serviceUUID)

    state.commandChar = await service.getCharacteristic(BLE.commandCharUUID)

    try{
      state.tapChar = await service.getCharacteristic(BLE.tapCharUUID)
      await state.tapChar.startNotifications()
      state.tapChar.addEventListener('characteristicvaluechanged', onTapNotify)
      if(state.debug) toast('tap通知OK')
    }catch(eTap){
      state.tapChar = null
      if(state.debug) toast('tap通知NG')
    }

    setConnected(true)
    toast('つながった')
  }catch(err){
    setConnected(false)
    toast('つなげなかった')
    const hint = safeText(err)
    if(hint) el('bleHint').textContent = hint
  }
}

function onDisconnected(){
  try{
    if(state.tapChar){
      state.tapChar.removeEventListener('characteristicvaluechanged', onTapNotify)
    }
  }catch(e){}

  state.tapChar = null
  state.commandChar = null
  state.server = null

  setConnected(false)
  toast('きれた')
}

async function sendCommand(cmd){
  if(!state.commandChar){
    toast('つながっていない')
    return
  }

  try{
    const u8 = new Uint8Array([cmd & 0xff])
    await state.commandChar.writeValue(u8)

    if(cmd === CMD.chance) addLog('chance')
    if(cmd === CMD.pinch) addLog('pinch')

    if(cmd === CMD.chance) toast('チャンス')
    else if(cmd === CMD.pinch) toast('ピンチ')
    else toast('停止')
  }catch(err){
    toast('おくれなかった')
  }
}

function svgEl(name){
  return document.createElementNS('http://www.w3.org/2000/svg', name)
}

function drawHistoryChart(){
  const svg = el('chartSvg')
  const W = 360
  const H = 360
  const padL = 10
  const padR = 10
  const padT = 34
  const padB = 58

  while(svg.firstChild) svg.removeChild(svg.firstChild)

  const taps = state.logs.filter((x) => x.type === 'tap')
  if(taps.length < 2){
    drawEmptyChart(svg, W, H)
    return
  }

  const t0 = taps[0].t
  const t1 = taps[taps.length - 1].t
  const span = Math.max(1, t1 - t0)

  const bins = 30
  const counts = new Array(bins).fill(0)

  for(const ev of taps){
    const ratio = (ev.t - t0) / span
    const idxF = mul(ratio, bins)
    const idx = Math.max(0, Math.min(bins - 1, Math.floor(idxF)))
    counts[idx] = counts[idx] + 1
  }

  const maxC = Math.max(1, ...counts)

  const xOf = (i) => {
    const r = i / (bins - 1)
    const w = (W - padL - padR)
    return padL + mul(r, w)
  }

  const yOf = (c) => {
    const r = c / maxC
    const h = (H - padT - padB)
    const v = padT + mul((1 - r), h)
    return v
  }

  let dLine = ''
  for(let i = 0; i < bins; i++){
    const x = xOf(i)
    const y = yOf(counts[i])
    dLine += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
  }

  const x0 = xOf(0)
  const xN = xOf(bins - 1)
  const yBase = H - padB

  const area = svgEl('path')
  area.setAttribute('d', dLine + 'L ' + xN.toFixed(2) + ' ' + String(yBase) + ' L ' + x0.toFixed(2) + ' ' + String(yBase) + ' Z')
  area.setAttribute('fill', 'rgba(0,199,172,.28)')
  svg.appendChild(area)

  const line = svgEl('path')
  line.setAttribute('d', dLine)
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', 'rgba(0,199,172,.95)')
  line.setAttribute('stroke-width', '4')
  line.setAttribute('stroke-linecap', 'round')
  svg.appendChild(line)

  const base = svgEl('line')
  base.setAttribute('x1', String(padL))
  base.setAttribute('x2', String(W - padR))
  base.setAttribute('y1', String(yBase))
  base.setAttribute('y2', String(yBase))
  base.setAttribute('stroke', 'rgba(0,0,0,.12)')
  base.setAttribute('stroke-width', '2')
  svg.appendChild(base)

  const marks = state.logs.filter((x) => (x.type === 'chance' || x.type === 'pinch'))
  for(const m of marks){
    const ratio = (m.t - t0) / span
    const x = padL + mul(clamp01(ratio), (W - padL - padR))

    const c = svgEl('circle')
    c.setAttribute('cx', x.toFixed(2))
    c.setAttribute('cy', String(padT + 10))
    c.setAttribute('r', '6')
    c.setAttribute('fill', m.type === 'chance' ? '#ffd400' : '#ff6b7a')
    c.setAttribute('stroke', 'rgba(0,0,0,.12)')
    c.setAttribute('stroke-width', '2')
    svg.appendChild(c)
  }
}

function drawEmptyChart(svg, W, H){
  const txt = svgEl('text')
  txt.setAttribute('x', String(W / 2))
  txt.setAttribute('y', String(H / 2))
  txt.setAttribute('text-anchor', 'middle')
  txt.setAttribute('font-size', '14')
  txt.setAttribute('font-family', 'system-ui')
  txt.setAttribute('fill', 'rgba(122,132,153,.9)')
  txt.textContent = 'ログがまだない'
  svg.appendChild(txt)

  const base = svgEl('line')
  base.setAttribute('x1', '10')
  base.setAttribute('x2', String(W - 10))
  base.setAttribute('y1', String(H - 58))
  base.setAttribute('y2', String(H - 58))
  base.setAttribute('stroke', 'rgba(0,0,0,.12)')
  base.setAttribute('stroke-width', '2')
  svg.appendChild(base)
}

function initNav(){
  const navItems = Array.from(document.querySelectorAll('.navItem'))
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const t = item.getAttribute('data-target')
      if(t === 'home') showScreen('home')
      else if(t === 'history') showScreen('history')
      else toast('みじっそう')
    })
  })

  el('navFab').addEventListener('click', () => showScreen('history'))
}

function init(){
  loadPersist()

  el('bleHint').textContent = bleSupportHint()

  syncDebug()
  syncMatchLabel()

  setConnected(false)
  syncDerivedFromLogsOnly()

  el('batTap').addEventListener('click', () => showScreen('live'))

  el('tapCircle').addEventListener('click', () => addLog('tap'))
  el('goHistoryBtn').addEventListener('click', () => showScreen('history'))
  el('toHistoryFromLive').addEventListener('click', () => showScreen('history'))
  el('backBtn').addEventListener('click', () => showScreen('home'))

  el('connectBtn').addEventListener('click', async () => {
    if(state.connected && state.device && state.device.gatt && state.device.gatt.connected){
      toast('つながっている')
      return
    }
    await connectBLE()
  })

  el('reconnectBtn').addEventListener('click', async () => {
    await connectBLE()
  })

  el('sendChanceBtn').addEventListener('click', () => sendCommand(CMD.chance))
  el('sendPinchBtn').addEventListener('click', () => sendCommand(CMD.pinch))
  el('stopBtn').addEventListener('click', () => sendCommand(CMD.stop))

  el('incTap').addEventListener('click', () => addLog('tap'))
  el('resetSession').addEventListener('click', () => {
    clearLogs()
    toast('この回をリセット')
  })

  el('exportCsv').addEventListener('click', exportCsv)

  el('settingsBtn').addEventListener('click', () => showSheet(true))
  el('sheetBackdrop').addEventListener('click', () => showSheet(false))
  el('sheetClose').addEventListener('click', () => showSheet(false))

  el('toggleDebug').addEventListener('click', () => {
    setDebug(!state.debug)
    toast('デバッグをきりかえ')
  })

  el('clearLogs').addEventListener('click', clearLogs)

  el('matchInput').addEventListener('change', (e) => setMatchLabel(e.target.value))

  initNav()

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
}

init()
