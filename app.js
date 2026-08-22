/* ════════════════════════════════════════════════════════════
   🔥 PASTE YOUR FIREBASE CONFIG HERE
   Get it: Firebase Console → Project Settings → Your apps → Web app
   ⚠  Replace ALL 6 values below with your real project values
════════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBodhMATYuMKmnioEUziKrE2_rRZFWa_fc",
  authDomain: "teamsync03-3d5fc.firebaseapp.com",
  projectId: "teamsync03-3d5fc",
  storageBucket: "teamsync03-3d5fc.firebasestorage.app",
  messagingSenderId: "983918066218",
  appId: "1:983918066218:web:782b641e10a70cc404e153"
};
/* ════════════════════════════════════════════════════════════
   DATA & CONSTANTS
════════════════════════════════════════════════════════════ */
const DEPTS = ['Computer Science & Engineering','Information Technology','Electronics & Communication',
  'Electrical Engineering','Mechanical Engineering','Civil Engineering',
  'Artificial Intelligence & Data Science','Artificial Intelligence & Machine Learning','MBA / Management','Biotechnology','Other'];

const DEPT_SHORT = {
  'Computer Science & Engineering':'CSE','Information Technology':'IT',
  'Electronics & Communication':'ECE','Electrical Engineering':'EEE',
  'Mechanical Engineering':'MECH','Civil Engineering':'CIVIL',
  'Artificial Intelligence & Data Science':'AIDS','Artificial Intelligence & Machine Learning':'AIML',
  'MBA / Management':'MBA','Biotechnology':'BIO','Other':'OTHER'
};

const DEPT_COLOR = {
  'Computer Science & Engineering':'#00e5a0','Information Technology':'#3b9eff',
  'Electronics & Communication':'#ffbe3d','Electrical Engineering':'#ff4e6a',
  'Mechanical Engineering':'#b06cff','Civil Engineering':'#ff7c3b',
  'Artificial Intelligence & Data Science':'#22d3ee','Artificial Intelligence & Machine Learning':'#f472b6',
  'MBA / Management':'#a3e635','Biotechnology':'#4ade80','Other':'#94a3b8'
};

const ROLES = {captain:'Captain',vice:'Vice Captain',manager:'Team Manager',strategist:'Strategist',team_leader:'Team Leader',member:'Member'};
const SENIOR_ROLES = ['captain','vice','manager','strategist','team_leader'];

function dc(dept){return DEPT_COLOR[dept]||'#94a3b8'}
function ini(n){return (n||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
/* Returns the inner HTML for an avatar circle — a cropped photo if the member has
   uploaded one (m.photoURL), otherwise falls back to initials. */
function avInner(m){
  return (m&&m.photoURL) ? `<img src="${m.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">` : ini(m&&m.name);
}
/* Applies member color to an avatar circle without disturbing its size/shape —
   never use style.cssText here, it wipes out width/height/overflow set elsewhere. */
function paintAvatar(el,color){
  if(!el) return;
  el.style.background=`${color}1a`;
  el.style.color=color;
  el.style.border=`1.5px solid ${color}40`;
}
function ds(dept){return DEPT_SHORT[dept]||'OTH'}
function isSenior(role){return SENIOR_ROLES.includes(role)}
function sid(x){return String(x)}
/* Personal dashboards: Captain, Vice, Manager & Strategist can open ANY member's
   dashboard in view-only mode. Team Leader is excluded — they only see their own. */
function canViewOtherDashboards(role){return isSenior(role) && role!=='team_leader'}


/* ════════════════════════════════════════════════════════════
   DATA — backed by Firebase Firestore
   Collections: members | messages | reports | roadmaps | hackathons | aptitudeMaterials | aptitudeTests
════════════════════════════════════════════════════════════ */
let members    = [];
let messages   = [];
let reports    = [];
let roadmaps   = [];
let hackathons = [];
let leetcodeStats = [];  // LeetCode tracker data
let dailyTasks    = [];  // Daily tasks per member
let domains       = [];  // Domain groups { id, name, emoji, tlId, tlName, memberIds, psName }
let aptitudeMaterials = []; // Study material posted by Captain / Aptitude Incharge
let aptitudeTests     = []; // MCQ tests { id, title, questions:[{q,options,correct}], submissions:[{memberId,answers,score}] }
let captainLeave  = null; // { id, type:'single'|'range', startDate, endDate, startTime, endTime, viceCaptainId, appliedAt, active }
let CU         = null; // current logged-in user

/* ── Firestore instance (compat SDK — available as global firebase.firestore()) ── */
let _firestore = null;
function db(){
  if(!_firestore) _firestore = firebase.firestore();
  return _firestore;
}

/* ── Firebase Storage instance (compat SDK — for binary report uploads) ── */
let _storage = null;
function storage(){
  if(!_storage) _storage = firebase.storage();
  return _storage;
}

/* ── Detect if running inside the Capacitor native APK (vs a normal browser) ── */
function isNativeApp(){
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/* ════════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS (Capacitor FCM → Vercel proxy → FCM Admin)
   Requires: npm i @capacitor/push-notifications ; npx cap sync
   See SETUP_PUSH_NOTIFICATIONS.md for the Android Studio + Vercel steps.
════════════════════════════════════════════════════════════ */
const NOTIFY_API = 'https://teamsyncv11.vercel.app/api/send-notification'; // ⚠ change if your proxy domain differs

/* Ask permission + register device token. Call once after login. No-op on web. */
async function initPushNotifications(){
  if(!isNativeApp() || !CU) return;
  try{
    const P = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
    if(!P){ console.warn('PushNotifications plugin not found — did you npx cap sync?'); return; }

    let perm = await P.checkPermissions();
    if(perm.receive !== 'granted') perm = await P.requestPermissions();
    if(perm.receive !== 'granted'){ console.warn('Push permission denied'); return; }

    // Avoid stacking duplicate listeners on repeat logins
    await P.removeAllListeners();

    P.addListener('registration', (token) => { saveFcmToken(token.value); });
    P.addListener('registrationError', (err) => { console.error('FCM registration error', err); });
    P.addListener('pushNotificationReceived', (n) => {
      // Foreground push — app is open, so just toast it instead of a system banner
      toast(`🔔 ${n.title || 'TeamSync'}: ${n.body || ''}`);
    });
    P.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action.notification && action.notification.data) || {};
      if(data.type === 'roadmap') goTo('roadmap');
      else if(data.type === 'message') goTo('announce');
    });

    await P.register();
  }catch(e){ console.error('initPushNotifications failed', e); }
}

/* Store this device's FCM token against the current user in Firestore */
async function saveFcmToken(token){
  if(!CU || !token) return;
  try{
    await db().collection('fcmTokens').doc(String(CU.id)).set({
      uid: Number(CU.id), name: CU.name, token, updatedAt: nowStr()
    }, { merge:true });
  }catch(e){ console.error('saveFcmToken failed', e); }
}

/* Ask the Vercel proxy to push a notification to one or more member ids.
   Fails silently (network/proxy issues shouldn't block the in-app action). */
async function sendPushNotification({ toIds, title, body, type, extra }){
  if(!toIds || !toIds.length) return;
  try{
    await fetch(NOTIFY_API, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ toIds, title, body, type, extra: extra||{} })
    });
  }catch(e){ console.error('sendPushNotification failed', e); }
}

/* ── Convert a Blob to a base64 string (no data: prefix) — used for native file saving ── */
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
}

/* Tracks any Firestore read errors so init() can show the real reason instead of
   silently treating a failed load as "no data / first-time setup" */
let __fsErrors = [];

/* Load all documents from a collection, optionally ordered by a field */
async function loadCol(col, orderField){
  try {
    let ref = db().collection(col);
    if(orderField) ref = ref.orderBy(orderField);
    const snap = await ref.get();
    return snap.docs.map(d => ({...d.data(), _fid: d.id}));
  } catch(e){
    console.warn('loadCol error', col, e);
    __fsErrors.push(`${col}: ${e.code || ''} ${e.message || e}`);
    return [];
  }
}

/* Load all collections at once */
async function reloadData(){
  [members, messages, reports, roadmaps, hackathons, leetcodeStats, dailyTasks, domains, aptitudeMaterials, aptitudeTests] = await Promise.all([
    loadCol('members'),
    loadCol('messages', 'time'),
    loadCol('reports',  'time'),
    loadCol('roadmaps'),
    loadCol('hackathons'),
    loadCol('leetcodeStats'),
    loadCol('dailyTasks'),
    loadCol('domains'),
    loadCol('aptitudeMaterials'),
    loadCol('aptitudeTests')
  ]);
  // Load captain leave setting
  try {
    const snap = await db().collection('settings').doc('captainLeave').get();
    captainLeave = snap.exists ? snap.data() : null;
  } catch(e){ captainLeave = null; }
}

/* ── Captain Leave helpers ── */
function isCaptainOnLeave(){
  if(!captainLeave||!captainLeave.active) return false;
  const now = new Date();
  if(captainLeave.type==='single'){
    // Single day: check if today's date matches and within time range
    const today2 = todayKey();
    if(captainLeave.startDate !== today2) return false;
    if(captainLeave.startTime && captainLeave.endTime){
      const [sh,sm]=captainLeave.startTime.split(':').map(Number);
      const [eh,em]=captainLeave.endTime.split(':').map(Number);
      const start=new Date(); start.setHours(sh,sm,0,0);
      const end=new Date(); end.setHours(eh,em,0,0);
      return now>=start && now<=end;
    }
    return true;
  } else {
    // Range: check if now is within start date+time and end date+time
    const startDT = new Date(captainLeave.startDate + 'T' + (captainLeave.startTime||'00:00'));
    const endDT   = new Date(captainLeave.endDate   + 'T' + (captainLeave.endTime||'23:59'));
    return now >= startDT && now <= endDT;
  }
}

/* Returns true if current user effectively has captain-level access
   (either IS captain, or IS vice captain with active delegated access) */
function hasElevatedAccess(){
  if(!CU) return false;
  if(CU.role==='captain') return true;
  if(CU.role==='vice' && isCaptainOnLeave()){
    // Confirm this vice captain is the designated one
    const vc = members.find(m=>m.role==='vice');
    return vc && String(vc.id)===String(CU.id);
  }
  return false;
}

async function saveCaptainLeave(leaveData){
  await db().collection('settings').doc('captainLeave').set(leaveData);
  captainLeave = leaveData;
}

async function clearCaptainLeave(){
  await db().collection('settings').doc('captainLeave').delete();
  captainLeave = null;
}

/* Save / overwrite a document — doc id = String(data.id) */
async function saveDoc(col, data){
  const docId = String(data.id || Date.now());
  // Remove internal _fid before saving to Firestore
  const clean = {...data}; delete clean._fid;
  await db().collection(col).doc(docId).set(clean);
}

/* Delete a document */
async function delDoc(col, id){
  await db().collection(col).doc(String(id)).delete();
}

/* persist() — no-op shim; every action saves directly to Firestore */
function persist(){}

/* ════════════════════════════════════════════════════════════
   APP INIT — initialise Firebase then load from Firestore
════════════════════════════════════════════════════════════ */
async function init(){
  // Initialise Firebase (guard against double-init)
  if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

  // Hide all screens while loading
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display    = 'none';

  // Show spinner while loading
  const nlDiv = document.createElement('div');
  nlDiv.id = 'net-loading';
  nlDiv.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);gap:18px';
  nlDiv.innerHTML = '<div style="width:44px;height:44px;border:3px solid var(--b2);border-top-color:var(--acc);border-radius:50%;animation:spin .8s linear infinite"></div><div style="color:var(--t2);font-size:.88rem;font-weight:600">Connecting to TeamSync…</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(nlDiv);

  function removeLoader(){ const el=document.getElementById('net-loading'); if(el)el.remove(); }
  function showNetError(detail){
    const el=document.getElementById('net-loading');
    if(!el)return;
    const detailHtml = detail ? `<div style="font-family:var(--mono,monospace);font-size:.68rem;color:#f87171;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:8px;padding:10px 12px;margin-bottom:20px;text-align:left;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto">${detail.replace(/</g,'&lt;')}</div>` : '';
    el.innerHTML='<div style="text-align:center;padding:32px 24px;max-width:360px"><div style="font-size:2.8rem;margin-bottom:16px">&#128225;</div><div style="font-size:1.1rem;font-weight:800;color:var(--t1);margin-bottom:8px">Connection Failed</div><div style="font-size:.84rem;color:var(--t3);line-height:1.65;margin-bottom:16px">Unable to reach the server. Please check your internet connection and try again.</div>'+detailHtml+'<button onclick="location.reload()" style="background:linear-gradient(135deg,var(--acc),var(--acc2));color:#07050f;border:none;border-radius:10px;padding:11px 28px;font-family:var(--font);font-size:.88rem;font-weight:700;cursor:pointer">Retry</button></div>';
  }

  __fsErrors = [];
  try {
    await Promise.race([
      reloadData(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),8000))
    ]);
  } catch(e){
    console.error("Firestore error:", e);
    showNetError((e.code?e.code+': ':'')+(e.message||String(e)));
    return;
  }

  if(__fsErrors.length){
    console.error("Firestore load errors:", __fsErrors);
    showNetError(__fsErrors.join('\n'));
    return;
  }

  const cap = members.find(m => m.role === 'captain');
  if(!cap){
    removeLoader();
    document.getElementById('setup-screen').style.display = 'flex';
    return;
  }

  removeLoader();

  // Restore session on refresh — sessionStorage survives refresh but clears on tab close
  const savedId  = sessionStorage.getItem('tsync_uid');
  const savedTab = sessionStorage.getItem('tsync_tab') || 'dash';
  if(savedId){
    const m = members.find(x => String(x.id) === String(savedId));
    if(m){
      CU = m;
      document.getElementById('app-shell').style.display = 'block';
      buildNav();
      updateTopbarUser();
      goTo(savedTab);
      return;
    }
  }

  showLogin();
}

/* ════════════════════════════════════════════════════════════
   CAPTAIN SETUP
════════════════════════════════════════════════════════════ */
function setupCaptain(){
  const name  = v('cap-name');
  const roll  = v('cap-roll');
  const dept  = v('cap-dept');
  const pin   = v('cap-pin');
  const pin2  = v('cap-pin2');
  const err   = document.getElementById('stp1-err');
  err.textContent='';
  if(!name||!roll||!dept){err.textContent='Name, Roll No & Department are required.';return}
  if(!pin||pin.length!==4){err.textContent='PIN must be exactly 4 digits.';return}
  if(pin!==pin2){err.textContent='PINs do not match.';return}
  const cap = {
    id:Date.now(), name, roll, dept,
    year: v('cap-year'), role:'captain', email: v('cap-email'),
    pin, dream:'', targetRole:'', dreamWhy:'',
    current:'', nextWeek:'', projects:'',
    skills:[], courses:[], teamImprove:'', updates:[],
    addedOn: today()
  };
  saveDoc('members', cap).then(()=>{
    members.push(cap);
    toast('Captain account created! Welcome, '+name+'!');
    document.getElementById('setup-screen').style.display='none';
    showLogin();
  }).catch(()=>toast('Failed to save — check Firebase config','err'));
}

/* ════════════════════════════════════════════════════════════
   LOGIN
════════════════════════════════════════════════════════════ */
let selectedLoginId = null;

function showLogin(){
  document.getElementById('login-screen').style.display='flex';
  buildLoginGrid();
}

function buildLoginGrid(){
  selectedLoginId=null;
  const grid=document.getElementById('login-member-grid');
  const loginOrder=['captain','vice','manager','strategist','member'];
  const sortedLogin=[...members].sort((a,b)=>{
    const ra=a.role==='team_leader'?'member':a.role;
    const rb=b.role==='team_leader'?'member':b.role;
    return loginOrder.indexOf(ra)-loginOrder.indexOf(rb)||a.name.localeCompare(b.name);
  });
  grid.innerHTML = sortedLogin.map(m=>{
    const c=dc(m.dept);
    const displayRole=m.role==='team_leader'?'Member':ROLES[m.role];
    return `<div class="member-login-btn" id="mlb-${m.id}" onclick="selectLoginMember(${m.id})">
      <div class="mlb-av" style="background:${c}1a;color:${c};border:1.5px solid ${c}40">${avInner(m)}</div>
      <div><div class="mlb-name">${m.name}</div><div class="mlb-role">${displayRole}</div></div>
    </div>`;
  }).join('');
  document.getElementById('login-pin').value='';
  document.getElementById('login-err').textContent='';
}

function selectLoginMember(id){
  selectedLoginId=id;
  document.querySelectorAll('.member-login-btn').forEach(b=>b.classList.remove('selected'));
  const el=document.getElementById('mlb-'+id);
  if(el) el.classList.add('selected');
  document.getElementById('login-pin').focus();
}

async function doLogin(){
  const err=document.getElementById('login-err');
  err.textContent='';
  if(!selectedLoginId){err.textContent='Please select a member.';return}
  const pin=document.getElementById('login-pin').value;
  if(!pin){err.textContent='Enter your PIN.';return}

  // Reload fresh data from Firestore on every login
  await reloadData();

  const m=members.find(x=>String(x.id)===String(selectedLoginId));
  if(!m){err.textContent='Member not found.';return}
  if(pin!==(m.pin||'1234')){err.textContent='Incorrect PIN.';return}
  CU=m;
  sessionStorage.setItem('tsync_uid', String(m.id));
  sessionStorage.setItem('tsync_tab', 'dash');
  document.getElementById('login-screen').style.display='none';
  launchApp();
}

async function doLogout(){
  CU=null;
  stopLiveSync();
  sessionStorage.removeItem('tsync_uid');
  sessionStorage.removeItem('tsync_tab');
  document.getElementById('app-shell').style.display='none';
  await reloadData();
  showLogin();
}

/* ════════════════════════════════════════════════════════════
   APP LAUNCH
════════════════════════════════════════════════════════════ */
function launchApp(){
  document.getElementById('app-shell').style.display='block';
  buildNav();
  updateTopbarUser();
  goTo('dash');
  initPushNotifications();
  startMessagesLiveSync();
  startRoadmapsLiveSync();
}

/* ════════════════════════════════════════════════════════════
   LIVE SYNC — Firestore realtime listeners so Team Chat & Roadmap
   update instantly for everyone without a manual refresh/relogin.
════════════════════════════════════════════════════════════ */
let _msgUnsub = null;
let _rmUnsub = null;

function startMessagesLiveSync(){
  if(_msgUnsub) return; // already listening
  try{
    _msgUnsub = db().collection('messages').onSnapshot(snap => {
      messages = snap.docs.map(d => ({...d.data(), _fid: d.id}));
      // Only re-render if the Announcements tab is the one currently visible
      const scEl = document.getElementById('sc-announce');
      if(scEl && scEl.classList.contains('active')) renderAnnounce();
    }, err => console.error('messages live sync error', err));
  }catch(e){ console.error('startMessagesLiveSync failed', e); }
}

function startRoadmapsLiveSync(){
  if(_rmUnsub) return;
  try{
    _rmUnsub = db().collection('roadmaps').onSnapshot(snap => {
      roadmaps = snap.docs.map(d => ({...d.data(), _fid: d.id}));
      const scEl = document.getElementById('sc-roadmap');
      if(scEl && scEl.classList.contains('active')) renderRoadmap();
    }, err => console.error('roadmaps live sync error', err));
  }catch(e){ console.error('startRoadmapsLiveSync failed', e); }
}

function stopLiveSync(){
  if(_msgUnsub){ _msgUnsub(); _msgUnsub=null; }
  if(_rmUnsub){ _rmUnsub(); _rmUnsub=null; }
}

function buildNav(){
  const nav=document.getElementById('tb-nav');
  const tabs=[
    {id:'dash',     lbl:'Dashboard',  icon:'🏠'},
    {id:'announce', lbl:'Team Chat',  icon:'📢'},
    {id:'tasks',    lbl:'Daily Tasks', icon:'✅'},
    {id:'leetcode', lbl:'LeetCode',   icon:'💻'},
    {id:'reports',  lbl:'Reports',    icon:'📄'},
    {id:'roadmap',  lbl:'Roadmap',    icon:'🗺'},
    {id:'hackathon',lbl:'Hackathons', icon:'🏆'},
    {id:'aptitude', lbl:'Aptitude',   icon:'🧠'},
    {id:'depts',    lbl:'Departments',icon:'🏫'},
    {id:'profile',  lbl:'My Profile', icon:'👤'},
  ];
  // Analytics tab - visible only to senior leadership (Captain, Vice, Manager, Strategist)
  if(isSenior(CU.role) && CU.role !== 'team_leader') {
    tabs.push({id:'analytics', lbl:'Analytics', icon:'📊'});
  }
  if(CU.role==='captain'||hasElevatedAccess()) tabs.push({id:'admin',lbl:'Admin',icon:'⚙'});

  // Desktop top nav
  nav.innerHTML=tabs.map(t=>`<button class="tn" id="tn-${t.id}" onclick="goTo('${t.id}')">${t.icon} ${t.lbl}</button>`).join('');

  // Mobile bottom bar — show 5 primary tabs max, rest in hamburger menu
  const bottomTabs = tabs.slice(0,5);
  const mobileNav = document.getElementById('mobile-nav');
  mobileNav.innerHTML = bottomTabs.map(t=>`
    <button class="mn-btn" id="mn-${t.id}" onclick="goTo('${t.id}')">
      <span class="mn-icon">${t.icon}</span>
      <span>${t.lbl}</span>
    </button>`).join('') +
    `<button class="mn-btn" id="hamburger-mn" onclick="openMobileMenu()">
      <span class="mn-icon">☰</span><span>More</span>
    </button>`;

  // Mobile slide-in menu nav list
  const mmList = document.getElementById('mm-nav-list');
  mmList.innerHTML = tabs.map(t=>`
    <button class="mm-nav-item" id="mmn-${t.id}" onclick="goTo('${t.id}')">
      <span class="mm-nav-icon">${t.icon}</span>${t.lbl}
    </button>`).join('');

  // Populate mobile menu user info
  if(CU){
    const c=dc(CU.dept);
    const mmav=document.getElementById('mm-av');
    if(mmav){mmav.innerHTML=avInner(CU);paintAvatar(mmav,c);}
    const mmu=document.getElementById('mm-uname');
    if(mmu) mmu.textContent=CU.name;
    const mmr=document.getElementById('mm-role');
    if(mmr) mmr.textContent=ROLES[CU.role]||CU.role;
  }
}

