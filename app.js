// ══════════════════════════════════════════════════════
//  SAFE STORAGE (iOS Private Browsing guard)
// ══════════════════════════════════════════════════════
const _store = (()=>{
  const mem = {};
  let ls = null;
  try { localStorage.setItem('_t','1'); localStorage.removeItem('_t'); ls = localStorage; } catch(e) {}
  return {
    get(k)    { try { return ls ? ls.getItem(k) : (mem[k]??null); } catch(e) { return mem[k]??null; } },
    set(k,v)  { try { if(ls) ls.setItem(k,v); else mem[k]=v; } catch(e) { mem[k]=v; } },
    remove(k) { try { if(ls) ls.removeItem(k); else delete mem[k]; } catch(e) { delete mem[k]; } }
  };
})();

// ══════════════════════════════════════════════════════
//  CLIENT ID
// ══════════════════════════════════════════════════════
const clientId = (_store.get('vt_cid') || (()=>{
  const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  _store.set('vt_cid', id); return id;
})());

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let state = { vessels: [], activeVesselId: null };
let currentView = 'dashboard';

function loadState() {
  try { const s = _store.get('vesseltrack_v2'); if (s) state = JSON.parse(s); } catch(e) {}
}
function saveState() {
  state._cid = clientId; state._ts = Date.now();
  
  // 1. Save everything to local storage
  _store.set('vesseltrack_v2', JSON.stringify(state));
  
  // 2. Sync to Firebase, but strip out the local UI state first
  if (syncRef && syncConfig.enabled) {
    const syncPayload = Object.assign({}, state);
    delete syncPayload.activeVesselId; // Prevent hijacking other users' screens
    syncRef.set(syncPayload).catch(e=>console.warn(e));
  }
}
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function getActiveVessel() { return state.vessels.find(v=>v.id===state.activeVesselId); }

// ══════════════════════════════════════════════════════
//  VIEW SWITCHING
// ══════════════════════════════════════════════════════
function switchView(view) {
  currentView = view;
  document.getElementById('navDash').className    = 'view-tab' + (view==='dashboard'    ? ' active' : '');
  document.getElementById('navFleet').className   = 'view-tab' + (view==='fleet'        ? ' active' : '');
  document.getElementById('navCerts').className   = 'view-tab' + (view==='certificates' ? ' active' : '');
  document.getElementById('navRepairs').className = 'view-tab' + (view==='repairs'      ? ' active' : '');
  document.getElementById('dashboardView').style.display = view==='dashboard'    ? 'block' : 'none';
  document.getElementById('vesselTabs').style.display    = 'none';
  document.getElementById('mainContent').style.display   = view==='fleet'        ? 'flex'  : 'none';
  document.getElementById('certView').style.display      = view==='certificates' ? 'flex'  : 'none';
  document.getElementById('repairView').style.display    = view==='repairs'      ? 'flex'  : 'none';
  if (view==='dashboard')    renderDashboard();
  else if (view==='fleet')   { renderSidebar(); renderContent(); }
  else if (view==='certificates') renderCertView();
  else if (view==='repairs') renderRepairView();
}

// ══════════════════════════════════════════════════════
//  PARENT PROGRESS AUTO-CALC
// ══════════════════════════════════════════════════════
function updateParentFromSubtasks(parentId) {
  if (!parentId) return;
  const vessel = getActiveVessel(); if (!vessel) return;
  const parent = vessel.tasks.find(t=>t.id===parentId); if (!parent) return;
  const subs = vessel.tasks.filter(t=>t.parentId===parentId);
  if (!subs.length) return;
  const avgPct = Math.round(subs.reduce((s,t)=>s+(+t.pct||0),0)/subs.length);
  parent.pct = avgPct;
  const allDone = subs.every(t=>t.status==='complete');
  const anyInProgress = subs.some(t=>t.status==='inprogress'||t.pct>0);
  const anyAtRisk = subs.some(t=>t.status==='atrisk');
  if (allDone && avgPct===100) parent.status='complete';
  else if (anyAtRisk) parent.status='atrisk';
  else if (anyInProgress && parent.status==='notstarted') parent.status='inprogress';
  else if (avgPct===0 && parent.status==='complete') parent.status='notstarted';
}

// ══════════════════════════════════════════════════════
//  FIREBASE
// ══════════════════════════════════════════════════════
const DEFAULT_FIREBASE_CONFIG = {
  apiKey:"AIzaSyCpnVNMocz54tuDTM2pqaYBFZPsQE4OLA8",
  authDomain:"database-e6851.firebaseapp.com",
  databaseURL:"https://database-e6851-default-rtdb.firebaseio.com",
  projectId:"database-e6851",
  storageBucket:"database-e6851.firebasestorage.app",
  messagingSenderId:"738312398642",
  appId:"1:738312398642:web:546219e72be4787594192b",
  measurementId:"G-9DEKZMQEHD"
};
const DEFAULT_ROOM_ID = "MAL-Fleet-Tracker";

let db=null, syncRef=null, repairsRef=null;
let syncConfig = { enabled:false, roomId:'', firebaseConfigStr:'' };

function loadSyncConfig() {
  try {
    const s = _store.get('vt_sync');
    if (s) syncConfig = JSON.parse(s);
    if (syncConfig.enabled && syncConfig.roomId && syncConfig.firebaseConfigStr)
      _initFirebase(syncConfig.firebaseConfigStr, syncConfig.roomId, false);
    else
      _initFirebase(JSON.stringify(DEFAULT_FIREBASE_CONFIG), DEFAULT_ROOM_ID, false);
  } catch(e) {
    _initFirebase(JSON.stringify(DEFAULT_FIREBASE_CONFIG), DEFAULT_ROOM_ID, false);
  }
}
function saveSyncConfig() { _store.set('vt_sync', JSON.stringify(syncConfig)); }

function openSyncModal() {
  document.getElementById('syncRoomId').value    = syncConfig.roomId || DEFAULT_ROOM_ID;
  document.getElementById('syncConfigJson').value= syncConfig.firebaseConfigStr || JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2);
  document.getElementById('syncDisconnectBtn').style.display = syncConfig.enabled ? 'inline-flex' : 'none';
  document.getElementById('syncStatusMsg').textContent = syncConfig.enabled
    ? '✅ Connected — Room: '+syncConfig.roomId : '⚡ Default config pre-loaded.';
  openModal('syncModal');
}

function connectSync() {
  const roomId = document.getElementById('syncRoomId').value.trim().replace(/[^a-zA-Z0-9_-]/g,'-');
  const cfgStr = document.getElementById('syncConfigJson').value.trim();
  if (!roomId || !cfgStr) return;
  _initFirebase(cfgStr, roomId, true);
}

function _initFirebase(cfgStr, roomId, showToastMsg) {
  try {
    let cfg; try { cfg=JSON.parse(cfgStr); } catch(e) {
      let c=cfgStr.trim().replace(/^const\s+\w+\s*=\s*/,'').replace(/;$/,'').replace(/'/g,'"');
      c=c.replace(/([{,]\s*)([a-zA-Z0-9]+)\s*:/g,'$1"$2":'); cfg=JSON.parse(c);
    }
    if (!cfg.databaseURL) { alert('Firebase config must include databaseURL'); return; }
    try { firebase.app().delete(); } catch(e) {}
    const app = firebase.initializeApp(cfg,'vt_'+Date.now());
    db=firebase.database(app); syncRef=db.ref('vesseltrack/'+roomId);
    syncConfig = { enabled:true, roomId, firebaseConfigStr:cfgStr };
    saveSyncConfig();
    syncRef.on('value', snap=>{
      const d=snap.val();
      if (d && d._ts>(state._ts||0)) { 
        // 1. Capture the user's current local tab selection
        const localActiveId = state.activeVesselId;
        
        // 2. Accept the incoming data
        state = d; 
        
        // 3. Re-apply the local tab selection
        state.activeVesselId = localActiveId;
        
        // Fallback: If no tab is active, select the first one
        if (!state.activeVesselId && state.vessels && state.vessels.length > 0) {
          state.activeVesselId = state.vessels[0].id;
        }

        renderCurrentView(); 
      }
    });
    // ── Listen for new repair requests from fleet_repairs/ ──
    initRepairsListener();
    setSyncUI(true);
    if (showToastMsg) { closeModal('syncModal'); showToast('🟢 Live sync connected — Room: '+roomId); }
  } catch(err) { alert('Connection failed: '+err.message); }
}

function disconnectSync() {
  if (syncRef) { try{syncRef.off();}catch(e){} syncRef=null; }
  if (repairsRef) { try{repairsRef.off();}catch(e){} repairsRef=null; }
  try{firebase.app().delete();}catch(e){}
  db=null; syncConfig={enabled:false,roomId:'',firebaseConfigStr:''};
  saveSyncConfig(); setSyncUI(false); closeModal('syncModal');
  showToast('Sync disconnected');
}

function setSyncUI(connected) {
  const dot=document.getElementById('syncDot'), lbl=document.getElementById('syncLabel');
  const btn=document.getElementById('syncDisconnectBtn');
  if (dot) dot.className='sync-dot'+(connected?' live':'');
  if (lbl) lbl.textContent=connected?'Live':'Local';
  if (btn) btn.style.display=connected?'inline-flex':'none';
  const msg=document.getElementById('syncStatusMsg');
  if (msg&&connected) msg.textContent='✅ Connected. Room: '+syncConfig.roomId;
}

// ══════════════════════════════════════════════════════
//  EMAIL ALERTS (EmailJS)
// ══════════════════════════════════════════════════════
let emailConfig = { enabled:false, serviceId:'', templateId:'', publicKey:'', fromName:'VesselTrack', alertAssign:true, alertStatus:true, alertOverdue:true };
let emailLog = {};

function loadEmailConfig() {
  try {
    const s=_store.get('vt_email'); if(s) emailConfig=JSON.parse(s);
    const l=_store.get('vt_emaillog'); if(l) emailLog=JSON.parse(l);
    setEmailUI();
    if (emailConfig.enabled) {
      emailjs.init({ publicKey: emailConfig.publicKey });
      checkOverdueAlerts();
    }
  } catch(e) {}
}

function saveEmailConfigStore() { _store.set('vt_email', JSON.stringify(emailConfig)); }
function logEmail(key) { emailLog[key]=Date.now(); _store.set('vt_emaillog',JSON.stringify(emailLog)); }
function emailAlreadySent(key) { const ts=emailLog[key]; return ts && (Date.now()-ts)<23*60*60*1000; }

function openEmailModal() {
  document.getElementById('ejServiceId').value  = emailConfig.serviceId  || '';
  document.getElementById('ejTemplateId').value = emailConfig.templateId || '';
  document.getElementById('ejPublicKey').value  = emailConfig.publicKey  || '';
  document.getElementById('ejFromName').value   = emailConfig.fromName   || 'VesselTrack';
  document.getElementById('ejAlertAssign').checked  = emailConfig.alertAssign  !== false;
  document.getElementById('ejAlertStatus').checked  = emailConfig.alertStatus  !== false;
  document.getElementById('ejAlertOverdue').checked = emailConfig.alertOverdue !== false;
  document.getElementById('emailTestMsg').textContent = emailConfig.enabled ? '✅ Email alerts are active' : '';
  document.getElementById('emailDisableBtn').style.display = emailConfig.enabled ? 'inline-flex' : 'none';
  openModal('emailModal');
}

function saveEmailConfig() {
  const svc  = document.getElementById('ejServiceId').value.trim();
  const tmpl = document.getElementById('ejTemplateId').value.trim();
  const key  = document.getElementById('ejPublicKey').value.trim();
  if (!svc||!tmpl||!key) { alert('Please fill in Service ID, Template ID, and Public Key'); return; }
  emailConfig = {
    enabled: true, serviceId:svc, templateId:tmpl, publicKey:key,
    fromName: document.getElementById('ejFromName').value.trim() || 'VesselTrack',
    alertAssign:  document.getElementById('ejAlertAssign').checked,
    alertStatus:  document.getElementById('ejAlertStatus').checked,
    alertOverdue: document.getElementById('ejAlertOverdue').checked
  };
  emailjs.init({ publicKey: key });
  saveEmailConfigStore(); setEmailUI(); closeModal('emailModal');
  showToast('📧 Email alerts enabled ✓');
  checkOverdueAlerts();
}

function disableEmail() {
  emailConfig.enabled = false; saveEmailConfigStore(); setEmailUI();
  closeModal('emailModal'); showToast('Email alerts disabled');
}

function setEmailUI() {
  const dot=document.getElementById('emailDot'), lbl=document.getElementById('emailLabel');
  if (dot) dot.className='email-dot'+(emailConfig.enabled?' active':'');
  if (lbl) lbl.textContent=emailConfig.enabled?'Alerts On':'Alerts Off';
}

async function testEmail() {
  if (!emailConfig.serviceId) { alert('Please fill in and save your EmailJS credentials first'); return; }
  const msg = document.getElementById('emailTestMsg');
  msg.textContent = 'Sending test…';
  try {
    await emailjs.send(emailConfig.serviceId, emailConfig.templateId, {
      to_name:     'VesselTrack User',
      to_email:    'test@example.com',
      from_name:   emailConfig.fromName,
      vessel_name: 'MV Test Vessel',
      task_name:   'Test Task',
      status:      'In Progress',
      priority:    'Medium',
      due_date:    new Date().toLocaleDateString(),
      alert_type:  'Test Alert',
      message:     'This is a test alert from VesselTrack. If you see this, email alerts are working!'
    }, emailConfig.publicKey);
    msg.textContent = '✅ Test email sent! Check your inbox.';
    msg.style.color = 'var(--green)';
  } catch(e) {
    msg.textContent = '❌ Failed: '+e.text;
    msg.style.color = 'var(--red)';
  }
}

async function sendTaskEmail(alertType, task, vessel) {
  if (!emailConfig.enabled || !task.assigneeEmail) return;
  const statusMap = { notstarted:'Not Started', inprogress:'In Progress', complete:'Complete', onhold:'On Hold', atrisk:'At Risk' };
  try {
    await emailjs.send(emailConfig.serviceId, emailConfig.templateId, {
      to_name:     task.assignee || 'Team Member',
      to_email:    task.assigneeEmail,
      from_name:   emailConfig.fromName,
      vessel_name: vessel ? vessel.name : 'Fleet',
      task_name:   task.name,
      status:      statusMap[task.status] || task.status,
      priority:    (task.priority||'').charAt(0).toUpperCase()+(task.priority||'').slice(1),
      due_date:    task.endDate || 'Not set',
      alert_type:  alertType,
      message:     task.notes || ''
    }, emailConfig.publicKey);
    showToast('📧 Alert sent to '+task.assigneeEmail);
  } catch(e) {
    console.warn('Email send failed:', e);
  }
}

function checkOverdueAlerts() {
  if (!emailConfig.enabled || !emailConfig.alertOverdue) return;
  const today = new Date().toDateString();
  state.vessels.forEach(vessel => {
    (vessel.tasks||[]).forEach(task => {
      if (!task.assigneeEmail || !isOverdue(task)) return;
      const key = `overdue:${task.id}:${today}`;
      if (!emailAlreadySent(key)) {
        logEmail(key);
        sendTaskEmail('Overdue Alert', task, vessel);
      }
    });
  });
}

// ══════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════
function renderDashboard() {
  const dv = document.getElementById('dashboardView');
  if (!dv) return;

  const vessels   = state.vessels;
  const allTasks  = vessels.flatMap(v=>(v.tasks||[]));
  const today     = new Date();
  const dateStr   = today.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const totalTasks    = allTasks.length;
  const completedT    = allTasks.filter(t=>t.status==='complete').length;
  const inProgressT   = allTasks.filter(t=>t.status==='inprogress').length;
  const onHoldT       = allTasks.filter(t=>t.status==='onhold').length;
  const atRiskT       = allTasks.filter(t=>t.status==='atrisk').length;
  const notStartedT   = allTasks.filter(t=>t.status==='notstarted'||!t.status).length;
  const overdueArr    = allTasks.filter(t=>isOverdue(t));
  const overallPct    = totalTasks ? Math.round(completedT/totalTasks*100) : 0;
  const activeVessels = vessels.filter(v=>v.status==='active').length;

  const statusCounts = {
    complete:   completedT,
    inprogress: inProgressT,
    notstarted: notStartedT,
    onhold:     onHoldT,
    atrisk:     atRiskT
  };

  const donut = buildDonutSVG(statusCounts, totalTasks);

  // Vessel cards HTML
  const vcards = vessels.length ? vessels.map(v=>{
    const vt = v.tasks||[];
    const pt = vt.filter(t=>!t.parentId);
    const vpct = pt.length ? Math.round(pt.reduce((s,t)=>s+(+t.pct||0),0)/pt.length) : 0;
    const vdone = vt.filter(t=>t.status==='complete').length;
    const vrisk = vt.filter(t=>t.status==='atrisk').length;
    const vover = vt.filter(t=>isOverdue(t)).length;
    const fillColor = vpct===100?'var(--green)':vrisk>0?'var(--red)':vover>0?'var(--amber)':'var(--teal)';
    const statusBadge = {active:`<span class="badge badge-complete" style="font-size:10px;padding:2px 8px;">Active</span>`,hold:`<span class="badge badge-onhold" style="font-size:10px;padding:2px 8px;">On Hold</span>`,done:`<span class="badge badge-notstarted" style="font-size:10px;padding:2px 8px;">Done</span>`}[v.status]||'';
    return `<div class="v-card" onclick="goToVessel('${v.id}')">
      <div class="v-card-header">
        <div>
          <div class="v-card-name">${escHtml(v.name)}</div>
          <div class="v-card-meta">${escHtml(v.type)} · ${escHtml(v.imo||'No IMO')} · PM: ${escHtml(v.pm||'—')}</div>
        </div>
        ${statusBadge}
      </div>
      <div class="v-card-progress">
        <div class="v-card-bar"><div class="v-card-fill" style="width:${vpct}%;background:${fillColor};"></div></div>
        <div class="v-card-pct">${vpct}% complete</div>
      </div>
      <div class="v-card-stats">
        <div class="v-card-stat"><span style="color:var(--text-pri)">${vt.length}</span> tasks</div>
        <div class="v-card-stat"><span style="color:var(--green)">${vdone}</span> done</div>
        ${vrisk?`<div class="v-card-stat"><span style="color:var(--red)">${vrisk}</span> at risk</div>`:''}
        ${vover?`<div class="v-card-stat"><span style="color:var(--amber)">${vover}</span> overdue</div>`:''}
      </div>
    </div>`;
  }).join('') : `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-dim);">
      <div style="font-size:40px;margin-bottom:8px;">🚢</div>
      <div style="font-weight:600;color:var(--text-sec);">No vessels yet</div>
      <div style="margin-top:8px;"><button class="btn btn-primary" onclick="openVesselModal()">Add First Vessel</button></div>
    </div>`;

  // Overdue table
  const overdueRows = overdueArr.length ? overdueArr.map(t=>{
    const v = vessels.find(v=>v.tasks&&v.tasks.some(x=>x.id===t.id));
    const daysOver = Math.floor((new Date()-new Date(t.endDate))/(1000*60*60*24));
    return `<tr>
      <td><span onclick="goToVessel('${v?.id}')" style="cursor:pointer;color:var(--teal);font-weight:500;">${escHtml(v?.name||'—')}</span></td>
      <td style="font-weight:500;">${escHtml(t.name)}</td>
      <td>${escHtml(t.assignee||'—')}</td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;">${t.endDate}</td>
      <td><span class="overdue-days">+${daysOver}d</span></td>
      <td><span class="badge badge-${t.status||'notstarted'}" style="font-size:10px;">${{notstarted:'Not Started',inprogress:'In Progress',complete:'Complete',onhold:'On Hold',atrisk:'At Risk'}[t.status||'notstarted']}</span></td>
    </tr>`;
  }).join('') : '';

  // At risk table
  const atRiskArr = allTasks.filter(t=>t.status==='atrisk');
  const atRiskRows = atRiskArr.length ? atRiskArr.map(t=>{
    const v = vessels.find(v=>v.tasks&&v.tasks.some(x=>x.id===t.id));
    return `<tr>
      <td><span onclick="goToVessel('${v?.id}')" style="cursor:pointer;color:var(--teal);font-weight:500;">${escHtml(v?.name||'—')}</span></td>
      <td style="font-weight:500;">${escHtml(t.name)}</td>
      <td>${escHtml(t.assignee||'—')}</td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;">${t.endDate||'—'}</td>
      <td><span class="badge badge-${t.priority||'low'}" style="font-size:10px;">${(t.priority||'low').charAt(0).toUpperCase()+(t.priority||'low').slice(1)}</span></td>
    </tr>`;
  }).join('') : '';

  dv.innerHTML = `
  <div class="dash-header">
    <h1>Fleet Dashboard</h1>
    <p>${dateStr} &nbsp;·&nbsp; ${vessels.length} vessels · ${totalTasks} tasks tracked</p>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card kpi-teal">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M3 17l5-10 4 7 3-5 6 8H3zm0 2h18v2H3v-2z"/></svg></div>
      <div class="kpi-value">${vessels.length}</div>
      <div class="kpi-label">Vessels</div>
      <div class="kpi-sub" style="color:var(--green);">${activeVessels} active</div>
    </div>
    <div class="kpi-card kpi-gray">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg></div>
      <div class="kpi-value">${totalTasks}</div>
      <div class="kpi-label">Total Tasks</div>
      <div class="kpi-sub" style="color:var(--text-dim);">${overallPct}% complete</div>
    </div>
    <div class="kpi-card kpi-green">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
      <div class="kpi-value">${completedT}</div>
      <div class="kpi-label">Completed</div>
      <div class="kpi-sub" style="color:var(--green);">${overallPct}%</div>
    </div>
    <div class="kpi-card kpi-blue">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg></div>
      <div class="kpi-value">${inProgressT}</div>
      <div class="kpi-label">In Progress</div>
      <div class="kpi-sub" style="color:var(--blue);">active now</div>
    </div>
    <div class="kpi-card ${overdueArr.length>0?'kpi-amber':'kpi-gray'}">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg></div>
      <div class="kpi-value">${overdueArr.length}</div>
      <div class="kpi-label">Overdue</div>
      <div class="kpi-sub" style="color:${overdueArr.length>0?'var(--amber)':'var(--text-dim)'};">${overdueArr.length>0?'needs attention':'on track'}</div>
    </div>
    <div class="kpi-card ${atRiskT>0?'kpi-red':'kpi-gray'}">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zm-1 5.5v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg></div>
      <div class="kpi-value">${atRiskT}</div>
      <div class="kpi-label">At Risk</div>
      <div class="kpi-sub" style="color:${atRiskT>0?'var(--red)':'var(--text-dim)'};">${atRiskT>0?'review needed':'all clear'}</div>
    </div>
  </div>

  <div class="dash-body">
    <div>
      <div class="section-title">Vessel Progress</div>
      <div class="vessel-cards">${vcards}</div>
    </div>
    <div>
      <div class="section-title">Status Distribution</div>
      <div class="chart-panel">
        <div class="donut-wrap">
          <svg viewBox="0 0 120 120" width="180" height="180" class="donut-svg">${donut}</svg>
          <div class="donut-legend">
            ${buildLegend(statusCounts, totalTasks)}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="alerts-section">
    <div class="section-title">Alerts &amp; Attention Required</div>
    <div class="alerts-panel">
      <div class="alerts-tabs">
        <div class="alert-tab active" onclick="switchAlertTab('overdue',this)">
          ⏰ Overdue (${overdueArr.length})
        </div>
        <div class="alert-tab" onclick="switchAlertTab('atrisk',this)">
          🚨 At Risk (${atRiskT})
        </div>
      </div>
      <div id="atOverdue" class="alert-tab-content active">
        ${overdueRows ? `<table class="alert-table">
          <thead><tr><th>Vessel</th><th>Task</th><th>Assignee</th><th>Due Date</th><th>Days Over</th><th>Status</th></tr></thead>
          <tbody>${overdueRows}</tbody></table>` :
          `<div class="no-alerts"><div class="no-alerts-icon">✅</div>No overdue tasks — great work!</div>`}
      </div>
      <div id="atRisk" class="alert-tab-content">
        ${atRiskRows ? `<table class="alert-table">
          <thead><tr><th>Vessel</th><th>Task</th><th>Assignee</th><th>Due Date</th><th>Priority</th></tr></thead>
          <tbody>${atRiskRows}</tbody></table>` :
          `<div class="no-alerts"><div class="no-alerts-icon">✅</div>No at-risk tasks — everything looks good!</div>`}
      </div>
    </div>
  </div>`;
}

function buildDonutSVG(counts, total) {
  if (!total) return '<text x="60" y="68" text-anchor="middle" fill="#9ca3af" font-size="11" font-family="DM Sans">No tasks</text>';
  const colors = { complete:'#16a34a', inprogress:'#2563eb', notstarted:'#d1d5db', onhold:'#d97706', atrisk:'#dc2626' };
  const R=46, r=28, cx=60, cy=60;
  let startAngle = -Math.PI/2;
  let paths = '';
  const entries = Object.entries(counts).filter(([,v])=>v>0);
  if (entries.length===1) {
    const [status] = entries[0];
    paths = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${colors[status]}"/>
             <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>`;
  } else {
    entries.forEach(([status, count]) => {
      const angle = (count/total)*2*Math.PI;
      const end = startAngle+angle;
      const x1=cx+R*Math.cos(startAngle), y1=cy+R*Math.sin(startAngle);
      const x2=cx+R*Math.cos(end),        y2=cy+R*Math.sin(end);
      const ix1=cx+r*Math.cos(startAngle),iy1=cy+r*Math.sin(startAngle);
      const ix2=cx+r*Math.cos(end),       iy2=cy+r*Math.sin(end);
      const lg=angle>Math.PI?1:0;
      paths+=`<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${r} ${r} 0 ${lg} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z" fill="${colors[status]}"/>`;
      startAngle=end;
    });
  }
  const pct = total ? Math.round((counts.complete/total)*100) : 0;
  return `${paths}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
    <text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#111827" font-size="14" font-weight="bold" font-family="Bebas Neue,sans-serif">${pct}%</text>
    <text x="${cx}" y="${cy+10}" text-anchor="middle" fill="#9ca3af" font-size="8" font-family="DM Sans,sans-serif">COMPLETE</text>`;
}

