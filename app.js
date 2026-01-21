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
  matchLabel: '',
  battery: null
}

const el = (id) => document.getElementById(id)

let rafId = 0
let chartRuntime = null

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

  const active = navItems.find((n) => n.getAttribute('data-target') === name)
  if(active) active.classList.add('active')

  if(name === 'live'){
    el('backBtn').style.visibility = 'visible'
    el('topTitle').textContent = 'わたしのバット'
  }else{
    el('backBtn').style.visibility = 'hidden'
    el('topTitle').textContent = name === 'history' ? 'ふりかえり' : 'わたしのバット'
  }

  if(name === 'history') startMarkerLoop()
  else stopMarkerLoop()
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

function setBatteryText(pct){
  const text = (typeof pct === 'number' && isFinite(pct))
    ? ('バッテリー ' + String(Math.max(0, Math.min(100, Math.round(pct)))) + '%')
    : 'バッテリー --%'
  const a = el('batteryTextHome')
  const b = el('batteryTextLive')
  if(a) a.textContent = text
  if(b) b.textContent = text
}

function syncDerivedFromLogsOnly(){
  const taps = state.logs.filter((x) => x.type === 'tap').length
  state.tapCount = taps
  updateLive()
  el('totalTapCount').innerHTML = String(taps) + '<span class="countUnit">回</span>'
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
  for(let i = 0; i < delta; i++){
    state.logs.push({ t: t + i * 20, type: 'tap' })
  }

  if(state.logs.length > 5000) state.logs = state.logs.slice(state.logs.length - 5000)

  saveLogs()
  syncDerivedFromLogsOnly()
}

async function readBatteryOnce(server){
  try{
    const svc = await server.getPrimaryService('battery_service')
    const chr = await svc.getCharacteristic('battery_level')
    const v = await chr.readValue()
    const pct = v.getUint8(0)
    state.battery = pct
    setBatteryText(pct)

    try{
      await chr.startNotifications()
      chr.addEventListener('characteristicvaluechanged', (e) => {
        const vv = e.target.value
        const pp = vv.getUint8(0)
        state.battery = pp
        setBatteryText(pp)
      })
    }catch(e2){}
  }catch(e){
    setBatteryText(null)
  }
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
        optionalServices: [BLE.serviceUUID, 'battery_service']
      })
    }catch(e1){
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE.namePrefix }],
        optionalServices: [BLE.serviceUUID, 'battery_service']
      })
    }

    state.device = device
    state.device.addEventListener('gattserverdisconnected', onDisconnected)

    state.server = await device.gatt.connect()

    await readBatteryOnce(state.server)

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
  state.battery = null
  setBatteryText(null)

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

function getStartTime(){
  if(state.logs.length === 0) return null
  let t = state.logs[0].t
  for(const x of state.logs){
    if(typeof x.t === 'number' && x.t < t) t = x.t
  }
  return t
}