function openMobileMenu(){
  document.getElementById('mobile-menu').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeMobileMenu(){
  document.getElementById('mobile-menu').classList.remove('open');
  document.body.style.overflow='';
}
function closeMobileMenuOutside(e){
  if(e.target===document.getElementById('mobile-menu')) closeMobileMenu();
}

function updateTopbarUser(){
  if(!CU)return;
  const c=dc(CU.dept);
  const av=document.getElementById('tb-av');
  av.innerHTML=avInner(CU);
  paintAvatar(av,c);
  document.getElementById('tb-uname').textContent=CU.name;
  const rb=document.getElementById('tb-rbadge');
  // Show "Acting Captain" badge if vice is elevated
  const isActing = CU.role==='vice' && isCaptainOnLeave();
  if(isActing){
    rb.textContent='Acting Captain';
    rb.className='tb-role-badge';
    rb.style.cssText='background:rgba(252,211,77,.15);color:var(--acc4);border:1px solid rgba(252,211,77,.3);display:inline-flex';
  } else if(CU.role==='team_leader'){
    rb.textContent='';
    rb.className='tb-role-badge b-'+CU.role;
    rb.style.display='none';
  } else {
    rb.textContent=ROLES[CU.role];
    rb.className='tb-role-badge b-'+CU.role;
    rb.style.display='';
  }
  // Sync mobile menu avatar
  const mmav=document.getElementById('mm-av');
  if(mmav){mmav.innerHTML=avInner(CU);paintAvatar(mmav,c);}
  const mmu=document.getElementById('mm-uname');
  if(mmu) mmu.textContent=CU.name;
  const mmr=document.getElementById('mm-role');
  if(mmr) mmr.textContent=isActing?'Acting Captain':(ROLES[CU.role]||CU.role);
}

function goTo(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tn').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.mn-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.mm-nav-item').forEach(b=>b.classList.remove('active'));

  const sc=document.getElementById('sc-'+id);
  const tn=document.getElementById('tn-'+id);
  if(sc) sc.classList.add('active');
  if(tn) tn.classList.add('active');
  const mnb=document.getElementById('mn-'+id);
  if(mnb) mnb.classList.add('active');
  const mmn=document.getElementById('mmn-'+id);
  if(mmn) mmn.classList.add('active');

  if(CU) sessionStorage.setItem('tsync_tab', id);
  closeMobileMenu();
  window.scrollTo({top:0,behavior:'smooth'});
  const renders={
    dash:renderDash, profile:renderProfile,
    announce:renderAnnounce, reports:renderReports,
    roadmap:renderRoadmap, depts:renderDepts, hackathon:renderHackathons, leetcode:renderLeetCode, admin:renderAdmin, tasks:renderTasks,
    aptitude:renderAptitude
  };
  if(renders[id]) renders[id]();
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD — personal (each member sees only their own overview)
════════════════════════════════════════════════════════════ */
function renderDash(){
  if(!CU)return;

  // Show leave status banner on dashboard
  const dashBannerEl = document.getElementById('dash-leave-banner');
  if(dashBannerEl){
    if(captainLeave && captainLeave.active){
      const vc = members.find(m=>String(m.id)===String(captainLeave.viceCaptainId));
      const vcName = vc ? vc.name : 'Vice Captain';
      const cap = members.find(m=>m.role==='captain');
      const capName = cap ? cap.name : 'Captain';
      const isActive = isCaptainOnLeave();
      if(isActive){
        dashBannerEl.innerHTML = `<div class="info-pill" style="margin-bottom:18px;background:rgba(252,211,77,.07);border-color:rgba(252,211,77,.28);color:var(--acc4)">
          ✈ <strong>${capName}</strong> is currently absent — <strong>${vcName}</strong> is acting as Captain with full access.
        </div>`;
      } else {
        dashBannerEl.innerHTML = `<div class="info-pill" style="margin-bottom:18px;background:rgba(129,140,248,.07);border-color:rgba(129,140,248,.25);color:var(--acc2)">
          📅 Captain leave scheduled — <strong>${vcName}</strong> will have acting captain access during that period.
        </div>`;
      }
    } else {
      dashBannerEl.innerHTML = '';
    }
  }

  // Load team analytics for seniors (Captain, Vice, Manager, Strategist)
  if(isSenior(CU.role)){
    setTimeout(loadTeamAnalytics, 100);
  }

  document.getElementById('dash-personal').innerHTML = personalDashboardHTML(CU.id);
}

/* Builds the full personal-dashboard markup for a given member — used both
   for a member's own Dashboard tab and could be reused for a read-only view. */
/* ════════════════════════════════════════════════════════════
   LIGHTWEIGHT SVG CHARTS — no external chart library, themeable
   via CSS vars so they match dark/light mode automatically
════════════════════════════════════════════════════════════ */
function svgSmoothPath(points){
  if(!points.length) return '';
  if(points.length===1) return `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for(let i=0;i<points.length-1;i++){
    const [x0,y0]=points[i], [x1,y1]=points[i+1];
    const midX=(x0+x1)/2;
    d += ` C ${midX.toFixed(1)},${y0.toFixed(1)} ${midX.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/* Dual-series area/line chart, e.g. "assigned vs verified" over N days */
function buildActivityChart(labels, seriesA, seriesB){
  const w=600,h=176,padL=8,padR=8,padT=16,padB=24;
  const max=Math.max(1,...seriesA,...seriesB);
  const n=labels.length;
  const stepX = n>1 ? (w-padL-padR)/(n-1) : 0;
  const y=(v)=>padT+(h-padT-padB)*(1-v/max);
  const ptsA=seriesA.map((v,i)=>[padL+i*stepX,y(v)]);
  const ptsB=seriesB.map((v,i)=>[padL+i*stepX,y(v)]);
  const pathA=svgSmoothPath(ptsA);
  const pathB=svgSmoothPath(ptsB);
  const areaA = ptsA.length ? `${pathA} L ${ptsA[ptsA.length-1][0].toFixed(1)},${(h-padB).toFixed(1)} L ${ptsA[0][0].toFixed(1)},${(h-padB).toFixed(1)} Z` : '';
  const gid='ag'+Math.random().toString(36).slice(2,8);
  const dotsA=ptsA.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--acc)"/>`).join('');
  const dotsB=ptsB.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="var(--acc2)"/>`).join('');
  const gridLines=[0.25,0.5,0.75].map(f=>{
    const gy=(padT+(h-padT-padB)*f).toFixed(1);
    return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="var(--b1)" stroke-width="1" stroke-dasharray="3,4"/>`;
  }).join('');
  const labelsHtml=labels.map((l,i)=>`<text x="${(padL+i*stepX).toFixed(1)}" y="${h-6}" font-size="9.5" fill="var(--t3)" text-anchor="middle" font-family="var(--font)">${l}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible;display:block">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--acc)" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="var(--acc)" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridLines}
    <path d="${areaA}" fill="url(#${gid})" stroke="none"/>
    <path d="${pathB}" fill="none" stroke="var(--acc2)" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
    <path d="${pathA}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round"/>
    ${dotsB}${dotsA}
    ${labelsHtml}
  </svg>`;
}

/* Semi-circle "speedometer" gauge with a needle — percent 0-100 */
function buildGaugeChart(percent){
  percent = Math.max(0,Math.min(100,Math.round(percent)));
  const size=200, cx=size/2, cy=108, r=76;
  const toXY=(deg,radius)=>{const rad=deg*Math.PI/180;return [cx+radius*Math.cos(rad), cy-radius*Math.sin(rad)];};
  const [x1,y1]=toXY(180,r), [x2,y2]=toXY(0,r);
  const needleAngle = 180-(percent/100*180);
  const [xp,yp]=toXY(needleAngle,r-14);
  const color = percent>=80?'var(--acc5)':percent>=50?'var(--acc)':'var(--acc3)';
  const circumference = Math.PI*r;
  const dash = circumference*(percent/100);
  return `<svg viewBox="0 0 ${size} 128" width="100%" height="128">
    <path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="var(--s3)" stroke-width="15" stroke-linecap="round"/>
    <path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="15" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"/>
    <line x1="${cx}" y1="${cy}" x2="${xp.toFixed(1)}" y2="${yp.toFixed(1)}" stroke="var(--t1)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6.5" fill="var(--t1)"/>
    <text x="${cx}" y="${cy-24}" text-anchor="middle" font-size="24" font-weight="800" fill="${color}" font-family="var(--font)">${percent}%</text>
  </svg>`;
}

function personalDashboardHTML(memberId){
  const m = members.find(x=>sid(x.id)===sid(memberId));
  if(!m) return emptyState('👤','Member not found');

  const c = dc(m.dept);
  const domain = domainOfMember(m.id);
  const perf = computeTaskPerformance(m.id);
  const lcEntry = leetcodeStats.find(x=>sid(x.memberId)===sid(m.id));
  const lcTotal = lcEntry ? (lcEntry.easy||0)+(lcEntry.medium||0)+(lcEntry.hard||0) : 0;

  // ── "Reports to" line ──
  let reportsTo = '—';
  if(m.role!=='captain'){
    if(domain && domain.tlId && sid(domain.tlId)!==sid(m.id)) reportsTo = domain.tlName;
    else { const cap=members.find(x=>x.role==='captain'); if(cap) reportsTo = cap.name; }
  }

  /* ── Profile card ── */
  const profileCard = `<div class="pd-card">
    <div class="pd-profile-top">
      <div class="pd-profile-av" style="background:${c}18;color:${c};border:2px solid ${c}40">${avInner(m)}</div>
      <div style="min-width:0">
        <div class="pd-profile-name">${m.name}</div>
        <div class="pd-profile-sub">${m.roll} · ${ds(m.dept)}</div>
      </div>
    </div>
    <div class="pd-profile-rows">
      <div class="pd-profile-row"><span>Role</span><span>${ROLES[m.role]}</span></div>
      <div class="pd-profile-row"><span>Email</span><span>${m.email||'—'}</span></div>
      <div class="pd-profile-row"><span>${m.role==='captain'?'Leads':'Reports to'}</span><span>${m.role==='captain'?'Whole Team':reportsTo}</span></div>
      <div class="pd-profile-row"><span>Project</span><span>${domain?domain.name:'Unassigned'}</span></div>
    </div>
  </div>`;

  /* ── Performance tiles card ── */
  const tiles = [
    {num:perf.overall.rate+'%', lbl:'Overall Task Score', color:scoreColor(perf.overall.rate)},
  ];
  if(perf.domain){
    tiles.push({num:perf.domain.rate+'%', lbl:(domain.emoji||'📁')+' '+domain.name+' Score', color:scoreColor(perf.domain.rate)});
  } else {
    tiles.push({num:'—', lbl:'No project assigned', color:'var(--t3)'});
  }
  tiles.push({num:lcTotal, lbl:'💻 LeetCode Solved', color:'var(--acc4)'});

  const perfCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Performance</h4><p>Your score across tasks &amp; project</p></div>
      <span class="pd-head-badge">${perf.overall.verified}/${perf.overall.total} verified</span>
    </div>
    <div class="pd-tiles">
      ${tiles.map(t=>`<div class="pd-tile" style="background:${t.color==='var(--t3)'?'var(--s2)':t.color+'14'};border:1px solid ${t.color==='var(--t3)'?'var(--b1)':t.color+'30'}">
        <div class="pd-tile-num" style="color:${t.color}">${t.num}</div>
        <div class="pd-tile-lbl">${t.lbl}</div>
      </div>`).join('')}
    </div>
  </div>`;

  /* ── Donut gauge card ── */
  const rate = perf.overall.rate;
  const donutColor = scoreColor(rate);
  const donutCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Task Completion</h4><p>Verified vs total assigned</p></div></div>
    <div class="pd-donut-wrap">
      <div class="pd-donut" style="background:conic-gradient(${donutColor} ${rate*3.6}deg, var(--s3) 0)">
        <div class="pd-donut-inner">
          <div class="pd-donut-num">${rate}%</div>
          <div class="pd-donut-lbl">Task Score</div>
        </div>
      </div>
      <div class="pd-donut-sub">${perf.overall.verified} verified out of ${perf.overall.total} tasks</div>
    </div>
  </div>`;

  /* ── Task Activity line chart (last 7 days: assigned vs verified) ── */
  const chartDays = [];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    chartDays.push({key, label:d.toLocaleDateString('en-IN',{weekday:'short'})});
  }
  const myAllTasks = dailyTasks.filter(t=>sid(t.memberId)===sid(m.id) && t.status!=='removed');
  const assignedSeries = chartDays.map(d=>myAllTasks.filter(t=>t.assignedDate===d.key).length);
  const verifiedSeries = chartDays.map(d=>myAllTasks.filter(t=>t.assignedDate===d.key && t.status==='verified').length);
  const weekTotal = assignedSeries.reduce((a,b)=>a+b,0);
  const weekVerified = verifiedSeries.reduce((a,b)=>a+b,0);
  const weekRate = weekTotal ? Math.round(weekVerified/weekTotal*100) : perf.overall.rate;

  const activityChartCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Task Activity</h4><p>Your last 7 days, day by day</p></div></div>
    <div style="display:flex;gap:14px;margin:8px 0 4px;font-size:.7rem;color:var(--t3)">
      <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:var(--acc);display:inline-block"></span>Assigned</span>
      <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:var(--acc2);display:inline-block"></span>Verified</span>
    </div>
    ${weekTotal ? buildActivityChart(chartDays.map(d=>d.label), assignedSeries, verifiedSeries) : emptyState('📈','No task activity in the last 7 days.')}
  </div>`;

  /* ── Weekly verification-rate gauge ── */
  const gaugeCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>This Week</h4><p>Verification rate, last 7 days</p></div></div>
    <div style="text-align:center">
      ${buildGaugeChart(weekRate)}
      <div style="font-size:.74rem;color:var(--t3);margin-top:-6px">${weekVerified} of ${weekTotal||0} verified this week</div>
    </div>
  </div>`;

  /* ── LeetCode snapshot with inline Sync Now ── */
  const lcTarget = lcEntry && lcEntry.target ? lcEntry.target : 0;
  const lcProgressPct = lcTarget ? Math.min(100, Math.round(lcTotal/lcTarget*100)) : 0;
  const leetcodeSnapshotCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>💻 LeetCode</h4><p>${lcEntry && lcEntry.handle ? '@'+escHTML(lcEntry.handle) : 'Not linked yet — add it in My Profile'}</p></div>
      ${lcEntry && lcEntry.streak ? `<span class="pd-head-badge" style="color:var(--acc4);background:rgba(252,211,77,.1);border-color:rgba(252,211,77,.25)">🔥 ${lcEntry.streak}d</span>` : ''}
    </div>
    <div class="pd-tile" style="background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.22);margin-top:12px">
      <div class="pd-tile-num" style="color:var(--acc)">${lcTotal}</div>
      <div class="pd-tile-lbl">Problems Solved</div>
    </div>
    ${lcTarget ? `<div style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--t3);margin-bottom:5px"><span>Progress to goal</span><span>${lcTotal}/${lcTarget}</span></div>
        <div style="height:8px;border-radius:99px;background:var(--s3);overflow:hidden"><div style="height:100%;width:${lcProgressPct}%;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:99px"></div></div>
      </div>` : ''}
    <button class="btn btn-p btn-sm" style="width:100%;justify-content:center;margin-top:14px" onclick="syncSingleLeetCode(${m.id}).then(()=>renderDash())">🔄 Sync Now</button>
  </div>`;

  /* ── Team Pulse — status of nearby teammates today ── */
  const todayK = todayKey();
  let pulseMembers = [];
  if(domain){
    const idSet = new Set([...(domain.memberIds||[]), domain.tlId].filter(Boolean).map(String));
    idSet.delete(String(m.id));
    pulseMembers = members.filter(x=>idSet.has(String(x.id)));
  } else {
    pulseMembers = members.filter(x=>sid(x.id)!==sid(m.id));
  }
  const pulseStatusMeta = {
    pending:{lbl:'Pending today',color:'var(--acc4)'}, submitted:{lbl:'Submitted',color:'var(--acc2)'},
    verified:{lbl:'Verified today',color:'var(--acc5)'}, carried:{lbl:'Carried over',color:'var(--acc6)'},
    overdue_pending:{lbl:'Overdue',color:'var(--acc3)'}, excused:{lbl:'Excused',color:'var(--acc)'}
  };
  const pulseCards = pulseMembers.slice(0,5).map(tm=>{
    const tc = dc(tm.dept);
    const tTask = dailyTasks.find(t=>sid(t.memberId)===sid(tm.id) && t.assignedDate===todayK && t.status!=='removed');
    const sm2 = tTask ? (pulseStatusMeta[tTask.status]||{lbl:tTask.status,color:'var(--t3)'}) : {lbl:'No task today',color:'var(--t4)'};
    return `<div style="border:1px solid var(--b1);border-left:3px solid ${sm2.color};border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px">
      <div style="width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;overflow:hidden;background:${tc}18;color:${tc};border:1.5px solid ${tc}38">${avInner(tm)}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:.85rem;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tm.name}</div>
        <div style="font-size:.7rem;color:${sm2.color};display:flex;align-items:center;gap:5px;margin-top:2px"><span style="width:6px;height:6px;border-radius:50%;background:${sm2.color};display:inline-block"></span>${sm2.lbl}</div>
      </div>
      <span style="font-size:.62rem;font-weight:700;color:${tc};background:${tc}15;border:1px solid ${tc}30;padding:2px 7px;border-radius:99px;flex-shrink:0">${ds(tm.dept)}</span>
    </div>`;
  }).join('');
  const teamPulseCard = pulseMembers.length ? `<div class="pd-card">
    <div class="pd-head"><div><h4>Team Pulse</h4><p>${domain? escHTML(domain.name)+' teammates':'Fellow team members'} — today</p></div></div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">${pulseCards}</div>
  </div>` : '';

  /* ── Skills & Courses horizontal cards ── */
  const skillCards = (m.skills||[]).map(s=>`<div class="pd-skill-card">
      <span class="pd-skill-tag" style="background:rgba(192,132,252,.12);color:var(--acc)">SKILL</span>
      <div class="pd-skill-name">${escHTML(s)}</div>
      <div class="pd-skill-status" style="color:var(--acc5)">Learnt</div>
    </div>`).join('');
  const courseCards = (m.courses||[]).map(c2=>{
    const done = c2.status==='completed';
    return `<div class="pd-skill-card" style="border-top-color:${done?'var(--acc5)':'var(--acc4)'}">
      <span class="pd-skill-tag" style="background:${done?'rgba(110,231,183,.12)':'rgba(252,211,77,.12)'};color:${done?'var(--acc5)':'var(--acc4)'}">COURSE</span>
      <div class="pd-skill-name">${escHTML(c2.name)}</div>
      <div class="pd-skill-status" style="color:${done?'var(--acc5)':'var(--acc4)'}">${done?'Completed':'Ongoing'}</div>
    </div>`;
  }).join('');
  const skillsTotal = (m.skills||[]).length + (m.courses||[]).length;
  const skillsCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Skills &amp; Courses</h4><p>What you've learnt &amp; are working on</p></div>
      <span class="pd-head-badge">${skillsTotal}</span>
    </div>
    ${skillsTotal ? `<div class="pd-skill-scroll">${skillCards}${courseCards}</div>` : `<div class="pd-empty">Nothing added yet — update this from My Profile.</div>`}
  </div>`;

  /* ── Recent tasks card ── */
  const myTasksSorted = dailyTasks.filter(t=>sid(t.memberId)===sid(m.id))
    .slice().sort((a,b)=>(b.assignedDate||'').localeCompare(a.assignedDate||'')||(b.id>a.id?1:-1));
  const recentTasks = myTasksSorted.slice(0,4);
  const taskStatusMeta = {
    pending:{lbl:'Pending',color:'var(--t3)'}, submitted:{lbl:'Submitted',color:'var(--acc2)'},
    verified:{lbl:'Verified',color:'var(--acc5)'}, carried:{lbl:'Carried Over',color:'var(--acc6)'},
    overdue_pending:{lbl:'Overdue',color:'var(--acc3)'}, excused:{lbl:'Excused',color:'var(--acc)'},
    removed:{lbl:'Removed',color:'var(--acc3)'}
  };
  const tasksCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Recent Tasks</h4><p>Your latest assigned tasks</p></div>
      <span class="pd-head-badge">${myTasksSorted.length}</span>
    </div>
    ${recentTasks.length ? recentTasks.map(t=>{
      const sm=taskStatusMeta[t.status]||{lbl:t.status,color:'var(--t3)'};
      return `<div class="pd-task-row">
        <div style="min-width:0">
          <div class="pd-task-txt">${escHTML(t.text)}</div>
          <div class="pd-task-meta">${dateLabel(t.assignedDate)}${t.psName?' · '+escHTML(t.psName):''}</div>
        </div>
        <span class="pd-task-badge" style="color:${sm.color};background:${sm.color}18;border:1px solid ${sm.color}30">${sm.lbl}</span>
      </div>`;
    }).join('') : `<div class="pd-empty">No tasks assigned yet.</div>`}
  </div>`;

  /* ── Team announcements card ── */
  const recentMsgs = messages.slice().sort((a,b)=>b.id-a.id).slice(0,4);
  const announceCard = `<div class="pd-card">
    <div class="pd-head"><div><h4>Team Announcements</h4><p>Latest updates from the team</p></div>
      <span class="pd-head-badge">${messages.length}</span>
    </div>
    ${recentMsgs.length ? recentMsgs.map(msg=>`<div class="pd-notif-item">
      <div class="pd-notif-top">
        <div class="pd-notif-txt">${escHTML(msg.text)}</div>
        ${msg.pinned?'<span class="pin-tag">📌</span>':''}
      </div>
      <div class="pd-notif-meta"><strong style="color:var(--t2)">${msg.uname}</strong><span>${msg.time}</span></div>
    </div>`).join('') : `<div class="pd-empty">No announcements yet.</div>`}
  </div>`;

  return `<div class="pd-wrap">
    <div class="pd-col">${profileCard}${gaugeCard}${donutCard}${leetcodeSnapshotCard}</div>
    <div class="pd-col">${activityChartCard}${teamPulseCard}${perfCard}${skillsCard}${tasksCard}${announceCard}</div>
  </div>`;
}

function mrHTML(m,showDelete){
  const c=dc(m.dept); const isMe=CU&&sid(m.id)===sid(CU.id);
  const ds2=ds(m.dept);
  return `<div class="mr" onclick="openMemberDetail(${m.id})">
    <div class="av" style="background:${c}18;color:${c};border:1.5px solid ${c}38">${avInner(m)}</div>
    <div class="mi">
      <div class="mn">${m.name}${isMe?' <span style="font-size:.68rem;color:var(--acc);font-weight:600;margin-left:4px">(you)</span>':''}</div>
      <div class="ms">${m.roll} · ${m.year}</div>
    </div>
    <div class="mm">
      <span class="dt" style="background:${c}15;color:${c};border:1px solid ${c}28">${ds2}</span>
      <span class="badge b-${m.role==='team_leader'?'member':m.role}">${m.role==='team_leader'?'Member':ROLES[m.role]}</span>
      ${(showDelete&&CU&&(CU.role==='captain'||hasElevatedAccess())&&m.id!==CU.id)?`<button class="btn btn-d btn-xs" onclick="event.stopPropagation();captainRemove(${m.id})">Remove</button>`:''}
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   MY PROFILE
════════════════════════════════════════════════════════════ */
let pSkills=[], pCourseRows=[], pProjectRows=[], pPhotoURL=null;

function renderProfile(){
  if(!CU)return;
  const m=CU;
  const c=dc(m.dept);
  pSkills=[...(m.skills||[])];
  pCourseRows=[];
  pProjectRows=[];
  pPhotoURL=m.photoURL||null;

  document.getElementById('profile-body').innerHTML=`
    <div class="wk-bar"><span class="wk-dot"></span>Weekly update · ${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'})}</div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc)"></span>Profile Photo</div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div id="p-photo-preview" style="width:84px;height:84px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.7rem;background:${c}18;color:${c};border:2px solid ${c}40;overflow:hidden">${avInner(m)}</div>
        <div style="display:flex;flex-direction:column;gap:9px;min-width:0">
          <input type="file" id="p-photo-input" accept="image/*" style="display:none" onchange="handleProfilePhotoChange(this)">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-s btn-sm" onclick="document.getElementById('p-photo-input').click()">📷 Upload Photo</button>
            <button type="button" class="btn btn-d btn-sm" id="p-photo-remove-btn" style="${m.photoURL?'':'display:none'}" onclick="removeProfilePhoto()">🗑 Remove</button>
          </div>
          <div style="font-size:.72rem;color:var(--t3);line-height:1.5">JPG or PNG — auto-resized &amp; cropped to a square. Visible to your teammates everywhere your avatar appears. Click <strong style="color:var(--t2)">Save Update</strong> below to apply.</div>
        </div>
      </div>
    </div>

    ${performanceCardHTML(m.id)}

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc2)"></span>My Info</div>
      <div class="fg">
        <div class="field"><label>Full Name</label><input value="${m.name}" readonly></div>
        <div class="field"><label>Roll No</label><input value="${m.roll}" readonly></div>
        <div class="field"><label>Department</label><input value="${m.dept}" readonly></div>
        <div class="field"><label>Year</label><select id="p-year"><option ${m.year==='1st Year'?'selected':''}>1st Year</option><option ${m.year==='2nd Year'?'selected':''}>2nd Year</option><option ${m.year==='3rd Year'?'selected':''}>3rd Year</option><option ${m.year==='4th Year'?'selected':''}>4th Year</option></select></div>
        <div class="field"><label>Role</label><input value="${ROLES[m.role]}" readonly></div>
        <div class="field"><label>Email</label><input id="p-email" value="${m.email||''}" placeholder="your@email.com"></div>
      </div>
    </div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc4)"></span>Dream Company</div>
      <div class="fg">
        <div class="field"><label>Dream Company</label><input id="p-dream" value="${m.dream||''}" placeholder="Google, Microsoft, ISRO…"></div>
        <div class="field"><label>Target Role</label><input id="p-trole" value="${m.targetRole||''}" placeholder="Software Engineer…"></div>
        <div class="field full"><label>Why this company?</label><textarea id="p-dwhy">${m.dreamWhy||''}</textarea></div>
      </div>
    </div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc6)"></span>🔗 Social &amp; Profile Links <span style="font-size:.72rem;color:var(--t3);font-weight:400;margin-left:4px">(visible to all members)</span></div>
      <div class="fg">
        <div class="field"><label>🔵 LinkedIn URL</label><input id="p-linkedin" type="url" value="${m.linkedin||''}" placeholder="https://linkedin.com/in/yourname"></div>
        <div class="field"><label>⚫ GitHub URL</label><input id="p-github" type="url" value="${m.github||''}" placeholder="https://github.com/yourname"></div>
        <div class="field"><label>🌐 Portfolio URL</label><input id="p-portfolio" type="url" value="${m.portfolio||''}" placeholder="https://yourportfolio.com"></div>
        <div class="field full"><label>🟡 LeetCode Profile URL</label><input id="p-leetcode-url" type="url" value="${m.leetcodeUrl||''}" placeholder="https://leetcode.com/yourname"></div>
      </div>
    </div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc2)"></span>Projects &amp; Skills</div>
      <div class="fg">
        <div class="field full">
          <label>Projects Done</label>
          <div id="p-proj-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
          <button class="btn btn-s btn-sm" onclick="addProjectEntry()" style="margin-top:2px">+ Add Project</button>
        </div>
        <div class="field full"><label>Skills Learnt (press Enter to add)</label>
          <div class="tw" id="p-sw"><input type="text" id="p-si" placeholder="Type a skill &amp; press Enter"></div>
        </div>
      </div>
    </div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc5)"></span>Courses</div>
      <div id="p-crows"></div>
      <button class="btn btn-s btn-sm" onclick="addPCourse()">+ Add Course</button>
    </div>

    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc3)"></span>Change PIN</div>
      <div class="fg">
        <div class="field"><label>New PIN (4 digits)</label><input id="p-pin" type="password" maxlength="4" placeholder="••••" inputmode="numeric"></div>
        <div class="field"><label>Confirm PIN</label><input id="p-pin2" type="password" maxlength="4" placeholder="••••" inputmode="numeric"></div>
      </div>
    </div>

    <div class="act">
      <button class="btn btn-p" onclick="saveProfile()">💾 Save Update</button>
    </div>
  `;
  renderPTagWrap();
  initPTagInput();
  (m.courses||[]).forEach(c=>addPCourse(c));
  (m.projectList||[]).forEach(p=>addProjectEntry(p));
}

/* Reads the chosen image file, crops it to a square, downsizes it, and stores
   it as a compact base64 JPEG (kept in pPhotoURL until Save Update is pressed —
   same pattern as report file uploads, since Storage isn't set up on this plan). */
function handleProfilePhotoChange(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  if(!file.type.startsWith('image/')){toast('Please choose an image file','err');input.value='';return}
  if(file.size>8*1024*1024){toast('Image too large — pick one under 8MB','err');input.value='';return}
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      const size=320;
      const canvas=document.createElement('canvas');
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');
      const s=Math.min(img.width,img.height);
      const sx=(img.width-s)/2, sy=(img.height-s)/2;
      ctx.drawImage(img,sx,sy,s,s,0,0,size,size);
      pPhotoURL=canvas.toDataURL('image/jpeg',0.82);
      const preview=document.getElementById('p-photo-preview');
      if(preview) preview.innerHTML=`<img src="${pPhotoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      const rb=document.getElementById('p-photo-remove-btn');
      if(rb) rb.style.display='';
      toast('📷 Photo ready — click Save Update to apply');
    };
    img.onerror=function(){toast('Could not read that image','err')};
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
  input.value='';
}

function removeProfilePhoto(){
  pPhotoURL=null;
  const preview=document.getElementById('p-photo-preview');
  if(preview&&CU){
    const c=dc(CU.dept);
    preview.style.cssText=`width:84px;height:84px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.7rem;background:${c}18;color:${c};border:2px solid ${c}40;overflow:hidden`;
    preview.textContent=ini(CU.name);
  }
  const rb=document.getElementById('p-photo-remove-btn');
  if(rb) rb.style.display='none';
  toast('Photo removed — click Save Update to apply');
}

function renderPTagWrap(){
  const wrap=document.getElementById('p-sw');
  const inp=document.getElementById('p-si');
  if(!wrap||!inp)return;
  wrap.innerHTML='';
  pSkills.forEach((t,i)=>{
    const chip=document.createElement('span');
    chip.className='tc';
    chip.innerHTML=`${t}<button onclick="rmPSkill(${i})">×</button>`;
    wrap.appendChild(chip);
  });
  wrap.appendChild(inp);
}
function rmPSkill(i){pSkills.splice(i,1);renderPTagWrap()}
function initPTagInput(){
  const inp=document.getElementById('p-si');
  if(!inp)return;
  inp.onkeydown=function(e){
    if(e.key==='Enter'||e.key===','){
      e.preventDefault();
      const val=inp.value.trim();
      if(val&&!pSkills.includes(val)){pSkills.push(val);renderPTagWrap()}
      inp.value='';
    }
  };
}

function addPCourse(preset){
  const id=Date.now()+Math.random();
  pCourseRows.push(id);
  const cont=document.getElementById('p-crows');
  const d=document.createElement('div');
  d.style.cssText='display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px';
  d.id='pcr-'+id;
  d.innerHTML=`
    <div class="field"><label>Course Name</label><input type="text" id="pcn-${id}" value="${preset?preset.name:''}" placeholder="Python Bootcamp"></div>
    <div class="field"><label>Status</label><select id="pcs-${id}">
      <option value="completed"${preset&&preset.status==='completed'?' selected':''}>✓ Completed</option>
      <option value="ongoing"${preset&&preset.status==='ongoing'?' selected':''}>⟳ Ongoing</option>
    </select></div>
    <button class="btn btn-d btn-xs" style="margin-bottom:0" onclick="rmPCourse(${id})">✕</button>`;
  cont.appendChild(d);
}
function rmPCourse(id){const el=document.getElementById('pcr-'+id);if(el)el.remove();pCourseRows=pCourseRows.filter(r=>r!==id)}

function addProjectEntry(preset){
  const id=Date.now()+Math.random();
  pProjectRows.push(id);
  const cont=document.getElementById('p-proj-list');
  if(!cont)return;
  const d=document.createElement('div');
  d.style.cssText='display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end';
  d.id='ppr-'+id;
  d.innerHTML=`
    <div class="field" style="margin:0"><input type="text" id="ppn-${id}" value="${preset?escHTML(preset):''}" placeholder="e.g. AI Chatbot — Python, Flask"></div>
    <button class="btn btn-d btn-xs" style="margin-bottom:0" onclick="rmProjectEntry(${id})">✕</button>`;
  cont.appendChild(d);
}
function rmProjectEntry(id){const el=document.getElementById('ppr-'+id);if(el)el.remove();pProjectRows=pProjectRows.filter(r=>r!==id)}
function getProjects(){
  return pProjectRows.filter(id=>document.getElementById('ppr-'+id))
    .map(id=>(document.getElementById('ppn-'+id)||{value:''}).value.trim())
    .filter(Boolean);
}
function getPCourses(){
  return pCourseRows.filter(id=>document.getElementById('pcr-'+id))
    .map(id=>({name:(document.getElementById('pcn-'+id)||{value:''}).value.trim(),
               status:(document.getElementById('pcs-'+id)||{value:'completed'}).value}))
    .filter(c=>c.name);
}

async function saveProfile(){
  if(!CU)return;
  // Find member index for direct array mutation
  const idx = members.findIndex(x=>sid(x.id)===sid(CU.id));
  if(idx===-1){toast('Member not found — please re-login','err');return}
  const m = members[idx];

  // PIN change — handle separately first
  const np  = document.getElementById('p-pin').value.trim();
  const np2 = document.getElementById('p-pin2').value.trim();
  let pinChanged = false;
  if(np){
    if(np.length!==4){toast('PIN must be exactly 4 digits','err');return}
    if(np!==np2){toast('PINs do not match','err');return}
    m.pin = np;     // update in members array
    CU.pin = np;    // update current session
    pinChanged = true;
  }

  // Update profile fields
  m.year        = v('p-year');
  m.email       = v('p-email');
  m.linkedin    = safeUrl(v('p-linkedin'));
  m.github      = safeUrl(v('p-github'));
  m.portfolio   = safeUrl(v('p-portfolio'));
  m.leetcodeUrl = safeUrl(v('p-leetcode-url'));
  m.dream       = v('p-dream');
  m.targetRole  = v('p-trole');
  m.dreamWhy    = v('p-dwhy');
  m.projectList = getProjects();
  m.skills      = [...pSkills];
  m.courses     = getPCourses();
  m.photoURL    = pPhotoURL || null;

  // Keep members array and CU in sync
  members[idx] = m;
  Object.assign(CU, m);

  // Save to Firestore
  await saveDoc('members', m);
  updateTopbarUser();

  // ── Auto-create LeetCode entry if LeetCode URL is set but no LC entry exists ──
  const lcHandleFromUrl = extractLeetCodeHandle(m.leetcodeUrl);
  const existingLcEntry = leetcodeStats.find(x=>sid(x.memberId)===sid(CU.id));
  if(lcHandleFromUrl && !existingLcEntry){
    toast('🤖 LeetCode handle detected — auto-fetching stats…');
    const stats = await fetchLeetCodeStats(lcHandleFromUrl);
    const newEntry = {
      id: Date.now(),
      memberId: Number(CU.id),
      memberName: CU.name,
      handle: lcHandleFromUrl,
      rating: stats?.rating || 0,
      easy: stats?.easy || 0,
      medium: stats?.medium || 0,
      hard: stats?.hard || 0,
      streak: stats?.streak || 0,
      ranking: stats?.ranking || 0,
      target: 0,
      dailyLog: [],
      updatedOn: today(),
      updatedBy: 'Auto-sync',
      lastSynced: stats ? new Date().toISOString() : null
    };
    await saveDoc('leetcodeStats', newEntry);
    leetcodeStats.push(newEntry);
    if(stats){
      toast(`✅ LeetCode auto-synced! ${stats.total} problems solved (${stats.easy}E/${stats.medium}M/${stats.hard}H)`);
    }
  } else if(lcHandleFromUrl && existingLcEntry && !existingLcEntry.handle){
    // Entry exists but no handle — update handle and sync
    existingLcEntry.handle = lcHandleFromUrl;
    existingLcEntry._prevEasy = existingLcEntry.easy || 0;
    existingLcEntry._prevMedium = existingLcEntry.medium || 0;
    existingLcEntry._prevHard = existingLcEntry.hard || 0;
    await saveDoc('leetcodeStats', existingLcEntry);
    await syncSingleLeetCode(CU.id, true);
  }

  if(pinChanged){
    toast('✅ PIN changed & profile saved! Use your new PIN next time you log in.');
  } else {
    toast('✅ Profile saved!');
  }
  renderProfile();
}

/* ════════════════════════════════════════════════════════════
   ANNOUNCEMENTS (visible to ALL)
════════════════════════════════════════════════════════════ */
function renderAnnounce(){
  if(!CU)return;
  const c=dc(CU.dept);
  document.getElementById('compose-as').innerHTML=
    `<div class="av" style="width:26px;height:26px;font-size:.7rem;background:${c}18;color:${c};border:1.5px solid ${c}38">${ini(CU.name)}</div>
     As <strong style="color:var(--t1);margin-left:3px">${CU.name}</strong>`;

  const pinned=messages.filter(m=>m.pinned);
  // newest first — sort descending by id (timestamp-based)
  const rest=messages.filter(m=>!m.pinned).slice().sort((a,b)=>b.id-a.id);

  document.getElementById('pinned-area').innerHTML=pinned.length
    ?`<div class="pinned-sect"><div class="pl">📌 Pinned</div>${pinned.map(msgHTML).join('')}</div>`:'' ;
  const feed=document.getElementById('msg-feed');
  feed.innerHTML=rest.length?rest.map(msgHTML).join(''):emptyState('📢','No messages yet — be the first to post!');
}

function msgHTML(msg){
  const sender=members.find(m=>sid(m.id)===sid(msg.uid))||{name:msg.uname||'?',dept:'Other',role:'member'};
  const c=dc(sender.dept);
  const isCap=CU&&CU.role==='captain';
  const isMine=CU&&sid(msg.uid)===sid(CU.id);
  const canDel=isCap||isMine;
  const repliedMsg = msg.replyTo ? messages.find(x=>sid(x.id)===sid(msg.replyTo)) : null;
  const replyQuote = msg.replyTo
    ? (repliedMsg
        ? `<div class="reply-quote" onclick="scrollToMsg(${repliedMsg.id})">↩ <strong>${repliedMsg.uname}</strong>: ${escHTML((repliedMsg.text||'').slice(0,90))}${(repliedMsg.text||'').length>90?'…':''}</div>`
        : `<div class="reply-quote reply-quote-gone">↩ Replying to a deleted message</div>`)
    : '';
  return `<div class="msgcard" id="mc-${msg.id}">
    <div class="mh">
      <div class="mav" style="background:${c}18;color:${c};border:1.5px solid ${c}38">${ini(sender.name)}</div>
      <div class="mm2">
        <div class="msender">${sender.name}${sender.role!=='team_leader'?`<span class="badge b-${sender.role}" style="margin-left:6px">${ROLES[sender.role]}</span>`:''}${msg.pinned?'<span class="pin-tag">📌 Pinned</span>':''}</div>
        <div class="mtime">${msg.time}</div>
      </div>
      <div class="mactions">
        <button class="icon-btn" onclick="startReply(${msg.id})" title="Reply">↩ Reply</button>
        ${isCap?`<button class="icon-btn" onclick="togglePin(${msg.id})" title="${msg.pinned?'Unpin':'Pin'}" style="${msg.pinned?'color:var(--acc4)':''}">📌 ${msg.pinned?'Unpin':'Pin'}</button>`:''}
        ${isMine?`<button class="icon-btn" onclick="editMsg(${msg.id})" title="Edit" style="color:var(--acc2);border:1px solid rgba(129,140,248,.35);border-radius:6px">✏️ Edit</button>`:''}
        ${canDel?`<button class="icon-btn" onclick="delMsg(${msg.id})" title="Delete" style="color:var(--acc3);border:1px solid rgba(249,168,212,.35);border-radius:6px">🗑</button>`:''}
      </div>
    </div>
    ${replyQuote}
    <div class="mbody" id="mbody-${msg.id}">${renderMsgBody(msg.text)}${msg.editedAt?`<span style="font-size:.65rem;color:var(--t4);margin-left:8px;font-family:var(--mono)">(edited ${msg.editedAt})</span>`:''}</div>
    <div id="medit-panel-${msg.id}"></div>
  </div>`;
}

/* Escape then highlight @Name mentions as chips (only for names that match a real member) */
function renderMsgBody(text){
  const esc = escHTML(text);
  return esc.replace(/@([A-Za-z][\w' -]{1,30})/g, (whole, name) => {
    const clean = name.trim();
    const m = members.find(mm => mm.name.toLowerCase() === clean.toLowerCase()
      || mm.name.toLowerCase().startsWith(clean.toLowerCase()));
    return m ? `<span class="mention-chip">@${escHTML(m.name)}</span>` : whole;
  });
}

/* Find real members referenced via @Name in a message */
function extractMentions(text){
  const found=[];
  const re=/@([A-Za-z][\w' -]{1,30})/g;
  let match;
  while((match=re.exec(text))){
    const name=match[1].trim();
    const m=members.find(mm=>mm.name.toLowerCase()===name.toLowerCase()
      || mm.name.toLowerCase().startsWith(name.toLowerCase()));
    if(m && !found.some(f=>sid(f.id)===sid(m.id))) found.push(m);
  }
  return found;
}

/* ── Reply state ── */
let replyingTo=null;
let _postingMsg=false;

function startReply(msgId){
  const msg=messages.find(x=>sid(x.id)===sid(msgId));
  if(!msg)return;
  replyingTo={id:msg.id, uid:msg.uid, uname:msg.uname, text:msg.text};
  renderReplyPreview();
  const ta=document.getElementById('msg-inp');
  if(ta)ta.focus();
}

function cancelReply(){
  replyingTo=null;
  renderReplyPreview();
}

function renderReplyPreview(){
  const el=document.getElementById('reply-preview');
  if(!el)return;
  if(!replyingTo){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="reply-bar">
    <div class="reply-bar-txt">↩ Replying to <strong>${escHTML(replyingTo.uname)}</strong>: ${escHTML((replyingTo.text||'').slice(0,70))}${(replyingTo.text||'').length>70?'…':''}</div>
    <button class="icon-btn" onclick="cancelReply()">✕</button>
  </div>`;
}