function buildLegend(counts, total) {
  const map = [
    { key:'complete',   label:'Complete',    color:'#16a34a' },
    { key:'inprogress', label:'In Progress', color:'#2563eb' },
    { key:'notstarted', label:'Not Started', color:'#d1d5db' },
    { key:'onhold',     label:'On Hold',     color:'#d97706' },
    { key:'atrisk',     label:'At Risk',     color:'#dc2626' }
  ];
  return map.map(({key,label,color})=>`
    <div class="legend-row">
      <div class="legend-dot" style="background:${color};"></div>
      <span class="legend-label">${label}</span>
      <span class="legend-count">${counts[key]||0}</span>
      <span class="legend-pct">${total?(Math.round(((counts[key]||0)/total)*100))+'%':''}</span>
    </div>`).join('');
}

function switchAlertTab(tab, el) {
  document.querySelectorAll('.alert-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.alert-tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(tab==='overdue'?'atOverdue':'atRisk').classList.add('active');
}

function goToVessel(vesselId) {
  state.activeVesselId = vesselId;
  switchView('fleet');
}

// ══════════════════════════════════════════════════════
//  RENDER (fleet view)
// ══════════════════════════════════════════════════════
function renderCurrentView() {
  if (currentView==='dashboard') renderDashboard();
  else { renderTabs(); renderContent(); }
}
function render() { renderTabs(); renderSidebar(); if (currentView==='fleet') renderContent(); else renderDashboard(); }

function renderTabs() {
  const bar=document.getElementById('vesselTabs'); if(!bar) return;
  bar.innerHTML='';
  state.vessels.forEach(v=>{
    const tab=document.createElement('div');
    tab.className='vessel-tab'+(v.id===state.activeVesselId?' active':'');
    tab.innerHTML=`<span class="vessel-dot status-${v.status}"></span>${escHtml(v.name)}<button class="tab-close" onclick="removeVessel('${v.id}',event)">✕</button>`;
    tab.addEventListener('click',()=>{state.activeVesselId=v.id;saveState();renderContent();});
    bar.appendChild(tab);
  });
  const add=document.createElement('div');
  add.className='tab-add'; add.textContent='+'; add.onclick=openVesselModal;
  bar.appendChild(add);
}

function renderSidebar() {
  const sb = document.getElementById('sidebarVessels'); if (!sb) return;
  if (!state.vessels.length) { sb.innerHTML = ''; return; }
  sb.innerHTML = state.vessels.map(v => {
    const vt = v.tasks||[], pt = vt.filter(t=>!t.parentId);
    const vpct = pt.length ? Math.round(pt.reduce((s,t)=>s+(+t.pct||0),0)/pt.length) : 0;
    const vdone = vt.filter(t=>t.status==='complete').length;
    const vrisk = vt.filter(t=>t.status==='atrisk').length;
    const fillColor = vpct===100?'var(--green)':vrisk>0?'var(--red)':'var(--teal)';
    const isActive = v.id === state.activeVesselId;
    return `<div class="s-card${isActive?' active':''}" onclick="selectVesselInFleet('${v.id}')">
      <div class="s-card-top">
        <div class="s-card-dot status-${v.status}"></div>
        <div class="s-card-name" title="${escHtml(v.name)}">${escHtml(v.name)}</div>
        <div class="s-card-pct">${vpct}%</div>
      </div>
      <div class="s-card-bar"><div class="s-card-fill" style="width:${vpct}%;background:${fillColor};"></div></div>
      <div class="s-card-meta">
        <div><span>${vt.length}</span> tasks</div>
        <div><span style="color:var(--green)">${vdone}</span> done</div>
        ${vrisk?`<div><span style="color:var(--red)">${vrisk}</span> risk</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function selectVesselInFleet(id) {
  state.activeVesselId = id;
  saveState();
  renderSidebar();
  renderContent();
}

let sidebarCollapsed = false;
function toggleFleetSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sidebar = document.getElementById('fleetSidebar');
  const expandBtn = document.getElementById('sidebarExpandBtn');
  if (sidebarCollapsed) {
    sidebar.classList.add('collapsed');
    expandBtn.classList.add('visible');
  } else {
    sidebar.classList.remove('collapsed');
    expandBtn.classList.remove('visible');
  }
}

// Fleet sub-view state: 'table' or 'gantt'
let fleetSubView = 'table';
let ganttDayWidth = 28; // px per day, controls zoom

function setFleetSubView(v) {
  fleetSubView = v;
  // Re-render just the content area without rebuilding the header/stats
  const gw  = document.getElementById('ganttWrap');
  const tw  = document.getElementById('tableWrap');
  const addR= document.getElementById('addRowBtn');
  const tBtn= document.getElementById('viewToggleTable');
  const gBtn= document.getElementById('viewToggleGantt');
  const zGrp= document.getElementById('ganttZoomGroup');
  const srch= document.getElementById('fleetSearchBox');
  const eaBtn= document.getElementById('expandAllBtn');
  const caBtn= document.getElementById('collapseAllBtn');
  if (!gw || !tw) { renderContent(); return; }
  if (v === 'gantt') {
    gw.style.display = 'flex';
    tw.style.display = 'none';
    if (addR) addR.style.display = 'none';
    if (zGrp) zGrp.style.display = 'flex';
    if (srch) srch.style.display = 'none';
    if (eaBtn) eaBtn.style.display = 'none';
    if (caBtn) caBtn.style.display = 'none';
    renderGantt();
  } else {
    gw.style.display = 'none';
    tw.style.display = 'flex';
    if (addR) addR.style.display = 'flex';
    if (zGrp) zGrp.style.display = 'none';
    if (srch) srch.style.display = 'flex';
    if (eaBtn) eaBtn.style.display = '';
    if (caBtn) caBtn.style.display = '';
    renderTasks();
  }
  if (tBtn) tBtn.className = 'gantt-toggle-btn' + (v==='table'?' active':'');
  if (gBtn) gBtn.className = 'gantt-toggle-btn' + (v==='gantt'?' active':'');
}

function ganttZoom(delta) {
  ganttDayWidth = Math.max(14, Math.min(80, ganttDayWidth + delta));
  renderGantt();
}

function renderContent() {
  const nv=document.getElementById('noVessels');
  const detail=document.getElementById('vesselDetail');
  renderSidebar();
  if (!state.vessels.length){
    if(nv){nv.style.display='flex';}
    if(detail){detail.style.display='none';}
    return;
  }
  if(nv){nv.style.display='none';}
  if(detail){detail.style.display='flex';}
  const vessel=getActiveVessel();
  if (!vessel){state.activeVesselId=state.vessels[0].id;saveState();renderContent();return;}
  const allTasks=vessel.tasks||[], parentTasks=allTasks.filter(t=>!t.parentId);
  const done=allTasks.filter(t=>t.status==='complete').length;
  const inp=allTasks.filter(t=>t.status==='inprogress').length;
  const risk=allTasks.filter(t=>t.status==='atrisk').length;
  const avgPct=parentTasks.length?Math.round(parentTasks.reduce((s,t)=>s+(+t.pct||0),0)/parentTasks.length):0;
  const isGantt = fleetSubView === 'gantt';
  detail.innerHTML=`
    <div class="vessel-header">
      <div class="vessel-icon"><svg viewBox="0 0 24 24"><path d="M3 17l5-10 4 7 3-5 6 8H3zm0 2h18v2H3v-2z"/></svg></div>
      <div class="vessel-info">
        <h2>${escHtml(vessel.name)}</h2>
        <p>${escHtml(vessel.type)} · ${escHtml(vessel.imo||'—')} · PM: ${escHtml(vessel.pm||'Unassigned')}</p>
      </div>
      <div class="vessel-overall-progress">
        <span class="overall-pct-label">Overall</span>
        <div class="overall-bar"><div class="overall-fill" style="width:${avgPct}%"></div></div>
        <span class="overall-pct-num">${avgPct}%</span>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat-item"><span class="stat-num">${allTasks.length}</span><span class="stat-label">Total Tasks</span></div>
      <div class="stat-item"><span class="stat-num">${done}</span><span class="stat-label">Complete</span></div>
      <div class="stat-item"><span class="stat-num">${inp}</span><span class="stat-label">In Progress</span></div>
      <div class="stat-item" style="${risk?'color:var(--red)':''}"><span class="stat-num" style="${risk?'color:var(--red)':''}">${risk}</span><span class="stat-label">At Risk</span></div>
      <div class="stat-item"><span class="stat-num">${avgPct}%</span><span class="stat-label">Progress</span></div>
    </div>
    <div class="toolbar">
      <div class="toolbar-group">
        <button class="btn btn-primary" onclick="openTaskModal(null)">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add Task
        </button>
      </div>
      <div class="toolbar-sep"></div>
      <!-- View toggle -->
      <div class="gantt-toolbar-group">
        <button id="viewToggleTable" class="gantt-toggle-btn${!isGantt?' active':''}" onclick="setFleetSubView('table')">
          <svg viewBox="0 0 24 24"><path d="M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z"/></svg>Table
        </button>
        <button id="viewToggleGantt" class="gantt-toggle-btn${isGantt?' active':''}" onclick="setFleetSubView('gantt')">
          <svg viewBox="0 0 24 24"><path d="M3 5v14h2V5H3zm4 7h6v2H7v-2zm0-4h10v2H7V8zm0 8h4v2H7v-2z"/></svg>Gantt
        </button>
      </div>
      <div class="toolbar-sep"></div>
      <div class="toolbar-group" id="expandAllBtn" style="display:${isGantt?'none':''}">
        <button class="btn btn-ghost" onclick="expandAll()">Expand All</button>
        <button class="btn btn-ghost" id="collapseAllBtn" onclick="collapseAll()">Collapse All</button>
      </div>
      <!-- Gantt zoom (hidden in table mode) -->
      <div class="gantt-zoom-group" id="ganttZoomGroup" style="display:${isGantt?'flex':'none'}">
        <span style="font-size:11px;color:var(--text-dim);margin-right:2px;">Zoom</span>
        <button class="gantt-zoom-btn" onclick="ganttZoom(-7)" title="Zoom out">−</button>
        <button class="gantt-zoom-btn" onclick="ganttZoom(7)"  title="Zoom in">+</button>
        <button class="gantt-zoom-btn" onclick="ganttFitToday()" title="Jump to today" style="width:auto;padding:0 8px;font-size:10px;font-weight:600;letter-spacing:.04em;">TODAY</button>
      </div>
      <div class="toolbar-sep"></div>
      <button class="btn btn-ghost" onclick="openEditVesselModal()">
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>Edit Vessel
      </button>
      <div class="search-box" id="fleetSearchBox" style="margin-left:auto;display:${isGantt?'none':'flex'}">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" placeholder="Search tasks…" oninput="filterTasks(this.value)"/>
      </div>
      ${isGantt?'<div style="margin-left:auto;"></div>':''}
    </div>
    <!-- TABLE VIEW -->
    <div id="tableWrap" style="display:${isGantt?'none':'flex'};flex-direction:column;flex:1;overflow:hidden;">
      <div class="grid-wrapper">
        <table><thead><tr>
          <th style="width:36px;"></th>
          <th class="col-task">Task Name</th>
          <th class="col-assign">Assigned To</th>
          <th class="col-status">Status</th>
          <th class="col-priority">Priority</th>
          <th class="col-start">Start</th>
          <th class="col-end">Due Date</th>
          <th class="col-pct">Progress</th>
          <th class="col-notes">Notes</th>
          <th class="col-actions">Actions</th>
        </tr></thead><tbody id="taskBody"></tbody></table>
      </div>
      <div class="add-row" id="addRowBtn">
        <button class="btn btn-ghost" onclick="openTaskModal(null)">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add Main Task
        </button>
      </div>
    </div>
    <!-- GANTT VIEW -->
    <div id="ganttWrap" style="display:${isGantt?'flex':'none'};flex:1;overflow:hidden;flex-direction:column;"></div>`;

  if (isGantt) renderGantt();
  else renderTasks();
}

// ══════════════════════════════════════════════════════
//  GANTT CHART RENDERER
// ══════════════════════════════════════════════════════
function renderGantt() {
  const wrap = document.getElementById('ganttWrap');
  if (!wrap) return;
  const vessel = getActiveVessel();
  if (!vessel) { wrap.innerHTML = ''; return; }

  const tasks    = vessel.tasks || [];
  const parents  = tasks.filter(t => !t.parentId);
  const childMap = {};
  tasks.filter(t => t.parentId).forEach(t => {
    if (!childMap[t.parentId]) childMap[t.parentId] = [];
    childMap[t.parentId].push(t);
  });

  // ── Determine date range ───────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allDated = tasks.filter(t => t.startDate || t.endDate);

  if (!allDated.length) {
    wrap.innerHTML = `<div class="gantt-no-dates">
      <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
      <h3 style="font-size:16px;font-weight:600;color:var(--text-sec);">No Dates Set</h3>
      <p>Add Start and Due dates to tasks to see them on the Gantt chart. Tasks without dates appear in the table.</p>
      <button class="btn btn-primary" onclick="setFleetSubView('table')" style="margin-top:4px;">Back to Table</button>
    </div>`;
    return;
  }

  // Auto date range: min start - max end, pad 1 week each side
  let minDate = new Date(Math.min(...allDated.map(t => new Date(t.startDate || t.endDate))));
  let maxDate = new Date(Math.max(...allDated.map(t => new Date(t.endDate || t.startDate))));
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);
  // Snap to Monday start
  minDate.setDate(minDate.getDate() - ((minDate.getDay() + 6) % 7));

  const totalDays = Math.ceil((maxDate - minDate) / 86400000);
  const DW = ganttDayWidth; // px per day

  // ── Build flat row list (parent, then children if not collapsed) ──
  const flatRows = [];
  let rowNum = 0;
  parents.forEach(p => {
    rowNum++;
    const kids = childMap[p.id] || [];
    flatRows.push({ task: p, isSub: false, rowNum, collapsed: p.collapsed && kids.length > 0 });
    if (!p.collapsed || !kids.length) {
      kids.forEach((k, i) => flatRows.push({ task: k, isSub: true, rowNum: `${rowNum}.${i+1}`, collapsed: false }));
    }
  });

  const ROW_H = 40;
  const HEADER_H = 52;
  const totalHeight = flatRows.length * ROW_H;
  const totalWidth  = totalDays * DW;

  // ── Build months header ────────────────────────────
  let monthsHtml = '', weeksHtml = '';
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Iterate months
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const monthStart = new Date(cur);
    const monthEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const clampEnd   = monthEnd < maxDate ? monthEnd : maxDate;
    const days = Math.ceil((clampEnd - monthStart) / 86400000);
    const w = days * DW;
    const isNow = cur.getMonth() === today.getMonth() && cur.getFullYear() === today.getFullYear();
    monthsHtml += `<div class="gantt-month-cell${isNow?' current-month':''}" style="width:${w}px;">${MONTH_NAMES[cur.getMonth()]} ${cur.getFullYear()}</div>`;
    cur = monthEnd;
  }

  // Iterate weeks
  cur = new Date(minDate);
  while (cur < maxDate) {
    const weekStart = new Date(cur);
    const weekEnd   = new Date(cur); weekEnd.setDate(cur.getDate() + 7);
    const days = Math.min(7, Math.ceil((maxDate - weekStart) / 86400000));
    const w = days * DW;
    const dayNum = weekStart.getDate();
    const isTodayWeek = today >= weekStart && today < weekEnd;
    weeksHtml += `<div class="gantt-week-cell${isTodayWeek?' today-week':''}" style="width:${w}px;">${dayNum}</div>`;
    cur.setDate(cur.getDate() + 7);
  }

  // ── Build vertical grid lines ──────────────────────
  let gridLines = '';
  let d = new Date(minDate);
  while (d <= maxDate) {
    const left = Math.round(((d - minDate) / 86400000) * DW);
    const isMonthStart = d.getDate() === 1;
    const isTodayLine = d.getTime() === today.getTime();
    if (isTodayLine) {
      gridLines += `<div class="gantt-vline today-line" style="left:${left}px;"><div class="gantt-today-label" style="top:${-HEADER_H+2}px;">TODAY</div></div>`;
    } else if (isMonthStart || d.getDay() === 1) {
      gridLines += `<div class="gantt-vline${isMonthStart?' month-line':''}" style="left:${left}px;"></div>`;
    }
    d.setDate(d.getDate() + 1);
  }

  // ── Build name rows ────────────────────────────────
  const STATUS_COLORS = { complete:'#16a34a', inprogress:'#2563eb', notstarted:'#94a3b8', onhold:'#d97706', atrisk:'#dc2626' };

  let nameRowsHtml = '', chartRowsHtml = '';

  flatRows.forEach(({ task: t, isSub, rowNum: rn, collapsed }) => {
    const statusColor = STATUS_COLORS[t.status || 'notstarted'];

    // Name column
    nameRowsHtml += `<div class="gantt-name-row${isSub?' subtask':''}${collapsed?' parent-collapsed':''}" onclick="openEditTaskModal('${t.id}')">
      <span class="gantt-row-num">${rn}</span>
      <span class="gantt-status-dot" style="background:${statusColor};"></span>
      <span class="gantt-name-text" title="${escHtml(t.name||'Untitled')}">${escHtml(t.name||'Untitled')}</span>
    </div>`;

    // Chart row — compute bar
    let barHtml = '';
    if (t.startDate || t.endDate) {
      const start = t.startDate ? new Date(t.startDate + 'T00:00:00') : new Date(t.endDate + 'T00:00:00');
      const end   = t.endDate   ? new Date(t.endDate   + 'T00:00:00') : new Date(t.startDate + 'T00:00:00');
      const left  = Math.round(((start - minDate) / 86400000) * DW);
      const width = Math.max(Math.round(((end - start) / 86400000) * DW) + DW, DW);
      const pct   = t.pct || 0;
      const sName = { complete:'Complete', inprogress:'In Progress', notstarted:'Not Started', onhold:'On Hold', atrisk:'At Risk' }[t.status||'notstarted'];
      const isParent = !isSub && (childMap[t.id]||[]).length > 0;
      const label = width > 40 ? `${escHtml(t.name||'')} (${pct}%)` : '';

      barHtml = `<div class="gantt-bar-wrap${isParent?' parent-bar':''}" style="left:${left}px;width:${width}px;"
        onclick="openEditTaskModal('${t.id}')" title="${escHtml(t.name||'')} · ${sName} · ${pct}%">
        <div class="gantt-bar gantt-bar-${t.status||'notstarted'}">
          <div class="gantt-bar-pct-fill" style="width:${pct}%;background:rgba(255,255,255,0.5);"></div>
          <span class="gantt-bar-label">${label}</span>
        </div>
      </div>`;
    } else {
      barHtml = `<div class="gantt-no-bar">no dates</div>`;
    }

    chartRowsHtml += `<div class="gantt-grid-row" style="height:${ROW_H}px;">${barHtml}</div>`;
  });

  // ── Assemble final HTML ────────────────────────────
  wrap.innerHTML = `<div class="gantt-layout">
    <!-- Names column (fixed) -->
    <div class="gantt-names">
      <div class="gantt-names-header"><span>Task Name</span></div>
      <div class="gantt-names-body" id="ganttNamesBody">${nameRowsHtml}</div>
    </div>
    <!-- Chart scroll area -->
    <div class="gantt-chart-scroll" id="ganttScroll">
      <div class="gantt-chart-inner" style="width:${totalWidth}px;">
        <!-- Sticky header -->
        <div class="gantt-header" style="width:${totalWidth}px;">
          <div class="gantt-months-row">${monthsHtml}</div>
          <div class="gantt-weeks-row">${weeksHtml}</div>
        </div>
        <!-- Rows + grid -->
        <div class="gantt-rows" style="position:relative;height:${totalHeight}px;">
          <div class="gantt-grid-lines">${gridLines}</div>
          ${chartRowsHtml}
        </div>
      </div>
    </div>
  </div>`;

  // Sync vertical scroll between name column and chart
  const scroll    = document.getElementById('ganttScroll');
  const namesBody = document.getElementById('ganttNamesBody');
  if (scroll && namesBody) {
    scroll.addEventListener('scroll', () => { namesBody.scrollTop = scroll.scrollTop; });
  }

  // Auto-scroll today into view
  ganttFitToday();
}

function ganttFitToday() {
  const scroll = document.getElementById('ganttScroll');
  if (!scroll) return;
  const today    = new Date(); today.setHours(0,0,0,0);
  const inner    = scroll.querySelector('.gantt-chart-inner');
  if (!inner) return;
  const totalW   = inner.offsetWidth;
  const viewW    = scroll.offsetWidth;
  // Scroll so today is ~30% from the left
  const todayLine = scroll.querySelector('.gantt-vline.today-line');
  if (todayLine) {
    const leftPx = parseInt(todayLine.style.left, 10) || 0;
    scroll.scrollLeft = Math.max(0, leftPx - viewW * 0.3);
  }
}

function renderTasks(filter) {
  const vessel=getActiveVessel(); if(!vessel) return;
  const tasks=vessel.tasks||[], body=document.getElementById('taskBody'); if(!body) return;
  const parents=tasks.filter(t=>!t.parentId);
  const childMap={}; tasks.filter(t=>t.parentId).forEach(t=>{if(!childMap[t.parentId])childMap[t.parentId]=[];childMap[t.parentId].push(t);});
  let rowNum=0, html='';
  parents.forEach(p=>{
    if(filter&&!matchFilter(p,filter)){const kids=childMap[p.id]||[];if(!kids.some(k=>matchFilter(k,filter)))return;}
    rowNum++;
    const kids=childMap[p.id]||[], collapsed=p.collapsed&&kids.length;
    html+=buildTaskRow(p,rowNum,false,kids.length,collapsed);
    if(!collapsed) kids.forEach((k,i)=>{if(filter&&!matchFilter(k,filter)&&!matchFilter(p,filter))return;html+=buildTaskRow(k,`${rowNum}.${i+1}`,true,0,false);});
  });
  if(!html) html=`<tr><td colspan="10"><div class="empty-state"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg><h3>${filter?'No matches':'No tasks'}</h3><p>${filter?'Try different search':'Click Add Task to begin'}</p></div></td></tr>`;
  body.innerHTML=html;
}

function matchFilter(t,f){f=f.toLowerCase();return(t.name||'').toLowerCase().includes(f)||(t.assignee||'').toLowerCase().includes(f)||(t.notes||'').toLowerCase().includes(f);}

function buildTaskRow(t,rowNum,isSub,childCount,isCollapsed){
  const sMap={notstarted:'Not Started',inprogress:'In Progress',complete:'Complete',onhold:'On Hold',atrisk:'At Risk'};
  const pIcon={low:'▼',medium:'■',high:'▲',critical:'⚑'};
  const pct=+t.pct||0, vessel=getActiveVessel();
  const hasAuto=!isSub&&vessel&&vessel.tasks.some(x=>x.parentId===t.id);
  const recurBadge=t.recurring?`<span class="recurring-badge">🔁 monthly</span>`:'';
  let toggle='';
  if(!isSub){
    if(childCount>0) toggle=`<button class="toggle-btn has-children ${isCollapsed?'collapsed':''}" onclick="toggleTask('${t.id}')">${isCollapsed?'▶':'▼'}</button>`;
    else toggle=`<button class="toggle-btn" onclick="openTaskModal('${t.id}')" title="Add subtask">+</button>`;
  }
  const indent=isSub?`<div style="width:24px;flex-shrink:0;"></div>`:'';
  const autoBadge=hasAuto?`<span class="auto-calc-badge">auto</span>`:'';
  return `<tr class="${isSub?'subtask-row':''}" data-id="${t.id}">
    <td style="width:36px;text-align:center;"><input type="checkbox" class="row-checkbox" ${t.status==='complete'?'checked':''} onchange="toggleCheck('${t.id}',this)"></td>
    <td class="col-task-cell"><div class="task-cell">
      <span class="task-row-num">${rowNum}</span>${indent}${toggle}
      <span class="task-name ${isSub?'sub-task':'parent-task'}" ondblclick="inlineEdit(this,'${t.id}','name')">${escHtml(t.name||'Untitled')}</span>${autoBadge}${recurBadge}
    </div></td>
    <td ondblclick="inlineEdit(this,'${t.id}','assignee')"><span>${escHtml(t.assignee||'—')}</span></td>
    <td><span class="badge badge-${t.status||'notstarted'}" onclick="cycleStatus('${t.id}')" style="cursor:pointer">${sMap[t.status||'notstarted']}</span></td>
    <td><span class="priority priority-${t.priority||'low'}" onclick="cyclePriority('${t.id}')" style="cursor:pointer">${pIcon[t.priority||'low']} ${(t.priority||'Low').charAt(0).toUpperCase()+(t.priority||'low').slice(1)}</span></td>
    <td ondblclick="inlineEdit(this,'${t.id}','startDate')" style="font-family:var(--font-mono,'DM Mono',monospace);font-size:12px;">${t.startDate||'—'}</td>
    <td ondblclick="inlineEdit(this,'${t.id}','endDate')" style="font-family:var(--font-mono,'DM Mono',monospace);font-size:12px;${isOverdue(t)?'color:var(--red)':''}">${t.endDate||'—'}${isOverdue(t)?'<span title="Overdue" style="margin-left:4px;">⚠</span>':''}</td>
    <td><div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-pct" ${!hasAuto?`ondblclick="inlineEditPct(this,'${t.id}')" style="cursor:pointer"`:''}>${pct}%</span></div></td>
    <td ondblclick="inlineEdit(this,'${t.id}','notes')" style="color:var(--text-sec);font-size:12px;white-space:pre-wrap;">${escHtml(t.notes||'')}</td>
    <td><div class="row-actions">
      <button class="icon-btn" onclick="openEditTaskModal('${t.id}')" title="Edit"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
      ${!isSub?`<button class="icon-btn" onclick="openTaskModal('${t.id}')" title="Add subtask"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>`:''}
      <button class="icon-btn delete" onclick="deleteTask('${t.id}')" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
    </div></td>
  </tr>`;
}

function isOverdue(t){if(!t.endDate||t.status==='complete')return false;return new Date(t.endDate)<new Date();}

// ══════════════════════════════════════════════════════
//  VESSEL CRUD
// ══════════════════════════════════════════════════════
let editingVesselId=null;

function openVesselModal(){editingVesselId=null;document.getElementById('vesselModalTitle').textContent='Add New Vessel';['vName','vImo','vPm','vDesc'].forEach(id=>document.getElementById(id).value='');document.getElementById('vType').value='Cargo';document.getElementById('vStatus').value='active';openModal('vesselModal');}

function openEditVesselModal(){const v=getActiveVessel();if(!v)return;editingVesselId=v.id;document.getElementById('vesselModalTitle').textContent='Edit Vessel';document.getElementById('vName').value=v.name||'';document.getElementById('vImo').value=v.imo||'';document.getElementById('vType').value=v.type||'Cargo';document.getElementById('vStatus').value=v.status||'active';document.getElementById('vPm').value=v.pm||'';document.getElementById('vDesc').value=v.desc||'';openModal('vesselModal');}

function saveVessel(){
  const name=document.getElementById('vName').value.trim(); if(!name){alert('Vessel name required');return;}
  if(editingVesselId){const v=state.vessels.find(x=>x.id===editingVesselId);if(v){v.name=name;v.imo=document.getElementById('vImo').value.trim();v.type=document.getElementById('vType').value;v.status=document.getElementById('vStatus').value;v.pm=document.getElementById('vPm').value.trim();v.desc=document.getElementById('vDesc').value.trim();}}
  else{const v={id:uid(),name,imo:document.getElementById('vImo').value.trim(),type:document.getElementById('vType').value,status:document.getElementById('vStatus').value,pm:document.getElementById('vPm').value.trim(),desc:document.getElementById('vDesc').value.trim(),tasks:[]};state.vessels.push(v);state.activeVesselId=v.id;}
  saveState();closeModal('vesselModal');render();showToast('Vessel saved ✓');
}

function removeVessel(id,e){e.stopPropagation();if(!confirm('Remove this vessel and all its tasks?'))return;state.vessels=state.vessels.filter(v=>v.id!==id);if(state.activeVesselId===id)state.activeVesselId=state.vessels[0]?.id||null;saveState();render();showToast('Vessel removed');}

// ══════════════════════════════════════════════════════
//  TASK CRUD
// ══════════════════════════════════════════════════════
let editingTaskId=null;

function openTaskModal(parentId){
  editingTaskId=null;
  document.getElementById('taskModalTitle').textContent=parentId?'Add Subtask':'Add Main Task';
  ['tName','tAssign','tAssignEmail','tNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('tStatus').value='notstarted'; document.getElementById('tPriority').value='medium';
  document.getElementById('tPct').value='0'; document.getElementById('tStart').value=''; document.getElementById('tEnd').value='';
  document.getElementById('tParentId').value=parentId||''; document.getElementById('tEditId').value='';
  document.getElementById('pctLockNote').textContent='';
  document.getElementById('tRecurring').checked=false;
  document.getElementById('recurringGroup').style.display=parentId?'none':'block';
  openModal('taskModal');
}

function openEditTaskModal(taskId){
  const vessel=getActiveVessel();if(!vessel)return;
  const task=vessel.tasks.find(t=>t.id===taskId);if(!task)return;
  editingTaskId=taskId;
  document.getElementById('taskModalTitle').textContent='Edit Task';
  document.getElementById('tName').value=task.name||''; document.getElementById('tAssign').value=task.assignee||'';
  document.getElementById('tAssignEmail').value=task.assigneeEmail||'';
  document.getElementById('tStatus').value=task.status||'notstarted'; document.getElementById('tPriority').value=task.priority||'medium';
  document.getElementById('tPct').value=task.pct||0; document.getElementById('tStart').value=task.startDate||'';
  document.getElementById('tEnd').value=task.endDate||''; document.getElementById('tNotes').value=task.notes||'';
  document.getElementById('tParentId').value=task.parentId||''; document.getElementById('tEditId').value=taskId;
  document.getElementById('tRecurring').checked=!!task.recurring;
  document.getElementById('recurringGroup').style.display=task.parentId?'none':'block';
  const hasSubs=vessel.tasks.some(t=>t.parentId===taskId);
  const pf=document.getElementById('tPct'); pf.readOnly=hasSubs; pf.style.opacity=hasSubs?'0.5':'1';
  document.getElementById('pctLockNote').textContent=hasSubs?'(auto from subtasks)':'';
  openModal('taskModal');
}

function saveTask(){
  const name=document.getElementById('tName').value.trim(); if(!name){alert('Task name required');return;}
  const vessel=getActiveVessel(); if(!vessel)return;
  if(!vessel.tasks) vessel.tasks=[];
  const editId=document.getElementById('tEditId').value;
  const parentId=document.getElementById('tParentId').value;
  const prevEmail = editId ? vessel.tasks.find(t=>t.id===editId)?.assigneeEmail : null;
  const prevAssignee = editId ? vessel.tasks.find(t=>t.id===editId)?.assignee : null;
  const data={
    name, assignee:document.getElementById('tAssign').value.trim(),
    assigneeEmail:document.getElementById('tAssignEmail').value.trim(),
    status:document.getElementById('tStatus').value, priority:document.getElementById('tPriority').value,
    pct:+document.getElementById('tPct').value||0,
    startDate:document.getElementById('tStart').value, endDate:document.getElementById('tEnd').value,
    notes:document.getElementById('tNotes').value.trim(), parentId:parentId||null,
    recurring: parentId ? false : !!document.getElementById('tRecurring').checked
  };
  if(editId){const t=vessel.tasks.find(x=>x.id===editId);if(t)Object.assign(t,data);}
  else{vessel.tasks.push({id:uid(),...data,collapsed:false});}
  if(data.parentId) updateParentFromSubtasks(data.parentId);
  saveState(); closeModal('taskModal'); renderTasks(); renderStats();
  showToast('Task saved ✓');

  // Email triggers
  if(emailConfig.enabled && data.assigneeEmail){
    const isNew=!editId;
    const assigneeChanged=editId && (data.assigneeEmail!==prevEmail || data.assignee!==prevAssignee);
    if(emailConfig.alertAssign && (isNew || assigneeChanged)){
      sendTaskEmail('Task Assigned', data, vessel);
    }
  }
}

function deleteTask(taskId){
  if(!confirm('Delete this task and all subtasks?'))return;
  const vessel=getActiveVessel();if(!vessel)return;
  const parentId=vessel.tasks.find(t=>t.id===taskId)?.parentId;
  vessel.tasks=vessel.tasks.filter(t=>t.id!==taskId&&t.parentId!==taskId);
  if(parentId) updateParentFromSubtasks(parentId);
  saveState(); renderTasks(); renderStats(); showToast('Task deleted');
}

function toggleTask(id){const vessel=getActiveVessel();if(!vessel)return;const t=vessel.tasks.find(x=>x.id===id);if(!t)return;t.collapsed=!t.collapsed;saveState();renderTasks();}

function toggleRecurringUI(){ /* reserved for future interval options */ }

function spawnNextRecurring(task, vessel) {
  if (!task.recurring) return;
  // Roll due date forward 1 month; also shift start date if set
  function addMonth(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  const next = {
    id: uid(),
    name: task.name,
    assignee: task.assignee,
    assigneeEmail: task.assigneeEmail,
    status: 'notstarted',
    priority: task.priority,
    pct: 0,
    startDate: addMonth(task.startDate),
    endDate: addMonth(task.endDate),
    notes: task.notes,
    parentId: null,
    recurring: true,
    collapsed: false
  };
  // Insert right after the completed task
  const idx = vessel.tasks.findIndex(t => t.id === task.id);
  vessel.tasks.splice(idx + 1, 0, next);
  showToast('🔁 Next recurrence created — due ' + (next.endDate || 'no date'));
}

function cycleStatus(taskId){
  const order=['notstarted','inprogress','complete','onhold','atrisk'];
  const vessel=getActiveVessel();if(!vessel)return;
  const t=vessel.tasks.find(x=>x.id===taskId);if(!t)return;
  const prevStatus=t.status;
  t.status=order[(order.indexOf(t.status||'notstarted')+1)%order.length];
  if(t.status==='complete') t.pct=100;
  if(t.status==='notstarted') t.pct=0;
  if(t.parentId) updateParentFromSubtasks(t.parentId);
  if(t.status==='complete' && prevStatus!=='complete') spawnNextRecurring(t, vessel);
  saveState(); renderTasks(); renderStats();
  if(emailConfig.enabled && emailConfig.alertStatus && t.assigneeEmail && t.status!==prevStatus){
    sendTaskEmail('Status Update', t, vessel);
  }
}

function toggleCheck(id,el){
  const vessel=getActiveVessel();if(!vessel)return;
  const t=vessel.tasks.find(x=>x.id===id);if(!t)return;
  const wasComplete = t.status==='complete';
  if(el.checked){t.status='complete';t.pct=100;}else{t.status='notstarted';t.pct=0;}
  if(t.parentId)updateParentFromSubtasks(t.parentId);
  if(el.checked && !wasComplete) spawnNextRecurring(t, vessel);
  saveState();renderTasks();renderStats();
}

function cyclePriority(id){const o=['low','medium','high','critical'];const vessel=getActiveVessel();if(!vessel)return;const t=vessel.tasks.find(x=>x.id===id);if(!t)return;t.priority=o[(o.indexOf(t.priority||'low')+1)%o.length];saveState();renderTasks();}

// ══════════════════════════════════════════════════════
//  INLINE EDITING
// ══════════════════════════════════════════════════════
function inlineEdit(cell,id,field){
  const vessel=getActiveVessel();if(!vessel)return;
  const t=vessel.tasks.find(x=>x.id===id);if(!t)return;
  if(field==='notes'){
    const ta=document.createElement('textarea'); ta.className='cell-edit';
    ta.value=t[field]||''; ta.rows=3; ta.style.cssText='width:100%;resize:vertical;min-height:60px;font-family:inherit;font-size:12px;';
    cell.innerHTML='';cell.appendChild(ta);ta.focus();
    const commit=()=>{t[field]=ta.value;saveState();renderTasks();renderStats();};
    ta.addEventListener('blur',commit);
    ta.addEventListener('keydown',e=>{if(e.key==='Escape')renderTasks();});
    return;
  }
  const inp=document.createElement('input'); inp.className='cell-edit';
  if(field==='startDate'||field==='endDate')inp.type='date';
  inp.value=t[field]||''; cell.innerHTML='';cell.appendChild(inp);inp.focus();
  const commit=()=>{t[field]=inp.value;saveState();renderTasks();renderStats();};
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')renderTasks();});
}

function inlineEditPct(cell,id){
  const vessel=getActiveVessel();if(!vessel)return;
  const t=vessel.tasks.find(x=>x.id===id);if(!t)return;
  if(vessel.tasks.some(s=>s.parentId===id)){showToast('Progress auto-calculated from subtasks');return;}
  const inp=document.createElement('input');inp.className='cell-edit';inp.type='number';inp.min='0';inp.max='100';
  inp.value=t.pct||0;inp.style.width='60px';cell.innerHTML='';cell.appendChild(inp);inp.focus();inp.select();
  inp.addEventListener('blur',()=>{t.pct=Math.min(100,Math.max(0,+inp.value||0));if(t.pct===100)t.status='complete';if(t.parentId)updateParentFromSubtasks(t.parentId);saveState();renderTasks();renderStats();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();});
}

// ══════════════════════════════════════════════════════
//  STATS REFRESH
// ══════════════════════════════════════════════════════
function renderStats(){
  const vessel=getActiveVessel();if(!vessel)return;
  const at=vessel.tasks||[], pt=at.filter(t=>!t.parentId);
  const done=at.filter(t=>t.status==='complete').length, inp=at.filter(t=>t.status==='inprogress').length, risk=at.filter(t=>t.status==='atrisk').length;
  const avg=pt.length?Math.round(pt.reduce((s,t)=>s+(+t.pct||0),0)/pt.length):0;
  const sb=document.querySelector('.stats-bar');
  if(sb)sb.innerHTML=`<div class="stat-item"><span class="stat-num">${at.length}</span><span class="stat-label">Total Tasks</span></div><div class="stat-item"><span class="stat-num">${done}</span><span class="stat-label">Complete</span></div><div class="stat-item"><span class="stat-num">${inp}</span><span class="stat-label">In Progress</span></div><div class="stat-item" style="${risk?'color:var(--red)':''}"><span class="stat-num" style="${risk?'color:var(--red)':''}">${risk}</span><span class="stat-label">At Risk</span></div><div class="stat-item"><span class="stat-num">${avg}%</span><span class="stat-label">Progress</span></div>`;
  const fill=document.querySelector('.overall-fill'), num=document.querySelector('.overall-pct-num');
  if(fill)fill.style.width=avg+'%'; if(num)num.textContent=avg+'%';
}

function expandAll(){const vessel=getActiveVessel();if(!vessel)return;vessel.tasks.forEach(t=>{if(!t.parentId)t.collapsed=false;});saveState();renderTasks();}
function collapseAll(){const vessel=getActiveVessel();if(!vessel)return;vessel.tasks.forEach(t=>{if(!t.parentId)t.collapsed=true;});saveState();renderTasks();}
function filterTasks(val){renderTasks(val.trim()||null);}

// ══════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ══════════════════════════════════════════════════════

// ── Legacy JSON (kept for internal backup use) ────────
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vesseltrack_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();}
function importData(){document.getElementById('importFile').click();}
function handleImport(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const data=JSON.parse(ev.target.result);if(!data.vessels)throw new Error('Invalid format');if(confirm('Replace current data?')){state=data;saveState();render();showToast('Imported ✓');}}catch(err){alert('Invalid file: '+err.message);}};reader.readAsText(file);e.target.value='';}