function startMarkerLoop(){
  stopMarkerLoop()
  const tick = () => {
    updateTimeMarker()
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopMarkerLoop(){
  if(rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function updateTimeMarker(){
  if(!chartRuntime) return
  const startT = chartRuntime.startT
  if(!startT) return

  const minuteMs = 60000
  const elapsedMin = Math.max(0, (nowMs() - startT) / minuteMs)
  const xNow = chartRuntime.xOfMin(elapsedMin)

  if(chartRuntime.marker){
    chartRuntime.marker.setAttribute('cx', xNow.toFixed(2))
    chartRuntime.marker.setAttribute('cy', String(chartRuntime.yHold))
  }

  if(chartRuntime.holdLine){
    chartRuntime.holdLine.setAttribute('x2', xNow.toFixed(2))
    chartRuntime.holdLine.setAttribute('y1', String(chartRuntime.yHold))
    chartRuntime.holdLine.setAttribute('y2', String(chartRuntime.yHold))
  }

  const meta = el('chartMeta')
  if(meta){
    meta.textContent = '開始0分 / いま' + String(Math.floor(elapsedMin)) + '分'
  }

  if(chartRuntime.chartWrap){
    const wrap = chartRuntime.chartWrap
    const rightEdge = xNow - wrap.clientWidth * 0.6
    if(rightEdge > wrap.scrollLeft){
      wrap.scrollLeft = rightEdge
    }
  }
}

function pickYTicks(maxC, yOf){
  const ticks = []
  ticks.push({ v: 0, y: yOf(0) })
  ticks.push({ v: maxC, y: yOf(maxC) })

  if(maxC >= 2){
    const mid = Math.round(maxC / 2)
    const yMid = yOf(mid)
    const y0 = ticks[0].y
    const yM = yMid
    const yMax = ticks[1].y

    const minGap = 22
    if(Math.abs(y0 - yM) >= minGap && Math.abs(yM - yMax) >= minGap){
      ticks.splice(1, 0, { v: mid, y: yMid })
    }
  }

  return ticks
}

function drawHistoryChart(){
  const svg = el('chartSvg')
  const wrap = svg ? svg.parentElement : null

  const H = 360
  const padL = 52
  const padR = 14
  const padT = 28
  const padB = 62
  const yBase = H - padB

  while(svg.firstChild) svg.removeChild(svg.firstChild)
  chartRuntime = null

  const startT = getStartTime()
  if(!startT){
    const W0 = 360
    svg.setAttribute('width', String(W0))
    svg.setAttribute('height', String(H))
    svg.setAttribute('viewBox', '0 0 ' + String(W0) + ' ' + String(H))
    drawEmptyChart(svg, W0, H, padL, padR, padT, padB)
    const meta = el('chartMeta')
    if(meta) meta.textContent = '開始0分 / いま0分'
    return
  }

  const nowT = nowMs()
  const minuteMs = 60000
  let binsTime = Math.floor((nowT - startT) / minuteMs) + 1
  if(binsTime < 2) binsTime = 2
  if(binsTime > 240) binsTime = 240

  const pxPerMin = 26
  const minW = 360
  const W = Math.max(minW, padL + padR + (binsTime - 1) * pxPerMin)

  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  svg.setAttribute('viewBox', '0 0 ' + String(W) + ' ' + String(H))

  const taps = state.logs.filter((x) => x.type === 'tap')

  let lastTapIdx = -1
  for(const ev of taps){
    const idx = Math.floor((ev.t - startT) / minuteMs)
    if(idx > lastTapIdx) lastTapIdx = idx
  }

  let binsLine = Math.max(2, lastTapIdx + 1)
  if(binsLine > binsTime) binsLine = binsTime

  const counts = new Array(binsLine).fill(0)
  for(const ev of taps){
    const idx = Math.floor((ev.t - startT) / minuteMs)
    if(idx >= 0 && idx < binsLine) counts[idx] = counts[idx] + 1
  }

  const maxC = Math.max(1, ...counts)

  const xOf = (i) => padL + i * pxPerMin
  const xOfMin = (minF) => {
    const m = Math.max(0, Math.min(binsTime - 1, minF))
    return padL + m * pxPerMin
  }
  const yOf = (c) => {
    const r = c / maxC
    const h = (H - padT - padB)
    return padT + mul((1 - r), h)
  }

  // 横軸ラベルの間引き
  const labelMinPx = 46
  const labelEvery = Math.max(1, Math.ceil(labelMinPx / pxPerMin))

  // 目盛線
  for(let i = 0; i < binsTime; i++){
    const x = xOf(i)

    const grid = svgEl('line')
    grid.setAttribute('x1', x.toFixed(2))
    grid.setAttribute('x2', x.toFixed(2))
    grid.setAttribute('y1', String(padT))
    grid.setAttribute('y2', String(yBase))
    grid.setAttribute('stroke', 'rgba(0,0,0,.06)')
    grid.setAttribute('stroke-width', '2')
    svg.appendChild(grid)

    if(i === 0 || i === binsTime - 1 || (i % labelEvery === 0)){
      const label = svgEl('text')
      label.setAttribute('x', x.toFixed(2))
      label.setAttribute('y', String(H - 18))
      label.setAttribute('text-anchor', i === 0 ? 'start' : (i === binsTime - 1 ? 'end' : 'middle'))
      label.setAttribute('font-size', '12')
      label.setAttribute('font-family', 'system-ui')
      label.setAttribute('fill', 'rgba(40,46,60,.62)')
      label.textContent = String(i) + '分'
      svg.appendChild(label)
    }
  }

  // 縦軸ラベル
  const yLabel = svgEl('text')
  yLabel.setAttribute('x', String(16))
  yLabel.setAttribute('y', String(padT + 10))
  yLabel.setAttribute('text-anchor', 'start')
  yLabel.setAttribute('font-size', '12')
  yLabel.setAttribute('font-family', 'system-ui')
  yLabel.setAttribute('fill', 'rgba(40,46,60,.72)')
  yLabel.textContent = '回'
  svg.appendChild(yLabel)

  // 縦軸目盛
  const yTicks = pickYTicks(maxC, yOf)
  for(const t of yTicks){
    const hline = svgEl('line')
    hline.setAttribute('x1', String(padL))
    hline.setAttribute('x2', String(W - padR))
    hline.setAttribute('y1', String(t.y))
    hline.setAttribute('y2', String(t.y))
    hline.setAttribute('stroke', 'rgba(0,0,0,.05)')
    hline.setAttribute('stroke-width', '2')
    svg.appendChild(hline)

    const txt = svgEl('text')
    txt.setAttribute('x', String(padL - 10))
    txt.setAttribute('y', String(t.y + 4))
    txt.setAttribute('text-anchor', 'end')
    txt.setAttribute('font-size', '12')
    txt.setAttribute('font-family', 'system-ui')
    txt.setAttribute('fill', 'rgba(40,46,60,.62)')
    txt.textContent = String(t.v)
    svg.appendChild(txt)
  }

  // 線と面（最後の叩打まで）
  let dLine = ''
  for(let i = 0; i < binsLine; i++){
    const x = xOf(i)
    const y = yOf(counts[i])
    dLine += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
  }

  const x0 = xOf(0)
  const xN = xOf(binsLine - 1)

  const area = svgEl('path')
  area.setAttribute('d', dLine + 'L ' + xN.toFixed(2) + ' ' + String(yBase) + ' L ' + x0.toFixed(2) + ' ' + String(yBase) + ' Z')
  area.setAttribute('fill', 'rgba(0,199,172,.24)')
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
  base.setAttribute('stroke', 'rgba(0,0,0,.14)')
  base.setAttribute('stroke-width', '2')
  svg.appendChild(base)

  // chance/pinch マーカー
  const marks = state.logs.filter((x) => (x.type === 'chance' || x.type === 'pinch'))
  for(const m of marks){
    const ratio = (m.t - startT) / Math.max(1, (nowT - startT))
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

  // 黒丸は常に先頭（いま）にいる
  // 縦位置は「最後の叩打の高さ」を保持して、先に行っても落ちないようにする
  let yHold = yBase
  if(binsLine >= 2){
    const last = counts[binsLine - 1]
    yHold = yOf(last)
  }else if(binsLine === 1){
    yHold = yOf(counts[0])
  }

  // 先頭までの保持線（薄いガイド）
  const holdLine = svgEl('line')
  holdLine.setAttribute('x1', String(xN))
  holdLine.setAttribute('x2', String(xN))
  holdLine.setAttribute('y1', String(yHold))
  holdLine.setAttribute('y2', String(yHold))
  holdLine.setAttribute('stroke', 'rgba(40,46,60,.22)')
  holdLine.setAttribute('stroke-width', '2')
  holdLine.setAttribute('stroke-dasharray', '6 8')
  svg.appendChild(holdLine)

  const marker = svgEl('circle')
  marker.setAttribute('cx', String(xN))
  marker.setAttribute('cy', String(yHold))
  marker.setAttribute('r', '7')
  marker.setAttribute('fill', 'rgba(40,46,60,.88)')
  marker.setAttribute('stroke', 'rgba(255,255,255,.9)')
  marker.setAttribute('stroke-width', '2')
  svg.appendChild(marker)

  chartRuntime = {
    startT,
    marker,
    holdLine,
    xOfMin,
    chartWrap: wrap,
    yHold
  }

  const meta = el('chartMeta')
  if(meta){
    const elapsedMin = Math.max(0, (nowT - startT) / minuteMs)
    meta.textContent = '開始0分 / いま' + String(Math.floor(elapsedMin)) + '分'
  }

  updateTimeMarker()
}

function drawEmptyChart(svg, W, H, padL, padR, padT, padB){
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
  base.setAttribute('x1', String(padL))
  base.setAttribute('x2', String(W - padR))
  base.setAttribute('y1', String(H - padB))
  base.setAttribute('y2', String(H - padB))
  base.setAttribute('stroke', 'rgba(0,0,0,.12)')
  base.setAttribute('stroke-width', '2')
  svg.appendChild(base)

  const label = svgEl('text')
  label.setAttribute('x', String(padL))
  label.setAttribute('y', String(H - 18))
  label.setAttribute('text-anchor', 'start')
  label.setAttribute('font-size', '12')
  label.setAttribute('font-family', 'system-ui')
  label.setAttribute('fill', 'rgba(40,46,60,.62)')
  label.textContent = '0分'
  svg.appendChild(label)

  const yLabel = svgEl('text')
  yLabel.setAttribute('x', String(16))
  yLabel.setAttribute('y', String(padT + 10))
  yLabel.setAttribute('text-anchor', 'start')
  yLabel.setAttribute('font-size', '12')
  yLabel.setAttribute('font-family', 'system-ui')
  yLabel.setAttribute('fill', 'rgba(40,46,60,.72)')
  yLabel.textContent = '回'
  svg.appendChild(yLabel)
}

function initNav(){
  const navItems = Array.from(document.querySelectorAll('.navItem'))
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const t = item.getAttribute('data-target')
      if(t === 'home') showScreen('home')
      else if(t === 'history') showScreen('history')
      else toast('じゅんびちゅう')
    })
  })
}

function init(){
  loadPersist()

  el('bleHint').textContent = bleSupportHint()
  setBatteryText(null)

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