function scrollToMsg(id){
  const el=document.getElementById('mc-'+id);
  if(!el)return;
  el.scrollIntoView({behavior:'smooth', block:'center'});
  el.classList.add('flash-highlight');
  setTimeout(()=>el.classList.remove('flash-highlight'), 1500);
}

/* ── @mention autocomplete dropdown ── */
function handleMentionInput(){
  const ta=document.getElementById('msg-inp');
  const dd=document.getElementById('mention-dropdown');
  if(!ta||!dd)return;
  const val=ta.value;
  const pos=ta.selectionStart;
  const uptoCursor=val.slice(0,pos);
  const atMatch=uptoCursor.match(/@([\w' -]{0,30})$/);
  if(!atMatch){ dd.style.display='none'; dd.innerHTML=''; return; }
  const q=atMatch[1].toLowerCase();
  const matches=members.filter(m=>Number(m.id)!==Number(CU.id) && m.name.toLowerCase().includes(q)).slice(0,6);
  if(!matches.length){ dd.style.display='none'; dd.innerHTML=''; return; }
  dd.style.display='block';
  dd.innerHTML=matches.map(m=>{
    const c=dc(m.dept);
    return `<div class="mention-item" onmousedown="event.preventDefault();insertMention(${m.id})">
      <span class="mention-item-av" style="background:${c}18;color:${c}">${ini(m.name)}</span>${escHTML(m.name)}
    </div>`;
  }).join('');
}

function insertMention(id){
  const m=members.find(x=>sid(x.id)===sid(id));
  const ta=document.getElementById('msg-inp');
  if(!m||!ta)return;
  const val=ta.value;
  const pos=ta.selectionStart;
  const uptoCursor=val.slice(0,pos);
  const atMatch=uptoCursor.match(/@([\w' -]{0,30})$/);
  if(!atMatch)return;
  const start=atMatch.index;
  const before=val.slice(0,start);
  const after=val.slice(pos);
  const insertion=`@${m.name} `;
  ta.value=before+insertion+after;
  ta.selectionStart=ta.selectionEnd=before.length+insertion.length;
  ta.focus();
  const dd=document.getElementById('mention-dropdown');
  if(dd){ dd.style.display='none'; dd.innerHTML=''; }
}

async function postMsg(){
  if(_postingMsg) return; // guard against double-tap / double-submit
  const txt=document.getElementById('msg-inp').value.trim();
  if(!txt){toast('Write something first','err');return}
  _postingMsg = true;
  const postBtn = document.getElementById('post-msg-btn');
  if(postBtn) postBtn.disabled = true;
  try{
    const mentions = extractMentions(txt);
    const msg={
      id:Date.now(), uid:Number(CU.id), uname:CU.name, text:txt, time:nowStr(), pinned:false,
      mentions: mentions.map(m=>Number(m.id)),
      replyTo: replyingTo ? replyingTo.id : null
    };
    await saveDoc('messages', msg);
    // NOTE: do NOT push into `messages` here — the Firestore onSnapshot
    // listener (startMessagesLiveSync) already fires the instant saveDoc
    // writes (optimistic local update) and rebuilds the `messages` array
    // from the server snapshot. Pushing here too caused the double post.
    document.getElementById('msg-inp').value='';
    const dd=document.getElementById('mention-dropdown'); if(dd){dd.style.display='none';dd.innerHTML='';}
    cancelReply();
    toast('Message posted!');
    renderAnnounce();

    /* ── Push notifications: mentioned/replied-to users get a priority ping,
       everyone else gets a lighter "new message" ping ── */
    const priorityIds = new Set();
    mentions.forEach(m=>{ if(Number(m.id)!==Number(CU.id)) priorityIds.add(Number(m.id)); });
    if(replyingTo && Number(replyingTo.uid)!==Number(CU.id)) priorityIds.add(Number(replyingTo.uid));

    if(priorityIds.size){
      const isReplyOnly = !mentions.length;
      sendPushNotification({
        toIds:[...priorityIds],
        title: isReplyOnly ? `${CU.name} replied to you` : `${CU.name} tagged you`,
        body: txt.slice(0,120),
        type:'message',
        extra:{ msgId: msg.id }
      });
    }
    const rest = members
      .filter(m=>Number(m.id)!==Number(CU.id) && !priorityIds.has(Number(m.id)))
      .map(m=>Number(m.id));
    if(rest.length){
      sendPushNotification({
        toIds: rest,
        title: `New team message from ${CU.name}`,
        body: txt.slice(0,120),
        type:'message',
        extra:{ msgId: msg.id }
      });
    }
  } finally {
    _postingMsg = false;
    if(postBtn) postBtn.disabled = false;
  }
}

async function togglePin(id){
  const m=messages.find(x=>sid(x.id)===sid(id));
  if(!m)return;
  m.pinned=!m.pinned;
  await saveDoc('messages', m);
  renderAnnounce();
}
async function delMsg(id){
  await delDoc('messages', id);
  messages=messages.filter(x=>sid(x.id)!==sid(id));
  renderAnnounce();
}

function editMsg(id){
  const msg=messages.find(x=>sid(x.id)===sid(id));
  if(!msg)return;
  const panel=document.getElementById('medit-panel-'+id);
  const body=document.getElementById('mbody-'+id);
  if(!panel||!body)return;
  if(panel.innerHTML){panel.innerHTML='';body.style.display='';return;}
  body.style.display='none';
  const safeText=(msg.text||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  panel.innerHTML=`<div style="margin-top:8px">
    <textarea id="medit-ta-${id}" style="width:100%;background:var(--s2);border:1px solid var(--acc);border-radius:var(--r8);color:var(--t1);font-family:var(--font);font-size:.88rem;padding:11px;outline:none;resize:none;min-height:74px;line-height:1.6;transition:all .2s"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-p btn-xs" onclick="saveEditMsg(${id})">Save</button>
      <button class="btn btn-s btn-xs" onclick="cancelEditMsg(${id})">Cancel</button>
    </div>
  </div>`;
  const ta=document.getElementById('medit-ta-'+id);
  if(ta){ta.value=safeText;ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
}

function cancelEditMsg(id){
  const panel=document.getElementById('medit-panel-'+id);
  const body=document.getElementById('mbody-'+id);
  if(panel)panel.innerHTML='';
  if(body)body.style.display='';
}

async function saveEditMsg(id){
  const msg=messages.find(x=>sid(x.id)===sid(id));
  if(!msg)return;
  const ta=document.getElementById('medit-ta-'+id);
  if(!ta)return;
  const newText=ta.value.trim();
  if(!newText){toast('Message cannot be empty','err');return}
  msg.text=newText;
  msg.editedAt=nowStr();
  await saveDoc('messages',msg);
  toast('Message updated!');
  renderAnnounce();
}

/* ════════════════════════════════════════════════════════════
   WEEKLY REPORTS
   - Submit: any member uploads .txt
   - Visible: only captain, vice, manager, strategist
   - Member can view their OWN reports
════════════════════════════════════════════════════════════ */
function renderReports(){
  if(!CU)return;
  const canView=isSenior(CU.role);
  const body=document.getElementById('report-body');

  let html=`<div class="card"><div class="ct"><span class="cd" style="background:var(--acc2)"></span>Submit Weekly Report</div>
    <div class="info-pill ip-info">📄 Upload a .txt, .pptx, or .docx file — your weekly summary</div>
    <div class="fg">
      <div class="field"><label>Report Title</label><input id="rep-title" placeholder="Week 12 — Progress Update"></div>
      <div class="field"><label>Upload File (.txt / .pptx / .docx) file size must be less than 1mb (use file compressor if needed)</label><input type="file" id="rep-file" accept=".txt,.pptx,.docx,.ppt,.doc"></div>
    </div>
    <div class="act"><button class="btn btn-p" onclick="submitReport()">📤 Submit Report</button></div>
    <div id="rep-err" style="display:none;margin-top:14px;font-family:var(--mono,monospace);font-size:.72rem;color:#f87171;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;user-select:text"></div>
  </div>`;

  if(canView){
    html+=`<div class="info-pill ip-warn" style="margin-bottom:16px">🔒 Reports visible to senior roles only (Captain, Vice, Manager, Strategist)</div>`;
    const allReports=reports.slice().reverse();
    if(!allReports.length){html+=emptyState('📄','No reports submitted yet');
    } else {
      html+=allReports.map(r=>{
        const author=members.find(m=>sid(m.id)===sid(r.uid))||{name:r.uname||'?',dept:'Other',role:'member'};
        const c=dc(author.dept);
        const ft=r.fileType||'txt';
        const ficon=ft==='pptx'||ft==='ppt'?'📊':ft==='docx'||ft==='doc'?'📝':'📄';
        const ftbadge=`<span style="font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(129,140,248,.1);color:var(--acc2);border:1px solid rgba(129,140,248,.25);text-transform:uppercase;letter-spacing:.04em">${ft.toUpperCase()}</span>`;
        const isBinary=r.chunked||(r.fileData&&r.fileData.length>0)||(r.fileURL&&r.fileURL.length>0);
        return `<div class="report-card">
          <div class="rh" onclick="toggleReport(${r.id})" style="cursor:pointer">
            <div class="ricon">${ficon}</div>
            <div class="ri">
              <div class="rtitle">${r.title||'Weekly Report'}</div>
              <div class="rmeta">
                <span class="av" style="width:20px;height:20px;font-size:.6rem;background:${c}18;color:${c};border:1px solid ${c}30;display:inline-flex;align-items:center;justify-content:center;border-radius:50%">${ini(author.name)}</span>
                <strong style="font-size:.78rem">${author.name}</strong>
                ${author.role!=='team_leader'?`<span class="badge b-${author.role}">${ROLES[author.role]}</span>`:""}
                ${ftbadge}
                <span style="font-family:var(--mono);font-size:.7rem;color:var(--t3)">${r.time}</span>
                <span class="restricted-badge">Senior Only</span>
              </div>
            </div>
            <button class="btn btn-acc2 btn-xs" onclick="event.stopPropagation();downloadReport(${r.id})" title="Download report" style="flex-shrink:0;margin-left:8px">⬇ Download</button>
          </div>
          ${isBinary?`<div class="report-content" id="rc-${r.id}" style="font-style:italic;color:var(--t3)">📎 Binary file (${ft.toUpperCase()}) — click Download to open.</div>`:`<div class="report-content" id="rc-${r.id}">${escHTML(r.content)}</div>`}
        </div>`;
      }).join('');
    }
  } else {
    // Show only own reports
    const myReports=reports.filter(r=>sid(r.uid)===sid(CU.id)).reverse();
    html+=`<div class="info-pill ip-warn" style="margin-bottom:16px">🔒 Reports are reviewed by Captain, Vice, Manager &amp; Strategist only</div>`;
    if(!myReports.length){html+=emptyState('📄','You haven\'t submitted any reports yet');
    } else {
      html+=`<div class="ct" style="margin-bottom:14px"><span class="cd" style="background:var(--acc2)"></span>My Submitted Reports</div>`;
      html+=myReports.map(r=>{
        const ft=r.fileType||'txt';
        const ficon=ft==='pptx'||ft==='ppt'?'📊':ft==='docx'||ft==='doc'?'📝':'📄';
        const ftbadge=`<span style="font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(129,140,248,.1);color:var(--acc2);border:1px solid rgba(129,140,248,.25);text-transform:uppercase;letter-spacing:.04em">${ft.toUpperCase()}</span>`;
        const isBinary=r.chunked||(r.fileData&&r.fileData.length>0)||(r.fileURL&&r.fileURL.length>0);
        return `
        <div class="report-card">
          <div class="rh" onclick="toggleReport(${r.id})" style="cursor:pointer">
            <div class="ricon">${ficon}</div>
            <div class="ri">
              <div class="rtitle">${r.title||'Weekly Report'}</div>
              <div class="rmeta">
                ${ftbadge}
                <span style="font-family:var(--mono);font-size:.7rem;color:var(--t3)">${r.time}</span>
              </div>
            </div>
            <button class="btn btn-acc2 btn-xs" onclick="event.stopPropagation();downloadReport(${r.id})" title="Download report" style="flex-shrink:0;margin-left:8px">⬇ Download</button>
          </div>
          ${isBinary?`<div class="report-content" id="rc-${r.id}" style="font-style:italic;color:var(--t3)">📎 Binary file (${ft.toUpperCase()}) — click Download to open.</div>`:`<div class="report-content" id="rc-${r.id}">${escHTML(r.content)}</div>`}
        </div>`;
      }).join('');
    }
  }
  body.innerHTML=html;
}

/* ── Binary reports are stored as base64 chunks split across Firestore documents,
   avoiding Firebase Storage entirely (no CORS, no external upload, no WebView
   upload-hang issues). Each chunk stays well under Firestore's 1MB doc limit. ── */
const CHUNK_SIZE = 700000; // characters per chunk, safely under Firestore's 1MB doc limit

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

async function saveReportChunks(reportId, base64){
  const chunks=[];
  for(let i=0;i<base64.length;i+=CHUNK_SIZE) chunks.push(base64.slice(i,i+CHUNK_SIZE));
  await Promise.all(chunks.map((chunkStr,i)=>
    saveDoc('reportChunks', { id:`${reportId}_${i}`, reportId, chunkIndex:i, data:chunkStr })
  ));
  return chunks.length;
}

async function loadReportChunks(reportId){
  const snap = await db().collection('reportChunks').where('reportId','==',reportId).get();
  const docs = snap.docs.map(d=>d.data());
  docs.sort((a,b)=>a.chunkIndex-b.chunkIndex);
  return docs.map(d=>d.data).join('');
}

async function submitReport(){
  const title=v('rep-title');
  const fi=document.getElementById('rep-file');
  const errBox=document.getElementById('rep-err');
  if(errBox){ errBox.style.display='none'; errBox.textContent=''; }

  if(!fi.files.length){toast('Select a file','err');return}
  const file=fi.files[0];
  const ext=file.name.split('.').pop().toLowerCase();
  const allowed=['txt','pptx','ppt','docx','doc'];
  if(!allowed.includes(ext)){toast('Only .txt, .pptx or .docx files allowed','err');return}
  const isBinary=['pptx','ppt','docx','doc'].includes(ext);

  if(file.size > 15*1024*1024){ toast('File too large (max 15MB)','err'); return; }

  toast('Uploading…');
  try{
    const rep={id:Date.now(),uid:Number(CU.id),uname:CU.name,title:title||file.name,
      fileName:file.name, fileType:ext, time:nowStr(), content:'', chunked:false, chunkCount:0};

    if(isBinary){
      const base64 = await fileToBase64(file);
      rep.chunkCount = await saveReportChunks(rep.id, base64);
      rep.chunked = true;
    } else {
      rep.content = await file.text();
    }

    await saveDoc('reports', rep);
    reports.push(rep);
    toast('Report submitted!');
    renderReports();
  }catch(err){
    console.error('Report submit failed:', err);
    const msg = 'Submit failed: '+(err.message||err||'unknown error');
    toast(msg,'err');
    if(errBox){ errBox.textContent = msg; errBox.style.display='block'; }
  }
}

function toggleReport(id){
  const el=document.getElementById('rc-'+id);
  if(el) el.classList.toggle('open');
}

async function downloadReport(id){
  const r=reports.find(x=>sid(x.id)===sid(id));
  if(!r)return;

  const fileName = r.fileName || (r.title||'report')+(r.chunked||r.fileURL||r.fileData?'':'.txt');
  const native = isNativeApp();

  const MIME_TYPES = {
    txt:'text/plain', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt:'application/vnd.ms-powerpoint',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:'application/msword'
  };
  const fileExt = (fileName.split('.').pop()||'').toLowerCase();
  const mime = MIME_TYPES[fileExt]||'application/octet-stream';

  // Saves the file straight into the phone's real Downloads folder via a small
  // custom native plugin (uses Android's MediaStore API) — no share sheet needed.
  async function saveDirect(base64Data){
    const { Downloader } = window.Capacitor.Plugins;
    await Downloader.saveFile({ fileName, data: base64Data, mimeType: mime });
    toast('Saved to Downloads: '+fileName);
  }

  try{
    // ── Case 1: new-style binary report, stored as chunks in Firestore ──
    if(r.chunked){
      toast('Preparing download…');
      const base64Data = await loadReportChunks(r.id);
      if(native){
        await saveDirect(base64Data);
      } else {
        const a=document.createElement('a');
        a.href = `data:${mime};base64,${base64Data}`;
        a.download = fileName;
        a.click();
      }
      return;
    }

    // ── Case 2: legacy — file stored in Firebase Storage (old reports) ──
    if(r.fileURL){
      if(native){
        const resp = await fetch(r.fileURL);
        const blob = await resp.blob();
        const base64Data = await blobToBase64(blob);
        await saveDirect(base64Data);
      } else {
        const a=document.createElement('a');
        a.href=r.fileURL; a.download=fileName; a.target='_blank'; a.click();
      }
      return;
    }

    // ── Case 3: legacy — binary file stored as base64 dataURL directly in Firestore ──
    if(r.fileData){
      if(native){
        const base64Data = r.fileData.split(',')[1];
        await saveDirect(base64Data);
      } else {
        const a=document.createElement('a');
        a.href=r.fileData;
        a.download=fileName;
        a.click();
      }
      return;
    }

    // ── Case 4: plain text report ──
    if(r.content){
      if(native){
        const base64Data = btoa(unescape(encodeURIComponent(r.content)));
        await saveDirect(base64Data);
      } else {
        const blob=new Blob([r.content],{type:'text/plain'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download=fileName;a.click();
        URL.revokeObjectURL(url);
      }

      return;
    }

    toast('No file data available for download','err');
  }catch(err){
    console.error('Download failed:', err);
    toast('Download failed: '+(err.message||'unknown error'),'err');
  }
}

/* ════════════════════════════════════════════════════════════
   ROADMAPS
   - Create: ONLY strategist
   - For: any member (including captain, vice, manager)
   - Visible: ONLY to the assigned member + strategist
════════════════════════════════════════════════════════════ */
function renderRoadmap(){
  if(!CU)return;
  const isStrat = CU.role==='strategist';
  const body = document.getElementById('roadmap-body');
  let html = '';

  // Normalise all ids to strings for safe comparison (handles Number/String mismatch after import)
  const myId = String(CU.id);

  if(isStrat){
    // Strategist: compose form + list all roadmaps they created
    html+=`<div class="card"><div class="ct"><span class="cd" style="background:var(--acc5)"></span>Create Roadmap for a Member</div>
      <div class="info-pill ip-info" style="margin-bottom:14px">🗺 Roadmap is <strong>private</strong> — visible only to the assigned member &amp; you</div>
      <div class="fg">
        <div class="field"><label>Assign To *</label>
          <select id="rm-target">
            <option value="">— Select Member —</option>
            ${members.map(m=>`<option value="${m.id}">${m.name} (${ROLES[m.role]})</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Roadmap Title *</label><input id="rm-title" placeholder="6-Month Placement Roadmap"></div>
        <div class="field full"><label>Roadmap Content *</label>
          <textarea id="rm-body" style="min-height:160px" placeholder="Detailed roadmap, milestones, steps, resources…"></textarea>
        </div>
      </div>
      <div class="act"><button class="btn btn-acc5" onclick="createRoadmap()">🗺 Create Roadmap</button></div>
    </div>`;

    // Show all roadmaps created by this strategist
    const myRMs = roadmaps.filter(r => String(r.byId) === myId).reverse();
    if(myRMs.length){
      html+=`<div style="grid-column:1/-1;margin-top:8px">
        <div class="ct" style="margin-bottom:14px"><span class="cd" style="background:var(--acc5)"></span>Roadmaps You've Created (${myRMs.length})</div>
        <div style="display:grid;grid-template-columns:1fr;gap:14px">
          ${myRMs.map(r=>roadmapCardHTML(r,true)).join('')}
        </div>
      </div>`;
    } else {
      html+=`<div style="grid-column:1/-1">${emptyState('🗺','No roadmaps created yet — use the form above to assign one.')}</div>`;
    }

  } else {
    // All other roles: show only roadmaps assigned TO them
    const myRMs = roadmaps.filter(r => String(r.forId) === myId).reverse();
    if(!myRMs.length){
      html = emptyState('🗺','No roadmaps assigned to you yet.<br>The Strategist will create one for you.');
    } else {
      html = `<div class="info-pill ip-ok" style="margin-bottom:16px">🗺 These roadmaps are <strong>private to you</strong> — only you and the Strategist can see them</div>`;
      html += myRMs.map(r=>roadmapCardHTML(r,false)).join('');
    }
  }
  body.innerHTML = html;
}

function roadmapCardHTML(r, showFor){
  const forMember = members.find(m=>String(m.id)===String(r.forId)) || {name:r.forName||'?',dept:'Other',role:'member'};
  const byMember  = members.find(m=>String(m.id)===String(r.byId))  || {name:r.byName||'?', dept:'Other',role:'strategist'};
  const fc = dc(forMember.dept);
  const bc = dc(byMember.dept);
  return `<div class="roadmap-card" id="rmc-${r.id}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        ${showFor?`<div class="rm-for">📌 For: <strong style="color:var(--t1)">${forMember.name}</strong> ${forMember.role!=='team_leader'?`<span class="badge b-${forMember.role}" style="margin-left:6px">${ROLES[forMember.role]}</span>`:""}</div>`:''}
        <div class="rm-title" style="margin-top:4px">${escHTML(r.title)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          <div class="av" style="width:20px;height:20px;font-size:.58rem;background:${bc}18;color:${bc};border:1px solid ${bc}30;flex-shrink:0">${ini(byMember.name)}</div>
          <span class="rm-by">By <strong>${byMember.name}</strong></span>
          <span style="font-family:var(--mono);font-size:.68rem;color:var(--t3)">${r.time}</span>
        </div>
      </div>
      ${showFor?`<button class="btn btn-d btn-xs" style="flex-shrink:0;margin-top:2px" onclick="deleteRoadmap(${r.id})">🗑</button>`:''}
    </div>
    <div class="rm-body">${escHTML(r.content)}</div>
  </div>`;
}

async function deleteRoadmap(id){
  if(!confirm('Delete this roadmap?'))return;
  await delDoc('roadmaps', id);
  roadmaps = roadmaps.filter(r=>sid(r.id)!==sid(id));
  toast('Roadmap deleted.');
  renderRoadmap();
}

async function createRoadmap(){
  const rawId = document.getElementById('rm-target').value;
  const title  = v('rm-title');
  const content= v('rm-body');
  if(!rawId || !title || !content){toast('Fill all fields — target member, title & content required','err');return}
  // Find member using string comparison to avoid type issues
  const forM = members.find(m => String(m.id) === String(rawId));
  if(!forM){toast('Member not found','err');return}
  // Store ALL ids as the same type (Number) consistently
  const rm={id:Date.now(),forId:Number(rawId),forName:forM.name,
    byId:CU.id,byName:CU.name,title,content,time:nowStr()};
  await saveDoc('roadmaps', rm);
  roadmaps.push(rm);
  toast('✅ Roadmap assigned to '+forM.name+'! They will see it when they open the Roadmap tab.');
  sendPushNotification({
    toIds:[Number(rawId)],
    title:`New roadmap from ${CU.name}`,
    body:title,
    type:'roadmap',
    extra:{ roadmapId: rm.id }
  });
  // Clear form
  document.getElementById('rm-target').value='';
  document.getElementById('rm-title').value='';
  document.getElementById('rm-body').value='';
  renderRoadmap();
}

/* ════════════════════════════════════════════════════════════
   DEPARTMENTS
════════════════════════════════════════════════════════════ */
function renderDepts(){
  const map={};
  members.forEach(m=>{if(!map[m.dept])map[m.dept]=[];map[m.dept].push(m)});
  const body=document.getElementById('depts-body');
  if(!Object.keys(map).length){body.innerHTML=emptyState('🏛️','No members yet');return}
  body.innerHTML=Object.entries(map).map(([dept,ms])=>{
    const c=dc(dept);
    return `<div class="dg">
      <div class="dh" style="color:${c};border-color:${c}25">${dept}<span class="dc">${ms.length}</span></div>
      ${ms.map(m=>mrHTML(m)).join('')}
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   MEMBER DETAIL MODAL
════════════════════════════════════════════════════════════ */
function openMemberDetail(id){
  const m=members.find(x=>sid(x.id)===sid(id));
  if(!m)return;
  const isMe=CU&&sid(m.id)===sid(CU.id);

  const c=dc(m.dept);
  const isCap=CU&&(CU.role==='captain'||hasElevatedAccess());
  const viewingOther=!isMe; // true whenever someone is looking at another member's dashboard

  const skillsHTML=(m.skills||[]).length
    ?`<div style="display:flex;flex-wrap:wrap;gap:5px">${(m.skills||[]).map(s=>`<span class="tc">${s}</span>`).join('')}</div>`
    :'<span style="color:var(--t3);font-size:.83rem">None added</span>';

  const coursesHTML=(m.courses||[]).map(c2=>
    `<div class="ci"><span class="cn">${c2.name}</span><span class="cst ${c2.status==='completed'?'st-done':'st-wip'}">${c2.status==='completed'?'✓ Done':'⟳ Ongoing'}</span></div>`
  ).join('')||'<p style="color:var(--t3);font-size:.83rem">None added</p>';

  const projectsHTML=(m.projectList||[]).length
    ?`<ul style="padding-left:16px;margin:0">${(m.projectList||[]).map(p=>`<li style="font-size:.86rem;color:var(--t2);margin-bottom:4px">${p}</li>`).join('')}</ul>`
    :'<p style="color:var(--t3);font-size:.83rem">No projects added</p>';

  // ── LeetCode summary ──
  const lcEntry=leetcodeStats.find(x=>sid(x.memberId)===sid(m.id));
  const lcTotal=lcEntry?(lcEntry.easy||0)+(lcEntry.medium||0)+(lcEntry.hard||0):0;
  const lcLastSync=lcEntry&&lcEntry.lastSynced?new Date(lcEntry.lastSynced).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const lcHTML=lcEntry
    ?`<p style="font-size:.86rem;color:var(--t2)"><strong style="color:var(--t1)">${lcTotal}</strong> solved — <span class="lc-easy">${lcEntry.easy||0} Easy</span> · <span class="lc-medium">${lcEntry.medium||0} Medium</span> · <span class="lc-hard">${lcEntry.hard||0} Hard</span></p>
      ${lcEntry.handle?`<p style="font-size:.75rem;color:var(--t3);margin-top:4px">🤖 <a href="https://leetcode.com/u/${escHTML(lcEntry.handle)}/" target="_blank" rel="noopener" style="color:#f89f1b">@${escHTML(lcEntry.handle)}</a>${lcEntry.streak?` · 🔥 ${lcEntry.streak}-day streak`:''}${lcEntry.rating?` · ⚡ Rating ${lcEntry.rating}`:''}${lcLastSync?` · Synced ${lcLastSync}`:''}</p>`:''}`
    :'<p style="color:var(--t3);font-size:.83rem">No LeetCode handle set yet</p>';

  // ── Daily task history (read-only) ──
  const taskHistoryHTML=buildMemberHistory(m.id, viewingOther);

  // ── Weekly reports — respects the existing senior-only visibility rule ──
  const showReports = isMe || isSenior(CU.role);
  const memberReports = reports.filter(r=>sid(r.uid)===sid(m.id)).reverse();
  const reportsHTML = !memberReports.length
    ? '<p style="color:var(--t3);font-size:.83rem">No reports submitted</p>'
    : memberReports.map(r=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--b1)">
        <div style="min-width:0"><div style="font-size:.85rem;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(r.title||'Weekly Report')}</div><div style="font-size:.7rem;color:var(--t3)">${r.time}</div></div>
        <button class="btn btn-acc2 btn-xs" onclick="event.stopPropagation();downloadReport(${r.id})" style="flex-shrink:0">⬇</button>
      </div>`).join('');

  // ── Roadmap — stays private to the assigned member + Strategist, same as the Roadmap tab ──
  const showRoadmap = isMe || CU.role==='strategist';
  const memberRoadmaps = roadmaps.filter(r=>String(r.forId)===String(m.id));
  const roadmapHTML = !memberRoadmaps.length
    ? '<p style="color:var(--t3);font-size:.83rem">No roadmap assigned yet</p>'
    : memberRoadmaps.map(r=>roadmapCardHTML(r,false)).join('');

  document.getElementById('modal-member-body').innerHTML=`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px">
      <div class="av" style="width:50px;height:50px;font-size:1.1rem;background:${c}18;color:${c};border:2px solid ${c}40">${avInner(m)}</div>
      <div>
        <h3 style="margin-bottom:7px">${m.name}${isMe?' <span style="font-size:.72rem;color:var(--acc)">(you)</span>':''}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="badge b-${m.role==='team_leader'?'member':m.role}">${m.role==='team_leader'?'Member':ROLES[m.role]}</span>
          <span class="dt" style="background:${c}15;color:${c};border:1px solid ${c}28">${m.dept}</span>
        </div>
      </div>
    </div>
    ${viewingOther?`<div class="info-pill ip-info" style="margin-bottom:16px">👁 Viewing ${m.name}'s personal dashboard — view only</div>`:''}
    <div class="ds"><h4>📋 Info</h4><p>${m.roll} · ${m.year}${m.email?' · '+m.email:''} · Joined: ${m.addedOn}</p></div>
    ${(m.linkedin||m.github||m.portfolio||m.leetcodeUrl)?`<div class="ds"><h4>🔗 Links</h4><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
      ${m.linkedin?`<button class="prof-link-btn" data-url="${encodeURIComponent(m.linkedin)}" style="background:rgba(10,102,194,.13);border:1px solid rgba(10,102,194,.3);color:#5b9bd5">🔵 LinkedIn</button>`:''}
      ${m.github?`<button class="prof-link-btn" data-url="${encodeURIComponent(m.github)}" style="background:rgba(36,41,46,.08);border:1px solid rgba(36,41,46,.28);color:#24292e">⚫ GitHub</button>`:''}
      ${m.portfolio?`<button class="prof-link-btn" data-url="${encodeURIComponent(m.portfolio)}" style="background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.25);color:#6ee7b7">🌐 Portfolio</button>`:''}
      ${m.leetcodeUrl?`<button class="prof-link-btn" data-url="${encodeURIComponent(m.leetcodeUrl)}" style="background:rgba(248,159,27,.1);border:1px solid rgba(248,159,27,.28);color:#f89f1b">🟡 LeetCode</button>`:''}
    </div></div>`:''}
    <div class="ds"><h4>🌟 Dream Company</h4><p><strong>${m.dream||'—'}</strong>${m.targetRole?' → '+m.targetRole:''}</p>${m.dreamWhy?`<p style="margin-top:4px;color:var(--t3)">${m.dreamWhy}</p>`:''}</div>
    <div class="ds"><h4>💻 Projects</h4>${projectsHTML}</div>
    <div class="ds"><h4>🛠 Skills</h4>${skillsHTML}</div>
    <div class="ds"><h4>📚 Courses</h4>${coursesHTML}</div>
    <div class="ds"><h4>🟡 LeetCode</h4>${lcHTML}</div>
    ${performanceCardHTML(m.id)}
    <div class="ds"><h4>✅ Daily Task History</h4>${taskHistoryHTML}</div>
    ${showReports?`<div class="ds"><h4>📄 Weekly Reports (${memberReports.length})</h4>${reportsHTML}</div>`:''}
    ${showRoadmap?`<div class="ds"><h4>🗺 Roadmap</h4>${roadmapHTML}</div>`:''}
    ${isCap&&!isMe?`<div style="margin-top:20px"><button class="btn btn-d btn-sm" onclick="captainRemove(${m.id})">🗑 Remove from Team</button></div>`:''}
  `;
  document.getElementById('modal-member').classList.add('open');
}

async function captainRemove(id){
  const m=members.find(x=>sid(x.id)===sid(id));
  if(!m){closeMov('modal-member');return}
  if(!confirm(`Remove "${m.name}" from the team? This cannot be undone.`))return;
  await delDoc('members', id);
  members=members.filter(x=>sid(x.id)!==sid(id));
  closeMov('modal-member');
  toast(m.name+' removed from team.');
  renderDash();
}

/* ════════════════════════════════════════════════════════════
   LEETCODE TRACKER — AUTO-SYNCED FROM LEETCODE API
   Stats are fetched automatically from LeetCode's public API.
   Members only need to provide their LeetCode username/handle.
   Captain/Vice/Manager can sync all; members sync their own.
════════════════════════════════════════════════════════════ */
let lcEditId = null; // member id being edited
let _lcSyncingAll = false; // prevent double sync-all

/* ── LeetCode API: Fetch user stats from public API ──
   Uses multiple fallback endpoints for reliability:
   1. alfa-leetcode-api /solved endpoint (solved counts)
   2. alfa-leetcode-api /{username} endpoint (ranking/profile)
   3. LeetCode GraphQL via CORS proxy
   Returns: { easy, medium, hard, total, rating, streak, ranking } or null on failure */
async function fetchLeetCodeStats(handle){
  if(!handle) return null;
  const username = handle.replace(/^@/,'').replace(/\/+$/,'').trim();
  const API_BASE = 'https://alfa-leetcode-api.onrender.com';

  let easy = 0, medium = 0, hard = 0, total = 0, rating = 0, streak = 0, ranking = 0;
  let gotSolved = false, gotProfile = false;

  // Cache-bust: add random param so API returns fresh data (not cached)
  const cb = '&cb=' + Date.now();

  // ── Step 1: Fetch solved stats from /{username}/solved ──
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(), 15000);
    const resp = await fetch(`${API_BASE}/${encodeURIComponent(username)}/solved?_=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);
    if(resp.ok){
      const data = await resp.json();
      if(data && !data.errors && (data.solvedProblem != null || data.easySolved != null)){
        easy   = data.easySolved   || 0;
        medium = data.mediumSolved || 0;
        hard   = data.hardSolved   || 0;
        total  = data.solvedProblem || (easy + medium + hard);
        gotSolved = true;
      }
    }
  } catch(e){ console.warn('LC solved API failed:', e.message); }

  // ── Step 2: Fetch profile/ranking from /{username} ──
  try {
    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(()=>controller2.abort(), 10000);
    const resp2 = await fetch(`${API_BASE}/${encodeURIComponent(username)}?_=${Date.now()}`, {
      signal: controller2.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId2);
    if(resp2.ok){
      const data2 = await resp2.json();
      if(data2 && !data2.errors){
        ranking = data2.ranking || 0;
        gotProfile = true;
      }
    }
  } catch(e){ console.warn('LC profile API failed:', e.message); }

  // If we got solved data, return success
  if(gotSolved){
    return {
      easy, medium, hard, total,
      rating, streak, ranking,
      source: 'alfa-api'
    };
  }

  // ── Step 3: Fallback — LeetCode GraphQL via CORS proxy ──
  try {
    const graphqlBody = JSON.stringify({
      query: `query userPublicProfile($username: String!) {
        matchedUser(username: $username) {
          username
          profile { ranking }
          submitStatsGlobal {
            acSubmissionNum { difficulty count }
          }
        }
      }`,
      variables: { username }
    });

    // Try multiple CORS proxies
    const proxies = [
      {
        url: 'https://corsproxy.io/?' + encodeURIComponent('https://leetcode.com/graphql'),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: graphqlBody
      },
      {
        url: 'https://api.codetabs.com/v1/proxy?quest=https://leetcode.com/graphql',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: graphqlBody
      }
    ];

    for(const proxy of proxies){
      try {
        const controller3 = new AbortController();
        const timeoutId3 = setTimeout(()=>controller3.abort(), 12000);
        const resp3 = await fetch(proxy.url, {
          method: proxy.method,
          headers: proxy.headers,
          body: proxy.body,
          signal: controller3.signal
        });
        clearTimeout(timeoutId3);
        if(resp3.ok){
          const text = await resp3.text();
          const data3 = JSON.parse(text);
          const user = data3?.data?.matchedUser;
          if(user){
            const stats = user.submitStatsGlobal?.acSubmissionNum || [];
            easy   = stats.find(s=>s.difficulty==='Easy')?.count   || 0;
            medium = stats.find(s=>s.difficulty==='Medium')?.count || 0;
            hard   = stats.find(s=>s.difficulty==='Hard')?.count   || 0;
            total  = easy + medium + hard;
            ranking = user.profile?.ranking || 0;
            return {
              easy, medium, hard, total,
              rating: 0, streak: 0, ranking,
              source: 'graphql-proxy'
            };
          }
        }
      } catch(e){ console.warn('Proxy failed:', proxy.url, e.message); }
    }
  } catch(e){ console.warn('GraphQL fallback failed:', e.message); }

  return null; // all methods failed
}

/* ── Sync a single member's LeetCode stats from the API ── */
async function syncSingleLeetCode(memberId, showToasts = true){
  const member = members.find(m=>sid(m.id)===sid(memberId));
  if(!member){ if(showToasts) toast('Member not found','err'); return false; }
  const entry = leetcodeStats.find(x=>sid(x.memberId)===sid(memberId));
  if(!entry || !entry.handle){ if(showToasts) toast('No LeetCode handle set for '+member.name,'err'); return false; }

  if(showToasts) toast('🔄 Fetching @'+entry.handle+' from LeetCode…');

  // Store previous values BEFORE fetching so we can compute the diff
  const prevEasy   = entry.easy   || 0;
  const prevMedium = entry.medium || 0;
  const prevHard   = entry.hard   || 0;
  const prevTotal  = prevEasy + prevMedium + prevHard;

  const stats = await fetchLeetCodeStats(entry.handle);
  if(!stats){
    if(showToasts) toast('❌ Failed to fetch stats for @'+entry.handle+'. Try again later.','err');
    return false;
  }

  // Calculate what changed since last sync
  const diffTotal = stats.total - prevTotal;

  // Check if anything actually changed
  const noChange = (stats.easy === prevEasy && stats.medium === prevMedium && stats.hard === prevHard);

  // Update the entry with fetched data
  entry.easy     = stats.easy;
  entry.medium   = stats.medium;
  entry.hard     = stats.hard;
  entry.streak   = stats.streak || entry.streak || 0;
  entry.rating   = stats.rating || entry.rating || 0;
  entry.ranking  = stats.ranking || entry.ranking || 0;
  entry.updatedOn  = today();
  entry.updatedBy  = 'Auto-sync';
  entry.lastSynced = new Date().toISOString();

  // Only log to dailyLog if there was an actual change
  if(!noChange){
    const logEntry = {
      date: today(),
      easy: stats.easy - prevEasy,
      medium: stats.medium - prevMedium,
      hard: stats.hard - prevHard,
      total: diffTotal,
      note: `Auto-synced from LeetCode`,
      streak: stats.streak || entry.streak,
      autoSync: true
    };
    entry.dailyLog = [...(entry.dailyLog || []), logEntry];
  }

  await saveDoc('leetcodeStats', entry);

  if(showToasts){
    if(noChange){
      toast(`✅ ${member.name}: No change — still ${stats.total} total solved`);
    } else if(diffTotal > 0){
      toast(`📈 ${member.name}: +${diffTotal} new problems! Total: ${stats.total} (${stats.easy}E/${stats.medium}M/${stats.hard}H)`);
    } else {
      toast(`✅ ${member.name}: Stats synced — ${stats.total} total solved`);
    }
  }
  return true;
}

/* ── Sync ALL members who have a LeetCode handle ── */
async function syncAllLeetCode(){
  if(_lcSyncingAll) return;
  const canSyncAll = ['captain','vice','manager'].includes(CU.role);
  if(!canSyncAll){ toast('Only Captain/Vice/Manager can sync all','err'); return; }

  const entriesWithHandle = leetcodeStats.filter(e=>e.handle);
  if(!entriesWithHandle.length){ toast('No members have LeetCode handles set yet','err'); return; }

  _lcSyncingAll = true;
  toast(`🔄 Syncing ${entriesWithHandle.length} member${entriesWithHandle.length>1?'s':''} from LeetCode…`);

  let successCount = 0;
  let failCount = 0;

  // Show progress indicator
  const body = document.getElementById('leetcode-body');
  const progressEl = document.createElement('div');
  progressEl.id = 'lc-sync-progress';
  progressEl.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--s1);border:1px solid var(--acc4);border-radius:12px;padding:12px 24px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-size:.85rem;color:var(--t1);animation:fadeUp .3s ease';
  progressEl.innerHTML = `<div style="width:20px;height:20px;border:2px solid var(--b2);border-top-color:var(--acc4);border-radius:50%;animation:spin .8s linear infinite"></div><span id="lc-sync-text">Syncing 0/${entriesWithHandle.length}…</span>`;
  document.body.appendChild(progressEl);

  for(let i = 0; i < entriesWithHandle.length; i++){
    const entry = entriesWithHandle[i];
    // Store previous values for diff calculation
    entry._prevEasy = entry.easy || 0;
    entry._prevMedium = entry.medium || 0;
    entry._prevHard = entry.hard || 0;

    const member = members.find(m=>sid(m.id)===sid(entry.memberId));
    const textEl = document.getElementById('lc-sync-text');
    if(textEl) textEl.textContent = `Syncing ${i+1}/${entriesWithHandle.length} — @${entry.handle}…`;

    const ok = await syncSingleLeetCode(entry.memberId, false);
    if(ok) successCount++; else failCount++;

    // Small delay between API calls to avoid rate limiting
    if(i < entriesWithHandle.length - 1) await new Promise(r=>setTimeout(r, 1500));
  }

  // Remove progress indicator
  progressEl.remove();
  _lcSyncingAll = false;

  toast(`✅ Sync complete: ${successCount} updated, ${failCount} failed`);
  renderLeetCode();
}

/* Horizontal bar chart of the top LeetCode solvers */
function buildTopSolversBars(sortedMembers, max){
  max = max || 5;
  const withStats = sortedMembers.map(mm=>{
    const e = leetcodeStats.find(x=>sid(x.memberId)===sid(mm.id));
    const total = e ? (e.easy||0)+(e.medium||0)+(e.hard||0) : 0;
    return {mm, total};
  }).filter(x=>x.total>0).slice(0,max);
  if(!withStats.length) return emptyState('📊','No LeetCode data synced yet.');
  const maxVal = Math.max(...withStats.map(x=>x.total));
  const medals=['🥇','🥈','🥉'];
  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${withStats.map((x,i)=>{
      const c=dc(x.mm.dept);
      const pct = Math.max(6, Math.round(x.total/maxVal*100));
      return `<div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;margin-bottom:5px">
          <span style="display:flex;align-items:center;gap:7px;font-weight:700;color:var(--t1)">
            <span style="width:20px;height:20px;border-radius:50%;background:${c}18;color:${c};display:inline-flex;align-items:center;justify-content:center;font-size:.62rem;overflow:hidden;flex-shrink:0">${i<3?medals[i]:avInner(x.mm)}</span>
            ${x.mm.name}
          </span>
          <span style="font-weight:800;color:#f89f1b">${x.total}</span>
        </div>
        <div style="height:9px;border-radius:99px;background:var(--s3);overflow:hidden">
          <div style="height:100%;width:${pct}%;border-radius:99px;background:linear-gradient(90deg,#f89f1b,#fbbf24)"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderLeetCode(){
  if(!CU) return;
  const body = document.getElementById('leetcode-body');
  const canEditAll = ['captain','vice','manager'].includes(CU.role);

  // Sort members: by total solved desc, unsorted last
  const sorted = [...members].sort((a,b)=>{
    const sa = leetcodeStats.find(x=>sid(x.memberId)===sid(a.id));
    const sb = leetcodeStats.find(x=>sid(x.memberId)===sid(b.id));
    const ta = sa ? (sa.easy||0)+(sa.medium||0)+(sa.hard||0) : -1;
    const tb = sb ? (sb.easy||0)+(sb.medium||0)+(sb.hard||0) : -1;
    return tb - ta;
  });

  // Team totals
  const totEasy   = leetcodeStats.reduce((s,x)=>s+(x.easy||0),0);
  const totMedium = leetcodeStats.reduce((s,x)=>s+(x.medium||0),0);
  const totHard   = leetcodeStats.reduce((s,x)=>s+(x.hard||0),0);
  const totAll    = totEasy+totMedium+totHard;
  const membersWithHandle = leetcodeStats.filter(e=>e.handle).length;

  let html = `
  <div class="card" style="margin-bottom:18px">
    <div class="ct"><span class="cd" style="background:#f89f1b"></span>Team LeetCode Summary</div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:0">
      <div class="sc"><div class="sc-num" style="color:#f89f1b">${totAll}</div><div class="sc-lbl">Total Solved</div></div>
      <div class="sc lc-sc-easy"><div class="sc-num lc-easy">${totEasy}</div><div class="sc-lbl">Easy</div></div>
      <div class="sc lc-sc-medium"><div class="sc-num lc-medium">${totMedium}</div><div class="sc-lbl">Medium</div></div>
      <div class="sc lc-sc-hard"><div class="sc-num lc-hard">${totHard}</div><div class="sc-lbl">Hard</div></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:22px">
    <div class="ct"><span class="cd" style="background:#f89f1b"></span>🏆 Top Solvers</div>
    ${buildTopSolversBars(sorted)}
  </div>

  <div class="card" style="margin-bottom:22px">
    <div class="ct"><span class="cd" style="background:#f89f1b"></span>${lcEditId ? 'Edit LeetCode Handle' : 'LeetCode Setup'}</div>
    <div id="lc-form-wrap">${lcFormHTML(lcEditId)}</div>
  </div>

  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
    <div class="lc-section-lbl" style="margin:0;flex:1">🏅 Member Rankings — ${sorted.length} members</div>
    ${canEditAll && membersWithHandle > 0 ? `<button class="btn btn-lc-save btn-xs" onclick="syncAllLeetCode()" style="font-size:.75rem;padding:6px 14px">🔄 Sync All (${membersWithHandle})</button>` : ''}
  </div>
  <div class="lc-grid">
    ${sorted.map((m,i)=>lcCardHTML(m, i, canEditAll)).join('')}
  </div>`;

  body.innerHTML = html;
  // If editing, populate form with existing values
  if(lcEditId) lcPopulateForm(lcEditId);

  // ── Auto-sync: refresh own stats if last sync was >6 hours ago ──
  if(!_lcSyncingAll){
    const myEntry = leetcodeStats.find(x=>sid(x.memberId)===sid(CU.id));
    if(myEntry && myEntry.handle){
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      const lastSyncTime = myEntry.lastSynced ? new Date(myEntry.lastSynced).getTime() : 0;
      const now = Date.now();
      if(now - lastSyncTime > SIX_HOURS){
        // Store previous values for diff calc
        myEntry._prevEasy = myEntry.easy || 0;
        myEntry._prevMedium = myEntry.medium || 0;
        myEntry._prevHard = myEntry.hard || 0;
        // Background sync — don't block UI, re-render when done
        setTimeout(async ()=>{
          const ok = await syncSingleLeetCode(CU.id, true);
          if(ok) renderLeetCode();
        }, 800);
      }
    }
  }
}

function lcFormHTML(editingMemberId){
  const targetId = editingMemberId || lcEditId || CU.id;
  const targetMember = members.find(m=>sid(m.id)===sid(targetId)) || CU;
  const existingEntry = leetcodeStats.find(x=>sid(x.memberId)===sid(targetId));
  const isInitial = !existingEntry; // no entry yet → show handle form

  // Try to extract handle from member's leetcodeUrl in profile
  const urlHandle = targetMember.leetcodeUrl ? extractLeetCodeHandle(targetMember.leetcodeUrl) : '';
  const prefilledHandle = existingEntry?.handle || urlHandle || '';

  const memberDisplay = `<input type="hidden" id="lc-member-sel" value="${targetMember.id}">
  <div style="background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8);padding:10px 13px;font-size:.9rem;color:var(--t1);margin-bottom:14px">
    <span style="color:var(--t3);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:3px">Member</span>
    ${targetMember.name} <span style="color:var(--t3);font-size:.78rem">(${targetMember.roll})</span>
  </div>`;

  if(isInitial){
    // ── FIRST TIME: just enter handle, stats will be auto-fetched ──
    return memberDisplay + `
    <div class="info-pill ip-info" style="margin-bottom:14px">🤖 Enter your LeetCode username — stats will be <strong>auto-fetched</strong> from LeetCode. No manual numbers needed!</div>
    <div class="fg">
      <div class="field"><label>LeetCode Username *</label><input id="lc-handle" placeholder="e.g. john_doe123" value="${escHTML(prefilledHandle)}"></div>
      <div class="field"><label>Target (total problems)</label><input id="lc-target" type="number" min="0" placeholder="500"></div>
    </div>
    ${prefilledHandle && !existingEntry ? `<div style="font-size:.75rem;color:var(--t3);margin-top:4px">💡 Handle auto-detected from your profile LeetCode URL</div>` : ''}
    <div class="act">
      <button class="btn btn-lc-baseline" onclick="saveLeetCode()">🤖 Fetch &amp; Save Stats</button>
    </div>`;
  } else {
    // ── EXISTING: show current stats + sync button ──
    const total = (existingEntry.easy||0)+(existingEntry.medium||0)+(existingEntry.hard||0);
    const lastSync = existingEntry.lastSynced ? new Date(existingEntry.lastSynced).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : existingEntry.updatedOn;
    return memberDisplay + `
    <div class="info-pill ip-ok" style="margin-bottom:14px">📈 Current total: <strong>${total}</strong> solved &nbsp;·&nbsp; @${existingEntry.handle} &nbsp;·&nbsp; 🔥 ${existingEntry.streak||0}-day streak &nbsp;·&nbsp; Last synced: ${lastSync}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-lc-save" onclick="syncSingleLeetCode(${targetMember.id}).then(()=>{lcClearForm();renderLeetCode()})">🔄 Sync from LeetCode</button>
      <button class="btn btn-s btn-xs" onclick="lcEditEntry(${targetMember.id})" title="Change handle">✏️ Change Handle</button>
    </div>
    ${lcEditId ? `
    <div style="margin-top:14px;border-top:1px solid var(--b1);padding-top:14px">
      <div class="fg">
        <div class="field"><label>New LeetCode Username</label><input id="lc-handle" placeholder="${escHTML(existingEntry.handle)}" value="${escHTML(existingEntry.handle)}"></div>
        <div class="field"><label>Target (total problems)</label><input id="lc-target" type="number" min="0" value="${existingEntry.target||''}" placeholder="500"></div>
      </div>
      <div class="act">
        <button class="btn btn-lc-baseline" onclick="updateHandle(${targetMember.id})">💾 Update &amp; Re-fetch</button>
        <button class="btn btn-s" onclick="lcClearForm()">↺ Cancel</button>
      </div>
    </div>` : ''}`;
  }
}

/* Extract username from LeetCode URL like https://leetcode.com/u/username/ or https://leetcode.com/username/ */
function extractLeetCodeHandle(url){
  if(!url) return '';
  const m = url.match(/leetcode\.com\/(?:u\/)?([a-zA-Z0-9_-]+)\/?$/);
  return m ? m[1] : '';
}

function lcPopulateForm(memberId){
  // Used when editing handle
  const entry = leetcodeStats.find(x=>sid(x.memberId)===sid(memberId));
  if(!entry) return;
  setV('lc-target',  entry.target   || '');
}

function setV(id, val){ const el=document.getElementById(id); if(el) el.value=val; }

function lcClearForm(){
  lcEditId = null;
  renderLeetCode();
}

async function saveLeetCode(){
  // Saves the INITIAL entry: fetches stats from LeetCode API automatically
  const sel = document.getElementById('lc-member-sel');
  const memberId = sel ? sel.value : String(CU.id);
  if(!memberId){ toast('Select a member','err'); return; }
  const canEditAll = ['captain','vice','manager'].includes(CU.role);
  if(!canEditAll && sid(memberId) !== sid(CU.id)){ toast('You can only edit your own entry','err'); return; }
  const member = members.find(m=>sid(m.id)===sid(memberId));
  if(!member){ toast('Member not found','err'); return; }
  const handle = v('lc-handle').replace(/^@/,'').trim();
  if(!handle){ toast('LeetCode username is required','err'); return; }

  toast('🤖 Fetching stats from LeetCode for @'+handle+'…');

  const stats = await fetchLeetCodeStats(handle);

  if(!stats){
    // API failed — save with zeros, user can sync later
    toast('⚠ Could not fetch stats. Saved handle — use Sync later to retry.','err');
  }

  const entry = {
    id:         Date.now(),
    memberId:   Number(memberId),
    memberName: member.name,
    handle,
    rating:     stats?.rating || 0,
    easy:       stats?.easy   || 0,
    medium:     stats?.medium || 0,
    hard:       stats?.hard   || 0,
    streak:     stats?.streak || 0,
    ranking:    stats?.ranking || 0,
    target:     parseInt(v('lc-target')) || 0,
    dailyLog:   [],
    updatedOn:  today(),
    updatedBy:  'Auto-sync',
    lastSynced: stats ? new Date().toISOString() : null
  };

  await saveDoc('leetcodeStats', entry);
  leetcodeStats.push(entry);

  if(stats){
    toast(`✅ Auto-synced! ${member.name}: ${stats.total} problems solved (${stats.easy}E/${stats.medium}M/${stats.hard}H)`);
  } else {
    toast(`⚠ Handle saved for ${member.name}. Stats couldn't be fetched — try Sync later.`);
  }
  lcEditId = null;
  renderLeetCode();
}

async function updateHandle(memberId){
  // Update handle and re-fetch
  const handle = v('lc-handle').replace(/^@/,'').trim();
  if(!handle){ toast('LeetCode username is required','err'); return; }
  const entry = leetcodeStats.find(x=>sid(x.memberId)===sid(memberId));
  if(!entry) return;
  const member = members.find(m=>sid(m.id)===sid(memberId));

  entry.handle = handle;
  entry.target = parseInt(v('lc-target')) || entry.target || 0;
  entry._prevEasy = entry.easy || 0;
  entry._prevMedium = entry.medium || 0;
  entry._prevHard = entry.hard || 0;

  await saveDoc('leetcodeStats', entry);

  toast('🤖 Handle updated — fetching new stats…');
  const ok = await syncSingleLeetCode(memberId, true);
  lcEditId = null;
  renderLeetCode();
}

function lcEditEntry(memberId){
  lcEditId = memberId;
  renderLeetCode();
  const formWrap = document.getElementById('lc-form-wrap');
  if(formWrap) formWrap.scrollIntoView({behavior:'smooth',block:'center'});
}

async function lcDeleteEntry(memberId){
  const entry = leetcodeStats.find(x=>sid(x.memberId)===sid(memberId));
  if(!entry) return;
  if(!confirm('Remove this LeetCode entry?')) return;
  await delDoc('leetcodeStats', entry.id);
  leetcodeStats = leetcodeStats.filter(x=>sid(x.memberId)!==sid(memberId));
  toast('Entry removed.');
  renderLeetCode();
}

function lcCardHTML(m, rank, canEditAll){
  const c = dc(m.dept);
  const entry = leetcodeStats.find(x=>sid(x.memberId)===sid(m.id));
  const isMe = CU && sid(m.id)===sid(CU.id);
  const canEdit = canEditAll || isMe;
  const total = entry ? (entry.easy||0)+(entry.medium||0)+(entry.hard||0) : 0;
  const target = entry && entry.target ? entry.target : 0;
  const pct = target ? Math.min(100, Math.round(total/target*100)) : 0;
  const rankIcon = rank===0?'🥇':rank===1?'🥈':rank===2?'🥉':`<span style="font-size:.75rem;color:var(--t3);font-family:var(--mono)">#${rank+1}</span>`;
  const lastSync = entry && entry.lastSynced ? new Date(entry.lastSynced).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : (entry ? entry.updatedOn : '');

  return `<div class="lc-card">
    <div class="lc-header">
      <div class="lc-av" style="background:${c}18;color:${c};border:1.5px solid ${c}40">${ini(m.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="lc-name">${m.name}${isMe?' <span style="font-size:.65rem;color:var(--acc)">(you)</span>':''}</div>
        <div class="lc-handle">${entry&&entry.handle ? `<a href="https://leetcode.com/u/${escHTML(entry.handle)}/" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--t4)">@${escHTML(entry.handle)}</a>` : '<span style="color:var(--t4)">No handle set</span>'}</div>
      </div>
      <div>${rankIcon}</div>
    </div>

    ${entry ? `
    <div class="lc-total">
      <span>Total Solved</span>
      <span class="lc-total-num">${total}</span>
    </div>
    <div class="lc-stats">
      <div class="lc-stat"><div class="lc-stat-num lc-easy">${entry.easy||0}</div><div class="lc-stat-lbl lbl-easy">Easy</div></div>
      <div class="lc-stat"><div class="lc-stat-num lc-medium">${entry.medium||0}</div><div class="lc-stat-lbl lbl-medium">Medium</div></div>
      <div class="lc-stat"><div class="lc-stat-num lc-hard">${entry.hard||0}</div><div class="lc-stat-lbl lbl-hard">Hard</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${entry.rating ? `<span class="lc-rank-badge">⚡ Rating ${entry.rating}</span>` : ''}
      ${entry.streak ? `<span class="lc-streak">🔥 ${entry.streak}-day streak</span>` : ''}
      ${entry.ranking ? `<span style="font-size:.68rem;color:var(--t3)">🏆 Rank #${entry.ranking.toLocaleString()}</span>` : ''}
    </div>
    ${target ? `
    <div style="font-size:.72rem;color:var(--t3);margin-bottom:4px">Progress to ${target} problems — ${pct}%</div>
    <div class="lc-progress-bar"><div class="lc-progress-fill" style="width:${pct}%"></div></div>` : ''}
    <div class="lc-updated" style="margin-top:8px">🤖 Auto-synced: ${lastSync}</div>
    ` : `<div class="lc-no-entry">No handle set — tap Add to get started</div>`}

    <div class="lc-actions" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">
    ${canEdit && !entry ? `<button class="btn btn-s btn-xs" onclick="lcEditEntry(${m.id})">➕ Add Handle</button>` : ''}
    ${entry && canEdit ? `<button class="btn btn-xs" style="background:rgba(248,159,27,.1);color:#f89f1b;border:1px solid rgba(248,159,27,.25)" onclick="syncSingleLeetCode(${m.id}).then(()=>renderLeetCode())">🔄 Sync</button>` : ''}
    ${entry && canEdit ? `<button class="btn btn-s btn-xs" onclick="lcEditEntry(${m.id})">✏️ Edit</button>` : ''}
    ${entry && canEditAll ? `<button class="btn btn-d btn-xs" onclick="lcDeleteEntry(${m.id})">🗑</button>` : ''}
    </div>
  </div>`;
}


/* ════════════════════════════════════════════════════════════
   HACKATHONS
   Post: Team Manager (+ Captain can also post)
   View & Register: ALL members
════════════════════════════════════════════════════════════ */
function renderHackathons(){
  if(!CU) return;
  const canPost = CU.role==='manager' || CU.role==='captain';
  const body = document.getElementById('hackathon-body');
  let html = '';

  if(canPost){
    html += `<div class="card">
      <div class="ct"><span class="cd" style="background:var(--acc6)"></span>Post a Hackathon</div>
      <div class="info-pill ip-info" style="margin-bottom:16px">🏆 Fill in the details — all team members will see this with a direct register button</div>
      <div class="fg3">
        <div class="field"><label>Hackathon Name *</label><input id="hk-name" placeholder="Smart India Hackathon 2025"></div>
        <div class="field"><label>Organiser / Platform *</label><input id="hk-org" placeholder="MoE, Devfolio, Unstop…"></div>
        <div class="field"><label>Mode</label>
          <select id="hk-mode">
            <option value="Online">🌐 Online</option>
            <option value="Offline">🏢 Offline</option>
            <option value="Hybrid">🔀 Hybrid</option>
          </select>
        </div>
        <div class="field"><label>Registration Deadline *</label><input id="hk-deadline" type="date"></div>
        <div class="field"><label>Event Date / Duration</label><input id="hk-date" placeholder="15–17 Aug 2025  (36 hrs)"></div>
        <div class="field"><label>Prize Pool</label><input id="hk-prize" placeholder="₹1,00,000 · Internship offer"></div>
        <div class="field"><label>Team Size</label><input id="hk-team" placeholder="2–4 members"></div>
        <div class="field"><label>Themes / Tracks</label><input id="hk-theme" placeholder="AI, Health, FinTech, Open…"></div>
        <div class="field"><label>Eligibility</label><input id="hk-elig" placeholder="UG students, All branches…"></div>
        <div class="field"><label>Status</label>
          <select id="hk-status">
            <option value="open">🟢 Registration Open</option>
            <option value="upcoming">🔵 Upcoming — Not Yet Open</option>
            <option value="closed">🔴 Registration Closed</option>
          </select>
        </div>
        <div class="field full"><label>Registration Link *</label><input id="hk-link" type="url" placeholder="https://unstop.com/hackathons/…"></div>
        <div class="field full"><label>Description / Details</label>
          <textarea id="hk-desc" style="min-height:88px" placeholder="Problem statements, judging criteria, perks, important notes…"></textarea>
        </div>
      </div>
      <div class="act">
        <button class="btn" style="background:linear-gradient(135deg,var(--acc6),var(--acc4));color:#07050f;font-weight:700;font-size:.88rem" onclick="addHackathon()">🏆 Post Hackathon</button>
        <button class="btn btn-s" onclick="resetHkForm()">↺ Reset</button>
      </div>
    </div>`;
  }

  const list = hackathons.slice().reverse();

  if(!list.length){
    html += emptyState('🏆', canPost
      ? 'No hackathons yet — use the form above to add one!'
      : 'No hackathons posted yet. Check back soon!');
    body.innerHTML = html;
    return;
  }

  // Determine effective status — auto-close if deadline has passed
  function effectiveStatusOf(h){
    if(h.status === 'closed') return 'closed';
    if(h.deadline){
      const dl = new Date(h.deadline);
      dl.setHours(23,59,59,999);
      if(new Date() > dl) return 'closed';
    }
    return h.status;
  }
  const active = list.filter(h => effectiveStatusOf(h) !== 'closed');
  const closed = list.filter(h => effectiveStatusOf(h) === 'closed');

  if(active.length){
    html += `<div class="hk-section-lbl">🟢 Active &amp; Upcoming — ${active.length} hackathon${active.length>1?'s':''}</div>`;
    html += active.map(h => hkCardHTML(h, canPost)).join('');
  }
  if(closed.length){
    html += `<div class="hk-section-lbl" style="margin-top:28px">🔴 Closed — ${closed.length}</div>`;
    html += closed.map(h => hkCardHTML(h, canPost)).join('');
  }

  body.innerHTML = html;
}

function hkCardHTML(h, canManage){
  const modeKey  = (h.mode||'online').toLowerCase().replace(/[^a-z]/g,'');

  // Auto-close if registration deadline has passed
  let effectiveStatus = h.status;
  if(h.deadline && h.status !== 'closed'){
    const dl = new Date(h.deadline);
    dl.setHours(23,59,59,999);
    if(new Date() > dl) effectiveStatus = 'closed';
  }
  const isExpiredClosed = effectiveStatus === 'closed' && h.status !== 'closed'; // deadline passed but not manually closed
  const isClosed = effectiveStatus === 'closed';

  const stLabel  = {open:'🟢 Open',upcoming:'🔵 Upcoming',closed:'🔴 Closed'}[effectiveStatus] || effectiveStatus;
  const poster   = members.find(m => sid(m.id)===sid(h.byId)) || {name: h.byName||'Manager', dept:'Other', role:'manager'};
  const pc       = dc(poster.dept);

  let urgencyHTML = '';
  if(h.deadline && effectiveStatus==='open'){
    const dl = new Date(h.deadline);
    dl.setHours(23,59,59);
    const daysLeft = Math.ceil((dl - new Date()) / 86400000);
    if(daysLeft >= 0 && daysLeft <= 7){
      urgencyHTML = `<div class="hk-urgency"><span class="udot"></span>${daysLeft===0?'⚠ Deadline is TODAY!':daysLeft+' day'+( daysLeft>1?'s':'')+' left to register!'}</div>`;
    }
  }

  const metaItems = [
    h.deadline ? `<div class="hk-mi"><div class="hk-ml">📅 Reg. Deadline</div><div class="hk-mv" style="color:${isClosed?'#888':'var(--acc3)'}">${new Date(h.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div></div>` : '',
    h.eventDate ? `<div class="hk-mi"><div class="hk-ml">🗓 Event Date</div><div class="hk-mv">${h.eventDate}</div></div>` : '',
    h.teamSize  ? `<div class="hk-mi"><div class="hk-ml">👥 Team Size</div><div class="hk-mv">${h.teamSize}</div></div>` : '',
    h.eligibility?`<div class="hk-mi"><div class="hk-ml">✅ Eligibility</div><div class="hk-mv">${h.eligibility}</div></div>` : '',
  ].filter(Boolean).join('');

  // B&W styles handled via .hk-closed CSS class

  // Register button: disable when closed
  const registerBtn = isClosed
    ? `<span style="font-size:.78rem;color:#888;font-style:italic;padding:10px 14px;border:1px solid #444;border-radius:8px;display:inline-flex;align-items:center;gap:6px">🔒 Registration Closed</span>`
    : (h.link
        ? `<button class="reg-btn" onclick="window.open('${h.link.replace(/'/g,"\'")}','_blank','noopener,noreferrer')">🚀 Register Now</button>`
        : `<span style="font-size:.78rem;color:var(--t3);font-style:italic">No link</span>`);

  return `<div class="hk-card${isClosed?' hk-closed':''}" id="hkc-${h.id}">
    <div class="hk-card-body">
      <div>
        <div class="hk-title">${escHTML(h.name)}</div>
        <div class="hk-org">${escHTML(h.organiser)}</div>
      </div>
      <div class="hk-tags">
        <span class="hk-tag hk-mode-${modeKey}">${h.mode}</span>
        <span class="hk-tag hk-status-${effectiveStatus}">${stLabel}</span>
        ${h.prize  ? `<span class="hk-tag hk-tag-prize">🏅 ${escHTML(h.prize)}</span>`:''}
        ${h.theme  ? `<span class="hk-tag hk-tag-theme">🎯 ${escHTML(h.theme)}</span>`:''}
        ${isExpiredClosed ? `<span class="hk-tag" style="background:rgba(120,120,120,.15);color:#999;border:1px solid #555">⏰ Deadline Passed</span>` : ''}
      </div>
      ${urgencyHTML ? `<div>${urgencyHTML}</div>` : ''}
      ${metaItems ? `<div class="hk-meta">${metaItems}</div>` : ''}
      ${h.description ? `<div class="hk-desc">${escHTML(h.description)}</div>` : ''}
    </div>
    <div class="hk-card-footer-wrap">
      <div class="hk-footer">
        <div class="hk-by">
          <div class="av" style="width:26px;height:26px;font-size:.62rem;flex-shrink:0;background:${pc}18;color:${pc};border:1px solid ${pc}40">${ini(poster.name)}</div>
          Posted by <strong style="color:var(--t2)">${poster.name}</strong>
          <span style="font-family:var(--mono);font-size:.66rem;color:var(--t3)">${h.time}</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-shrink:0">
          ${canManage ? `<button class="btn btn-d btn-sm" onclick="deleteHackathon(${h.id})">🗑 Remove</button>` : ''}
          ${registerBtn}
        </div>
      </div>
    </div>
  </div>`;
}

async function addHackathon(){
  const name = v('hk-name');
  const org  = v('hk-org');
  const link = v('hk-link');
  const deadline = v('hk-deadline');

  if(!name || !org){toast('Hackathon name & organiser are required','err'); return}
  if(!deadline){toast('Please set a registration deadline','err'); return}
  // Auto-add https:// if user forgot the protocol
  const normLink = link ? (link.startsWith('http') ? link : 'https://'+link) : '';

  const hk = {
    id:         Date.now(),
    byId:       Number(CU.id),
    byName:     CU.name,
    name,
    organiser:  org,
    mode:       v('hk-mode') || 'Online',
    deadline,
    eventDate:  v('hk-date'),
    prize:      v('hk-prize'),
    teamSize:   v('hk-team'),
    theme:      v('hk-theme'),
    eligibility:v('hk-elig'),
    status:     v('hk-status') || 'open',
    link: normLink,
    description:v('hk-desc'),
    time:       nowStr()
  };

  await saveDoc('hackathons', hk);
  hackathons.push(hk);
  toast('"' + name + '" posted successfully!');
  resetHkForm();
  renderHackathons();
}

async function deleteHackathon(id){
  if(!confirm('Remove this hackathon from the board?')) return;
  await delDoc('hackathons', id);
  hackathons = hackathons.filter(h => sid(h.id) !== sid(id));
  toast('Hackathon removed.');
  renderHackathons();
}

function resetHkForm(){
  ['hk-name','hk-org','hk-deadline','hk-date','hk-prize',
   'hk-team','hk-theme','hk-elig','hk-link','hk-desc'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  ['hk-mode','hk-status'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.selectedIndex = 0;
  });
}

/* ════════════════════════════════════════════════════════════
   APTITUDE
   Assign: Captain assigns one or more members as "Aptitude Incharge"
   Post material & create tests: Incharge (+ Captain)
   View material & attempt tests: ALL members
════════════════════════════════════════════════════════════ */
let aptQRows = []; // question-builder row ids for the test-creation form

function canManageAptitude(){
  return !!CU && (CU.role==='captain' || hasElevatedAccess() || !!CU.aptitudeIncharge);
}

function renderAptitude(){
  if(!CU) return;
  const body = document.getElementById('aptitude-body');
  const isCap = CU.role==='captain' || hasElevatedAccess();
  const canManage = canManageAptitude();
  let html = '';

  // ── Captain: assign / remove Aptitude Incharge ──
  if(isCap){
    const list = members.slice().sort((a,b)=>a.name.localeCompare(b.name));
    html += `<div class="card">
      <div class="ct"><span class="cd" style="background:var(--acc3)"></span>Assign Aptitude Incharge</div>
      <div class="info-pill ip-info" style="margin-bottom:14px">🧠 Assigned members can post study material &amp; create tests for the whole team</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${list.map(m=>`
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8)">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <div class="av" style="width:32px;height:32px;font-size:.7rem;background:${dc(m.dept)}18;color:${dc(m.dept)};border:1.5px solid ${dc(m.dept)}38;flex-shrink:0">${avInner(m)}</div>
              <div style="min-width:0">
                <div style="font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(m.name)}${m.aptitudeIncharge?' <span class="badge" style="background:rgba(192,132,252,.15);color:var(--acc);margin-left:4px">Incharge</span>':''}</div>
                <div style="font-size:.72rem;color:var(--t3)">${ROLES[m.role]}</div>
              </div>
            </div>
            <button class="btn ${m.aptitudeIncharge?'btn-d':'btn-s'} btn-xs" style="flex-shrink:0" onclick="toggleAptitudeIncharge('${m.id}')">${m.aptitudeIncharge?'✕ Remove':'➕ Assign'}</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  // ── Incharge / Captain: post material & create tests ──
  if(canManage){
    html += `<div class="card">
      <div class="ct"><span class="cd" style="background:var(--acc5)"></span>Post Study Material</div>
      <div class="fg">
        <div class="field full"><label>Title *</label><input id="am-title" placeholder="Quantitative Aptitude — Time & Work"></div>
        <div class="field full"><label>Content</label><textarea id="am-content" style="min-height:110px" placeholder="Notes, formulas, tips, practice questions…"></textarea></div>
        <div class="field full"><label>Resource Link (optional)</label><input id="am-link" type="url" placeholder="https://drive.google.com/…"></div>
      </div>
      <div class="act"><button class="btn btn-acc5" onclick="addAptitudeMaterial()">📚 Post Material</button></div>
    </div>

    <div class="card">
      <div class="ct"><span class="cd" style="background:var(--acc)"></span>Create Aptitude Test</div>
      <div class="fg">
        <div class="field full"><label>Test Title *</label><input id="at-title" placeholder="Weekly Aptitude Test #1"></div>
        <div class="field full"><label>Description</label><textarea id="at-desc" style="min-height:70px" placeholder="Instructions, topics covered, time limit…"></textarea></div>
      </div>
      <div id="at-qrows" style="display:flex;flex-direction:column;gap:14px;margin:14px 0"></div>
      <button class="btn btn-s btn-sm" onclick="addAptQuestionRow()">+ Add Question</button>
      <div class="act" style="margin-top:16px"><button class="btn btn-p" onclick="createAptitudeTest()">🧪 Publish Test</button></div>
    </div>`;
  }

  // ── Study material list (everyone) ──
  const matList = aptitudeMaterials.slice().reverse();
  html += `<div class="card">
    <div class="ct"><span class="cd" style="background:var(--acc2)"></span>📚 Study Materials (${matList.length})</div>
    ${matList.length ? matList.map(mtl=>aptMaterialCardHTML(mtl,canManage)).join('') : emptyState('📚','No study material posted yet.')}
  </div>`;

  // ── Test list (everyone) ──
  const testList = aptitudeTests.slice().reverse();
  html += `<div class="card">
    <div class="ct"><span class="cd" style="background:var(--acc6)"></span>🧪 Tests (${testList.length})</div>
    ${testList.length ? testList.map(t=>aptTestCardHTML(t,canManage)).join('') : emptyState('🧪','No tests published yet.')}
  </div>`;

  body.innerHTML = html;

  // Start the question builder with one empty question row
  if(canManage){
    aptQRows = [];
    addAptQuestionRow();
  }
}

function aptMaterialCardHTML(mtl, canManage){
  const canDelete = canManage && (CU.role==='captain' || hasElevatedAccess() || String(mtl.createdBy)===String(CU.id));
  return `<div style="padding:14px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8);margin-bottom:12px">
    <div style="font-weight:700;font-size:.9rem;color:var(--t1)">${escHTML(mtl.title)}</div>
    ${mtl.content?`<p style="white-space:pre-wrap;margin-top:6px;font-size:.85rem;color:var(--t2);line-height:1.6">${escHTML(mtl.content)}</p>`:''}
    ${mtl.link?`<p style="margin-top:8px"><a href="${escHTML(mtl.link)}" target="_blank" rel="noopener" style="color:var(--acc);font-size:.83rem;font-weight:600">🔗 Open Resource</a></p>`:''}
    <p style="font-size:.72rem;color:var(--t3);margin-top:9px">By ${escHTML(mtl.createdByName)} · ${mtl.createdOn}</p>
    ${canDelete?`<button class="btn btn-d btn-xs" style="margin-top:8px" onclick="deleteAptitudeMaterial('${mtl.id}')">🗑 Delete</button>`:''}
  </div>`;
}

function aptTestCardHTML(t, canManage){
  const subs = t.submissions || [];
  const qCount = (t.questions||[]).length;
  const mySub = subs.find(s=>String(s.memberId)===String(CU.id));
  const avg = subs.length ? (subs.reduce((a,s)=>a+s.score,0)/subs.length).toFixed(1) : null;
  const canDelete = canManage && (CU.role==='captain' || hasElevatedAccess() || String(t.createdBy)===String(CU.id));
  return `<div style="padding:14px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8);margin-bottom:12px">
    <div style="font-weight:700;font-size:.9rem;color:var(--t1)">${escHTML(t.title)}</div>
    ${t.description?`<p style="margin-top:5px;font-size:.83rem;color:var(--t2)">${escHTML(t.description)}</p>`:''}
    <p style="font-size:.72rem;color:var(--t3);margin-top:9px">By ${escHTML(t.createdByName)} · ${t.createdOn} · ${qCount} question${qCount!==1?'s':''} · ${subs.length} attempt${subs.length!==1?'s':''}${avg?` · Avg ${avg}/${qCount}`:''}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;align-items:center">
      ${mySub
        ? `<span class="badge" style="background:rgba(110,231,183,.15);color:#22c07a">✅ Scored ${mySub.score}/${qCount}</span>
           <button class="btn btn-s btn-xs" onclick="openTakeTest('${t.id}',true)">👁 Review Answers</button>`
        : `<button class="btn btn-p btn-xs" onclick="openTakeTest('${t.id}',false)">📝 Take Test</button>`}
      ${canManage?`<button class="btn btn-acc2 btn-xs" onclick="viewAptTestResults('${t.id}')">📊 Results (${subs.length})</button>`:''}
      ${canDelete?`<button class="btn btn-d btn-xs" onclick="deleteAptitudeTest('${t.id}')">🗑 Delete</button>`:''}
    </div>
  </div>`;
}

async function toggleAptitudeIncharge(id){
  const m = members.find(x=>sid(x.id)===sid(id));
  if(!m) return;
  m.aptitudeIncharge = !m.aptitudeIncharge;
  await saveDoc('members', m);
  if(CU && sid(CU.id)===sid(m.id)) CU.aptitudeIncharge = m.aptitudeIncharge;
  toast(m.aptitudeIncharge ? `${m.name} is now Aptitude Incharge` : `${m.name} removed as Aptitude Incharge`);
  renderAptitude();
}

async function addAptitudeMaterial(){
  const title = v('am-title');
  if(!title){toast('Material title is required','err');return}
  const mtl = {
    id: Date.now(), title, content: v('am-content'), link: safeUrl(v('am-link')),
    createdBy: CU.id, createdByName: CU.name, createdOn: today()
  };
  await saveDoc('aptitudeMaterials', mtl);
  aptitudeMaterials.push(mtl);
  toast('✅ Study material posted!');
  renderAptitude();
}

async function deleteAptitudeMaterial(id){
  if(!confirm('Delete this material?')) return;
  await delDoc('aptitudeMaterials', id);
  aptitudeMaterials = aptitudeMaterials.filter(m=>sid(m.id)!==sid(id));
  toast('Material deleted.');
  renderAptitude();
}

/* ── Test-creation question builder (mirrors the profile's dynamic course/project rows) ── */
function addAptQuestionRow(){
  const id = Date.now()+Math.random();
  aptQRows.push(id);
  const cont = document.getElementById('at-qrows');
  if(!cont) return;
  const d = document.createElement('div');
  d.style.cssText='padding:14px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8)';
  d.id = 'aqr-'+id;
  d.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:.8rem;color:var(--t2)">Question ${aptQRows.length}</strong>
      <button class="btn btn-d btn-xs" style="margin-bottom:0" onclick="rmAptQuestionRow(${id})">✕ Remove</button>
    </div>
    <div class="field full" style="margin-bottom:10px"><input type="text" id="aqq-${id}" placeholder="Question text"></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${[0,1,2,3].map(i=>`
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="radio" name="aqc-${id}" value="${i}" ${i===0?'checked':''} style="width:auto;flex-shrink:0;accent-color:var(--acc)">
          <input type="text" id="aqo-${id}-${i}" placeholder="Option ${String.fromCharCode(65+i)}" style="flex:1;background:var(--s1);border:1px solid var(--b2);border-radius:var(--r8);color:var(--t1);padding:9px 12px;font-size:.85rem;font-family:var(--font);outline:none">
        </label>`).join('')}
    </div>
    <p style="font-size:.7rem;color:var(--t3);margin-top:8px">Select the radio button next to the correct option</p>`;
  cont.appendChild(d);
}

function rmAptQuestionRow(id){
  const el = document.getElementById('aqr-'+id);
  if(el) el.remove();
  aptQRows = aptQRows.filter(r=>r!==id);
  document.querySelectorAll('#at-qrows > div').forEach((row,i)=>{
    const lbl = row.querySelector('strong');
    if(lbl) lbl.textContent = 'Question '+(i+1);
  });
}

async function createAptitudeTest(){
  const title = v('at-title');
  if(!title){toast('Test title is required','err');return}
  const questions = [];
  for(const id of aptQRows){
    if(!document.getElementById('aqr-'+id)) continue;
    const qtext = (document.getElementById('aqq-'+id)||{value:''}).value.trim();
    const opts = [0,1,2,3].map(i=>(document.getElementById(`aqo-${id}-${i}`)||{value:''}).value.trim());
    const correctEl = document.querySelector(`input[name="aqc-${id}"]:checked`);
    const correct = correctEl ? parseInt(correctEl.value,10) : 0;
    if(!qtext || opts.some(o=>!o)) continue; // skip incomplete rows
    questions.push({q:qtext, options:opts, correct});
  }
  if(!questions.length){toast('Add at least one complete question (text + all 4 options)','err');return}
  const t = {
    id: Date.now(), title, description: v('at-desc'),
    questions, submissions: [],
    createdBy: CU.id, createdByName: CU.name, createdOn: today()
  };
  await saveDoc('aptitudeTests', t);
  aptitudeTests.push(t);
  toast(`✅ Test published with ${questions.length} question${questions.length!==1?'s':''}!`);
  renderAptitude();
}

async function deleteAptitudeTest(id){
  if(!confirm('Delete this test and all its submissions?')) return;
  await delDoc('aptitudeTests', id);
  aptitudeTests = aptitudeTests.filter(t=>sid(t.id)!==sid(id));
  toast('Test deleted.');
  renderAptitude();
}

/* ── Take-test / review modal ── */
function openTakeTest(testId, reviewMode){
  const t = aptitudeTests.find(x=>sid(x.id)===sid(testId));
  if(!t) return;
  const mySub = (t.submissions||[]).find(s=>String(s.memberId)===String(CU.id));
  const answers = (reviewMode && mySub) ? mySub.answers : [];

  const qHTML = (t.questions||[]).map((q,qi)=>{
    const optsHTML = q.options.map((opt,oi)=>{
      let extraStyle='', tag='';
      if(reviewMode){
        const picked = answers[qi]===oi;
        const isCorrect = q.correct===oi;
        if(isCorrect){extraStyle='color:#22c07a;font-weight:700';tag=' ✓';}
        else if(picked && !isCorrect){extraStyle='color:#ff4e6a;font-weight:700';tag=' ✕ (your answer)';}
      }
      return `<label style="display:flex;align-items:center;gap:8px;${reviewMode?'pointer-events:none':'cursor:pointer'}">
        <input type="radio" name="tq-${qi}" value="${oi}" ${reviewMode&&answers[qi]===oi?'checked':''} ${reviewMode?'disabled':''} style="width:auto;flex-shrink:0;accent-color:var(--acc)">
        <span style="${extraStyle}">${String.fromCharCode(65+oi)}. ${escHTML(opt)}${tag}</span>
      </label>`;
    }).join('');
    return `<div style="margin-bottom:16px;padding:14px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8)">
      <div style="font-weight:600;font-size:.87rem;margin-bottom:10px">${qi+1}. ${escHTML(q.q)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${optsHTML}</div>
    </div>`;
  }).join('');

  document.getElementById('modal-apttest-body').innerHTML = `
    <h3 style="margin-bottom:6px">${reviewMode?'📋 Review — ':'📝 '}${escHTML(t.title)}</h3>
    ${t.description?`<p style="color:var(--t3);font-size:.85rem;margin-bottom:16px">${escHTML(t.description)}</p>`:''}
    ${reviewMode?`<div class="info-pill ip-ok" style="margin-bottom:16px">You scored <strong>${mySub.score}/${(t.questions||[]).length}</strong></div>`:''}
    <div id="tt-qs">${qHTML}</div>
    ${reviewMode?'':`<div class="act"><button class="btn btn-p" onclick="submitAptitudeTest('${t.id}')">✅ Submit Test</button></div>`}
  `;
  document.getElementById('modal-apttest').classList.add('open');
}

async function submitAptitudeTest(testId){
  const t = aptitudeTests.find(x=>sid(x.id)===sid(testId));
  if(!t) return;
  if((t.submissions||[]).some(s=>String(s.memberId)===String(CU.id))){toast('You already submitted this test','err');return}
  const qCount = (t.questions||[]).length;
  const answers = [];
  for(let qi=0; qi<qCount; qi++){
    const picked = document.querySelector(`input[name="tq-${qi}"]:checked`);
    answers.push(picked ? parseInt(picked.value,10) : -1);
  }
  if(answers.some(a=>a===-1)){toast('Please answer all questions before submitting','err');return}
  const score = answers.filter((a,i)=>a===t.questions[i].correct).length;
  const sub = {memberId:CU.id, memberName:CU.name, answers, score, submittedOn: today()};
  t.submissions = [...(t.submissions||[]), sub];
  await saveDoc('aptitudeTests', t);
  toast(`✅ Submitted! You scored ${score}/${qCount}`);
  closeMov('modal-apttest');
  renderAptitude();
}

function viewAptTestResults(testId){
  const t = aptitudeTests.find(x=>sid(x.id)===sid(testId));
  if(!t) return;
  const subs = (t.submissions||[]).slice().sort((a,b)=>b.score-a.score);
  const qCount = (t.questions||[]).length;
  const rowsHTML = subs.length ? subs.map(s=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 13px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8);margin-bottom:8px">
      <span style="font-weight:600;font-size:.85rem">${escHTML(s.memberName)}</span>
      <span style="font-size:.82rem;color:var(--t3)">${s.score}/${qCount} · ${s.submittedOn}</span>
    </div>`).join('') : emptyState('📊','No submissions yet.');
  document.getElementById('modal-apttest-body').innerHTML = `
    <h3 style="margin-bottom:14px">📊 Results — ${escHTML(t.title)}</h3>
    ${rowsHTML}`;
  document.getElementById('modal-apttest').classList.add('open');
}

function renderAdmin(){
  if(!CU||(CU.role!=='captain'&&!hasElevatedAccess())){
    document.getElementById('admin-body').innerHTML=`<div class="no-acc"><div class="ni">🔒</div><p>Only the Captain can access this panel.</p></div>`;
    return;
  }

  const viceMember = members.find(m=>m.role==='vice');
  const leaveActive = isCaptainOnLeave();
  const isActingCaptain = CU.role==='vice' && leaveActive;

  // Build captain leave card HTML
  let leaveCardHTML = '';
  if(CU.role==='captain'){
    let leaveStatusHTML = '';
    if(captainLeave && captainLeave.active){
      const vc = members.find(m=>String(m.id)===String(captainLeave.viceCaptainId));
      const vcName = vc ? vc.name : 'Vice Captain';
      const typeLabel = captainLeave.type==='single'
        ? `${captainLeave.startDate} · ${captainLeave.startTime||'00:00'} – ${captainLeave.endTime||'23:59'}`
        : `${captainLeave.startDate} ${captainLeave.startTime||'00:00'} → ${captainLeave.endDate} ${captainLeave.endTime||'23:59'}`;
      leaveStatusHTML = `
        <div class="info-box" style="background:${leaveActive?'rgba(110,231,183,.08)':'rgba(252,211,77,.07)'};border-color:${leaveActive?'rgba(110,231,183,.3)':'rgba(252,211,77,.25)'};color:${leaveActive?'var(--acc5)':'var(--acc4)'}">
          <div style="font-weight:700;margin-bottom:4px">${leaveActive?'🟢 Access currently delegated':'🟡 Leave scheduled (not active yet)'}</div>
          <div><strong>${vcName}</strong> has captain-level access</div>
          <div style="font-size:.75rem;color:var(--t3);margin-top:5px">📅 ${typeLabel}</div>
          <div style="font-size:.75rem;color:var(--t3)">Applied: ${captainLeave.appliedAt||''}</div>
        </div>
        <button class="btn btn-d btn-sm" onclick="revokeCaptainLeave()" style="margin-bottom:16px">🔴 Revoke Access — I'm Back Early</button>`;
    }

    leaveCardHTML = `
    <div class="card" style="margin-bottom:18px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--acc4),var(--acc3))"></div>
      <div class="ct"><span class="cd" style="background:var(--acc4)"></span>Captain Absence — Delegate Access</div>
      <div class="info-box ip-info">👑 When you're absent, the <strong>Vice Captain</strong> gets full captain-level access — members, tasks, admin, and all features. Access is <strong>only granted by you</strong> and can be revoked anytime.</div>
      ${viceMember ? '' : `<div class="info-box ip-warn">⚠ No Vice Captain found. Add a member with the "Vice Captain" role first.</div>`}
      ${leaveStatusHTML}
      ${viceMember && !(captainLeave&&captainLeave.active) ? `
      <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.85rem;font-weight:600;text-transform:none;letter-spacing:0">
          <input type="radio" name="leave-type" value="single" id="lt-single" checked onchange="toggleLeaveType()" style="width:auto;accent-color:var(--acc)"> Single Day
        </label>
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.85rem;font-weight:600;text-transform:none;letter-spacing:0">
          <input type="radio" name="leave-type" value="range" id="lt-range" onchange="toggleLeaveType()" style="width:auto;accent-color:var(--acc)"> Date Range
        </label>
      </div>

      <!-- Single day fields -->
      <div id="leave-single-fields" class="leave-fields" style="margin-bottom:14px">
        <div class="field"><label>Date *</label><input type="date" id="leave-single-date" min="${new Date().toISOString().split('T')[0]}"></div>
        <div class="field"><label>Absent From</label><input type="time" id="leave-single-start" value="09:00"></div>
        <div class="field"><label>Absent Until</label><input type="time" id="leave-single-end" value="18:00"></div>
      </div>

      <!-- Date range fields -->
      <div id="leave-range-fields" class="leave-fields" style="margin-bottom:14px;display:none">
        <div class="field"><label>From Date *</label><input type="date" id="leave-range-start-date" min="${new Date().toISOString().split('T')[0]}"></div>
        <div class="field"><label>From Time</label><input type="time" id="leave-range-start-time" value="09:00"></div>
        <div class="field"><label>To Date *</label><input type="date" id="leave-range-end-date" min="${new Date().toISOString().split('T')[0]}"></div>
        <div class="field"><label>To Time</label><input type="time" id="leave-range-end-time" value="18:00"></div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 13px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--r8);margin-bottom:14px;font-size:.82rem;color:var(--t2)">
        <span>👤 Granting access to:</span>
        <strong style="color:var(--acc2)">${viceMember.name}</strong>
        <span class="badge b-vice">Vice Captain</span>
      </div>

      <div class="act">
        <button class="btn btn-p" onclick="applyCaptainLeave()">✈ Apply Leave &amp; Grant Access</button>
      </div>` : ''}
    </div>`;
  }

  if(isActingCaptain){
    leaveCardHTML = `<div class="info-box" style="margin-bottom:18px;background:rgba(110,231,183,.08);border-color:rgba(110,231,183,.3);color:var(--acc5)">
      👑 You have <strong>acting captain access</strong> — the Captain is currently absent. All admin functions are available to you until the Captain returns or revokes access.
    </div>`;
  }

  document.getElementById('admin-body').innerHTML=`
    ${leaveCardHTML}
    <div class="card"><div class="ct"><span class="cd" style="background:var(--acc4)"></span>Add New Member</div>
      <div class="info-pill ip-warn" style="margin-bottom:14px">💡 New members get PIN <strong>1234</strong> by default. They can change it after logging in.</div>
      <div class="fg3">
        <div class="field"><label>Full Name *</label><input id="a-name" placeholder="Priya Rajan"></div>
        <div class="field"><label>Roll No *</label><input id="a-roll" placeholder="22CS046"></div>
        <div class="field"><label>Role *</label>
          <select id="a-role">
            <option value="member">Member</option>
            <option value="team_leader">Team Leader</option>
            <option value="vice">Vice Captain</option>
            <option value="manager">Team Manager</option>
            <option value="strategist">Strategist</option>
          </select>
        </div>
        <div class="field"><label>Department *</label>
          <select id="a-dept">
            <option value="">Select</option>
            ${DEPTS.map(d=>`<option>${d}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Year</label>
          <select id="a-year"><option>1st Year</option><option>2nd Year</option><option selected>3rd Year</option><option>4th Year</option></select>
        </div>
        <div class="field"><label>Email</label><input id="a-email" type="email" placeholder="member@college.edu"></div>
        <div class="field"><label>Custom PIN (optional)</label><input id="a-pin" type="password" maxlength="4" placeholder="1234" inputmode="numeric"></div>
        <div class="field"><label>Dream Company</label><input id="a-dream" placeholder="Google, TCS…"></div>
        <div class="field"><label>Target Role</label><input id="a-trole" placeholder="Software Engineer…"></div>
      </div>
      <div class="act">
        <button class="btn btn-p" onclick="adminAdd()">➕ Add Member</button>
        <button class="btn btn-s" onclick="renderAdmin()">Reset</button>
      </div>
    </div>

    <div class="card" style="margin-top:6px">
      <div class="ct"><span class="cd" style="background:var(--acc3)"></span>Current Members</div>
      <div id="admin-mlist">
        ${members.map(m=>mrHTML(m,true)).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:6px">
      <div class="ct"><span class="cd" style="background:var(--acc2)"></span>Database Info</div>
      <div class="info-pill ip-ok" style="margin-bottom:14px">🔥 All data is stored in <strong>Firebase Firestore</strong> — every member can log in from any device and see all data in real time.</div>
      <div style="font-size:.82rem;color:var(--t3);line-height:1.7">Just share this <strong style="color:var(--t2)">teamsync-firebase.html</strong> file with your team. Everyone opens the same file and all data is shared automatically.</div>
    </div>
  `;
}

async function adminAdd(){
  const name=v('a-name'), roll=v('a-roll'), dept=v('a-dept'), role=v('a-role');
  if(!name||!roll||!dept){toast('Name, Roll & Department required','err');return}
  if(members.find(m=>m.roll===roll)){toast('Roll No already exists','err');return}
  const pinRaw=v('a-pin');
  const pin=pinRaw&&pinRaw.length===4?pinRaw:'1234';
  const mem={
    id:Date.now(), name, roll, dept, year:v('a-year'), role, email:v('a-email'),
    pin, dream:v('a-dream'), targetRole:v('a-trole'),
    dreamWhy:'', current:'', nextWeek:'', projects:'',
    skills:[], courses:[], teamImprove:'', updates:[], addedOn:today()
  };
  await saveDoc('members', mem);
  members.push(mem);
  toast(`${name} added! PIN: ${pin}`);
  renderAdmin();
  buildLoginGrid();
}

/* ── Captain Leave functions ── */
function toggleLeaveType(){
  const isSingle = document.getElementById('lt-single').checked;
  document.getElementById('leave-single-fields').style.display = isSingle ? 'grid' : 'none';
  document.getElementById('leave-range-fields').style.display  = isSingle ? 'none' : 'grid';
}

async function applyCaptainLeave(){
  if(!CU||CU.role!=='captain'){toast('Only Captain can apply leave','err');return}
  const viceMember = members.find(m=>m.role==='vice');
  if(!viceMember){toast('No Vice Captain found — add one first','err');return}

  const isSingle = document.getElementById('lt-single').checked;
  let leaveData;

  if(isSingle){
    const date = document.getElementById('leave-single-date').value;
    const startTime = document.getElementById('leave-single-start').value;
    const endTime = document.getElementById('leave-single-end').value;
    if(!date){toast('Please select a date','err');return}
    if(startTime && endTime && startTime >= endTime){toast('Start time must be before end time','err');return}
    leaveData = {
      id: Date.now(), type:'single',
      startDate: date, endDate: date,
      startTime: startTime||'00:00', endTime: endTime||'23:59',
      viceCaptainId: String(viceMember.id),
      viceCaptainName: viceMember.name,
      appliedAt: nowStr(), active: true
    };
  } else {
    const startDate = document.getElementById('leave-range-start-date').value;
    const startTime = document.getElementById('leave-range-start-time').value;
    const endDate   = document.getElementById('leave-range-end-date').value;
    const endTime   = document.getElementById('leave-range-end-time').value;
    if(!startDate||!endDate){toast('Please select start and end dates','err');return}
    if(startDate > endDate){toast('End date must be after start date','err');return}
    if(startDate===endDate && startTime && endTime && startTime>=endTime){toast('Start time must be before end time','err');return}
    leaveData = {
      id: Date.now(), type:'range',
      startDate, startTime: startTime||'00:00',
      endDate,   endTime:   endTime||'23:59',
      viceCaptainId: String(viceMember.id),
      viceCaptainName: viceMember.name,
      appliedAt: nowStr(), active: true
    };
  }

  await saveCaptainLeave(leaveData);
  toast(`✅ Leave applied! ${viceMember.name} now has captain-level access during your absence.`);
  renderAdmin();
}

async function revokeCaptainLeave(){
  if(!CU||CU.role!=='captain'){toast('Only the Captain can revoke access','err');return}
  const vc = captainLeave ? members.find(m=>String(m.id)===String(captainLeave.viceCaptainId)) : null;
  const vcName = vc ? vc.name : 'Vice Captain';
  if(!confirm(`Revoke captain access from ${vcName}? They will immediately lose elevated permissions.`)) return;
  await clearCaptainLeave();
  toast(`✅ Access revoked. ${vcName} is back to Vice Captain permissions.`);
  renderAdmin();
}

/* ════════════════════════════════════════════════════════════
   DAILY TASKS  v2
   ─────────────────────────────────────────────────────────
   ROLES & PERMISSIONS
   • Captain   : creates Domains, assigns Team Leaders & members,
                 can see/manage everything
   • Team Leader: assigns tasks ONLY within their domain, verifies
                  completion, removes tasks with reason
   • Member    : submits "done" OR "can't complete + reason"
                 → TL must verify final completion

   TASK STATUS FLOW
   pending → submitted (member clicks ✓) → verified (TL confirms)
   pending → excused   (member can't complete, gives reason; TL acknowledges)
   pending → carried   (auto carry-over if due date passed without action)
   any     → removed   (TL removes with mandatory reason)

   Firestore collections: domains | dailyTasks
   dailyTask schema: { id, domainId, domainName, memberId, memberName,
     tlId, tlName, text, psName,
     assignedDate, dueDate, assignedBy,
     status:'pending'|'submitted'|'verified'|'carried'|'removed'|'excused',
     memberNote, tlNote, removedReason, excuseReason,
     submittedAt, verifiedAt, removedAt, carriedFromId }
════════════════════════════════════════════════════════════ */

/* ── date helpers ── */
function todayKey(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function tomorrowKey(){
  const d=new Date();d.setDate(d.getDate()+1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateLabel(k){
  if(!k)return'';
  const[y,m,d]=k.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
}
function isTaskOverdue(t){
  if(['verified','removed','excused','overdue_pending','carried'].includes(t.status))return false;
  const now=new Date();
  const[y,m,d]=t.dueDate.split('-').map(Number);
  return now>new Date(y,m-1,d,20,0,0);
}

/* ── role helpers ── */
function isCaptainOrVice(){return CU&&(CU.role==='captain'||hasElevatedAccess())} // Vice Captain gets captain-level when leave is active
function isCaptainOnly(){return CU&&(CU.role==='captain'||hasElevatedAccess())}
function isTeamLeader(){
  if(!CU)return false;
  // team_leader role OR vice captain assigned as TL of any domain OR any member assigned as TL
  if(CU.role==='team_leader')return true;
  if(CU.role==='vice') return domains.some(d=>sid(d.tlId)===sid(CU.id)); // Vice gets TL view only if assigned as domain TL
  return domains.some(d=>sid(d.tlId)===sid(CU.id));
}
function canManageTasks(){return isCaptainOrVice()||isTeamLeader()}

/* ── domain helpers ── */
function myDomain(){
  if(!CU)return null;
  // Only Captain sees all; Vice Captain now scoped to their own domain(s)
  if(CU.role==='captain') return null;
  return domains.find(d=>sid(d.tlId)===sid(CU.id)||
    (d.memberIds||[]).some(mid=>sid(mid)===sid(CU.id)));
}
/* Returns ALL domains where the current user is assigned as TL (supports multi-domain TLs) */
function myDomainsAsTL(){
  if(!CU) return [];
  return domains.filter(d=>sid(d.tlId)===sid(CU.id));
}
function domainOfMember(memberId){
  return domains.find(d=>(d.memberIds||[]).some(mid=>sid(mid)===sid(memberId))||sid(d.tlId)===sid(memberId));
}

/* ── Performance scoring: % of a member's daily tasks that were verified,
   both overall and scoped to their assigned project/domain. Removed tasks
   are excluded from the denominator — they were struck, not owed. ── */
function computeTaskPerformance(memberId){
  const tasks = dailyTasks.filter(t=>sid(t.memberId)===sid(memberId) && t.status!=='removed');
  const total = tasks.length;
  const verified = tasks.filter(t=>t.status==='verified').length;
  const rate = total ? Math.round(verified/total*100) : 0;

  const dom = domainOfMember(memberId);
  let domainPerf = null;
  if(dom){
    const domTasks = tasks.filter(t=>sid(t.domainId)===sid(dom.id));
    const domTotal = domTasks.length;
    const domVerified = domTasks.filter(t=>t.status==='verified').length;
    const domRate = domTotal ? Math.round(domVerified/domTotal*100) : 0;
    domainPerf = {name:dom.name, psName:dom.psName, emoji:dom.emoji||'📁', total:domTotal, verified:domVerified, rate:domRate};
  }
  return {overall:{total,verified,rate}, domain:domainPerf};
}

function scoreColor(rate){ return rate>=80?'var(--acc5)':rate>=50?'var(--acc4)':'var(--acc3)'; }

/* Renders the two-tile "Overall Score" + "Project Score" performance card.
   Used on both a member's own Profile tab and the personal-dashboard modal. */
function performanceCardHTML(memberId){
  const perf = computeTaskPerformance(memberId);
  const o = perf.overall;
  let html = `<div class="card" style="margin-bottom:18px">
    <div class="ct"><span class="cd" style="background:${scoreColor(o.rate)}"></span>📊 Task Performance</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px;text-align:center;padding:16px 10px;background:var(--s2);border-radius:12px;border:1px solid var(--b1)">
        <div style="font-size:2rem;font-weight:800;color:${scoreColor(o.rate)}">${o.rate}%</div>
        <div style="font-size:.72rem;color:var(--t3);margin-top:3px;font-weight:600">Overall Score</div>
        <div style="font-size:.68rem;color:var(--t4);margin-top:4px">${o.verified}/${o.total} tasks verified</div>
      </div>`;
  if(perf.domain){
    const d=perf.domain;
    html+=`<div style="flex:1;min-width:150px;text-align:center;padding:16px 10px;background:var(--s2);border-radius:12px;border:1px solid var(--b1)">
      <div style="font-size:2rem;font-weight:800;color:${scoreColor(d.rate)}">${d.rate}%</div>
      <div style="font-size:.72rem;color:var(--t3);margin-top:3px;font-weight:600">${d.emoji} ${escHTML(d.name)} Score</div>
      <div style="font-size:.68rem;color:var(--t4);margin-top:4px">${d.verified}/${d.total} verified${d.psName?' · '+escHTML(d.psName):''}</div>
    </div>`;
  } else {
    html+=`<div style="flex:1;min-width:150px;padding:16px 10px;background:var(--s2);border-radius:12px;border:1px solid var(--b1);display:flex;align-items:center;justify-content:center;text-align:center">
      <div style="font-size:.78rem;color:var(--t3)">Not assigned to a project yet</div>
    </div>`;
  }
  html+='</div></div>';
  return html;
}

/* ── carry-over ── (NO auto carry — TL/Captain must approve) ──
   Overdue pending tasks are flagged with status 'overdue_pending'.
   They will NOT move to next day unless TL/Captain explicitly approves
   via the carry-over panel (with optional task text edit).             */
async function processCarryOvers(){
  // Mark tasks that missed their deadline as 'overdue_pending' so the UI
  // can surface them for TL/Captain action — NO silent auto carry-over.
  const tk=todayKey();
  const ops=[];
  dailyTasks.forEach(t=>{
    if(t.status==='pending'&&t.dueDate<tk){
      t.status='overdue_pending';
      ops.push(t);
    }
  });
  for(const t of ops) await saveDoc('dailyTasks',t);
}

/* ════ STATE ════ */
let dtFilter='today';
let dtExpandedDomain={};
let dtActivePanel=null; // {type, taskId, element} — for inline action panels

/* ════ MAIN RENDER ════ */
async function renderTasks(){
  if(!CU)return;
  const body=document.getElementById('tasks-body');
  body.innerHTML=`<div style="color:var(--t3);font-size:.85rem;padding:24px 0;text-align:center">⏳ Loading tasks…</div>`;
  await reloadData();
  await processCarryOvers();

  const tk=todayKey();
  const isCap=isCaptainOrVice();
  const isTL=isTeamLeader();

  // Pending verifications (TL needs to act) — covers ALL domains the TL manages
  const myTLDoms = myDomainsAsTL(); // [] for non-TLs, 1+ entries for multi-domain TLs
  const myDom = myTLDoms.length===1 ? myTLDoms[0] : (myTLDoms.length>1 ? myTLDoms[0] : null); // first domain (legacy compat)
  const pendingVerify=isTL&&myTLDoms.length
    ?dailyTasks.filter(t=>myTLDoms.some(d=>d.id===t.domainId)&&t.status==='submitted').length
    :0;
  const pendingExcuses=isTL&&myTLDoms.length
    ?dailyTasks.filter(t=>myTLDoms.some(d=>d.id===t.domainId)&&t.status==='excused'&&!t.tlNote).length
    :0;

  // My pending tasks (member view)
  const myPending=(!isCap&&!isTL)
    ?dailyTasks.filter(t=>sid(t.memberId)===sid(CU.id)&&t.assignedDate===tk&&t.status==='pending').length
    :0;

  // Overdue tasks needing TL/Captain decision
  const overdueNeedDecision=(isCap||isTL)
    ?dailyTasks.filter(t=>{
        if(t.status!=='overdue_pending')return false;
        if(isCap)return true;
        // Multi-domain TL: check all their domains
        return myTLDoms.some(d=>d.id===t.domainId);
      }).length
    :0;

  const todayAll=dailyTasks.filter(t=>t.assignedDate===tk&&t.status!=='removed');
  const verifiedToday=todayAll.filter(t=>t.status==='verified').length;
  const overdueToday=todayAll.filter(t=>t.status==='overdue_pending').length;
  const myTasks=dailyTasks.filter(t=>sid(t.memberId)===sid(CU.id)&&t.assignedDate===tk&&t.status!=='removed');

  let html=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
    <div style="font-size:.72rem;color:var(--t3);font-family:var(--mono)">Daily Tasks · ${dateLabel(tk)}</div>
    ${isCaptainOnly()?`<button class="btn btn-d btn-sm" onclick="resetAllTaskData()" style="display:flex;align-items:center;gap:6px">
      <span style="font-size:.9rem">⚠</span> Reset All Task Data
    </button>`:''}
  </div>

  <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:22px">
    <div class="sc"><div class="sc-num" style="color:var(--acc)">${todayAll.length}</div><div class="sc-lbl">Today's Tasks</div></div>
    <div class="sc"><div class="sc-num" style="color:var(--acc5)">${verifiedToday}</div><div class="sc-lbl">Verified</div></div>
    <div class="sc"><div class="sc-num" style="color:var(--acc3)">${overdueToday}</div><div class="sc-lbl">Overdue</div></div>
    <div class="sc"><div class="sc-num" style="color:var(--acc2)">${myTasks.length}</div><div class="sc-lbl">My Tasks</div></div>
  </div>`;

  // ── Alert banners ──
  if(pendingVerify>0){
    html+=`<div class="info-pill" style="margin-bottom:14px;background:rgba(252,211,77,.07);border-color:rgba(252,211,77,.25);color:var(--acc4)">
      ⚡ <strong>${pendingVerify} task${pendingVerify>1?'s':''}</strong> submitted by members — waiting for your verification below.
    </div>`;
  }
  if(pendingExcuses>0){
    html+=`<div class="info-pill" style="margin-bottom:14px;background:rgba(192,132,252,.07);border-color:rgba(192,132,252,.25);color:var(--acc)">
      💬 <strong>${pendingExcuses} excuse${pendingExcuses>1?'s':''}</strong> submitted by members — please review and acknowledge.
    </div>`;
  }
  if(myPending>0){
    html+=`<div class="info-pill" style="margin-bottom:14px;background:rgba(129,140,248,.07);border-color:rgba(129,140,248,.25);color:var(--acc2)">
      📋 You have <strong>${myPending} pending task${myPending>1?'s':''}</strong> due today. Mark complete or report if unable.
    </div>`;
  }
  if(overdueNeedDecision>0){
    html+=`<div class="info-pill" style="margin-bottom:14px;background:rgba(252,211,77,.07);border-color:rgba(252,211,77,.3);color:var(--acc4)">
      ⏰ <strong>${overdueNeedDecision} overdue task${overdueNeedDecision>1?'s':''}</strong> missed their deadline. As TL/Captain, you must decide: carry each to the next day (with optional extra work) or remove it.
    </div>`;
  }

  // ── MY TASKS card ──
  html+=buildMyTasksCard(tk);

  // ── DOMAIN VIEW (task list — shown first for all roles) ──
  html+=`<div class="card" style="margin-bottom:18px">
    <div class="ct" style="flex-wrap:wrap;gap:8px"><span class="cd" style="background:var(--acc3)"></span>Tasks by Domain
      ${pendingVerify+pendingExcuses>0?`<span class="dt-notify-dot"></span>`:''}
      ${isCap?`<button class="btn btn-acc2 btn-xs" style="margin-left:auto" onclick="toggleDomainSummary()">📊 Domain Summary</button>`:''}
    </div>
    ${isCap?`<div id="dt-domain-summary" style="display:none;margin-bottom:16px"></div>`:''}
    <div class="dt-filter-bar">
      <button class="dt-filter-btn ${dtFilter==='today'?'active':''}" onclick="setDtFilter('today')">Today</button>
      <button class="dt-filter-btn ${dtFilter==='all'?'active':''}" onclick="setDtFilter('all')">All Time</button>
      <button class="dt-filter-btn ${dtFilter==='pending'?'active':''}" onclick="setDtFilter('pending')">Pending</button>
      <button class="dt-filter-btn ${dtFilter==='submitted'?'active':''}" onclick="setDtFilter('submitted')">Needs Verify${pendingVerify>0?` (${pendingVerify})`:''}</button>
      <button class="dt-filter-btn ${dtFilter==='verified'?'active':''}" onclick="setDtFilter('verified')">Verified</button>
      <button class="dt-filter-btn ${dtFilter==='overdue_pending'?'active':''}" onclick="setDtFilter('overdue_pending')">Overdue${overdueNeedDecision>0?` (${overdueNeedDecision})`:''}</button>
    </div>
    <div id="dt-domain-list">${renderDomainList()}</div>
  </div>`;

  // ── ASSIGN TASK (TL or captain — both get full domain access) ──
  if(canManageTasks()){
    html+=buildAssignCard(isCap||isTL,myDom);
  }

  // ── DOMAIN SETUP (captain only) ──
  if(isCaptainOnly()){
    html+=buildDomainSetupCard();
  }

  // ── HISTORY ──
  if(isCaptainOnly()||isTL){
    // For multi-domain TLs: collect members from ALL their domains (de-duped)
    const allTLDomains = myDomainsAsTL();
    const tlMemberIds = [...new Set(allTLDomains.flatMap(d=>d.memberIds||[]))];
    const histMembers=isCaptainOnly()
      ? members
      : tlMemberIds.map(mid=>members.find(m=>sid(m.id)===sid(mid))).filter(Boolean);

    if(isCaptainOnly()){
      // Captain: show picker to choose any member
      html+=`<div class="card">
        <div class="ct"><span class="cd" style="background:var(--t3)"></span>Member Task History
          <span style="margin-left:6px;font-size:.68rem;color:var(--acc3);font-weight:600">🗑 Full audit — removal reasons visible</span>
          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
            <select id="dt-hist-member" onchange="renderTaskHistory()" style="background:var(--s2);border:1px solid var(--b2);border-radius:6px;color:var(--t1);font-family:var(--font);font-size:.78rem;padding:4px 8px;outline:none;max-width:160px">
              <option value="">— Pick Member —</option>
              ${histMembers.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
            <button class="btn btn-d btn-xs" onclick="clearMemberHistory()" title="Delete all task history for selected member">🗑 Clear History</button>
          </div>
        </div>
        <div id="dt-history-body">${emptyState('📋','Select a member to see their full history')}</div>
      </div>`;
    } else {
      // TL: auto-load their own history + show domain members picker below
      html+=`<div class="card">
        <div class="ct"><span class="cd" style="background:var(--t3)"></span>Task History
          <span style="margin-left:6px;font-size:.68rem;color:var(--acc3);font-weight:600">🗑 Full audit — removal reasons visible</span>
          ${histMembers.length?`<div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
            <select id="dt-hist-member" onchange="renderTaskHistory()" style="background:var(--s2);border:1px solid var(--b2);border-radius:6px;color:var(--t1);font-family:var(--font);font-size:.78rem;padding:4px 8px;outline:none;max-width:160px">
              <option value="${CU.id}" selected>${CU.name} (me)</option>
              ${histMembers.filter(m=>sid(m.id)!==sid(CU.id)).map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
            <button class="btn btn-d btn-xs" onclick="clearMemberHistory()" title="Delete history for selected member">🗑 Clear</button>
          </div>`:''}
        </div>
        <div id="dt-history-body">${buildMemberHistory(CU.id, true)}</div>
      </div>`;
    }
  } else {
    // Regular member: auto-load their own history, removed tasks shown (no reason)
    html+=`<div class="card">
      <div class="ct"><span class="cd" style="background:var(--t3)"></span>My Task History</div>
      <div id="dt-history-body">${buildMemberHistory(CU.id, false)}</div>
    </div>`;
  }

  body.innerHTML=html;
}

/* ── My Tasks card ── */
function buildMyTasksCard(tk){
  // Members never see removed or carried tasks — carried ones are history, the new carried-over task is what the member acts on
  const myTasks=dailyTasks.filter(t=>sid(t.memberId)===sid(CU.id)&&t.assignedDate===tk&&t.status!=='removed'&&t.status!=='carried');
  const done=myTasks.filter(t=>['submitted','verified'].includes(t.status)).length;
  const overdueTasks=myTasks.filter(t=>t.status==='overdue_pending').length;
  const pct=myTasks.length?Math.round(done/myTasks.length*100):0;

  let h=`<div class="card" style="margin-bottom:18px">
    <div class="ct"><span class="cd" style="background:var(--acc2)"></span>My Tasks Today
      <span style="margin-left:auto;font-size:.72rem;color:var(--t3)">Due 8 PM · ${dateLabel(tk)}</span>
    </div>`;

  if(!myTasks.length){
    h+=`<div class="empty-state" style="padding:18px 0"><span class="ei">✅</span><p>No tasks assigned to you today.</p></div>`;
  } else {
    h+=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:.78rem;color:var(--t2)">${done}/${myTasks.length} done${overdueTasks?` · <span style="color:var(--acc3)">⏰ ${overdueTasks} awaiting TL decision</span>`:''}
      </span>
      <div class="dt-progress-bar" style="flex:1"><div class="dt-progress-fill" style="width:${pct}%"></div></div>
      <span style="font-size:.78rem;font-weight:700;color:var(--acc)">${pct}%</span>
    </div>`;
    const sorted=[...myTasks].sort((a,b)=>{
      const o={pending:0,overdue_pending:1,carried:2,submitted:3,excused:4,verified:5};
      return (o[a.status]||0)-(o[b.status]||0);
    });
    sorted.forEach(t=>{
      h+=renderTaskItem(t,{myView:true});
    });
  }
  h+=`</div>`;
  return h;
}

/* ── Domain Setup card (captain only) ── */
function buildDomainSetupCard(){
  const tls=members.filter(m=>m.role==='team_leader'||m.role==='captain'||m.role==='vice');
  // Same pool as "Assign To": all members including captain & vice
  const nonLeaders=members;

  let h=`<div class="card" style="margin-bottom:18px">
    <div class="ct"><span class="cd" style="background:var(--acc4)"></span>Domain Setup
      <span style="margin-left:auto;font-size:.72rem;color:var(--t3)">Captain only — define problem-statement domains</span>
    </div>`;

  // Existing domains
  if(domains.length){
    domains.forEach(dom=>{
      const tl=members.find(m=>sid(m.id)===sid(dom.tlId));
      const tlC=tl?dc(tl.dept):'#94a3b8';
      const domMembers=(dom.memberIds||[]).map(mid=>members.find(m=>sid(m.id)===sid(mid))).filter(Boolean);
      h+=`<div class="dt-setup-card" style="border-color:var(--b2)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="flex:1">
            <div style="font-weight:700;font-size:.95rem">${escHTML(dom.name)}</div>
            <div style="font-size:.72rem;color:var(--t3);margin-top:2px">PS: ${escHTML(dom.psName||'—')} · ${domMembers.length} member${domMembers.length!==1?'s':''}</div>
          </div>
          <button class="btn btn-d btn-xs" onclick="deleteDomain('${dom.id}')">🗑 Delete</button>
        </div>
        <div class="dt-tl-banner" style="margin-bottom:10px">
          <div class="dt-tl-av" style="background:${tlC}18;color:${tlC};border:1.5px solid ${tlC}38">${tl?ini(tl.name):'?'}</div>
          <div class="dt-tl-info"><div class="dt-tl-label">Team Leader</div><div class="dt-tl-name">${tl?tl.name:'Not assigned'}</div></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${domMembers.map(m=>{const c=dc(m.dept);return `<span class="dt-domain-pill" style="border-color:${c}30;color:${c}">
            <span style="width:18px;height:18px;border-radius:50%;background:${c}18;display:inline-flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700">${ini(m.name)}</span>
            ${m.name}
            <button onclick="removeMemberFromDomain('${dom.id}','${m.id}')">×</button>
          </span>`}).join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="dom-add-mem-${dom.id}" style="background:var(--s2);border:1px solid var(--b2);border-radius:6px;color:var(--t1);font-family:var(--font);font-size:.8rem;padding:5px 8px;outline:none;flex:1;min-width:120px">
            <option value="">+ Add member</option>
            ${members.filter(m=>!(dom.memberIds||[]).some(mid=>sid(mid)===sid(m.id))&&sid(m.id)!==sid(dom.tlId)).map(m=>`<option value="${m.id}">${m.name} (${ROLES[m.role]})</option>`).join('')}
          </select>
          <button class="btn btn-s btn-xs" onclick="addMemberToDomain('${dom.id}')">Add</button>
        </div>
      </div>`;
    });
  }

  // Create new domain form
  h+=`<div class="dt-setup-card">
    <div class="ct" style="margin-bottom:12px"><span class="cd" style="background:var(--acc)"></span>Create New Domain</div>
    <div class="fg">
      <div class="field"><label>Domain Name *</label><input id="dom-name" placeholder="e.g. Smart Agriculture"></div>
      <div class="field"><label>Problem Statement</label><input id="dom-ps" placeholder="PS title or code"></div>
      <div class="field"><label>Team Leader *</label>
        <select id="dom-tl">
          <option value="">— Select Team Leader —</option>
          ${nonLeaders.map(m=>`<option value="${m.id}">${m.name} (${ROLES[m.role]})</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="act">
      <button class="btn btn-p btn-sm" onclick="createDomain()">➕ Create Domain</button>
    </div>
  </div>`;

  h+=`</div>`;
  return h;
}

/* ── Assign Task card ── */
function buildAssignCard(isCap,myDom){
  const isTLOnly = isTeamLeader() && !isCaptainOrVice(); // pure TL, not captain
  const isTL = isTeamLeader();
  const isCapOrTL = isCap || isTL;
  if(!isCapOrTL) return '';

  // Captain sees all domains; TL sees all domains they are assigned to (supports multi-domain TLs)
  const myTLDomains = myDomainsAsTL(); // all domains where CU is TL
  const assignableDomains = isTLOnly ? myTLDomains : domains;

  if(!assignableDomains.length){
    return `<div class="card" style="margin-bottom:18px">
      <div class="ct"><span class="cd" style="background:var(--acc4)"></span>Assign Task</div>
      <div class="info-pill" style="margin-bottom:0">⚠ ${isCap ? 'No domains created yet — create a domain above first.' : 'You are not assigned as a Team Leader to any domain yet.'}</div>
    </div>`;
  }

  // Auto-select domain only when TL has exactly one domain assigned
  const autoSelectDomain = (isTLOnly && assignableDomains.length === 1) ? assignableDomains[0].id : '';

  // Pre-load members: if single-domain TL (auto-selected), populate immediately; otherwise blank prompt
  let initialMemberOptions = '';
  if(autoSelectDomain){
    const domMs = (assignableDomains[0].memberIds||[]).map(mid=>members.find(m=>sid(m.id)===sid(mid))).filter(Boolean);
    initialMemberOptions = `<option value="">— Select Member —</option>`
      + domMs.map(m=>`<option value="${m.id}">${m.name} (${ROLES[m.role]})</option>`).join('')
      + (domMs.length ? `<option value="all_domain">📌 All in Domain</option>` : '');
  } else {
    // Captain or multi-domain TL: add a blank first option so no domain is silently pre-selected
    initialMemberOptions = `<option value="">— Select Domain first —</option>`;
  }

  // Domain select options: prepend blank placeholder when multiple domains (Captain / multi-domain TL)
  const domainOptions = (assignableDomains.length > 1 ? `<option value="">— Select Domain —</option>` : '')
    + assignableDomains.map(d=>`<option value="${d.id}" ${d.id===autoSelectDomain?'selected':''}>${d.emoji||'📁'} ${d.name}</option>`).join('');

  return `<div class="card" style="margin-bottom:18px">
    <div class="ct"><span class="cd" style="background:var(--acc4)"></span>Assign Daily Task
      <span class="dt-deadline-pill" style="margin-left:auto">🕖 Due ${dateLabel(tomorrowKey())} 8 PM</span>
    </div>
    <div class="fg">
      <div class="field"><label>Domain *</label>
        <select id="dt-domain-sel" onchange="refreshAssignMembers()" ${autoSelectDomain ? `style="pointer-events:none;opacity:.7"` : ''}>
          ${domainOptions}
        </select>
      </div>
      <div class="field"><label>Assign To *</label>
        <select id="dt-member-sel">
          ${initialMemberOptions}
        </select>
      </div>
      <div class="field full">
        <label>Task Description *</label>
        <textarea id="dt-task-text" placeholder="Describe the task clearly — e.g. 'Research 3 existing solutions and write a 200-word summary'" style="min-height:72px"></textarea>
      </div>
    </div>
    <div class="act">
      <button class="btn btn-p" onclick="assignTask()">✅ Assign Task</button>
    </div>
  </div>`;
}

function refreshAssignMembers(){
  const domId = document.getElementById('dt-domain-sel')?.value;
  const sel = document.getElementById('dt-member-sel');
  if(!sel) return;
  if(!domId){ sel.innerHTML = `<option value="">— Select Domain first —</option>`; return; }
  const dom = domains.find(d => String(d.id) === String(domId));
  if(!dom){ sel.innerHTML = `<option value="">— Select Domain first —</option>`; return; }

  const domMs = (dom.memberIds||[]).map(mid => members.find(m => sid(m.id) === sid(mid))).filter(Boolean);

  // Only show members actually in this domain
  let ms = [...domMs];

  sel.innerHTML = `<option value="">— Select Member —</option>`
    + ms.map(m => `<option value="${m.id}">${m.name} (${ROLES[m.role]})</option>`).join('')
    + (ms.length ? `<option value="all_domain">📌 All in Domain</option>` : '');
}

/* ── Domain List (with task rows) ── */
function renderDomainList(){
  const tk=todayKey();
  // Removed and carried tasks are never shown on the board — only in TL/Captain history
  const nonRemoved=dailyTasks.filter(t=>t.status!=='removed'&&t.status!=='carried');
  let filtered=nonRemoved;
  if(dtFilter==='today')          filtered=nonRemoved.filter(t=>t.assignedDate===tk);
  else if(dtFilter==='pending')   filtered=nonRemoved.filter(t=>t.status==='pending');
  else if(dtFilter==='submitted') filtered=nonRemoved.filter(t=>t.status==='submitted');
  else if(dtFilter==='verified')  filtered=nonRemoved.filter(t=>t.status==='verified');
  else if(dtFilter==='overdue_pending') filtered=nonRemoved.filter(t=>t.status==='overdue_pending');

  // For non-captain/non-TL: only show their domain
  const isCap=isCaptainOrVice();
  const isTL=isTeamLeader();
  const visibleDomains=isCap?domains:domains.filter(d=>
    sid(d.tlId)===sid(CU.id)||(d.memberIds||[]).some(mid=>sid(mid)===sid(CU.id))
  );

  if(!visibleDomains.length){
    return emptyState('📁','No domains set up yet. Captain needs to create domains first.');
  }

  let html='';
  visibleDomains.forEach(dom=>{
    const domTasks=filtered.filter(t=>t.domainId===dom.id);
    const tl=members.find(m=>sid(m.id)===sid(dom.tlId));
    const tlC=tl?dc(tl.dept):'#fcd34d';
    const isOpen=dtExpandedDomain[dom.id]!==false;

    const totalCount=domTasks.length;
    const verCount=domTasks.filter(t=>t.status==='verified').length;
    const submCount=domTasks.filter(t=>t.status==='submitted').length;
    const overdueCount=domTasks.filter(t=>t.status==='overdue_pending').length;
    const pct=totalCount?Math.round(verCount/totalCount*100):0;

    // Group tasks by member
    const memberMap={};
    domTasks.forEach(t=>{
      if(!memberMap[t.memberId])memberMap[t.memberId]={name:t.memberName,tasks:[]};
      memberMap[t.memberId].tasks.push(t);
    });

    html+=`<div class="dt-domain-card">
      <div class="dt-domain-header" onclick="toggleDomain('${dom.id}')">
        <div class="dt-domain-info">
          <div class="dt-domain-name">${escHTML(dom.name)}</div>
          <div class="dt-domain-sub">
            <span>${escHTML(dom.psName||'No PS set')}</span>
            <span style="color:var(--acc5)">${verCount} verified</span>
            ${submCount?`<span style="color:var(--acc4)">${submCount} needs verify</span>`:''}
            ${overdueCount?`<span style="color:var(--acc3)">⏰ ${overdueCount} overdue</span>`:''}
            <span style="color:var(--t4)">${totalCount} total</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="dt-tl-av" style="width:28px;height:28px;font-size:.65rem;background:${tlC}18;color:${tlC};border:1.5px solid ${tlC}38">${tl?ini(tl.name):'?'}</div>
          <span class="dt-domain-caret" id="dt-dcaret-${dom.id}" style="transform:rotate(${isOpen?90:0}deg)">▶</span>
        </div>
      </div>
      <div class="dt-domain-body ${isOpen?'open':''}" id="dt-dombody-${dom.id}">
        <div class="dt-tl-banner">
          <div class="dt-tl-av" style="background:${tlC}18;color:${tlC};border:1.5px solid ${tlC}38">${tl?ini(tl.name):'?'}</div>
          <div class="dt-tl-info"><div class="dt-tl-label">👑 Team Leader</div><div class="dt-tl-name">${tl?tl.name:'Not assigned'}</div></div>
          ${pct>0?`<div style="text-align:right;flex-shrink:0">
            <div style="font-size:.82rem;font-weight:700;color:var(--acc5)">${pct}%</div>
            <div style="font-size:.65rem;color:var(--t3)">verified</div>
          </div>`:''}
        </div>
        ${Object.keys(memberMap).length
          ?Object.entries(memberMap).map(([mid,mr])=>renderMemberBlock(mid,mr,dom)).join('')
          :`<div class="empty-state" style="padding:14px 0"><span class="ei">📋</span><p>No tasks ${dtFilter==='today'?'assigned today':'matching this filter'}.</p></div>`
        }
      </div>
    </div>`;
  });
  return html;
}

function renderMemberBlock(mid,mr,dom){
  const m=members.find(x=>sid(x.id)===sid(mid));
  const c=m?dc(m.dept):'#94a3b8';
  const isTLofDom=CU&&(sid(dom.tlId)===sid(CU.id)||isTeamLeader());
  const isCap=isCaptainOrVice();
  const done=mr.tasks.filter(t=>t.status==='verified').length;

  const sorted=[...mr.tasks].sort((a,b)=>{
    const o={pending:0,overdue_pending:1,carried:2,submitted:3,excused:4,verified:5};
    return (o[a.status]||0)-(o[b.status]||0);
  });

  let h=`<div class="dt-member-row">
    <div class="dt-mr-top">
      <div class="av" style="width:34px;height:34px;font-size:.8rem;background:${c}18;color:${c};border:1.5px solid ${c}38;flex-shrink:0">${ini(mr.name)}</div>
      <div class="dt-mr-info">
        <div class="dt-mr-name">${mr.name}${m&&CU&&sid(m.id)===sid(CU.id)?' <span style="font-size:.64rem;color:var(--acc)">(you)</span>':''}</div>
        <div class="dt-mr-meta">${done}/${mr.tasks.length} verified · ${m?ROLES[m.role]:'Member'}</div>
      </div>
    </div>
    <div class="dt-tasks-wrap">`;

  sorted.forEach(t=>{
    h+=renderTaskItem(t,{domainView:true,isTLofDom,isCap});
  });

  // Inline add-task (TL or captain)
  if(isTLofDom||isCap){
    h+=`<div class="dt-add-task-row">
      <input id="dt-sub-${dom.id}-${mid}" placeholder="Add task for ${mr.name}…" onkeydown="if(event.key==='Enter')addSubTask('${dom.id}','${mid}')">
      <button class="btn btn-s btn-xs" onclick="addSubTask('${dom.id}','${mid}')">+ Add</button>
    </div>`;
  }
  h+=`</div></div>`;
  return h;
}

/* ── Single Task Item renderer ── */
function renderTaskItem(t, {myView=false,domainView=false,isTLofDom=false,isCap=false}={}){
  const st=t.status;
  const over=isTaskOverdue(t);
  const isMyTask=CU&&sid(t.memberId)===sid(CU.id);
  const canMemberAct=isMyTask&&['pending','carried'].includes(st);
  const canTLVerify=(isTLofDom||isCap)&&st==='submitted';
  const canTLRemove=(isTLofDom||isCap)&&!['verified'].includes(st);
  const canTLAckExcuse=(isTLofDom||isCap)&&st==='excused'&&!t.tlNote;
  const canTLCarryOver=(isTLofDom||isCap)&&st==='overdue_pending';

  // Checkbox appearance
  let cbClass='';
  let cbContent='';
  if(st==='verified'){cbClass='verified';cbContent='✓';}
  else if(st==='submitted'){cbClass='submitted';cbContent='◑';}
  else if(st==='overdue_pending'){cbClass='removed';cbContent='!';}
  else if(st==='excused'){cbClass='excused';cbContent='!';}

  // Status tag
  const tagMap={
    pending:'dt-tag-pending',submitted:'dt-tag-submitted',verified:'dt-tag-verified',
    carried:'dt-tag-carried',overdue_pending:'dt-tag-overdue',excused:'dt-tag-excused'
  };
  const tagLabel={
    pending:'Pending',submitted:'Submitted — Needs Verify',verified:'✓ Verified',
    carried:'Carried Over',overdue_pending:'⚠ Overdue — Awaiting TL Decision',excused:'Excuse Pending'
  };

  let h=`<div class="dt-task-item status-${st==='overdue_pending'?'overdue':st}" id="dt-ti-${t.id}">
    <div class="dt-task-cb ${cbClass}" ${canMemberAct?`onclick="memberSubmitDone('${t.id}')" title="Mark as completed"`:'style="cursor:default"'}>${cbContent}</div>
    <div class="dt-task-body">
      <div class="dt-task-text">${escHTML(t.text)}</div>
      <div class="dt-task-meta">
        <span class="dt-task-tag ${tagMap[st]||'dt-tag-pending'}">${tagLabel[st]||st}</span>
        ${t.carriedFromId&&st!=='carried'?`<span class="dt-task-tag dt-tag-carried">↩ Carried</span>`:''}
        ${over&&!['verified','excused','overdue_pending'].includes(st)?`<span class="dt-task-tag dt-tag-overdue">⚠ Overdue</span>`:''}
        <span>Due: ${dateLabel(t.dueDate)} 8PM</span>
        ${t.assignedBy?`<span>By: ${t.assignedBy}</span>`:''}
        ${t.verifiedAt?`<span style="color:var(--acc5)">✓ ${t.verifiedAt}</span>`:''}
      </div>
      ${t.excuseReason?`<div class="dt-task-reason reason-excuse">💬 Member: "${escHTML(t.excuseReason)}"${t.tlNote?`<br><span style="color:var(--acc5)">✓ TL: "${escHTML(t.tlNote)}"</span>`:''}</div>`:''}
      ${t.memberNote&&st==='submitted'?`<div class="dt-task-reason" style="border-left-color:var(--acc2);color:var(--acc2)">📝 Note: "${escHTML(t.memberNote)}"</div>`:''}
      ${st==='overdue_pending'?`<div class="dt-task-reason" style="border-left-color:var(--acc3);color:var(--acc3)">⏰ This task was not completed on time. TL or Captain must decide: carry it to the next day (with any changes) or dismiss it.</div>`:''}

      <!-- Action buttons -->
      <div class="dt-task-actions">
        ${canMemberAct?`<button class="btn btn-p btn-xs" onclick="memberSubmitDone('${t.id}')">✓ Mark Complete</button>
          <button class="btn btn-xs" style="background:rgba(192,132,252,.1);color:var(--acc);border:1px solid rgba(192,132,252,.25)" onclick="showExcusePanel('${t.id}')">💬 Can't Complete</button>`:''}
        ${canTLVerify?`<button class="btn btn-p btn-xs" style="background:linear-gradient(135deg,var(--acc5),var(--acc2));color:#07050f" onclick="tlVerifyTask('${t.id}')">✅ Verify Complete</button>
          <button class="btn btn-xs" style="background:rgba(129,140,248,.1);color:var(--acc2);border:1px solid rgba(129,140,248,.25)" onclick="tlUnsubmitTask('${t.id}')">↩ Send Back</button>`:''}
        ${canTLAckExcuse?`<button class="btn btn-xs" style="background:rgba(192,132,252,.1);color:var(--acc);border:1px solid rgba(192,132,252,.25)" onclick="showTLAckPanel('${t.id}')">💬 Acknowledge Excuse</button>`:''}
        ${canTLCarryOver?`<button class="btn btn-xs" style="background:rgba(252,211,77,.1);color:var(--acc4);border:1px solid rgba(252,211,77,.25)" onclick="showCarryOverPanel('${t.id}')">↩ Carry to Next Day</button>`:''}
        ${canTLRemove?`<button class="btn btn-d btn-xs" onclick="showRemovePanel('${t.id}')">🗑 Remove</button>`:''}
      </div>
      <!-- Inline panels (injected dynamically) -->
      <div id="dt-panel-${t.id}"></div>
    </div>
  </div>`;
  return h;
}

/* ── Toggle domain collapse ── */
function toggleDomain(domId){
  dtExpandedDomain[domId]=dtExpandedDomain[domId]===false?true:false;
  const body=document.getElementById('dt-dombody-'+domId);
  const caret=document.getElementById('dt-dcaret-'+domId);
  const isOpen=dtExpandedDomain[domId]!==false;
  if(body)body.classList.toggle('open',isOpen);
  if(caret)caret.style.transform=`rotate(${isOpen?90:0}deg)`;
}

function setDtFilter(f){
  dtFilter=f;
  const list=document.getElementById('dt-domain-list');
  if(list)list.innerHTML=renderDomainList();
  document.querySelectorAll('.dt-filter-btn').forEach(b=>{
    b.classList.remove('active');
  });
  // Re-apply active
  document.querySelectorAll('.dt-filter-btn').forEach(b=>{
    const lbl=b.textContent.toLowerCase();
    if(f==='today'&&lbl.startsWith('today')) b.classList.add('active');
    else if(f==='all'&&lbl.startsWith('all')) b.classList.add('active');
    else if(f==='pending'&&lbl.startsWith('pending')) b.classList.add('active');
    else if(f==='submitted'&&lbl.startsWith('needs')) b.classList.add('active');
    else if(f==='verified'&&lbl.startsWith('verified')) b.classList.add('active');
    else if(f==='overdue_pending'&&lbl.startsWith('overdue')) b.classList.add('active');
  });
}

/* ── Domain Summary (Captain only) ── */
let _domSummaryOpen = false;
function toggleDomainSummary(){
  const panel = document.getElementById('dt-domain-summary');
  if(!panel) return;
  _domSummaryOpen = !_domSummaryOpen;
  if(_domSummaryOpen){
    panel.style.display = 'block';
    panel.innerHTML = renderDomainSummaryHTML();
  } else {
    panel.style.display = 'none';
    panel.innerHTML = '';
  }
}

function renderDomainSummaryHTML(){
  if(!domains.length) return `<div class="info-pill" style="margin-bottom:0">No domains created yet.</div>`;
  const tk = todayKey();

  // Domain filter select
  let sel = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--t2)">Filter Domain:</label>
    <select id="dt-summary-domain-sel" onchange="renderSummaryForDomain()" style="background:var(--s2);border:1px solid var(--b2);border-radius:var(--r8);color:var(--t1);font-family:var(--font);font-size:.85rem;padding:7px 12px;outline:none;min-width:200px">
      <option value="all">All Domains</option>
      ${domains.map(d=>`<option value="${d.id}">${d.emoji||'📁'} ${escHTML(d.name)}</option>`).join('')}
    </select>
    <select id="dt-summary-date-sel" onchange="renderSummaryForDomain()" style="background:var(--s2);border:1px solid var(--b2);border-radius:var(--r8);color:var(--t1);font-family:var(--font);font-size:.85rem;padding:7px 12px;outline:none;min-width:140px">
      <option value="today">Today</option>
      <option value="all">All Time</option>
    </select>
  </div>
  <div id="dt-summary-content">${buildSummaryContent('all','today')}</div>`;
  return `<div style="background:var(--s2);border:1px solid var(--b2);border-radius:var(--r);padding:18px;animation:fadeIn .2s ease">${sel}</div>`;
}

function renderSummaryForDomain(){
  const domSel = document.getElementById('dt-summary-domain-sel');
  const dateSel = document.getElementById('dt-summary-date-sel');
  const content = document.getElementById('dt-summary-content');
  if(!domSel||!dateSel||!content) return;
  content.innerHTML = buildSummaryContent(domSel.value, dateSel.value);
}

function buildSummaryContent(domainFilter, dateFilter){
  const tk = todayKey();
  let domsToShow = domainFilter==='all' ? domains : domains.filter(d=>d.id===domainFilter);
  if(!domsToShow.length) return `<div class="empty-state"><span class="ei">📁</span><p>No domain found.</p></div>`;

  let html = '';
  domsToShow.forEach(dom=>{
    let tasks = dailyTasks.filter(t=>t.domainId===dom.id && t.status!=='removed');
    if(dateFilter==='today') tasks = tasks.filter(t=>t.assignedDate===tk);

    const total   = tasks.length;
    const pending = tasks.filter(t=>['pending','carried'].includes(t.status)).length;
    const submitted = tasks.filter(t=>t.status==='submitted').length;
    const verified  = tasks.filter(t=>t.status==='verified').length;
    const overdue   = tasks.filter(t=>t.status==='overdue_pending').length;
    const excused   = tasks.filter(t=>t.status==='excused').length;
    const pct = total ? Math.round(verified/total*100) : 0;

    const tl = members.find(m=>sid(m.id)===sid(dom.tlId));
    const tlC = tl ? dc(tl.dept) : '#fcd34d';

    // Member breakdown
    const memberMap = {};
    tasks.forEach(t=>{
      if(!memberMap[t.memberId]) memberMap[t.memberId]={name:t.memberName, total:0, verified:0, pending:0, submitted:0, overdue:0};
      memberMap[t.memberId].total++;
      if(t.status==='verified') memberMap[t.memberId].verified++;
      else if(t.status==='submitted') memberMap[t.memberId].submitted++;
      else if(t.status==='overdue_pending') memberMap[t.memberId].overdue++;
      else if(['pending','carried'].includes(t.status)) memberMap[t.memberId].pending++;
    });

    html += `<div style="background:var(--s1);border:1px solid var(--b1);border-radius:var(--r);padding:16px;margin-bottom:14px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;width:${pct}%;height:3px;background:linear-gradient(90deg,var(--acc5),var(--acc2));transition:width .5s ease"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div style="font-weight:800;font-size:.95rem">${dom.emoji||'📁'} ${escHTML(dom.name)}</div>
        <div class="dt-tl-av" style="width:24px;height:24px;font-size:.6rem;background:${tlC}18;color:${tlC};border:1.5px solid ${tlC}38">${tl?ini(tl.name):'?'}</div>
        <div style="font-size:.74rem;color:var(--t3)">${tl?tl.name:'No TL'}</div>
        <div style="margin-left:auto;font-size:1.1rem;font-weight:900;color:${pct===100?'var(--acc5)':'var(--acc2)'};font-family:var(--mono)">${pct}%</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--acc)">${total}</div>
          <div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:3px">Total</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--acc5)">${verified}</div>
          <div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:3px">Verified</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--acc4)">${submitted}</div>
          <div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:3px">Submitted</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--acc2)">${pending}</div>
          <div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:3px">Pending</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--acc3)">${overdue}</div>
          <div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:3px">Overdue</div>
        </div>
      </div>
      ${Object.keys(memberMap).length ? `<div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:8px">Member Breakdown</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${Object.entries(memberMap).map(([mid,mr])=>{
          const mpct = mr.total ? Math.round(mr.verified/mr.total*100) : 0;
          return `<div style="display:flex;align-items:center;gap:8px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:8px 12px">
            <div style="font-size:.84rem;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(mr.name)}</div>
            <div style="display:flex;gap:5px;align-items:center;flex-shrink:0;flex-wrap:wrap">
              ${mr.verified?`<span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(110,231,183,.12);color:var(--acc5);border:1px solid rgba(110,231,183,.25)">✓ ${mr.verified}</span>`:''}
              ${mr.submitted?`<span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(252,211,77,.1);color:var(--acc4);border:1px solid rgba(252,211,77,.22)">◑ ${mr.submitted}</span>`:''}
              ${mr.pending?`<span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(129,140,248,.12);color:var(--acc2);border:1px solid rgba(129,140,248,.25)">• ${mr.pending}</span>`:''}
              ${mr.overdue?`<span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(249,168,212,.1);color:var(--acc3);border:1px solid rgba(249,168,212,.22)">⚠ ${mr.overdue}</span>`:''}
              <span style="font-size:.72rem;font-weight:700;color:${mpct===100?'var(--acc5)':'var(--t3)'};font-family:var(--mono);min-width:32px;text-align:right">${mpct}%</span>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div style="font-size:.8rem;color:var(--t3);font-style:italic">No tasks in this domain for the selected period.</div>`}
    </div>`;
  });
  return html || `<div class="empty-state"><span class="ei">📊</span><p>No task data available.</p></div>`;
}

/* ════ DOMAIN CRUD ════ */
async function createDomain(){
  const name=v('dom-name');const ps=v('dom-ps');const tlId=v('dom-tl');
  if(!name||!tlId){toast('Domain name & Team Leader are required','err');return}

  const tl=members.find(m=>sid(m.id)===sid(tlId));
  if(!tl){toast('Member not found','err');return}

  // Auto-assign team_leader role if not already
  if(tl.role==='member'){
    tl.role='team_leader';
    await saveDoc('members',tl);
    members=members.map(m=>sid(m.id)===sid(tl.id)?tl:m);
    if(CU&&sid(CU.id)===sid(tl.id))CU=tl;
  }

  const dom={id:'dom-'+Date.now(),name,psName:ps,tlId:tl.id,tlName:tl.name,memberIds:[],createdBy:CU.name,createdAt:nowStr()};
  await saveDoc('domains',dom);
  domains.push(dom);
  toast(`✅ Domain "${name}" created with ${tl.name} as Team Leader`);
  renderTasks();
}

async function deleteDomain(domId){
  const dom=domains.find(d=>d.id===domId);
  if(!dom)return;
  const domTaskCount=dailyTasks.filter(t=>t.domainId===domId).length;
  if(!confirm(`Delete domain "${dom.name}"?\n\nThis will permanently delete:\n• The domain\n• All ${domTaskCount} tasks assigned in this domain\n• The full task history for all domain members\n\nThis cannot be undone.`))return;

  // Delete all tasks belonging to this domain from Firestore
  const toDelete=dailyTasks.filter(t=>t.domainId===domId);
  for(const t of toDelete) await delDoc('dailyTasks',String(t.id));
  dailyTasks=dailyTasks.filter(t=>t.domainId!==domId);

  // Delete the domain document
  await delDoc('domains',domId);
  domains=domains.filter(d=>d.id!==domId);

  toast(`✅ Domain "${dom.name}" and all ${toDelete.length} tasks deleted.`);
  renderTasks();
}

async function addMemberToDomain(domId){
  const sel=document.getElementById('dom-add-mem-'+domId);
  if(!sel||!sel.value)return;
  const mid=sel.value;
  const dom=domains.find(d=>d.id===domId);
  if(!dom)return;
  if((dom.memberIds||[]).some(x=>sid(x)===sid(mid))){toast('Member already in this domain','err');return}
  dom.memberIds=[...(dom.memberIds||[]),mid];
  await saveDoc('domains',dom);
  toast('Member added to domain!');
  renderTasks();
}

async function removeMemberFromDomain(domId,mid){
  const dom=domains.find(d=>d.id===domId);
  if(!dom)return;
  dom.memberIds=(dom.memberIds||[]).filter(x=>sid(x)!==sid(mid));
  await saveDoc('domains',dom);
  toast('Member removed from domain.');
  renderTasks();
}

/* ════ TASK CRUD ════ */
async function assignTask(){
  const isCap=isCaptainOrVice();
  const isTL=isTeamLeader();
  const domId=(isCap||isTL)?(document.getElementById('dt-domain-sel')?.value||'')
    :(domains.find(d=>sid(d.tlId)===sid(CU.id))?.id||'');
  const memberVal=v('dt-member-sel');
  const text=v('dt-task-text');
  if(!domId){toast('Select a domain','err');return}
  if(!memberVal){toast('Select a member','err');return}
  if(!text){toast('Enter task description','err');return}
  const dom=domains.find(d=>String(d.id)===String(domId));
  if(!dom){toast('Domain not found','err');return}

  const tk=todayKey();const dk=tomorrowKey();
  let targets=[];
  if(memberVal==='all_domain'){
    // Assign only to members actually in this domain
    const domMs=(dom.memberIds||[]).map(mid=>members.find(m=>sid(m.id)===sid(mid))).filter(Boolean);
    targets=[...domMs];
  } else {
    const m=members.find(m=>sid(m.id)===sid(memberVal));
    if(m)targets=[m];
  }
  if(!targets.length){toast('No members found','err');return}

  let saved=0;
  for(const m of targets){
    const task={
      id:Date.now()+Math.random(),
      domainId:dom.id,domainName:dom.name,
      memberId:m.id,memberName:m.name,
      tlId:dom.tlId,tlName:dom.tlName,
      text,psName:dom.psName||'',
      assignedDate:tk,dueDate:dk,
      assignedBy:CU.name,
      status:'pending',carriedFromId:null,
      memberNote:null,tlNote:null,removedReason:null,excuseReason:null,
      submittedAt:null,verifiedAt:null,removedAt:null
    };
    await saveDoc('dailyTasks',task);
    dailyTasks.push(task);
    saved++;
  }
  toast(`✅ Task assigned to ${saved} member${saved>1?'s':''}`);
  renderTasks();
}

async function addSubTask(domId,mid){
  const inp=document.getElementById(`dt-sub-${domId}-${mid}`);
  if(!inp||!inp.value.trim()){toast('Enter a task','err');return}
  const m=members.find(x=>sid(x.id)===sid(mid));
  const dom=domains.find(d=>d.id===domId);
  if(!m||!dom)return;
  const task={
    id:Date.now()+Math.random(),
    domainId:dom.id,domainName:dom.name,
    memberId:m.id,memberName:m.name,
    tlId:dom.tlId,tlName:dom.tlName,
    text:inp.value.trim(),psName:dom.psName||'',
    assignedDate:todayKey(),dueDate:tomorrowKey(),
    assignedBy:CU.name,
    status:'pending',carriedFromId:null,
    memberNote:null,tlNote:null,removedReason:null,excuseReason:null,
    submittedAt:null,verifiedAt:null,removedAt:null
  };
  await saveDoc('dailyTasks',task);
  dailyTasks.push(task);
  inp.value='';
  toast('Task added!');
  renderTasks();
}

/* ════ MEMBER ACTIONS ════ */
async function memberSubmitDone(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t||!['pending','carried'].includes(t.status))return;
  if(!CU||sid(t.memberId)!==sid(CU.id)){toast('This is not your task','err');return}
  // Show panel for optional note
  const panel=document.getElementById('dt-panel-'+tid);
  if(!panel)return;
  if(panel.innerHTML){panel.innerHTML='';return}
  panel.innerHTML=`<div class="dt-inline-panel">
    <div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--acc2)">✓ Submit as completed</div>
    <textarea id="dt-note-${tid}" placeholder="Optional note to your Team Leader (what you did, any blocker…)"></textarea>
    <div class="act">
      <button class="btn btn-p btn-xs" onclick="confirmSubmitDone('${tid}')">Submit</button>
      <button class="btn btn-s btn-xs" onclick="document.getElementById('dt-panel-${tid}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
}

async function confirmSubmitDone(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const noteEl=document.getElementById('dt-note-'+tid);
  t.status='submitted';
  t.memberNote=noteEl?noteEl.value.trim():null;
  t.submittedAt=nowStr();
  await saveDoc('dailyTasks',t);
  toast('✅ Submitted! Waiting for Team Leader to verify.');
  renderTasks();
}

function showExcusePanel(tid){
  const panel=document.getElementById('dt-panel-'+tid);
  if(!panel)return;
  if(panel.innerHTML){panel.innerHTML='';return}
  panel.innerHTML=`<div class="dt-inline-panel">
    <div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--acc)">💬 Can't Complete — Give Reason</div>
    <textarea id="dt-excuse-${tid}" placeholder="Explain why you cannot complete this task (conflicting PS work, external reason, resource issue…)" required></textarea>
    <div class="act">
      <button class="btn btn-xs" style="background:rgba(192,132,252,.15);color:var(--acc);border:1px solid rgba(192,132,252,.3)" onclick="confirmExcuse('${tid}')">Submit Reason</button>
      <button class="btn btn-s btn-xs" onclick="document.getElementById('dt-panel-${tid}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
}

async function confirmExcuse(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const excEl=document.getElementById('dt-excuse-'+tid);
  const reason=excEl?excEl.value.trim():'';
  if(!reason){toast('Please enter a reason','err');return}
  t.status='excused';
  t.excuseReason=reason;
  await saveDoc('dailyTasks',t);
  toast('Reason submitted. Your Team Leader will review.');
  renderTasks();
}

/* ════ CARRY-OVER APPROVAL (TL / Captain only) ════
   Overdue tasks must be explicitly approved to carry to next day.
   TL/Captain can also edit the task text to add extra work.          */
function showCarryOverPanel(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const panel=document.getElementById('dt-panel-'+tid);
  if(!panel)return;
  if(panel.innerHTML){panel.innerHTML='';return}
  panel.innerHTML=`<div class="dt-inline-panel" style="border-color:rgba(252,211,77,.3);background:rgba(252,211,77,.04)">
    <div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--acc4)">↩ Carry Task to Next Day</div>
    <div style="font-size:.72rem;color:var(--t3);margin-bottom:8px">You can edit the task below to add extra work or clarify expectations before carrying it over.</div>
    <textarea id="dt-carry-text-${tid}" style="margin-bottom:8px" placeholder="Task description (edit to add extra work…)">${escHTML(t.text)}</textarea>
    <div style="font-size:.72rem;color:var(--t3);margin-bottom:8px">Reason for carry-over (required)</div>
    <textarea id="dt-carry-reason-${tid}" placeholder="e.g. 'Member had conflicting PS submission, carrying with additional requirement…'" required></textarea>
    <div class="act">
      <button class="btn btn-xs" style="background:rgba(252,211,77,.15);color:var(--acc4);border:1px solid rgba(252,211,77,.3)" onclick="confirmCarryOver('${tid}')">↩ Confirm Carry to Next Day</button>
      <button class="btn btn-d btn-xs" onclick="showRemovePanel('${tid}');document.getElementById('dt-panel-${tid}').querySelector('.dt-inline-panel:first-child')&&document.getElementById('dt-panel-${tid}').querySelector('.dt-inline-panel:first-child').remove()">🗑 Dismiss Instead</button>
      <button class="btn btn-s btn-xs" onclick="document.getElementById('dt-panel-${tid}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
}

async function confirmCarryOver(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const textEl=document.getElementById('dt-carry-text-'+tid);
  const reasonEl=document.getElementById('dt-carry-reason-'+tid);
  const newText=textEl?textEl.value.trim():t.text;
  const reason=reasonEl?reasonEl.value.trim():'';
  if(!reason){toast('Please provide a reason for the carry-over','err');return}
  if(!newText){toast('Task description cannot be empty','err');return}

  const tk=tomorrowKey();
  const already=dailyTasks.find(x=>x.carriedFromId===String(t.id)&&x.assignedDate===tk);
  if(!already){
    const nt={
      id:Date.now()+Math.random(),
      domainId:t.domainId,domainName:t.domainName,
      memberId:t.memberId,memberName:t.memberName,
      tlId:t.tlId,tlName:t.tlName,
      text:newText,psName:t.psName,
      assignedDate:tk,dueDate:tomorrowKey(),
      assignedBy:CU.name,
      status:'pending',carriedFromId:String(t.id),
      memberNote:null,tlNote:reason,removedReason:null,excuseReason:null,
      submittedAt:null,verifiedAt:null,removedAt:null
    };
    await saveDoc('dailyTasks',nt);
    dailyTasks.push(nt);
  }
  // Mark original as 'carried' (kept in history, not deleted)
  t.status='carried';
  t.tlNote=reason;
  await saveDoc('dailyTasks',t);
  toast('✅ Task carried to next day' + (newText!==t.text?' with updated description':'') + '.');
  renderTasks();
}


async function tlVerifyTask(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t||t.status!=='submitted')return;
  t.status='verified';
  t.verifiedAt=nowStr();
  t.tlNote=t.tlNote||null;
  await saveDoc('dailyTasks',t);
  toast('✅ Task verified as complete!');
  renderTasks();
}

async function tlUnsubmitTask(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  t.status='pending';
  t.submittedAt=null;
  t.memberNote=null;
  await saveDoc('dailyTasks',t);
  toast('Task sent back to pending.');
  renderTasks();
}

function showRemovePanel(tid){
  const panel=document.getElementById('dt-panel-'+tid);
  if(!panel)return;
  if(panel.innerHTML){panel.innerHTML='';return}
  panel.innerHTML=`<div class="dt-inline-panel">
    <div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--acc3)">🗑 Remove Task — Mandatory Reason</div>
    <textarea id="dt-remove-reason-${tid}" placeholder="Reason for removal — e.g. 'Member reassigned to PS-2 submission', 'Task completed via alternate method'…" required></textarea>
    <div class="act">
      <button class="btn btn-d btn-xs" onclick="confirmRemoveTask('${tid}')">Confirm Remove</button>
      <button class="btn btn-s btn-xs" onclick="document.getElementById('dt-panel-${tid}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
}

async function confirmRemoveTask(tid){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const reasonEl=document.getElementById('dt-remove-reason-'+tid);
  const reason=reasonEl?reasonEl.value.trim():'';
  if(!reason){toast('Removal reason is mandatory','err');return}
  // Soft-delete: mark as removed (kept in DB for TL/Captain history only)
  t.status='removed';
  t.removedReason=reason;
  t.removedAt=nowStr();
  await saveDoc('dailyTasks',t);
  toast('🗑 Task removed. Hidden from dashboard — visible in history.');
  renderTasks();
}

function showTLAckPanel(tid){
  const panel=document.getElementById('dt-panel-'+tid);
  if(!panel)return;
  if(panel.innerHTML){panel.innerHTML='';return}
  panel.innerHTML=`<div class="dt-inline-panel">
    <div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--acc)">💬 Acknowledge Excuse</div>
    <textarea id="dt-ack-${tid}" placeholder="Your response to the member's excuse — e.g. 'Accepted, carrying task', 'Please complete by tomorrow EOD'…"></textarea>
    <div class="act">
      <button class="btn btn-xs" style="background:rgba(192,132,252,.15);color:var(--acc);border:1px solid rgba(192,132,252,.3)" onclick="confirmTLAck('${tid}','carry')">Accept & Carry Over</button>
      <button class="btn btn-xs" style="background:rgba(129,140,248,.1);color:var(--acc2);border:1px solid rgba(129,140,248,.25)" onclick="confirmTLAck('${tid}','pending')">Reinstate as Pending</button>
      <button class="btn btn-s btn-xs" onclick="document.getElementById('dt-panel-${tid}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
}

async function confirmTLAck(tid,action){
  const t=dailyTasks.find(x=>sid(x.id)===sid(tid));
  if(!t)return;
  const ackEl=document.getElementById('dt-ack-'+tid);
  const ackNote=ackEl?ackEl.value.trim()||'Acknowledged':'Acknowledged';
  t.tlNote=ackNote;

  if(action==='carry'){
    // Save the note first, then open the carry-over panel for full approval
    t.status='overdue_pending';
    await saveDoc('dailyTasks',t);
    toast('Excuse acknowledged — now approve carry-over details below.');
    renderTasks();
    // Open carry-over panel after re-render
    setTimeout(()=>showCarryOverPanel(String(t.id)),400);
  } else {
    t.status='pending';
    t.excuseReason=null;
    await saveDoc('dailyTasks',t);
    toast('Task reinstated as pending.');
    renderTasks();
  }
}

/* ════ HISTORY ════ */
// canSeeRemoved: always true now — members see their removed tasks too
// isTLorCap: controls whether removal reason is shown (TL/Captain see reason; member just sees "removed by TL")
function buildMemberHistory(memberId, isTLorCap=false){
  const allTasks=dailyTasks.filter(t=>sid(t.memberId)===sid(memberId));
  // Everyone sees all tasks including removed — members see "removed by TL" without the internal reason
  const tasks=allTasks;
  if(!tasks.length)return emptyState('📋','No task history yet.');
  const byDate={};
  tasks.forEach(t=>{if(!byDate[t.assignedDate])byDate[t.assignedDate]=[];byDate[t.assignedDate].push(t);});
  const dates=Object.keys(byDate).sort((a,b)=>b.localeCompare(a));
  const statusIcon={pending:'⏳',submitted:'📤',verified:'✅',carried:'🔄',overdue_pending:'⚠',excused:'💬',removed:'🗑'};
  const statusColor={verified:'var(--acc5)',submitted:'var(--acc4)',overdue_pending:'var(--acc3)',excused:'var(--acc)',carried:'var(--acc6)',pending:'var(--t3)',removed:'var(--acc3)'};

  const totalAll=tasks.filter(t=>t.status!=='removed').length;
  const verAll=tasks.filter(t=>t.status==='verified').length;
  const removedAll=tasks.filter(t=>t.status==='removed').length;
  const overdueAll=tasks.filter(t=>t.status==='overdue_pending').length;
  const excAll=tasks.filter(t=>t.status==='excused').length;
  const rate=totalAll?Math.round(verAll/totalAll*100):0;

  let html=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;padding:12px 14px;background:var(--s2);border-radius:10px;border:1px solid var(--b1)">
    <span style="font-size:.72rem;font-weight:700;color:var(--t2)">${totalAll} total tasks</span>
    <span style="color:var(--b3)">·</span>
    <span style="font-size:.72rem;font-weight:700;color:var(--acc5)">${verAll} verified (${rate}%)</span>
    <span style="color:var(--b3)">·</span>
    <span style="font-size:.72rem;font-weight:700;color:var(--acc3)">${overdueAll} overdue</span>
    <span style="color:var(--b3)">·</span>
    <span style="font-size:.72rem;font-weight:700;color:var(--acc)">${excAll} excused</span>
    ${removedAll?`<span style="color:var(--b3)">·</span>
    <span style="font-size:.72rem;font-weight:700;color:var(--acc3)">🗑 ${removedAll} removed</span>`:''}
    <div style="width:100%;height:3px;background:var(--s3);border-radius:99px;margin-top:6px;overflow:hidden">
      <div style="height:100%;width:${rate}%;background:linear-gradient(90deg,var(--acc5),var(--acc2));border-radius:99px"></div>
    </div>
  </div>`;

  dates.forEach(dk=>{
    const dayTasks=byDate[dk];
    const ver=dayTasks.filter(t=>t.status==='verified').length;
    const nonRemDay=dayTasks.filter(t=>t.status!=='removed').length;
    const dayPct=nonRemDay?Math.round(ver/nonRemDay*100):0;
    html+=`<div class="dt-history-item">
      <div class="dt-history-date" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span>${dateLabel(dk)}</span>
        <span style="font-size:.65rem;color:var(--t3);font-family:var(--mono)">${ver}/${nonRemDay} verified · ${dayPct}%</span>
      </div>`;
    dayTasks.forEach(t=>{
      const sc=statusColor[t.status]||'var(--t3)';
      html+=`<div class="dt-history-task ${t.status==='verified'?'ht-done':['overdue_pending','carried','removed'].includes(t.status)?'ht-miss':''}">
        <span style="flex-shrink:0;font-size:.88rem">${statusIcon[t.status]||'⏳'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;${t.status==='removed'?'text-decoration:line-through;opacity:.7':''}">${escHTML(t.text)}</div>
          ${t.status==='removed'
            ? isTLorCap
              // TL/Captain see full removal reason + timestamp + any submission note
              ? `<div style="font-size:.7rem;color:var(--acc3);margin-top:2px">🗑 Removed by TL: "${escHTML(t.removedReason||'')}"${t.removedAt?` · ${t.removedAt}`:''}</div>
                 ${t.memberNote?`<div style="font-size:.7rem;color:var(--acc2);margin-top:2px">📝 Member had submitted: "${escHTML(t.memberNote)}"</div>`:''}`
              // Member sees only that it was removed — no internal reason
              : `<div style="font-size:.7rem;color:var(--acc3);margin-top:2px">🗑 This task was removed by your Team Leader.</div>`
            : ''}
          ${t.status!=='removed'&&t.excuseReason?`<div style="font-size:.7rem;color:var(--acc);margin-top:2px">💬 Excuse: "${escHTML(t.excuseReason)}"${t.tlNote?` · <span style="color:var(--acc5)">TL: "${escHTML(t.tlNote)}"</span>`:''}</div>`:''}
          ${t.status!=='removed'&&t.memberNote&&t.status==='verified'?`<div style="font-size:.7rem;color:var(--acc2);margin-top:2px">📝 Note: "${escHTML(t.memberNote)}"</div>`:''}
        </div>
        <span style="flex-shrink:0;font-size:.62rem;color:${sc};font-weight:700;padding:1px 6px;border-radius:99px;border:1px solid ${sc}22;background:${sc}10;white-space:nowrap">${t.status}</span>
      </div>`;
    });
    html+=`</div>`;
  });
  return html;
}

function renderTaskHistory(){
  const sel=document.getElementById('dt-hist-member');
  const body=document.getElementById('dt-history-body');
  if(!sel||!body)return;
  if(!sel.value){body.innerHTML=emptyState('📋','Select a member to see their history');return}
  // TL/Captain see full removal details including reason
  body.innerHTML=buildMemberHistory(sel.value, true);
}

/* Clear all task history for a specific member */
async function clearMemberHistory(){
  const sel=document.getElementById('dt-hist-member');
  if(!sel||!sel.value){toast('Select a member first','err');return}
  const mid=sel.value;
  const m=members.find(x=>sid(x.id)===sid(mid));
  const mname=m?m.name:'this member';
  const toDelete=dailyTasks.filter(t=>sid(t.memberId)===sid(mid));
  if(!toDelete.length){toast('No task history to clear','err');return}
  if(!confirm(`Clear ALL ${toDelete.length} task records for ${mname}?\n\nThis permanently deletes their full task history from Firestore. This cannot be undone.`))return;
  for(const t of toDelete) await delDoc('dailyTasks',String(t.id));
  dailyTasks=dailyTasks.filter(t=>sid(t.memberId)!==sid(mid));
  toast(`🗑 Cleared ${toDelete.length} task records for ${mname}`);
  const body=document.getElementById('dt-history-body');
  if(body)body.innerHTML=emptyState('📋','History cleared.');
  // Refresh top stats without full re-render
  renderTasks();
}

/* ════════════════════════════════════════════════════════════
   RESET ALL TASK DATA  (Captain only)
   Wipes all dailyTasks + domains from Firestore → fresh start
════════════════════════════════════════════════════════════ */
async function resetAllTaskData(){
  if(CU.role!=='captain'){toast('Only Captain can reset task data','err');return}
  const taskCount=dailyTasks.length;
  const domCount=domains.length;
  if(!taskCount&&!domCount){toast('Nothing to reset — already fresh','err');return}
  const confirmed=confirm(
    `⚠ RESET ALL TASK DATA\n\n` +
    `This will permanently delete:\n` +
    `• All ${domCount} domain${domCount!==1?'s':''}\n` +
    `• All ${taskCount} task record${taskCount!==1?'s':''} (including history)\n\n` +
    `The team members and all other data (announcements, reports, etc.) will NOT be affected.\n\n` +
    `Type OK to confirm — this cannot be undone.`
  );
  if(!confirmed)return;

  // Delete all dailyTasks
  for(const t of dailyTasks){
    try{await delDoc('dailyTasks',String(t.id));}catch(e){}
  }
  dailyTasks=[];

  // Delete all domains
  for(const d of domains){
    try{await delDoc('domains',d.id);}catch(e){}
  }
  domains=[];

  toast('✅ All task data reset. Starting fresh.');
  renderTasks();
}

/* ════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════ */
function v(id){const el=document.getElementById(id);return el?el.value.trim():''}
function safeUrl(url){url=(url||'').trim();return(url&&!/^https?:\/\//i.test(url))?'https://'+url:url;}
// Delegated handler for profile link buttons — reads data-url to avoid inline interpolation bugs
document.addEventListener('click',function(e){
  const btn=e.target.closest('.prof-link-btn');
  if(!btn)return;
  e.stopPropagation();
  const url=safeUrl(decodeURIComponent(btn.dataset.url||''));
  if(url)window.open(url,'_blank','noopener,noreferrer');
});
function today(){return new Date().toLocaleDateString('en-IN')}
function nowStr(){return new Date().toLocaleString('en-IN',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
function escHTML(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function emptyState(icon,msg){return `<div class="empty-state"><span class="ei">${icon}</span><p>${msg}</p></div>`}

function closeMov(id){document.getElementById(id).classList.remove('open')}
window.addEventListener('click',e=>{
  document.querySelectorAll('.mov').forEach(ov=>{if(e.target===ov)ov.classList.remove('open')})
});

let _toastT;
function toast(msg,type){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='show '+(type||'ok');
  clearTimeout(_toastT);_toastT=setTimeout(()=>{t.className=''},3200);
}

/* ════════════════════════════════════════════════════════════
   EXPORT / IMPORT DATA (for sharing across devices)
════════════════════════════════════════════════════════════ */
function exportData(){
  const data = {members, messages, reports, roadmaps, hackathons, leetcodeStats, dailyTasks, domains, aptitudeMaterials, aptitudeTests, exportedAt: new Date().toLocaleString('en-IN')};
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'teamsync-backup.json'; a.click();
  URL.revokeObjectURL(url);
  toast('Data exported! Share teamsync-backup.json with your team.');
}

function importData(){
  const raw = document.getElementById('import-json').value.trim();
  if(!raw){toast('Paste the JSON data first','err');return}
  try{
    const data = JSON.parse(raw);
    if(!data.members||!Array.isArray(data.members)){toast('Invalid data format','err');return}
    members       = data.members       || [];
    messages      = data.messages      || [];
    reports       = data.reports       || [];
    roadmaps      = data.roadmaps      || [];
    hackathons    = data.hackathons    || [];
    leetcodeStats = data.leetcodeStats || [];
    dailyTasks    = data.dailyTasks    || [];
    domains       = data.domains       || [];
    aptitudeMaterials = data.aptitudeMaterials || [];
    aptitudeTests      = data.aptitudeTests      || [];
    persist();
    toast('Team data imported! You can now log in.');
    document.getElementById('setup-screen').style.display='none';
    showLogin();
  } catch(e){
    toast('Invalid JSON — please paste the exact exported data','err');
  }
}

function copyExportText(){
  const data = {members, messages, reports, roadmaps, hackathons, leetcodeStats, dailyTasks, domains, aptitudeMaterials, aptitudeTests, exportedAt: new Date().toLocaleString('en-IN')};
  const json = JSON.stringify(data);
  navigator.clipboard.writeText(json).then(()=>toast('Data copied to clipboard! Paste it on another device.')).catch(()=>toast('Copy failed — use Download instead','err'));
}

/* ════════════════════════════════════════════════════════════
   BOOT — run init() once the page DOM is fully loaded
════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);

/* ── Drag-to-scroll for top nav ── */
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('tb-nav');
  if (!nav) return;
  let isDown = false, startX, scrollLeft;
  nav.addEventListener('mousedown', e => {
    isDown = true; nav.classList.add('dragging');
    startX = e.pageX - nav.offsetLeft;
    scrollLeft = nav.scrollLeft;
  });
  document.addEventListener('mouseup', () => { isDown = false; nav.classList.remove('dragging'); });
  document.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - nav.offsetLeft;
    nav.scrollLeft = scrollLeft - (x - startX);
  });
});

/* ── Topbar scroll shadow ── */
document.addEventListener('DOMContentLoaded',()=>{
  const topbar=document.getElementById('topbar');
  if(topbar){
    window.addEventListener('scroll',()=>{
      topbar.style.boxShadow=window.scrollY>10?'0 4px 24px rgba(0,0,0,.6),0 1px 0 var(--b1)':'';
    },{passive:true});
  }
});

/* ══════════════════ DARK / LIGHT MODE TOGGLE ══════════════════ */
/* Syncs the native Android status bar icon color to the current theme.
   Requires the @capacitor/status-bar plugin — if it isn't installed this
   silently no-ops, so it's always safe to call. */
function syncStatusBar(isLight){
  try{
    if(!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    const SB = window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if(!SB) return;
    // Light theme = light background, so status bar icons need to be DARK (and vice versa)
    SB.setStyle({ style: isLight ? 'DARK' : 'LIGHT' });
    if(SB.setBackgroundColor) SB.setBackgroundColor({ color: isLight ? '#f4f0ff' : '#07050f' });
  }catch(e){}
}

function toggleTheme(){
  const body = document.body;
  const icon = document.getElementById('tt-icon');
  const isLight = body.classList.toggle('light-mode');
  if(icon) icon.textContent = isLight ? '☀️' : '🌙';
  try{ localStorage.setItem('ts-theme', isLight ? 'light' : 'dark'); } catch(e){}
  syncStatusBar(isLight);
}

// Apply saved theme on page load — dark is default
(function(){
  try{
    const saved = localStorage.getItem('ts-theme');
    // Default is dark; only go light if explicitly saved as 'light'
    if(saved === 'light'){
      document.body.classList.add('light-mode');
      const icon = document.getElementById('tt-icon');
      if(icon) icon.textContent = '☀️';
    }
    syncStatusBar(saved === 'light');
  } catch(e){}
})();

/* ════════════════════════════════════════════════════════════
   NEW FEATURES: NOTIFICATIONS, QUICK ACTIONS, TEAM ANALYTICS
════════════════════════════════════════════════════════════ */

// ── Notifications System ──
let notifications = [];

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    loadNotifications();
  }
}

function loadNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  
  // Sample notifications (in production, load from Firestore)
  notifications = [
    { id: 1, icon: '📢', title: 'New Announcement', body: 'Captain posted a new announcement', time: '2 mins ago', unread: true },
    { id: 2, icon: '✅', title: 'Task Assigned', body: 'New task added to your daily tasks', time: '1 hour ago', unread: true },
    { id: 3, icon: '🏆', title: 'Achievement Unlocked', body: 'You completed 10 tasks this week!', time: '3 hours ago', unread: false },
    { id: 4, icon: '📝', title: 'Report Reminder', body: 'Weekly report due tomorrow', time: '1 day ago', unread: false }
  ];
  
  if (notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty"><div class="notif-empty-icon">🔔</div><p>No notifications yet</p></div>';
    updateNotificationBadge(0);
    return;
  }
  
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="handleNotificationClick(${n.id})">
      <div class="notif-item-header">
        <span class="notif-item-icon">${n.icon}</span>
        <span class="notif-item-title">${n.title}</span>
        <span class="notif-item-time">${n.time}</span>
      </div>
      <div class="notif-item-body">${n.body}</div>
    </div>
  `).join('');
  
  const unreadCount = notifications.filter(n => n.unread).length;
  updateNotificationBadge(unreadCount);
}

function updateNotificationBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  badge.textContent = count;
  if (count > 0) {
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

function handleNotificationClick(id) {
  // Mark as read
  const notif = notifications.find(n => n.id === id);
  if (notif) notif.unread = false;
  loadNotifications();
  
  // Navigate to related screen (example logic)
  toggleNotifications();
}

function clearAllNotifications() {
  notifications = [];
  loadNotifications();
  toast('All notifications cleared', 'ok');
}

// Close notifications when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell');
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.remove('open');
  }
});

// ── Quick Actions System ──
function toggleQuickActions() {
  const panel = document.getElementById('quick-actions-panel');
  if (!panel) return;
  panel.classList.toggle('active');
}

function quickPost() {
  toggleQuickActions();
  // Navigate to announcements screen
  sw('announce');
  setTimeout(() => {
    const textarea = document.getElementById('msg-inp');
    if (textarea) textarea.focus();
  }, 100);
}

function quickTask() {
  toggleQuickActions();
  // Navigate to tasks screen
  sw('tasks');
  toast('Navigate to Daily Tasks to add new tasks', 'ok');
}

function quickReport() {
  toggleQuickActions();
  // Navigate to reports screen
  sw('reports');
  setTimeout(() => {
    const textarea = document.querySelector('#report-body textarea');
    if (textarea) textarea.focus();
  }, 100);
}

function quickReminder() {
  toggleQuickActions();
  openMov('modal-quick-action');
  
  const body = document.getElementById('modal-quick-action-body');
  if (!body) return;
  
  body.innerHTML = `
    <h3>⏰ Send Reminder</h3>
    <div class="fg1">
      <div class="field">
        <label>Reminder Message</label>
        <textarea id="qa-reminder-msg" placeholder="Type your reminder message..." rows="4"></textarea>
      </div>
      <div class="field">
        <label>Send To</label>
        <select id="qa-reminder-target">
          <option value="all">All Team Members</option>
          <option value="seniors">Senior Roles Only</option>
          <option value="dept">My Department</option>
        </select>
      </div>
    </div>
    <div class="act">
      <button class="btn btn-p" onclick="sendQuickReminder()">Send Reminder</button>
      <button class="btn btn-s" onclick="closeMov('modal-quick-action')">Cancel</button>
    </div>
  `;
}

function sendQuickReminder() {
  const msg = document.getElementById('qa-reminder-msg');
  const target = document.getElementById('qa-reminder-target');
  
  if (!msg || !msg.value.trim()) {
    toast('Please enter a message', 'err');
    return;
  }
  
  // In production, post this as an announcement or send notifications
  toast(`Reminder sent to ${target.value === 'all' ? 'all members' : target.options[target.selectedIndex].text}!`, 'ok');
  closeMov('modal-quick-action');
}

function quickSearch() {
  toggleQuickActions();
  openMov('modal-quick-action');
  
  const body = document.getElementById('modal-quick-action-body');
  if (!body) return;
  
  body.innerHTML = `
    <h3>🔍 Search Members</h3>
    <div class="field">
      <input type="text" id="qa-search-input" placeholder="Search by name, roll number, or department..." oninput="performQuickSearch()">
    </div>
    <div id="qa-search-results" style="margin-top:16px;max-height:400px;overflow-y:auto"></div>
  `;
  
  setTimeout(() => {
    const input = document.getElementById('qa-search-input');
    if (input) input.focus();
  }, 100);
}

function performQuickSearch() {
  const input = document.getElementById('qa-search-input');
  const results = document.getElementById('qa-search-results');
  if (!input || !results) return;
  
  const query = input.value.toLowerCase().trim();
  if (!query) {
    results.innerHTML = '<p style="color:var(--t3);font-size:.85rem;text-align:center;padding:20px">Type to search...</p>';
    return;
  }
  
  const filtered = members.filter(m => 
    m.name.toLowerCase().includes(query) ||
    m.roll.toLowerCase().includes(query) ||
    m.dept.toLowerCase().includes(query)
  );
  
  if (filtered.length === 0) {
    results.innerHTML = '<p style="color:var(--t3);font-size:.85rem;text-align:center;padding:20px">No members found</p>';
    return;
  }
  
  results.innerHTML = filtered.map(m => {
    const color = dc(m.dept);
    return `
      <div class="mr" onclick="closeMov('modal-quick-action');openMemberModal('${m.id}')">
        <div class="av" style="background:${color}1a;color:${color};border:1.5px solid ${color}40">${avInner(m)}</div>
        <div class="mi">
          <div class="mn">${m.name}</div>
          <div class="ms">${m.rollNo} • ${ds(m.dept)}</div>
        </div>
        <div class="mm">
          <span class="badge b-${m.role}">${ROLES[m.role]}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Close quick actions when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('quick-actions-panel');
  const btn = document.getElementById('quick-actions-btn');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});

// ── Team Analytics System ──
function loadTeamAnalytics() {
  if (!CU) return;
  
  const card = document.getElementById('team-analytics-card');
  if (card) card.style.display = 'block';
  
  // Calculate metrics
  const totalTasks = dailyTasks.reduce((sum, dt) => sum + dt.tasks.length, 0);
  const completedTasks = dailyTasks.reduce((sum, dt) => 
    sum + dt.tasks.filter(t => t.status === 'verified').length, 0
  );
  const completion = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const activeMembers = members.filter(m => {
    // Consider active if they have tasks or submitted reports recently
    const hasTasks = dailyTasks.some(dt => dt.memberId === m.id);
    const hasReports = reports.some(r => r.memberId === m.id);
    return hasTasks || hasReports;
  }).length;
  
  const engagement = members.length > 0 ? Math.round((activeMembers / members.length) * 100) : 0;
  
  // Mock growth (in production, calculate from historical data)
  const growth = Math.floor(Math.random() * 20) + 5;
  
  // Update tiles
  document.getElementById('analytics-completion').textContent = completion + '%';
  document.getElementById('analytics-active').textContent = activeMembers;
  document.getElementById('analytics-engagement').textContent = engagement + '%';
  document.getElementById('analytics-growth').textContent = '+' + growth + '%';
  
  // Load top performers
  loadTopPerformers();
  
  // Load department comparison
  loadDepartmentComparison();
}

function loadTopPerformers() {
  const container = document.getElementById('top-performers');
  if (!container) return;
  
  // Calculate scores based on tasks completed
  const scores = members.map(m => {
    const memberTasks = dailyTasks.filter(dt => dt.memberId === m.id);
    const verified = memberTasks.reduce((sum, dt) => 
      sum + dt.tasks.filter(t => t.status === 'verified').length, 0
    );
    return { member: m, score: verified };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  
  if (scores.length === 0) {
    container.innerHTML = '<p style="color:var(--t3);font-size:.85rem;padding:12px">No activity yet this week</p>';
    return;
  }
  
  container.innerHTML = scores.map((s, i) => {
    const m = s.member;
    const color = dc(m.dept);
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
    return `
      <div class="performer-item">
        <div class="performer-rank ${rankClass}">#${i + 1}</div>
        <div class="av" style="width:34px;height:34px;font-size:.8rem;background:${color}1a;color:${color};border:1.5px solid ${color}40">${avInner(m)}</div>
        <div class="performer-info">
          <div class="performer-name">${m.name}</div>
          <div class="performer-meta">${ds(m.dept)} • ${ROLES[m.role]}</div>
        </div>
        <div class="performer-score">${s.score}</div>
      </div>
    `;
  }).join('');
}

function loadDepartmentComparison() {
  const container = document.getElementById('dept-comparison');
  if (!container) return;
  
  // Group members by department and calculate activity
  const deptMap = {};
  members.forEach(m => {
    if (!deptMap[m.dept]) {
      deptMap[m.dept] = { count: 0, active: 0 };
    }
    deptMap[m.dept].count++;
    
    const hasTasks = dailyTasks.some(dt => dt.memberId === m.id);
    if (hasTasks) deptMap[m.dept].active++;
  });
  
  const deptData = Object.entries(deptMap).map(([dept, data]) => ({
    dept,
    percentage: data.count > 0 ? Math.round((data.active / data.count) * 100) : 0,
    active: data.active,
    total: data.count
  })).sort((a, b) => b.percentage - a.percentage).slice(0, 8);
  
  if (deptData.length === 0) {
    container.innerHTML = '<p style="color:var(--t3);font-size:.85rem;padding:12px">No department data</p>';
    return;
  }
  
  container.innerHTML = deptData.map(d => `
    <div class="dept-bar-item">
      <div class="dept-bar-header">
        <div class="dept-bar-name">${ds(d.dept)}</div>
        <div class="dept-bar-value">${d.percentage}%</div>
      </div>
      <div class="dept-bar-track">
        <div class="dept-bar-fill" style="width:${d.percentage}%"></div>
      </div>
    </div>
  `).join('');
}

// Initialize analytics when dashboard loads
function sw(screen) {
  goTo(screen);
  if (screen === 'dash') {
    setTimeout(loadTeamAnalytics, 100);
  }
}

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell');
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.remove('open');
  }
});

function openMov(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