// ── EXPORT AS EXCEL ───────────────────────────────────
function exportAsExcel() {
  if (!window.XLSX) { showToast('Excel library not loaded yet, please try again.'); return; }
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0,10);

  // ── Sheet 1: Vessels ──
  const vesselRows = [['Vessel Name','IMO / Registration','Vessel Type','Status','Project Manager','Description']];
  (state.vessels||[]).forEach(v => {
    vesselRows.push([v.name||'', v.imo||'', v.type||'', v.status||'', v.pm||'', v.desc||'']);
  });
  const wsVessels = XLSX.utils.aoa_to_sheet(vesselRows);
  wsVessels['!cols'] = [{wch:24},{wch:18},{wch:16},{wch:12},{wch:20},{wch:36}];
  XLSX.utils.book_append_sheet(wb, wsVessels, 'Vessels');

  // ── Sheet 2: Tasks ──
  const taskRows = [['Vessel Name','Task Name','Parent Task','Assigned To','Assignee Email','Status','Priority','% Complete','Start Date','End Date','Notes','Recurring']];
  (state.vessels||[]).forEach(v => {
    (v.tasks||[]).forEach(t => {
      const parent = t.parentId ? (v.tasks.find(x=>x.id===t.parentId)||{}).name||'' : '';
      taskRows.push([
        v.name||'', t.name||'', parent, t.assignee||'', t.assigneeEmail||'',
        t.status||'notstarted', t.priority||'medium', t.pct||0,
        t.startDate||'', t.endDate||'', t.notes||'', t.recurring?'Yes':'No'
      ]);
    });
  });
  const wsTasks = XLSX.utils.aoa_to_sheet(taskRows);
  wsTasks['!cols'] = [{wch:20},{wch:36},{wch:28},{wch:18},{wch:28},{wch:14},{wch:10},{wch:10},{wch:12},{wch:12},{wch:36},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsTasks, 'Tasks');

  // ── Sheet 3: Certificates ──
  const certRows = [['Vessel Name','Certificate / Audit Name','Issuing Authority','Certificate Type','Issue Date','Expiry Date','Last Survey Date','Notes']];
  (state.certificates||[]).forEach(c => {
    certRows.push([
      c.vesselName||'', c.certName||'', c.issuingAuthority||'',
      c.certType||'range', c.issueDate||'', c.expiryDate||'',
      c.lastSurveyDate||'', c.notes||''
    ]);
  });
  const wsCerts = XLSX.utils.aoa_to_sheet(certRows);
  wsCerts['!cols'] = [{wch:20},{wch:36},{wch:28},{wch:10},{wch:12},{wch:12},{wch:16},{wch:40}];
  XLSX.utils.book_append_sheet(wb, wsCerts, 'Certificates');

  XLSX.writeFile(wb, 'VesselTrack_Export_'+today+'.xlsx');
  closeModal('exportModal');
  showToast('📊 Excel export downloaded ✓');
}

// ── EXPORT AS PDF ─────────────────────────────────────
function exportAsPDF() {
  const today = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const vessels = state.vessels||[];
  const certs = state.certificates||[];

  // Status/priority label helpers
  const SL = {notstarted:'Not Started',inprogress:'In Progress',complete:'Complete',onhold:'On Hold',atrisk:'At Risk'};
  const PL = {low:'Low',medium:'Medium',high:'High',critical:'Critical'};
  const CL = {compliant:'Compliant',window_open:'Window Open',overdue:'Overdue'};
  const CT = {range:'Range',renewal:'Renewal',fixed:'Fixed'};

  // Build cert status for display
  function certStatusLabel(c) {
    const r = calcCertWindows(c);
    return CL[r.status]||r.status;
  }

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>VesselTrack Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:32px;}
    h1{font-size:22px;letter-spacing:2px;color:#00a896;margin-bottom:4px;}
    .subtitle{font-size:12px;color:#6b7280;margin-bottom:28px;}
    h2{font-size:14px;color:#111;margin:24px 0 8px;padding-bottom:5px;border-bottom:2px solid #00a896;letter-spacing:1px;}
    h3{font-size:12px;color:#374151;margin:16px 0 6px;font-weight:700;}
    table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;}
    th{background:#f3f4f6;padding:5px 8px;text-align:left;font-weight:700;border:1px solid #e5e7eb;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;}
    td{padding:5px 8px;border:1px solid #e5e7eb;vertical-align:top;}
    tr:nth-child(even) td{background:#f9fafb;}
    .badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;}
    .b-complete{background:#dcfce7;color:#15803d;}
    .b-inprogress{background:#dbeafe;color:#1d4ed8;}
    .b-notstarted{background:#f3f4f6;color:#6b7280;}
    .b-onhold{background:#fef3c7;color:#b45309;}
    .b-atrisk{background:#fee2e2;color:#dc2626;}
    .b-compliant{background:#dcfce7;color:#15803d;}
    .b-window_open{background:#fef3c7;color:#b45309;}
    .b-overdue{background:#fee2e2;color:#dc2626;}
    .b-high{color:#dc2626;font-weight:700;}
    .b-critical{color:#9f1239;font-weight:700;}
    .b-medium{color:#b45309;}
    .b-low{color:#15803d;}
    .kpi-row{display:flex;gap:12px;margin-bottom:20px;}
    .kpi{flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;}
    .kpi-val{font-size:22px;font-weight:700;color:#00a896;}
    .kpi-lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;}
    .page-break{page-break-before:always;}
    .footer{margin-top:32px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between;}
  </style></head><body>`;

  // Header
  html += `<h1>⚓ VesselTrack — Fleet Report</h1><div class="subtitle">Generated: ${today} &nbsp;·&nbsp; ${vessels.length} vessel${vessels.length!==1?'s':''} &nbsp;·&nbsp; ${certs.length} certificate${certs.length!==1?'s':''}</div>`;

  // KPIs
  const allTasks = vessels.flatMap(v=>v.tasks||[]);
  const totalTasks = allTasks.length;
  const completeTasks = allTasks.filter(t=>t.status==='complete').length;
  const atRisk = allTasks.filter(t=>t.status==='atrisk').length;
  const overdueCerts = certs.filter(c=>calcCertWindows(c).status==='overdue').length;
  html += `<div class="kpi-row">
    <div class="kpi"><div class="kpi-val">${vessels.length}</div><div class="kpi-lbl">Vessels</div></div>
    <div class="kpi"><div class="kpi-val">${totalTasks}</div><div class="kpi-lbl">Total Tasks</div></div>
    <div class="kpi"><div class="kpi-val">${completeTasks}</div><div class="kpi-lbl">Complete</div></div>
    <div class="kpi"><div class="kpi-val" style="color:${atRisk?'#dc2626':'#00a896'}">${atRisk}</div><div class="kpi-lbl">At Risk</div></div>
    <div class="kpi"><div class="kpi-val" style="color:${overdueCerts?'#dc2626':'#00a896'}">${overdueCerts}</div><div class="kpi-lbl">Certs Overdue</div></div>
  </div>`;

  // Vessels & Tasks
  html += `<h2>VESSELS &amp; TASKS</h2>`;
  if (!vessels.length) { html += `<p style="color:#9ca3af;font-style:italic;">No vessels recorded.</p>`; }
  vessels.forEach(v => {
    const tasks = v.tasks||[];
    const parentTasks = tasks.filter(t=>!t.parentId);
    const done = tasks.filter(t=>t.status==='complete').length;
    const pct = tasks.length ? Math.round(tasks.reduce((s,t)=>s+(+t.pct||0),0)/tasks.length) : 0;
    html += `<h3>🚢 ${v.name||'Unnamed'} &nbsp;<span style="font-weight:400;color:#6b7280;font-size:10px;">${v.type||''} &nbsp;·&nbsp; ${v.imo||''} &nbsp;·&nbsp; ${done}/${tasks.length} tasks complete &nbsp;·&nbsp; ${pct}% overall</span></h3>`;
    if (!parentTasks.length) { html += `<p style="color:#9ca3af;font-style:italic;margin-bottom:10px;">No tasks.</p>`; return; }
    html += `<table><thead><tr><th>Task</th><th>Assigned To</th><th>Status</th><th>Priority</th><th>%</th><th>Start</th><th>Due</th><th>Notes</th></tr></thead><tbody>`;
    parentTasks.forEach(t => {
      const sub = tasks.filter(x=>x.parentId===t.id);
      html += `<tr><td><strong>${t.name||''}</strong></td><td>${t.assignee||'—'}</td><td><span class="badge b-${t.status||'notstarted'}">${SL[t.status]||t.status}</span></td><td class="b-${t.priority||'medium'}">${PL[t.priority]||t.priority}</td><td>${t.pct||0}%</td><td>${t.startDate||'—'}</td><td>${t.endDate||'—'}</td><td>${t.notes||''}</td></tr>`;
      sub.forEach(s => {
        html += `<tr><td style="padding-left:20px;color:#4b5563;">↳ ${s.name||''}</td><td>${s.assignee||'—'}</td><td><span class="badge b-${s.status||'notstarted'}">${SL[s.status]||s.status}</span></td><td class="b-${s.priority||'medium'}">${PL[s.priority]||s.priority}</td><td>${s.pct||0}%</td><td>${s.startDate||'—'}</td><td>${s.endDate||'—'}</td><td>${s.notes||''}</td></tr>`;
      });
    });
    html += `</tbody></table>`;
  });

  // Certificates
  html += `<div class="page-break"></div><h2>CERTIFICATES &amp; AUDITS</h2>`;
  if (!certs.length) { html += `<p style="color:#9ca3af;font-style:italic;">No certificates recorded.</p>`; }
  else {
    html += `<table><thead><tr><th>Vessel</th><th>Certificate / Audit</th><th>Authority</th><th>Type</th><th>Issue Date</th><th>Expiry Date</th><th>Last Survey</th><th>Status</th><th>Notes</th></tr></thead><tbody>`;
    certs.forEach(c => {
      const st = calcCertWindows(c).status;
      html += `<tr><td>${c.vesselName||''}</td><td>${c.certName||''}</td><td>${c.issuingAuthority||''}</td><td>${CT[c.certType]||c.certType}</td><td>${c.issueDate||'—'}</td><td>${c.expiryDate||'—'}</td><td>${c.lastSurveyDate||'—'}</td><td><span class="badge b-${st}">${CL[st]||st}</span></td><td>${c.notes||''}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="footer"><span>VesselTrack — Fleet Project Management</span><span>Exported ${today}</span></div>`;
  html += `</body></html>`;

  const win = window.open('','_blank','width=1100,height=800');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(()=>{ win.print(); }, 600);
  closeModal('exportModal');
  showToast('📄 PDF report opened — use Print → Save as PDF');
}

// ── DOWNLOAD IMPORT TEMPLATE ──────────────────────────
function downloadImportTemplate() {
  if (!window.XLSX) { showToast('Excel library not loaded yet, please try again.'); return; }
  const wb = XLSX.utils.book_new();

  // ── Vessels sheet ──
  const vesselData = [
    ['Vessel Name','IMO / Registration','Vessel Type','Status','Project Manager','Description'],
    ['MV Example Ship','IMO 1234567','Cargo','active','John Smith','Example vessel — replace or delete this row'],
  ];
  const wsV = XLSX.utils.aoa_to_sheet(vesselData);
  wsV['!cols'] = [{wch:24},{wch:18},{wch:16},{wch:12},{wch:20},{wch:40}];
  // Add a notes row with allowed values
  wsV['A3'] = {v:'— Vessel Type options: Cargo, Tanker, Container, Bulk Carrier, RORO, Tug, Passenger, Offshore, Other',t:'s'};
  wsV['A4'] = {v:'— Status options: active, hold, done',t:'s'};
  XLSX.utils.book_append_sheet(wb, wsV, 'Vessels');

  // ── Tasks sheet ──
  const taskData = [
    ['Vessel Name','Task Name','Parent Task Name','Assigned To','Assignee Email','Status','Priority','% Complete','Start Date (YYYY-MM-DD)','End Date (YYYY-MM-DD)','Notes','Recurring (Yes/No)'],
    ['MV Example Ship','Main Engine Overhaul','','John Smith','john@example.com','inprogress','high',50,'2025-01-15','2025-03-01','Annual overhaul','No'],
    ['MV Example Ship','Replace Cylinder Liners','Main Engine Overhaul','Jane Doe','jane@example.com','notstarted','medium',0,'2025-02-01','2025-02-15','','No'],
  ];
  const wsT = XLSX.utils.aoa_to_sheet(taskData);
  wsT['!cols'] = [{wch:20},{wch:36},{wch:28},{wch:18},{wch:28},{wch:14},{wch:10},{wch:10},{wch:22},{wch:22},{wch:36},{wch:14}];
  wsT['A4'] = {v:'— Status options: notstarted, inprogress, complete, onhold, atrisk',t:'s'};
  wsT['A5'] = {v:'— Priority options: low, medium, high, critical',t:'s'};
  wsT['A6'] = {v:'— Parent Task Name must exactly match a Task Name in this sheet (leave blank for top-level tasks)',t:'s'};
  XLSX.utils.book_append_sheet(wb, wsT, 'Tasks');

  // ── Certificates sheet ──
  const certData = [
    ['Vessel Name','Certificate / Audit Name','Issuing Authority','Certificate Type','Issue Date (YYYY-MM-DD)','Expiry Date (YYYY-MM-DD)','Last Survey Date (YYYY-MM-DD)','Notes'],
    ['MV Example Ship','Load Line Certificate','Flag State','range','2022-06-01','2027-06-01','2024-05-15','Annual endorsement completed'],
    ['MV Example Ship','Safety Management Certificate (SMC)','ABS (American Bureau of Shipping)','renewal','2020-01-10','2025-01-10','2024-10-05','Renewal survey scheduled'],
  ];
  const wsC = XLSX.utils.aoa_to_sheet(certData);
  wsC['!cols'] = [{wch:20},{wch:36},{wch:30},{wch:10},{wch:24},{wch:24},{wch:26},{wch:40}];
  wsC['A4'] = {v:'— Certificate Type options: range (Annual/Intermediate ±3mo window), renewal (Renewal survey -3mo window), fixed (Hard expiry date)',t:'s'};
  XLSX.utils.book_append_sheet(wb, wsC, 'Certificates');

  XLSX.writeFile(wb, 'VesselTrack_Import_Template.xlsx');
  showToast('📥 Template downloaded ✓');
}

// ── HANDLE EXCEL IMPORT ───────────────────────────────
function handleExcelImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  if (!window.XLSX) { showToast('Excel library not loaded, please try again.'); return; }

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const wb = XLSX.read(ev.target.result, {type:'binary'});

      // ── Parse Vessels ──
      const wsV = wb.Sheets['Vessels'];
      if (!wsV) throw new Error('Missing "Vessels" sheet. Please use the official template.');
      const vesselRows = XLSX.utils.sheet_to_json(wsV, {defval:''});

      // ── Parse Tasks ──
      const wsT = wb.Sheets['Tasks'];
      if (!wsT) throw new Error('Missing "Tasks" sheet. Please use the official template.');
      const taskRows = XLSX.utils.sheet_to_json(wsT, {defval:''});

      // ── Parse Certificates ──
      const wsC = wb.Sheets['Certificates'];
      if (!wsC) throw new Error('Missing "Certificates" sheet. Please use the official template.');
      const certRows = XLSX.utils.sheet_to_json(wsC, {defval:''});

      // Validate we got at least some real data rows (skip comment rows)
      const isCommentRow = r => String(Object.values(r)[0]||'').startsWith('—');
      const realVessels = vesselRows.filter(r=>!isCommentRow(r)&&r['Vessel Name']);
      const realTasks   = taskRows.filter(r=>!isCommentRow(r)&&r['Task Name']);
      const realCerts   = certRows.filter(r=>!isCommentRow(r)&&r['Certificate / Audit Name']);

      if (!realVessels.length && !realTasks.length && !realCerts.length) {
        throw new Error('No data rows found. Please fill in at least one row and remove the example data.');
      }

      // Backup prompt
      const backupFirst = confirm(
        `Ready to import:\n• ${realVessels.length} vessel(s)\n• ${realTasks.length} task(s)\n• ${realCerts.length} certificate(s)\n\nYour existing data will be backed up as a JSON file first. Continue?`
      );
      if (!backupFirst) return;

      // Auto-backup current data
      const backupBlob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
      const bk = document.createElement('a');
      bk.href = URL.createObjectURL(backupBlob);
      bk.download = 'vesseltrack_backup_'+new Date().toISOString().slice(0,10)+'.json';
      bk.click();

      // ── Build vessels map ──
      const vesselMap = {};
      (state.vessels||[]).forEach(v => { vesselMap[v.name.toLowerCase()] = v; });

      // Merge / create vessels
      realVessels.forEach(r => {
        const name = String(r['Vessel Name']||'').trim();
        if (!name) return;
        const key = name.toLowerCase();
        const statusRaw = String(r['Status']||'active').trim().toLowerCase();
        const status = ['active','hold','done'].includes(statusRaw) ? statusRaw : 'active';
        if (vesselMap[key]) {
          // Update existing vessel fields (non-destructive: keep tasks)
          Object.assign(vesselMap[key], {
            imo:  String(r['IMO / Registration']||vesselMap[key].imo||'').trim(),
            type: String(r['Vessel Type']||vesselMap[key].type||'Cargo').trim(),
            status, pm: String(r['Project Manager']||vesselMap[key].pm||'').trim(),
            desc: String(r['Description']||vesselMap[key].desc||'').trim()
          });
        } else {
          const v = { id:uid(), name, imo:String(r['IMO / Registration']||'').trim(), type:String(r['Vessel Type']||'Cargo').trim(), status, pm:String(r['Project Manager']||'').trim(), desc:String(r['Description']||'').trim(), tasks:[] };
          state.vessels.push(v);
          vesselMap[key] = v;
        }
      });

      // ── Import tasks ──
      // Build name→id map for parent resolution (within each vessel)
      realTasks.forEach(r => {
        const vname = String(r['Vessel Name']||'').trim().toLowerCase();
        const vessel = vesselMap[vname];
        if (!vessel) return; // skip tasks for unknown vessels

        const parentName = String(r['Parent Task Name']||'').trim().toLowerCase();
        let parentId = null;
        if (parentName) {
          const parentTask = (vessel.tasks||[]).find(t=>t.name.toLowerCase()===parentName);
          if (parentTask) parentId = parentTask.id;
        }

        const statusRaw = String(r['Status']||'notstarted').trim().toLowerCase();
        const status = ['notstarted','inprogress','complete','onhold','atrisk'].includes(statusRaw) ? statusRaw : 'notstarted';
        const priorityRaw = String(r['Priority']||'medium').trim().toLowerCase();
        const priority = ['low','medium','high','critical'].includes(priorityRaw) ? priorityRaw : 'medium';
        const pct = Math.min(100, Math.max(0, parseInt(r['% Complete'])||0));
        const recurring = String(r['Recurring (Yes/No)']||'').trim().toLowerCase() === 'yes';

        vessel.tasks.push({
          id: uid(), name: String(r['Task Name']||'').trim(), parentId,
          assignee: String(r['Assigned To']||'').trim(),
          assigneeEmail: String(r['Assignee Email']||'').trim(),
          status, priority, pct,
          startDate: String(r['Start Date (YYYY-MM-DD)']||r['Start Date']||'').trim(),
          endDate:   String(r['End Date (YYYY-MM-DD)']||r['End Date']||'').trim(),
          notes:     String(r['Notes']||'').trim(),
          recurring, collapsed: false
        });
      });

      // ── Import certificates (merge by vessel+certName) ──
      if (!state.certificates) state.certificates = [];
      realCerts.forEach(r => {
        const vname = String(r['Vessel Name']||'').trim();
        const cname = String(r['Certificate / Audit Name']||'').trim();
        if (!vname || !cname) return;

        const typeRaw = String(r['Certificate Type']||'range').trim().toLowerCase();
        const certType = ['range','renewal','fixed'].includes(typeRaw) ? typeRaw : 'range';

        const existing = state.certificates.find(c=>c.vesselName.toLowerCase()===vname.toLowerCase()&&c.certName.toLowerCase()===cname.toLowerCase());
        const record = {
          id: existing?.id || uid(),
          vesselName: vname, certName: cname,
          issuingAuthority: String(r['Issuing Authority']||'').trim(),
          certType,
          issueDate:      String(r['Issue Date (YYYY-MM-DD)']||r['Issue Date']||'').trim(),
          expiryDate:     String(r['Expiry Date (YYYY-MM-DD)']||r['Expiry Date']||'').trim(),
          lastSurveyDate: String(r['Last Survey Date (YYYY-MM-DD)']||r['Last Survey Date']||'').trim(),
          notes: String(r['Notes']||'').trim()
        };
        if (existing) { Object.assign(existing, record); }
        else { state.certificates.push(record); }
      });

      saveState();
      render();
      closeModal('importModal');
      showToast(`✅ Imported ${realVessels.length} vessels, ${realTasks.length} tasks, ${realCerts.length} certs`);

    } catch(err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

// ══════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);});});

// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}

// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ══════════════════════════════════════════════════════
//  KEYBOARD
// ══════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){['vesselModal','taskModal','syncModal','emailModal','certModal','exportModal','importModal'].forEach(closeModal);closeRepairForm();}
  if((e.ctrlKey||e.metaKey)&&e.key==='n'&&!e.shiftKey){e.preventDefault();openTaskModal(null);}
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveState();showToast('Saved ✓');}
});

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
// REPAIR MODULE - EARLY DECLARATIONS (must be before loadSyncConfig)
// Full implementation follows after Certificate module below.

let _knownRepairIds = new Set();
let repairFilter = { status: 'all', priority: null };

function showRepairToast(msg, variant) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (variant ? ' toast-'+variant : '');
  t.classList.add('show');
  setTimeout(function(){ t.className = 'toast'; }, 3500);
}

function updateRepairBadge() {
  var pending = (state.repairRequests || []).filter(function(r){ return r.status === 'pending'; }).length;
  var badge = document.getElementById('repairBadge');
  if (!badge) return;
  if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }
}

function playRepairChime(priority) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var notes = (priority === 'critical') ? [880, 1100, 880] : [660, 880];
    var t2 = ctx.currentTime;
    notes.forEach(function(freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t2 + i*0.15);
      gain.gain.linearRampToValueAtTime(0.18, t2 + i*0.15 + 0.04);
      gain.gain.linearRampToValueAtTime(0, t2 + i*0.15 + 0.22);
      osc.start(t2 + i*0.15); osc.stop(t2 + i*0.15 + 0.25);
    });
  } catch(e) {}
}

function generateTrackingId(req) {
  if (req.trackingId) return req.trackingId;
  var base = req.submittedAt ? Math.floor(req.submittedAt / 1000) % 9000 + 1000 : Math.floor(Math.random()*9000)+1000;
  return 'REP-' + base;
}

function initRepairsListener() {
  if (!db) return;
  if (typeof repairsRef !== 'undefined' && repairsRef) { try{ repairsRef.off(); }catch(e){} }
  repairsRef = db.ref('fleet_repairs');
  (state.repairRequests || []).forEach(function(r){ _knownRepairIds.add(r.id); });
  repairsRef.on('child_added', function(snap) {
    var data = snap.val();
    if (!data || !data.id) return;
    if (_knownRepairIds.has(data.id)) return;
    _knownRepairIds.add(data.id);
    if (!state.repairRequests) state.repairRequests = [];
    if (!state.repairRequests.find(function(r){ return r.id === data.id; })) {
      state.repairRequests.unshift(data);
      saveState();
    }
    var isUrgent = data.priority === 'critical' || data.priority === 'high' || data.safetyRisk;
    var variant2 = data.priority === 'critical' ? 'critical' : 'repair';
    showRepairToast('New Repair Request from ' + (data.vessel || 'Unknown Vessel'), variant2);
    if (isUrgent) playRepairChime(data.priority);
    updateRepairBadge();
    if (typeof currentView !== 'undefined' && currentView === 'repairs') renderRepairView();
    if (typeof currentView !== 'undefined' && currentView === 'dashboard') renderDashboard();
  });
}

loadState();
loadSyncConfig();
loadEmailConfig();

// ══════════════════════════════════════════════════════
//  CERTIFICATE & AUDIT TRACKER — FULL MODULE
// ══════════════════════════════════════════════════════

/* ── Data Schema (stored in state.certificates) ──────
  {
    id:             string  (uid)
    vesselName:     string  (free text, matched to vessel tabs)
    certName:       string  (e.g. "Load Line Certificate")
    issuingAuthority: string
    certType:       'range' | 'renewal' | 'fixed'
                      range   = ±3 mo window around anniversary each year
                      renewal = -3 mo window before expiry (renewal survey)
                      fixed   = hard expiry date, no window
    issueDate:      'YYYY-MM-DD'
    expiryDate:     'YYYY-MM-DD'
    lastSurveyDate: 'YYYY-MM-DD' | ''
    notes:          string

    COMPUTED (not stored — recalculated on every render):
    anniversaryDate  MM-DD string, derived from expiryDate day/month
    windowOpen       Date
    windowClose      Date
    status           'compliant' | 'window_open' | 'overdue'
    daysToAction     number (negative = overdue)
  }
──────────────────────────────────────────────────────── */

// ── Cert status filter state ──────────────────────────
let certStatusFilter = 'all';

// ── Seed sample data on first load ───────────────────
function initCertState() {
  if (!state.certificates) {
    // Seed with realistic demo data so the view isn't empty
    const today = new Date();
    const fmt = d => d.toISOString().slice(0,10);
    const add = (d, days) => { const x=new Date(d); x.setDate(x.getDate()+days); return x; };
    const addM = (d, m) => { const x=new Date(d); x.setMonth(x.getMonth()+m); return x; };

    // Use first vessel name if one exists, else generic names
    const v1 = state.vessels[0]?.name || 'MV Atlantic Star';
    const v2 = state.vessels[1]?.name || 'MT Gulf Runner';

    state.certificates = [
      {
        id: uid(), vesselName: v1,
        certName: 'Load Line Certificate',
        issuingAuthority: 'ABS (American Bureau of Shipping)',
        certType: 'range',
        issueDate: fmt(addM(today, -36)),
        expiryDate: fmt(addM(today, 24)),
        lastSurveyDate: fmt(addM(today, -13)),
        notes: 'Annual endorsement due'
      },
      {
        id: uid(), vesselName: v1,
        certName: 'Safety Management Certificate (SMC)',
        issuingAuthority: 'Flag State',
        certType: 'range',
        issueDate: fmt(addM(today, -48)),
        expiryDate: fmt(addM(today, 12)),
        lastSurveyDate: '',
        notes: 'Intermediate survey pending'
      },
      {
        id: uid(), vesselName: v1,
        certName: 'ISSC (Ship Security Certificate)',
        issuingAuthority: 'Flag State',
        certType: 'renewal',
        issueDate: fmt(addM(today, -57)),
        expiryDate: fmt(addM(today, 3)),
        lastSurveyDate: '',
        notes: 'Renewal survey must be scheduled'
      },
      {
        id: uid(), vesselName: v1,
        certName: 'Local Safety Certificate',
        issuingAuthority: 'Ministry of National Security',
        certType: 'fixed',
        issueDate: fmt(addM(today, -10)),
        expiryDate: fmt(addM(today, 2)),
        lastSurveyDate: '',
        notes: 'Trinidad & Tobago coastal waters'
      },
      {
        id: uid(), vesselName: v1,
        certName: 'Cargo Ship Safety Equipment Certificate',
        issuingAuthority: 'ABS (American Bureau of Shipping)',
        certType: 'range',
        issueDate: fmt(addM(today, -60)),
        expiryDate: fmt(addM(today, -1)),
        lastSurveyDate: '',
        notes: 'OVERDUE — must renew immediately'
      },
      {
        id: uid(), vesselName: v2,
        certName: 'MARPOL Annex I Certificate (IOPP)',
        issuingAuthority: 'Bureau Veritas',
        certType: 'range',
        issueDate: fmt(addM(today, -24)),
        expiryDate: fmt(addM(today, 36)),
        lastSurveyDate: fmt(addM(today, -2)),
        notes: ''
      },
      {
        id: uid(), vesselName: v2,
        certName: 'ABS Special/Renewal Survey',
        issuingAuthority: 'ABS (American Bureau of Shipping)',
        certType: 'renewal',
        issueDate: fmt(addM(today, -60)),
        expiryDate: fmt(addM(today, 2)),
        lastSurveyDate: '',
        notes: 'Drydock scheduled next month'
      },
      {
        id: uid(), vesselName: v2,
        certName: 'Document of Compliance (DOC)',
        issuingAuthority: 'Flag State',
        certType: 'fixed',
        issueDate: fmt(addM(today, -18)),
        expiryDate: fmt(addM(today, 18)),
        lastSurveyDate: fmt(addM(today, -6)),
        notes: ''
      }
    ];
    saveState();
  }
}

// ── Date utilities ────────────────────────────────────
function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function fmtDate(d) {
  if (!d) return '—';
  if (typeof d === 'string') d = new Date(d + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function fmtDateShort(d) {
  if (!d) return '—';
  if (typeof d === 'string') d = new Date(d + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'2-digit'});
}

// ── Core business logic: window + status calculation ─
/*  PSEUDOCODE / FORMULA REFERENCE
    ════════════════════════════════════════════════════
    INPUT:  cert.certType, cert.expiryDate, cert.lastSurveyDate, today

    1. Parse dates:
       expiryDate = parseDate(cert.expiryDate)
       today      = now (midnight, local)

    2. FIXED TYPE:
       windowOpen  = expiryDate − 3 months
       windowClose = expiryDate
       → status = 'overdue'      if today > expiryDate
       → status = 'window_open'  if today ≥ windowOpen
       → status = 'compliant'    otherwise

    3. RENEWAL TYPE (same window, survey completes it):
       windowOpen  = expiryDate − 3 months
       windowClose = expiryDate
       → status = 'overdue'      if today > expiryDate
       → status = 'window_open'  if today ≥ windowOpen
                                    AND lastSurvey NOT in [windowOpen, today]
       → status = 'compliant'    if lastSurvey in [windowOpen, windowClose]
       → status = 'compliant'    if today < windowOpen

    4. RANGE TYPE (±3 months around each annual anniversary):
       annivMonth = expiryDate.month
       annivDay   = expiryDate.day
       anniversaryDate = annivMonth-annivDay (MM-DD label)

       # Identify the CURRENT active cycle:
       annivThisYear = Date(today.year, annivMonth, annivDay)
       windowOpen    = annivThisYear − 3 months
       windowClose   = annivThisYear + 3 months

       if today > windowClose:
         # This year's window is closed; step to next year's
         annivNextYear = Date(today.year+1, annivMonth, annivDay)
         windowOpen    = annivNextYear − 3 months
         windowClose   = annivNextYear + 3 months

       # Cap window at expiry
       if windowClose > expiryDate: windowClose = expiryDate

       # Status:
       if today > expiryDate:                      → 'overdue'
       if today > windowClose:                     → 'overdue'   (no survey on record)
       if today ≥ windowOpen:
         if lastSurvey ∈ [windowOpen, today]:      → 'compliant' (survey done)
         else:                                     → 'window_open'
       else:                                       → 'compliant'
    ════════════════════════════════════════════════════ */
function calcCertWindows(cert) {
  const today = new Date(); today.setHours(0,0,0,0);

  if (!cert.expiryDate) return { windowOpen: null, windowClose: null, status: 'compliant', daysToAction: null, anniversaryDate: null };

  const expiry = new Date(cert.expiryDate + 'T00:00:00');

  let windowOpen, windowClose, anniversaryDate = null;

  if (cert.certType === 'fixed') {
    windowOpen  = addMonths(expiry, -3);
    windowClose = expiry;
  } else if (cert.certType === 'renewal') {
    windowOpen  = addMonths(expiry, -3);
    windowClose = expiry;
  } else {
    // range: ±3 months around anniversary date
    const annivMonth = expiry.getMonth();
    const annivDay   = expiry.getDate();
    anniversaryDate  = String(annivMonth + 1).padStart(2,'0') + '-' + String(annivDay).padStart(2,'0');

    let anniv = new Date(today.getFullYear(), annivMonth, annivDay);
    windowOpen  = addMonths(anniv, -3);
    windowClose = addMonths(anniv, 3);

    // If this year's window is already closed, roll to next year
    if (today > windowClose) {
      anniv = new Date(today.getFullYear() + 1, annivMonth, annivDay);
      windowOpen  = addMonths(anniv, -3);
      windowClose = addMonths(anniv, 3);
    }
    // Cap at expiry
    if (windowClose > expiry) windowClose = new Date(expiry);
  }

  // ── Status determination ───────────────────────────
  let status;
  const lastSurvey = cert.lastSurveyDate ? new Date(cert.lastSurveyDate + 'T00:00:00') : null;
  const surveyInWindow = lastSurvey && lastSurvey >= windowOpen && lastSurvey <= windowClose;

  if (today > expiry) {
    status = 'overdue';
  } else if (today > windowClose) {
    // Window closed — if no survey recorded in that window → overdue
    status = surveyInWindow ? 'compliant' : 'overdue';
  } else if (today >= windowOpen) {
    status = surveyInWindow ? 'compliant' : 'window_open';
  } else {
    status = 'compliant';
  }

  // ── Days to action ─────────────────────────────────
  let daysToAction = null;
  if (status === 'overdue') {
    daysToAction = daysBetween(today, windowClose); // negative
  } else if (status === 'window_open') {
    daysToAction = daysBetween(today, windowClose); // days remaining in window
  } else {
    daysToAction = daysBetween(today, windowOpen);  // days until window opens
  }

  return { windowOpen, windowClose, status, daysToAction, anniversaryDate };
}

// ── Render: full cert view ────────────────────────────
function renderCertView() {
  initCertState();
  renderCertKPIs();
  populateCertFilterDropdowns();
  renderCertTable();
}

// ── Render: KPI summary row ───────────────────────────
function renderCertKPIs() {
  const certs = state.certificates || [];
  const totals = { total: certs.length, compliant: 0, window_open: 0, overdue: 0 };
  certs.forEach(c => {
    const { status } = calcCertWindows(c);
    totals[status] = (totals[status] || 0) + 1;
  });

  document.getElementById('certKpiBar').innerHTML = `
    <div class="cert-kpi kpi-cert-total">
      <div class="cert-kpi-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div>
      <div class="cert-kpi-body"><div class="cert-kpi-val">${totals.total}</div><div class="cert-kpi-lbl">Total Certificates</div></div>
    </div>
    <div class="cert-kpi kpi-cert-compliant">
      <div class="cert-kpi-icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
      <div class="cert-kpi-body"><div class="cert-kpi-val">${totals.compliant}</div><div class="cert-kpi-lbl">Compliant</div></div>
    </div>
    <div class="cert-kpi kpi-cert-window">
      <div class="cert-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg></div>
      <div class="cert-kpi-body"><div class="cert-kpi-val">${totals.window_open}</div><div class="cert-kpi-lbl">Window Open — Action Required</div></div>
    </div>
    <div class="cert-kpi kpi-cert-overdue">
      <div class="cert-kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div>
      <div class="cert-kpi-body"><div class="cert-kpi-val">${totals.overdue}</div><div class="cert-kpi-lbl">Overdue</div></div>
    </div>`;
}

// ── Render: filter dropdowns ──────────────────────────
function populateCertFilterDropdowns() {
  const certs = state.certificates || [];
  const vessels     = [...new Set(certs.map(c => c.vesselName).filter(Boolean))].sort();
  const authorities = [...new Set(certs.map(c => c.issuingAuthority).filter(Boolean))].sort();

  const vSel = document.getElementById('certVesselFilter');
  const curV = vSel.value;
  vSel.innerHTML = '<option value="all">All Vessels</option>' +
    vessels.map(v => `<option value="${escHtml(v)}" ${v===curV?'selected':''}>${escHtml(v)}</option>`).join('');

  const aSel = document.getElementById('certAuthorityFilter');
  const curA = aSel.value;
  aSel.innerHTML = '<option value="all">All Authorities</option>' +
    authorities.map(a => `<option value="${escHtml(a)}" ${a===curA?'selected':''}>${escHtml(a)}</option>`).join('');
}

// ── Status filter pills ───────────────────────────────
function setCertStatusFilter(status) {
  certStatusFilter = status;
  document.querySelectorAll('.cert-pill').forEach(p => {
    p.className = 'cert-pill';
    if (p.dataset.status === status) p.className = 'cert-pill active-' + status;
  });
  renderCertTable();
}

// ── Render: main table ────────────────────────────────
function renderCertTable() {
  const certs     = state.certificates || [];
  const vesselF   = document.getElementById('certVesselFilter')?.value   || 'all';
  const authorityF= document.getElementById('certAuthorityFilter')?.value || 'all';
  const searchQ   = (document.getElementById('certSearch')?.value || '').trim().toLowerCase();

  // Compute derived fields & filter
  let rows = certs.map(c => ({ ...c, ...calcCertWindows(c) }))
    .filter(c => {
      if (certStatusFilter !== 'all' && c.status !== certStatusFilter) return false;
      if (vesselF !== 'all' && c.vesselName !== vesselF) return false;
      if (authorityF !== 'all' && c.issuingAuthority !== authorityF) return false;
      if (searchQ) {
        const hay = [c.vesselName, c.certName, c.issuingAuthority, c.notes].join(' ').toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });

  // Sort: overdue first, then window_open, then compliant; within each group by window date
  const sortOrder = { overdue: 0, window_open: 1, compliant: 2 };
  rows.sort((a, b) => {
    const so = sortOrder[a.status] - sortOrder[b.status];
    if (so !== 0) return so;
    return (a.windowOpen || 0) - (b.windowOpen || 0);
  });

  const tbody = document.getElementById('certTableBody');
  const empty = document.getElementById('certEmpty');

  document.getElementById('certCountBadge').textContent = `${rows.length} record${rows.length!==1?'s':''}`;

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  const STATUS_LABELS = { compliant: 'Compliant', window_open: 'Window Open', overdue: 'Overdue' };
  const TYPE_LABELS   = { range: 'Annual ±3m', renewal: 'Renewal −3m', fixed: 'Fixed Expiry' };

  tbody.innerHTML = rows.map(c => {
    const wOpen  = c.windowOpen  ? fmtDateShort(c.windowOpen)  : '—';
    const wClose = c.windowClose ? fmtDateShort(c.windowClose) : '—';
    const anniv  = c.anniversaryDate ? `<span style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;">★ ${c.anniversaryDate}</span>` : '—';

    // Timeline bar: shows where today sits relative to [windowOpen … windowClose]
    let timelineHtml = '';
    if (c.windowOpen && c.windowClose) {
      const today = new Date(); today.setHours(0,0,0,0);
      const total = c.windowClose - c.windowOpen;
      const elapsed = Math.min(Math.max(today - c.windowOpen, 0), total);
      const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
      const fillColor = c.status === 'overdue' ? 'var(--red)' : c.status === 'window_open' ? 'var(--amber)' : 'var(--green)';
      const markerLeft = Math.min(Math.max(pct, 0), 100);
      timelineHtml = `
        <div class="cert-timeline">
          <div class="cert-timeline-fill" style="width:${pct}%;background:${fillColor};opacity:0.4;"></div>
          <div class="cert-timeline-marker" style="left:${markerLeft}%;"></div>
        </div>`;
    }

    // Days indicator
    let daysHtml = '—';
    if (c.daysToAction !== null) {
      if (c.status === 'overdue') {
        daysHtml = `<span class="cert-days cert-days-overdue">${Math.abs(c.daysToAction)}d overdue</span>`;
      } else if (c.status === 'window_open') {
        daysHtml = `<span class="cert-days cert-days-window">${c.daysToAction}d left</span>`;
      } else {
        daysHtml = `<span class="cert-days cert-days-compliant">in ${c.daysToAction}d</span>`;
      }
    }

    return `<tr class="cert-row-${c.status}" data-id="${c.id}">
      <td><strong>${escHtml(c.vesselName||'—')}</strong></td>
      <td title="${escHtml(c.notes||'')}">
        ${escHtml(c.certName||'—')}
        ${c.notes ? `<span style="font-size:10px;color:var(--text-dim);margin-left:4px;" title="${escHtml(c.notes)}">📝</span>` : ''}
      </td>
      <td style="font-size:12px;color:var(--text-sec);">${escHtml(c.issuingAuthority||'—')}</td>
      <td><span style="font-size:10px;background:var(--surface2);padding:2px 7px;border-radius:10px;border:1px solid var(--border);white-space:nowrap;">${TYPE_LABELS[c.certType]||c.certType}</span></td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:12px;">${c.issueDate ? fmtDateShort(new Date(c.issueDate+'T00:00:00')) : '—'}</td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:12px;${c.status==='overdue'?'color:var(--red);font-weight:600;':''}">${c.expiryDate ? fmtDateShort(new Date(c.expiryDate+'T00:00:00')) : '—'}</td>
      <td style="text-align:center;">${anniv}</td>
      <td>
        <div class="cert-window-cell">
          <div class="cert-window-dates">${wOpen} → ${wClose}</div>
          ${timelineHtml}
        </div>
      </td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:12px;color:var(--text-sec);">${c.lastSurveyDate ? fmtDateShort(new Date(c.lastSurveyDate+'T00:00:00')) : '<span style="color:var(--text-dim);font-size:11px;">None recorded</span>'}</td>
      <td><span class="cert-badge cert-badge-${c.status}">${STATUS_LABELS[c.status]}</span></td>
      <td>${daysHtml}</td>
      <td style="text-align:center;">
        <div class="row-actions">
          <button class="icon-btn" onclick="openCertModal('${c.id}')" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="icon-btn delete" onclick="deleteCert('${c.id}')" title="Delete">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal: open (add or edit) ─────────────────────────
function openCertModal(id) {
  // Populate vessel datalist from current fleet
  const dl = document.getElementById('certVesselList');
  dl.innerHTML = (state.vessels||[]).map(v => `<option value="${escHtml(v.name)}">`).join('');

  const cert = id ? (state.certificates||[]).find(c=>c.id===id) : null;
  document.getElementById('certModalTitle').textContent = cert ? 'Edit Certificate / Audit' : 'Add Certificate / Audit';
  document.getElementById('certDeleteBtn').style.display = cert ? 'inline-flex' : 'none';
  document.getElementById('cEditId').value = cert?.id || '';

  document.getElementById('cVessel').value     = cert?.vesselName || '';
  document.getElementById('cName').value       = cert?.certName || '';
  document.getElementById('cAuthority').value  = cert?.issuingAuthority || '';
  document.getElementById('cType').value       = cert?.certType || 'range';
  document.getElementById('cIssue').value      = cert?.issueDate || '';
  document.getElementById('cExpiry').value     = cert?.expiryDate || '';
  document.getElementById('cLastSurvey').value = cert?.lastSurveyDate || '';
  document.getElementById('cNotes').value      = cert?.notes || '';

  updateCertTypeHint();
  updateCertPreview();
  openModal('certModal');
}

// ── Modal: computed preview (live) ────────────────────
function updateCertPreview() {
  updateCertTypeHint();
  const expiry     = document.getElementById('cExpiry').value;
  const lastSurvey = document.getElementById('cLastSurvey').value;
  const certType   = document.getElementById('cType').value;
  if (!expiry) { document.getElementById('certComputedRow').style.display = 'none'; return; }

  const fake = { certType, expiryDate: expiry, lastSurveyDate: lastSurvey };
  const { windowOpen, windowClose, status, anniversaryDate } = calcCertWindows(fake);

  document.getElementById('certComputedRow').style.display = 'grid';
  document.getElementById('computedWindowOpen').textContent  = windowOpen  ? fmtDate(windowOpen)  : '—';
  document.getElementById('computedWindowClose').textContent = windowClose ? fmtDate(windowClose) : '—';

  const STATUS_LABELS = { compliant: '✅ Compliant', window_open: '⚠️ Window Open', overdue: '🔴 Overdue' };
  const statusEl = document.getElementById('computedStatus');
  statusEl.textContent = STATUS_LABELS[status] || status;
  statusEl.className = 'cert-computed-value cert-computed-status';
  statusEl.style.color = status==='compliant' ? 'var(--green)' : status==='window_open' ? 'var(--amber)' : 'var(--red)';
}

function updateCertTypeHint() {
  const hints = {
    range:   'Annual/Intermediate surveys: a ±3 month window opens around the anniversary date (MM-DD of expiry) every year. A survey recorded within the window marks it Compliant.',
    renewal: 'Renewal survey: a 3-month window opens before the expiry date. Schedule the drydock or renewal survey in this period.',
    fixed:   'Fixed expiry: no survey window. The certificate simply expires on the stated date. A 3-month warning period is shown for planning.'
  };
  const type = document.getElementById('cType')?.value || 'range';
  const hint = document.getElementById('certTypeHint');
  if (hint) hint.textContent = hints[type];
}

// ── Modal: delete from inside modal ──────────────────
function deleteCertFromModal() {
  const id = document.getElementById('cEditId').value;
  if (id) { deleteCert(id); closeModal('certModal'); }
}

// ── Save certificate ──────────────────────────────────
function saveCert() {
  const vessel   = document.getElementById('cVessel').value.trim();
  const name     = document.getElementById('cName').value.trim();
  const authority= document.getElementById('cAuthority').value.trim();
  const expiry   = document.getElementById('cExpiry').value;

  if (!vessel || !name || !expiry) { showToast('Vessel, Certificate Name & Expiry Date are required.'); return; }
  if (!state.certificates) state.certificates = [];

  const editId = document.getElementById('cEditId').value;
  const record = {
    id:               editId || uid(),
    vesselName:       vessel,
    certName:         name,
    issuingAuthority: authority,
    certType:         document.getElementById('cType').value,
    issueDate:        document.getElementById('cIssue').value,
    expiryDate:       expiry,
    lastSurveyDate:   document.getElementById('cLastSurvey').value,
    notes:            document.getElementById('cNotes').value.trim()
  };

  if (editId) {
    const idx = state.certificates.findIndex(c=>c.id===editId);
    if (idx >= 0) state.certificates[idx] = record; else state.certificates.push(record);
  } else {
    state.certificates.push(record);
  }

  saveState();
  closeModal('certModal');
  renderCertView();
  showToast(editId ? 'Certificate updated ✓' : 'Certificate added ✓');
}

// ── Delete certificate ────────────────────────────────
function deleteCert(id) {
  if (!confirm('Delete this certificate record?')) return;
  state.certificates = (state.certificates||[]).filter(c=>c.id!==id);
  saveState();
  renderCertView();
  showToast('Deleted ✓');
}

// switchView deferred — called after repair module initialises below

// ══════════════════════════════════════════════════════
//  VESSEL REPAIR REQUEST MODULE
// ══════════════════════════════════════════════════════
/* ── Data Schema (stored in state.repairRequests[] and mirrored to Firebase fleet_repairs/) ──
  {
    id:          string  (uid)
    vessel:      string  (vessel name)
    department:  string  (Deck | Engine | Electrical | Safety | Accommodation)
    item:        string  (equipment / item affected)
    description: string  (full description)
    priority:    'critical' | 'high' | 'medium' | 'low'
    safetyRisk:  boolean
    officer:     string  (submitting officer name)
    status:      'pending' | 'approved' | 'hold' | 'archived'
    submittedAt: number  (Date.now() timestamp)
    convertedTaskId: string | null  (set when approved → task)
  }
──────────────────────────────────────────────────────── */

// ── Open / Close submission form ──────────────────────
// The submission form overlay has been moved to a separate vessel-side file.
// These functions gracefully handle both cases: overlay present or absent.
function openRepairSubmitForm() {
  var overlay = document.getElementById('repairFormOverlay');
  if (overlay) {
    var sel = document.getElementById('rfVessel');
    if (sel) {
      var vessels = state.vessels || [];
      sel.innerHTML = '<option value="">— Select vessel —</option>' +
        vessels.map(function(v){ return '<option value="'+escHtml(v.name)+'">'+escHtml(v.name)+'</option>'; }).join('');
    }
    ['rfDept','rfItem','rfDesc','rfOfficer'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    var sc=document.getElementById('rfSafetyRisk'); if(sc) sc.checked=false;
    var rm=document.getElementById('rfpMedium'); if(rm) rm.checked=true;
    var btn=document.getElementById('repairSubmitBtn');
    if(btn){ btn.disabled=false; btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Submit Request'; }
    overlay.classList.add('open');
  } else {
    showRepairToast('\u2139\ufe0f Submission form is handled by the vessel-side form file.', null);
  }
}

function closeRepairForm() {
  var overlay = document.getElementById('repairFormOverlay');
  if (overlay) overlay.classList.remove('open');
}

// Close on overlay click — only wire if overlay exists in DOM
(function() {
  var overlay = document.getElementById('repairFormOverlay');
  if (overlay) {
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeRepairForm(); });
  }
})();

// ── Submit repair request ─────────────────────────────
function submitRepairRequest() {
  const vessel   = document.getElementById('rfVessel').value.trim();
  const dept     = document.getElementById('rfDept').value;
  const item     = document.getElementById('rfItem').value.trim();
  const desc     = document.getElementById('rfDesc').value.trim();
  const priority = document.querySelector('input[name="rfPriority"]:checked')?.value || 'medium';
  const safety   = document.getElementById('rfSafetyRisk').checked;
  const officer  = document.getElementById('rfOfficer').value.trim();

  if (!vessel || !dept || !item || !desc || !officer) {
    showRepairToast('⚠️ Please complete all required fields.', 'repair');
    return;
  }

  const record = {
    id:          uid(),
    vessel, department: dept, item, description: desc,
    priority, safetyRisk: safety, officer,
    status:      'pending',
    submittedAt: Date.now(),
    convertedTaskId: null
  };

  const btn = document.getElementById('repairSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Submitting…';

  // Try Firebase first, fall back to local
  if (db) {
    db.ref('fleet_repairs/' + record.id).set(record)
      .then(() => {
        _finalizeRepairSubmit(record, btn);
      })
      .catch(err => {
        console.warn('Firebase write failed, saving locally:', err);
        _finalizeRepairSubmit(record, btn, true);
      });
  } else {
    _finalizeRepairSubmit(record, btn, true);
  }
}

function _finalizeRepairSubmit(record, btn, localOnly) {
  if (!state.repairRequests) state.repairRequests = [];
  // Avoid duplicate if listener already added it
  if (!state.repairRequests.find(r => r.id === record.id)) {
    state.repairRequests.unshift(record);
  }
  _knownRepairIds.add(record.id);
  saveState();

  btn.innerHTML = '✅ Submitted!';
  updateRepairBadge();

  // Notification
  const isUrgent = record.priority === 'critical' || record.priority === 'high' || record.safetyRisk;
  const variant = record.priority === 'critical' ? 'critical' : 'repair';
  showRepairToast(`🛠️ New Repair Request Submitted by ${record.vessel} 🛠️`, variant);
  if (isUrgent) playRepairChime(record.priority);

  setTimeout(() => {
    closeRepairForm();
    if (currentView === 'repairs') renderRepairView();
    if (currentView === 'dashboard') renderDashboard();
  }, 900);
}

// ── Filter state ──────────────────────────────────────
function setRepairFilter(type, val, el) {
  if (type === 'status') {
    repairFilter.status = val;
    document.querySelectorAll('#repairStatusPills .repair-pill').forEach(p => p.classList.remove('active','active-all'));
    el.classList.add(val === 'all' ? 'active-all' : 'active');
  } else if (type === 'priority') {
    if (repairFilter.priority === val) {
      repairFilter.priority = null;
      el.classList.remove('active');
    } else {
      repairFilter.priority = val;
      document.querySelectorAll('#repairPriorityPills .repair-pill').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
    }
  }
  renderRepairTable();
}

// ── Main render ───────────────────────────────────────
function renderRepairView() {
  if (!state.repairRequests) state.repairRequests = [];
  renderRepairKpis();
  populateRepairVesselFilter();
  renderRepairTable();
  updateRepairBadge();
}

function renderRepairKpis() {
  const all = state.repairRequests || [];
  const pending  = all.filter(r => r.status === 'pending').length;
  const critical = all.filter(r => r.priority === 'critical' && r.status === 'pending').length;
  const safety   = all.filter(r => r.safetyRisk && r.status !== 'archived').length;
  const approved = all.filter(r => r.status === 'approved').length;
  const archived = all.filter(r => r.status === 'archived').length;

  document.getElementById('repairKpiStrip').innerHTML = `
    <div class="repair-kpi rkpi-red">
      <div class="repair-kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zm-1 5.5v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg></div>
      <div class="repair-kpi-body"><div class="repair-kpi-val">${critical}</div><div class="repair-kpi-lbl">Critical Pending</div></div>
    </div>
    <div class="repair-kpi rkpi-amber">
      <div class="repair-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg></div>
      <div class="repair-kpi-body"><div class="repair-kpi-val">${pending}</div><div class="repair-kpi-lbl">Awaiting Review</div></div>
    </div>
    <div class="repair-kpi rkpi-red">
      <div class="repair-kpi-icon"><svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></div>
      <div class="repair-kpi-body"><div class="repair-kpi-val">${safety}</div><div class="repair-kpi-lbl">Safety / Op Risk</div></div>
    </div>
    <div class="repair-kpi rkpi-teal">
      <div class="repair-kpi-icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
      <div class="repair-kpi-body"><div class="repair-kpi-val">${approved}</div><div class="repair-kpi-lbl">Approved / Active</div></div>
    </div>
    <div class="repair-kpi rkpi-gray">
      <div class="repair-kpi-icon"><svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.07-.44.18-.88.18-1.33 0-2.58-2.09-4.67-4.67-4.67-1.29 0-2.4.52-3.24 1.35L9 2.67 7.91 1.34C7.07.52 5.96 0 4.67 0 2.09 0 0 2.09 0 4.67c0 .45.1.89.18 1.33H0v12h20V6zm-8.5-3.92c.28-.27.67-.44 1.08-.44C13.51 1.64 14.36 2.49 14.36 3.5c0 .35-.1.64-.27.9L11.5 7H10l2.5-3.17V2.08zM5.56 2.64C5.28 2.37 4.89 2.2 4.5 2.2c-.98 0-1.81.85-1.81 1.84 0 .35.1.64.27.9L5.5 8H4l-1.5-2.19-.27-.37C2.09 5.21 2 4.92 2 4.67 2 3.65 2.85 2.8 3.86 2.8c.41 0 .8.17 1.08.44L6 4.31 5.56 2.64zM18 16H2V8h16v8z"/></svg></div>
      <div class="repair-kpi-body"><div class="repair-kpi-val">${archived}</div><div class="repair-kpi-lbl">Archived / Done</div></div>
    </div>`;
}

function populateRepairVesselFilter() {
  const sel = document.getElementById('repairVesselFilter');
  if (!sel) return;
  const currentVal = sel.value;
  const vessels = [...new Set((state.repairRequests||[]).map(r=>r.vessel).filter(Boolean))].sort();
  sel.innerHTML = '<option value="all">All Vessels</option>' +
    vessels.map(v => `<option value="${escHtml(v)}"${v===currentVal?' selected':''}>${escHtml(v)}</option>`).join('');
}

function renderRepairTable() {
  const tbody = document.getElementById('repairTableBody');
  const emptyEl = document.getElementById('repairEmpty');
  if (!tbody) return;

  const vesselFilter = document.getElementById('repairVesselFilter')?.value || 'all';
  let rows = (state.repairRequests || []).filter(r => {
    if (repairFilter.status !== 'all' && r.status !== repairFilter.status) return false;
    if (repairFilter.priority && r.priority !== repairFilter.priority) return false;
    if (vesselFilter !== 'all' && r.vessel !== vesselFilter) return false;
    return true;
  });

  if (!rows.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const PRI_MAP = {
    critical: '<span class="rpri rpri-critical">⚑ Critical</span>',
    high:     '<span class="rpri rpri-high">▲ High</span>',
    medium:   '<span class="rpri rpri-medium">■ Medium</span>',
    low:      '<span class="rpri rpri-low">▼ Low</span>'
  };
  const STAT_MAP = {
    pending:  '<span class="rstat rstat-pending">Pending</span>',
    approved: '<span class="rstat rstat-approved">Approved</span>',
    hold:     '<span class="rstat rstat-hold">On Hold</span>',
    closed:   '<span class="rstat rstat-closed">Closed</span>',
    archived: '<span class="rstat rstat-archived">Archived</span>'
  };

  tbody.innerHTML = rows.map(r => {
    const ts = r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    const risk = r.safetyRisk ? '<span class="risk-flag">⚠ RISK</span>' : '<span style="color:var(--text-dim);font-size:12px;">—</span>';
    // Generate tracking ID for legacy requests that don't have one
    if (!r.trackingId) r.trackingId = generateTrackingId(r);
    const trackingBadge = `<span class="tracking-badge">${escHtml(r.trackingId)}</span>`;
    const approveBtn = (r.status==='pending'||r.status==='hold') && r.status!=='closed'
      ? `<button class="ract-btn ract-approve" onclick="event.stopPropagation();repairAction('${r.id}','approve')">✅ Approve</button>` : '';
    const holdBtn = r.status==='pending'
      ? `<button class="ract-btn ract-hold" onclick="event.stopPropagation();repairAction('${r.id}','hold')">⏸ Hold</button>` : '';
    const closeBtn = (r.status==='approved'||r.status==='pending'||r.status==='hold')
      ? `<button class="ract-btn ract-close" onclick="event.stopPropagation();repairAction('${r.id}','close')">🔒 Close</button>` : '';
    const archiveBtn = r.status!=='archived' && r.status!=='closed'
      ? `<button class="ract-btn ract-archive" onclick="event.stopPropagation();repairAction('${r.id}','archive')">🗂 Archive</button>` : '';
    const deleteBtn = `<button class="ract-btn ract-delete" onclick="event.stopPropagation();repairDelete('${r.id}')" title="Delete">🗑</button>`;
    const printBtn  = `<button class="ract-btn ract-print"  onclick="event.stopPropagation();printRepairTicket('${r.id}')" title="Print service ticket">🖨</button>`;

    return `<tr style="cursor:pointer;" onclick="toggleRepairDetail('${r.id}')">
      <td style="text-align:center;">
        <button class="icon-btn" onclick="event.stopPropagation();toggleRepairDetail('${r.id}')" title="View details" style="font-size:10px;">▼</button>
      </td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;">${trackingBadge}</td>
      <td style="font-weight:600;color:var(--teal);">${escHtml(r.vessel||'—')}</td>
      <td style="font-size:12px;color:var(--text-sec);">${escHtml(r.department||'—')}</td>
      <td style="font-weight:500;">${escHtml(r.item||'—')}</td>
      <td>${PRI_MAP[r.priority]||r.priority}</td>
      <td>${risk}</td>
      <td style="font-size:12px;">${escHtml(r.officer||'—')}</td>
      <td style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;color:var(--text-sec);">${ts}</td>
      <td>${STAT_MAP[r.status]||r.status}</td>
      <td><div class="repair-actions">${approveBtn}${holdBtn}${closeBtn}${archiveBtn}${printBtn}${deleteBtn}</div></td>
    </tr>
    <tr class="repair-detail-row" id="rdetail-${r.id}" style="display:none;">
      <td colspan="11" class="repair-detail-cell">
        <div class="repair-detail-inner">
          <div class="rdl-item"><div class="rdl-label">Tracking #</div><div class="rdl-val" style="font-family:var(--font-mono,'DM Mono',monospace);font-weight:700;color:var(--teal);">${escHtml(r.trackingId)}</div></div>
          <div class="rdl-item"><div class="rdl-label">Vessel</div><div class="rdl-val">${escHtml(r.vessel||'—')}</div></div>
          <div class="rdl-item"><div class="rdl-label">Department</div><div class="rdl-val">${escHtml(r.department||'—')}</div></div>
          <div class="rdl-item"><div class="rdl-label">Item / Equipment</div><div class="rdl-val">${escHtml(r.item||'—')}</div></div>
          <div class="rdl-item" style="grid-column:1/-1;"><div class="rdl-label">Full Description</div><div class="rdl-val" style="line-height:1.6;white-space:pre-wrap;">${escHtml(r.description||'—')}</div></div>
          <div class="rdl-item"><div class="rdl-label">Priority</div><div class="rdl-val">${PRI_MAP[r.priority]||r.priority}</div></div>
          <div class="rdl-item"><div class="rdl-label">Safety / Op Risk</div><div class="rdl-val">${r.safetyRisk?'<span style="color:var(--red);font-weight:700;">⚠️ YES — Escalated</span>':'No'}</div></div>
          <div class="rdl-item"><div class="rdl-label">Submitted By</div><div class="rdl-val">${escHtml(r.officer||'—')}</div></div>
          ${r.convertedTaskId?`<div class="rdl-item"><div class="rdl-label">Linked Task</div><div class="rdl-val" style="color:var(--teal);font-weight:600;">Linked to project task ✓ (ID: ${r.convertedTaskId.slice(0,8)}…)</div></div>`:''}
          ${r.convertedAssignee?`<div class="rdl-item"><div class="rdl-label">Assigned Owner</div><div class="rdl-val">${escHtml(r.convertedAssignee)}</div></div>`:''}
          ${r.closedAt?`<div class="rdl-item"><div class="rdl-label">Closed</div><div class="rdl-val" style="color:var(--text-sec);font-size:12px;">${new Date(r.closedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div></div>`:''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleRepairDetail(id) {
  const row = document.getElementById('rdetail-'+id);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

// ── Approve repair → open taskModal pre-filled ────────
// We store the pending repair ID so saveTask() can link back to it
let _pendingRepairApprovalId = null;

function repairApproveViaModal(repairId) {
  const req = (state.repairRequests||[]).find(r => r.id === repairId);
  if (!req) return;

  // Ensure tracking ID is set
  if (!req.trackingId) { req.trackingId = generateTrackingId(req); saveState(); }

  _pendingRepairApprovalId = repairId;

  // Pre-fill task modal fields
  editingTaskId = null;
  document.getElementById('taskModalTitle').textContent = 'Approve → Add to Tracker';
  document.getElementById('tName').value = '[REPAIR] ' + (req.item || '');
  document.getElementById('tAssign').value = req.officer || '';
  document.getElementById('tAssignEmail').value = '';
  document.getElementById('tStatus').value = 'notstarted';
  document.getElementById('tPriority').value = req.priority || 'medium';
  document.getElementById('tPct').value = '0';
  document.getElementById('tStart').value = new Date().toISOString().slice(0, 10);
  document.getElementById('tEnd').value = '';
  document.getElementById('tNotes').value = req.description || '';
  document.getElementById('tParentId').value = '';
  document.getElementById('tEditId').value = '';
  document.getElementById('tRecurring').checked = false;
  document.getElementById('recurringGroup').style.display = 'block';
  document.getElementById('pctLockNote').textContent = '';

  // Pre-select the vessel in the active vessel context so saveTask() targets correctly
  const vessel = state.vessels.find(v => v.name === req.vessel);
  if (vessel) {
    state.activeVesselId = vessel.id;
    saveState();
  }

  // Show info banner inside modal
  const existingBanner = document.getElementById('repairApprovalBanner');
  if (existingBanner) existingBanner.remove();
  const banner = document.createElement('div');
  banner.id = 'repairApprovalBanner';
  banner.style.cssText = 'background:rgba(0,168,150,0.07);border:1px solid var(--border-hi);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--text-sec);margin-bottom:14px;line-height:1.6;';
  banner.innerHTML = '<strong style="color:var(--teal);">Approving Repair Request ' + escHtml(req.trackingId) + '</strong><br>'
    + 'Vessel: <strong>' + escHtml(req.vessel) + '</strong> · Dept: <strong>' + escHtml(req.department) + '</strong><br>'
    + 'Assign an owner and set dates, then click Save Task to place it into the tracker.';
  const modalEl = document.querySelector('#taskModal .modal');
  if (modalEl) modalEl.insertBefore(banner, modalEl.querySelector('.form-group'));

  openModal('taskModal');
}

// ── Hook into saveTask to link back to repair request ─
let _repairApprovalSaving = false; // Guard: prevent closeModal cleanup during saveTask
const _origSaveTask = saveTask;
saveTask = function() {
  // Capture BEFORE _origSaveTask() runs, because closeModal() (called inside
  // _origSaveTask) would otherwise clear _pendingRepairApprovalId too early.
  const capturedRepairId = _pendingRepairApprovalId;
  if (capturedRepairId) _repairApprovalSaving = true; // Suppress cleanup in closeModal override
  _origSaveTask();
  _repairApprovalSaving = false;
  if (capturedRepairId) {
    const req = (state.repairRequests||[]).find(r => r.id === capturedRepairId);
    if (req) {
      req.status = 'approved';
      // Find the task we just created (last task in the vessel)
      const vessel = getActiveVessel();
      if (vessel && vessel.tasks && vessel.tasks.length) {
        const lastTask = vessel.tasks[vessel.tasks.length - 1];
        req.convertedTaskId = lastTask.id;
        req.convertedAssignee = lastTask.assignee || '';
      }
      if (db) {
        db.ref('fleet_repairs/'+capturedRepairId+'/status').set('approved');
        if (req.convertedTaskId) db.ref('fleet_repairs/'+capturedRepairId+'/convertedTaskId').set(req.convertedTaskId);
      }
      saveState();
      updateRepairBadge();
      if (currentView === 'repairs') renderRepairView();
      showRepairToast('\u2705 Repair ' + req.trackingId + ' approved & linked to tracker', 'teal');
    }
    _pendingRepairApprovalId = null;
    // Remove banner
    const banner = document.getElementById('repairApprovalBanner');
    if (banner) banner.remove();
    document.getElementById('taskModalTitle').textContent = 'Add Task';
  }
};

// Also clean up if modal is cancelled
const _origCloseModal = closeModal;
closeModal = function(id) {
  _origCloseModal(id);
  // Only clean up if the modal was cancelled — NOT if saveTask() triggered the close
  if (id === 'taskModal' && _pendingRepairApprovalId && !_repairApprovalSaving) {
    _pendingRepairApprovalId = null;
    const banner = document.getElementById('repairApprovalBanner');
    if (banner) banner.remove();
    document.getElementById('taskModalTitle').textContent = 'Add Task';
  }
};

// ── Manager actions ───────────────────────────────────
function repairAction(id, action) {
  if (!state.repairRequests) return;
  const req = state.repairRequests.find(r => r.id === id);
  if (!req) return;

  if (action === 'approve') {
    // Open taskModal pre-filled instead of silently creating a task
    repairApproveViaModal(id);
    return; // saveTask() hook handles the rest

  } else if (action === 'hold') {
    req.status = 'hold';
    if (db) db.ref('fleet_repairs/'+id+'/status').set('hold');
    showRepairToast('\u23f8 Request placed on hold', 'repair');

  } else if (action === 'close') {
    // Open the service ticket dialog instead of a bare confirm
    openServiceTicketDialog(id);
    return; // dialog's confirmCloseRepair() handles persistence

  } else if (action === 'archive') {
    req.status = 'archived';
    if (db) db.ref('fleet_repairs/'+id+'/status').set('archived');
    showRepairToast('\uD83D\uDDC2 Request archived', null);
  }

  saveState();
  updateRepairBadge();
  renderRepairView();
  if (currentView === 'dashboard') renderDashboard();
}

function repairDelete(id) {
  if (!confirm('Permanently delete this repair request?')) return;
  state.repairRequests = (state.repairRequests||[]).filter(r => r.id !== id);
  _knownRepairIds.delete(id);
  if (db) db.ref('fleet_repairs/'+id).remove();
  saveState();
  updateRepairBadge();
  renderRepairView();
  showToast('Deleted ✓');
}

// ── Patch renderDashboard to show pending repair alerts ──
// We wrap the existing renderDashboard to append repair data after it runs
const _origRenderDashboard = renderDashboard;
renderDashboard = function() {
  _origRenderDashboard();
  _appendRepairDashboardSection();
};

function _appendRepairDashboardSection() {
  const dv = document.getElementById('dashboardView');
  if (!dv) return;
  const pending = (state.repairRequests||[]).filter(r => r.status === 'pending');
  if (!pending.length) return; // don't append section if nothing pending

  const rows = pending.slice(0, 8).map(r => {
    const PRI_COL = { critical:'var(--red)', high:'var(--red)', medium:'var(--amber)', low:'var(--green)' };
    const ts = r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    return `<tr>
      <td><span style="color:var(--teal);font-weight:600;cursor:pointer;" onclick="switchView('repairs')">${escHtml(r.vessel||'—')}</span></td>
      <td>${escHtml(r.department||'—')}</td>
      <td style="font-weight:500;">${escHtml(r.item||'—')}</td>
      <td style="color:${PRI_COL[r.priority]||'inherit'};font-weight:700;">${(r.priority||'').charAt(0).toUpperCase()+(r.priority||'').slice(1)}</td>
      <td>${r.safetyRisk?'<span style="color:var(--red);font-weight:700;">⚠️ YES</span>':'—'}</td>
      <td style="font-size:11px;font-family:\'DM Mono\',monospace;color:var(--text-sec);">${ts}</td>
    </tr>`;
  }).join('');

  const section = document.createElement('div');
  section.style.cssText = 'margin-top:0;margin-bottom:24px;';
  section.innerHTML = `
    <div class="alerts-section" style="margin-top:20px;">
      <div class="section-title">
        🛠️ Active Maintenance Alerts
        <span style="font-family:var(--font-mono,'DM Mono',monospace);font-size:11px;color:var(--red);margin-left:6px;">${pending.length} pending</span>
      </div>
      <div class="alerts-panel">
        <table class="alert-table">
          <thead><tr><th>Vessel</th><th>Department</th><th>Item</th><th>Priority</th><th>Safety Risk</th><th>Submitted</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;">
          <button class="btn btn-ghost" style="font-size:12px;" onclick="switchView('repairs')">
            View All Repair Requests →
          </button>
          ${pending.length > 8 ? `<span style="font-size:12px;color:var(--text-dim);">+${pending.length - 8} more not shown</span>` : ''}
        </div>
      </div>
    </div>`;
  dv.appendChild(section);
}

// ── Auto-close repair when linked task hits 100% ────────
function _checkRepairAutoClose(taskId, pct) {
  if (!taskId || pct < 100) return;
  const req = (state.repairRequests||[]).find(r => r.convertedTaskId === taskId && r.status !== 'closed');
  if (!req) return;
  req.status = 'closed';
  req.closedAt = Date.now();
  if (db) { db.ref('fleet_repairs/'+req.id+'/status').set('closed'); db.ref('fleet_repairs/'+req.id+'/closedAt').set(req.closedAt); }
  saveState();
  updateRepairBadge();
  showRepairToast('\uD83D\uDD12 Repair ' + req.trackingId + ' auto-closed — task 100% complete', 'teal');
  if (currentView === 'repairs') renderRepairView();
  // Offer the service ticket dialog after auto-close
  setTimeout(() => openServiceTicketDialog(req.id), 400);
}

// Patch updateTaskPct so auto-close fires when a task reaches 100%
if (typeof updateTaskPct === 'function') {
  const _origUpdateTaskPct = updateTaskPct;
  updateTaskPct = function(taskId, pct) {
    _origUpdateTaskPct(taskId, pct);
    _checkRepairAutoClose(taskId, pct);
  };
}

// ── Generate Repair Report (Excel) ───────────────────
function generateRepairReport() {
  const requests = state.repairRequests || [];
  if (!requests.length) {
    showRepairToast('\u2139\uFE0F No repair requests to export.', null);
    return;
  }

  const headers = [
    'Tracking #', 'Vessel', 'Department', 'Item / Equipment',
    'Priority', 'Safety Risk', 'Submitted By', 'Date Submitted',
    'Status', 'Assigned Owner', 'Linked Task ID', 'Closed At'
  ];

  const priLabel = { critical:'Critical', high:'High', medium:'Medium', low:'Low' };
  const statusLabel = { pending:'Pending', approved:'Approved', hold:'On Hold', closed:'Closed', archived:'Archived' };

  const buildRow = r => {
    if (!r.trackingId) r.trackingId = generateTrackingId(r);
    const submitted = r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const closedAt  = r.closedAt   ? new Date(r.closedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    return [
      r.trackingId||'—', r.vessel||'—', r.department||'—', r.item||'—',
      priLabel[r.priority]||r.priority||'—',
      r.safetyRisk ? 'YES' : 'No',
      r.officer||'—', submitted,
      statusLabel[r.status]||r.status||'—',
      r.convertedAssignee||'—', r.convertedTaskId||'—', closedAt
    ];
  };

  const colWidths = [
    {wch:14},{wch:20},{wch:14},{wch:32},
    {wch:11},{wch:12},{wch:24},{wch:20},
    {wch:11},{wch:22},{wch:38},{wch:20}
  ];

  const wb = XLSX.utils.book_new();

  // Sheet 1: All Requests
  const ws = XLSX.utils.aoa_to_sheet([headers, ...requests.map(buildRow)]);
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, 'All Requests');

  // Sheet 2: Open Requests (pending / hold / approved)
  const openRows = requests.filter(r => r.status==='pending'||r.status==='hold'||r.status==='approved');
  if (openRows.length) {
    const wsOpen = XLSX.utils.aoa_to_sheet([headers, ...openRows.map(buildRow)]);
    wsOpen['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, wsOpen, 'Open Requests');
  }

  // Sheet 3: Summary
  const total    = requests.length;
  const pending  = requests.filter(r=>r.status==='pending').length;
  const approved = requests.filter(r=>r.status==='approved').length;
  const closed   = requests.filter(r=>r.status==='closed').length;
  const critical = requests.filter(r=>r.priority==='critical').length;
  const safetyRiskCount = requests.filter(r=>r.safetyRisk).length;
  const today = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  const vesselBreakdown = Object.entries(
    requests.reduce((acc,r)=>{ if(r.vessel){ acc[r.vessel]=(acc[r.vessel]||0)+1; } return acc; },{})
  ).sort((a,b)=>b[1]-a[1]);

  const statusBreakdown = Object.entries(
    requests.reduce((acc,r)=>{ acc[r.status]=(acc[r.status]||0)+1; return acc; },{})
  );

  const summaryData = [
    ['VesselTrack — Repair Requests Report'],
    ['Generated', today],
    [''],
    ['OVERVIEW'],
    ['Total Requests',    total],
    ['Pending Review',    pending],
    ['Approved / Active', approved],
    ['Closed',            closed],
    ['Critical Priority', critical],
    ['Safety / Op Risk',  safetyRiskCount],
    [''],
    ['STATUS BREAKDOWN'],
    ...statusBreakdown.map(([k,v]) => [statusLabel[k]||k, v]),
    [''],
    ['VESSEL BREAKDOWN'],
    ...vesselBreakdown.map(([k,v]) => [k, v])
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{wch:26},{wch:16}];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const filename = 'RepairReport_' + new Date().toISOString().slice(0,10) + '.xlsx';
  XLSX.writeFile(wb, filename);
  showRepairToast('\uD83D\uDCC5 Report exported: ' + filename, 'teal');
}

// ── Init: set up repairs listener if db is already connected ──
if (db) initRepairsListener();

// ── Update badge on init ──
updateRepairBadge();

// ── Initial view ── (must come AFTER repair module is fully defined)
switchView('dashboard');

// ── Periodic refresh ──
setInterval(()=>{
  if(currentView==='dashboard') renderDashboard();
  checkOverdueAlerts();
  updateRepairBadge();
}, 5*60*1000);

// ── Expose form open for "Submit New Request" from topbar if needed ──
// Already wired via onclick="openRepairSubmitForm()" in the button

/* ═══════════════════════════════════════════════════
   SERVICE TICKET / CLOSE DIALOG
═══════════════════════════════════════════════════ */

// ID of the repair currently being closed via the service ticket dialog
let _pendingCloseRepairId = null;

// Open the service ticket close dialog
function openServiceTicketDialog(repairId) {
  const req = (state.repairRequests || []).find(r => r.id === repairId);
  if (!req) return;
  _pendingCloseRepairId = repairId;

  if (!req.trackingId) { req.trackingId = generateTrackingId(req); saveState(); }

  const priLabel = { critical:'Critical', high:'High', medium:'Medium', low:'Low' };
  const ts = req.submittedAt ? new Date(req.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const closedAt = new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

  document.getElementById('st-trackingNum').textContent = req.trackingId;
  document.getElementById('st-vessel').textContent = req.vessel || '—';
  document.getElementById('st-dept').textContent = req.department || '—';
  document.getElementById('st-item').textContent = req.item || '—';
  document.getElementById('st-priority').textContent = priLabel[req.priority] || (req.priority || '—');
  document.getElementById('st-safety').textContent = req.safetyRisk ? '⚠️ YES — Safety / Op Risk' : 'No';
  document.getElementById('st-submittedBy').textContent = req.officer || '—';
  document.getElementById('st-dateSubmitted').textContent = ts;
  document.getElementById('st-dateClose').textContent = closedAt;
  document.getElementById('st-description').textContent = req.description || '—';
  document.getElementById('st-assignee').textContent = req.convertedAssignee || req.officer || '—';

  // Clear editable fields
  document.getElementById('st-workDone').value = '';
  document.getElementById('st-partsUsed').value = '';
  document.getElementById('st-techName').value = req.convertedAssignee || '';
  document.getElementById('st-supervisorName').value = '';
  document.getElementById('st-remarks').value = '';

  const overlay = document.getElementById('serviceTicketOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeServiceTicketDialog() {
  const overlay = document.getElementById('serviceTicketOverlay');
  if (overlay) overlay.classList.remove('open');
  _pendingCloseRepairId = null;
}

// Confirm close and finalize the repair request
function confirmCloseRepair() {
  if (!_pendingCloseRepairId) return;
  const req = (state.repairRequests || []).find(r => r.id === _pendingCloseRepairId);
  if (req) {
    req.status = 'closed';
    req.closedAt = Date.now();
    req.serviceNotes = document.getElementById('st-workDone').value;
    req.partsUsed = document.getElementById('st-partsUsed').value;
    req.closedByTech = document.getElementById('st-techName').value;
    req.closedBySupervisor = document.getElementById('st-supervisorName').value;
    req.closingRemarks = document.getElementById('st-remarks').value;
    if (db) {
      db.ref('fleet_repairs/' + req.id + '/status').set('closed');
      db.ref('fleet_repairs/' + req.id + '/closedAt').set(req.closedAt);
      db.ref('fleet_repairs/' + req.id + '/serviceNotes').set(req.serviceNotes || '');
      db.ref('fleet_repairs/' + req.id + '/partsUsed').set(req.partsUsed || '');
      db.ref('fleet_repairs/' + req.id + '/closedByTech').set(req.closedByTech || '');
      db.ref('fleet_repairs/' + req.id + '/closedBySupervisor').set(req.closedBySupervisor || '');
      db.ref('fleet_repairs/' + req.id + '/closingRemarks').set(req.closingRemarks || '');
    }
    saveState();
    updateRepairBadge();
    if (currentView === 'repairs') renderRepairView();
    if (currentView === 'dashboard') renderDashboard();
    showRepairToast('🔒 Repair ' + req.trackingId + ' closed & service ticket saved', 'teal');
  }
  closeServiceTicketDialog();
}

// Print service ticket for any repair (by id, or current dialog)
function printRepairTicket(repairId) {
  const id = repairId || _pendingCloseRepairId;
  if (!id) return;
  const req = (state.repairRequests || []).find(r => r.id === id);
  if (!req) return;

  if (!req.trackingId) { req.trackingId = generateTrackingId(req); saveState(); }

  const priLabel = { critical:'Critical', high:'High', medium:'Medium', low:'Low' };
  const ts = req.submittedAt ? new Date(req.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const closedAtStr = req.closedAt ? new Date(req.closedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  // If dialog is open, capture the current editable field values
  const workDone = (repairId ? (req.serviceNotes||'') : (document.getElementById('st-workDone')?.value || req.serviceNotes||''));
  const parts    = (repairId ? (req.partsUsed||'')   : (document.getElementById('st-partsUsed')?.value || req.partsUsed||''));
  const techName = (repairId ? (req.closedByTech||'') : (document.getElementById('st-techName')?.value || req.closedByTech||''));
  const supvName = (repairId ? (req.closedBySupervisor||'') : (document.getElementById('st-supervisorName')?.value || req.closedBySupervisor||''));
  const remarks  = (repairId ? (req.closingRemarks||'') : (document.getElementById('st-remarks')?.value || req.closingRemarks||''));

  const printArea = document.getElementById('printTicketArea');
  if (!printArea) return;

  printArea.innerHTML = `
<div style="font-family:var(--font-body,'DM Sans',sans-serif);max-width:700px;margin:0 auto;padding:32px;background:white;color:#111827;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#00756a,#00a896);border-radius:10px;padding:22px 26px 18px;color:white;margin-bottom:24px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-bottom:3px;font-family:monospace;">VesselTrack Fleet Management</div>
    <div style="font-size:26px;font-weight:700;letter-spacing:1px;line-height:1.1;">REPAIR SERVICE TICKET</div>
    <div style="margin-top:8px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <span style="font-family:monospace;font-size:13px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:4px;padding:3px 10px;">${escHtml(req.trackingId)}</span>
      <span style="font-size:12px;opacity:.8;">Status: <strong>${req.status === 'closed' ? 'CLOSED' : 'PENDING CLOSE'}</strong></span>
    </div>
    <div style="display:flex;gap:24px;margin-top:14px;flex-wrap:wrap;">
      <div><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;">Vessel</div><div style="font-size:13px;font-weight:600;">${escHtml(req.vessel||'—')}</div></div>
      <div><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;">Department</div><div style="font-size:13px;font-weight:600;">${escHtml(req.department||'—')}</div></div>
      <div><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;">Priority</div><div style="font-size:13px;font-weight:600;">${priLabel[req.priority]||req.priority||'—'}</div></div>
      <div><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;">Safety Risk</div><div style="font-size:13px;font-weight:600;">${req.safetyRisk ? '⚠️ YES' : 'No'}</div></div>
    </div>
  </div>

  <!-- Request Details -->
  <div style="margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00a896;display:flex;align-items:center;gap:8px;">REQUEST DETAILS <span style="flex:1;height:1px;background:#dde3ec;display:inline-block;"></span></div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <tr>
      <td style="padding:7px 10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:4px;width:50%;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;">Item / Equipment</div>
        <div style="font-size:13px;font-weight:500;">${escHtml(req.item||'—')}</div>
      </td>
      <td style="width:8px;"></td>
      <td style="padding:7px 10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:4px;width:50%;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;">Submitted By</div>
        <div style="font-size:13px;font-weight:500;">${escHtml(req.officer||'—')}</div>
      </td>
    </tr>
    <tr><td colspan="3" style="height:8px;"></td></tr>
    <tr>
      <td style="padding:7px 10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:4px;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;">Date Submitted</div>
        <div style="font-size:13px;font-family:monospace;">${ts}</div>
      </td>
      <td style="width:8px;"></td>
      <td style="padding:7px 10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:4px;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;">Date Closed</div>
        <div style="font-size:13px;font-family:monospace;">${closedAtStr}</div>
      </td>
    </tr>
    <tr><td colspan="3" style="height:8px;"></td></tr>
    <tr>
      <td colspan="3" style="padding:9px 10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:4px;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Full Description / Fault Reported</div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(req.description||'—')}</div>
      </td>
    </tr>
  </table>

  <!-- Work Carried Out -->
  <div style="margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00a896;display:flex;align-items:center;gap:8px;">WORK CARRIED OUT <span style="flex:1;height:1px;background:#dde3ec;display:inline-block;"></span></div>
  <div style="padding:10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:6px;min-height:80px;font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:16px;">${escHtml(workDone||'')}</div>

  <!-- Parts Used -->
  <div style="margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00a896;display:flex;align-items:center;gap:8px;">PARTS / MATERIALS USED <span style="flex:1;height:1px;background:#dde3ec;display:inline-block;"></span></div>
  <div style="padding:10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:6px;min-height:60px;font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:16px;">${escHtml(parts||'')}</div>

  <!-- Remarks -->
  ${remarks ? `<div style="margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00a896;display:flex;align-items:center;gap:8px;">ADDITIONAL REMARKS <span style="flex:1;height:1px;background:#dde3ec;display:inline-block;"></span></div>
  <div style="padding:10px;background:#f7f8fa;border:1px solid #dde3ec;border-radius:6px;font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:16px;">${escHtml(remarks)}</div>` : ''}

  <!-- Signatures -->
  <div style="margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00a896;display:flex;align-items:center;gap:8px;">SIGN-OFF <span style="flex:1;height:1px;background:#dde3ec;display:inline-block;"></span></div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:48%;padding:10px 0 4px;vertical-align:bottom;">
        <div style="border-bottom:1.5px solid #6b7280;min-height:48px;margin-bottom:5px;padding-bottom:4px;font-size:13px;color:#374151;">${escHtml(techName)}</div>
        <div style="font-size:10px;color:#9ca3af;font-family:monospace;letter-spacing:.06em;">TECHNICIAN / ENGINEER</div>
      </td>
      <td style="width:4%;"></td>
      <td style="width:48%;padding:10px 0 4px;vertical-align:bottom;">
        <div style="border-bottom:1.5px solid #6b7280;min-height:48px;margin-bottom:5px;padding-bottom:4px;font-size:13px;color:#374151;">${escHtml(supvName)}</div>
        <div style="font-size:10px;color:#9ca3af;font-family:monospace;letter-spacing:.06em;">SUPERVISOR / CHIEF OFFICER</div>
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #dde3ec;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9ca3af;font-family:monospace;">
    <span>VesselTrack Fleet Management System</span>
    <span>Printed: ${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
  </div>
</div>`;

  printArea.style.display = 'block';
  printArea.style.position = 'static';
  printArea.style.left = '';
  window.print();
  printArea.style.display = 'none';
  printArea.style.position = 'absolute';
  printArea.style.left = '-9999px';
}

// Close dialog on overlay click
document.addEventListener('DOMContentLoaded', function() {
  const st = document.getElementById('serviceTicketOverlay');
  if (st) st.addEventListener('click', function(e){ if(e.target === st) closeServiceTicketDialog(); });
});