// Extracted client script from index.html for separation of concerns.
// Note: This mirrors the previous inline script one-to-one.

// Theme Management System
const ThemeManager = {
  STORAGE_KEY: 'joker-chat-theme',
  
  getStoredTheme() {
    return localStorage.getItem(this.STORAGE_KEY) || 'auto';
  },
  
  setStoredTheme(theme) {
    localStorage.setItem(this.STORAGE_KEY, theme);
  },
  
  getPreferredTheme() {
    const stored = this.getStoredTheme();
    if (stored !== 'auto') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
  
  setTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.setAttribute('data-bs-theme', this.getPreferredTheme());
    } else {
      document.documentElement.setAttribute('data-bs-theme', theme);
    }
    this.setStoredTheme(theme);
    this.updateThemeUI(theme);
  },
  
  updateThemeUI(theme) {
    // Update all theme dropdown buttons
    const buttons = document.querySelectorAll('#themeDropdown, #themeDropdownLanding');
    const icons = {
      light: 'bi-sun',
      dark: 'bi-moon', 
      auto: 'bi-circle-half'
    };
    
    buttons.forEach(btn => {
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = `bi ${icons[theme] || 'bi-palette2'}`;
      }
    });
    
    // Update active states in dropdowns
    document.querySelectorAll('.theme-option').forEach(option => {
      option.classList.toggle('active', option.dataset.theme === theme);
    });
  },
  
  init() {
    // Set initial theme
    this.setTheme(this.getStoredTheme());
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.getStoredTheme() === 'auto') {
        this.setTheme('auto');
      }
    });
    
    // Event delegation for theme options (use closest so clicks on inner elements are handled)
    document.addEventListener('click', (e) => {
      const opt = e.target.closest ? e.target.closest('.theme-option') : null;
      if (opt) {
        e.preventDefault();
        const theme = opt.dataset.theme;
        this.setTheme(theme);
      }
    });
  }
};

let me = null;
let activeFriendId = null;
const chatMessages = document.getElementById('chatMessages');
const userCache = new Map();
const avatarCache = new Map(); // userId -> avatar url
let myAvatarUrl = null;

// --- UI toggle helpers ---
function showAppShellUI() {
  // Loading durumunu kaldır
  const loadingDiv = document.getElementById('authLoading');
  if (loadingDiv) loadingDiv.remove();
  
  const landing = document.getElementById('landingShell');
  const app = document.getElementById('appShell');
  if (landing) {
    landing.style.display = 'none';
    landing.classList.add('d-none');
    landing.setAttribute('hidden', 'true');
  // Remove from DOM to avoid any layout residue
  try { landing.remove(); } catch {}
  }
  if (app) app.style.display = '';
  const btnReg = document.getElementById('btnShowRegister');
  const btnLogin = document.getElementById('btnShowLogin');
  const btnLogout = document.getElementById('btnLogout');
  if (btnReg) btnReg.style.display = 'none';
  if (btnLogin) btnLogin.style.display = 'none';
  if (btnLogout) btnLogout.style.display = '';
  try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0,0); }
  document.body.classList.add('authenticated');
  // Update theme UI when switching to app shell
  if (typeof ThemeManager !== 'undefined') {
    ThemeManager.updateThemeUI(ThemeManager.getStoredTheme());
  }
}

function showLandingShellUI() {
  // Loading durumunu kaldır
  const loadingDiv = document.getElementById('authLoading');
  if (loadingDiv) loadingDiv.remove();
  
  let landing = document.getElementById('landingShell');
  const app = document.getElementById('appShell');
  (async () => {
    if (!landing) {
      // Re-inject landing fragment if it was removed
      try {
        const res = await fetch('/fragments/landing.html', { cache: 'no-cache' });
        const html = await res.text();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        const node = wrapper.firstElementChild;
        document.body.insertBefore(node, document.body.firstChild);
        landing = node;
      } catch (e) { console.error('Landing re-inject failed', e); }
    }
    if (landing) {
      landing.removeAttribute('hidden');
      landing.classList.remove('d-none');
      landing.style.display = '';
    }
  })();
  if (app) app.style.display = 'none';
  const btnReg = document.getElementById('btnShowRegister');
  const btnLogin = document.getElementById('btnShowLogin');
  const btnLogout = document.getElementById('btnLogout');
  if (btnReg) btnReg.style.display = '';
  if (btnLogin) btnLogin.style.display = '';
  if (btnLogout) btnLogout.style.display = 'none';
  document.body.classList.remove('authenticated');
  // Update theme UI when switching to landing
  if (typeof ThemeManager !== 'undefined') {
    ThemeManager.updateThemeUI(ThemeManager.getStoredTheme());
  }
}

// --- WebRTC state ---
const rtc = {
  pc: null,
  localStream: null,
  remoteStream: null,
  peerId: null,
  isCaller: false
};
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const connection = new signalR.HubConnectionBuilder()
  .withUrl('/chat')
  .withAutomaticReconnect()
  .build();

connection.on('ReceivePrivateMessage', async (payload) => {
  const [from, ...rest] = payload.split(':');
  const msg = rest.join(':');
  const senderName = await getUserName(from);
  if (activeFriendId !== from) {
    await setActiveChat(from, senderName);
    return;
  }
  chatMessages.appendChild(renderMessageBubble({ id: 0, content: msg, fromUserId: from }, false, senderName));
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ---- Realtime: Friends and users list updates ----
connection.on('UserRegistered', async (user) => {
  // Yeni üye geldi: kullanıcılar listesini tazele ve bilgilendir
  try { await refreshUsers(); } catch {}
  showToast(`Yeni üye: ${user.displayName || user.email}`, 'info');
});
connection.on('FriendRequestIncoming', async (fromUserId) => {
  // Size yeni istek: istekler bölümünü tazele
  try { await refreshRequests(); } catch {}
  const name = await getUserName(fromUserId);
  showToast(`${name} sana arkadaşlık isteği gönderdi.`, 'info');
});
connection.on('FriendRequestOutgoing', async (toUserId) => {
  // Gönderdiğiniz istek: outgoing list yenile
  try { await refreshRequests(); } catch {}
});
connection.on('FriendRequestAccepted', async (otherUserId) => {
  // Arkadaşlık kabul edildi: listeleri güncelle
  try { await Promise.all([refreshFriends(), refreshUsers(), refreshRequests()]); } catch {}
  const name = await getUserName(otherUserId);
  showToast(`${name} ile artık arkadaşsınız.`, 'success');
});
connection.on('FriendRequestRejected', async (otherUserId) => {
  try { await refreshRequests(); } catch {}
  const name = await getUserName(otherUserId);
  showToast(`${name} isteğinizi reddetti.`, 'warning');
});
connection.on('UserStatusChanged', async (userId, isOnline) => {
  // Arkadaş online/offline oldu: sadece UI'da status indicator güncelle
  updateUserStatusIndicator(userId, isOnline);
});

connection.on('RtcOffer', async (fromUserId, offerJson) => {
  try {
    const offer = JSON.parse(offerJson);
    if (rtc.pc && rtc.peerId && rtc.peerId !== fromUserId) {
      showToast('Meşgulsünüz, gelen çağrı reddedildi.', 'warning');
      return;
    }
    rtc.isCaller = false;
    rtc.peerId = fromUserId;
    await openVideoModal();
    await ensurePeerConnection();
    await rtc.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await ensureLocalStream();
    const answer = await rtc.pc.createAnswer();
    await rtc.pc.setLocalDescription(answer);
    await connection.invoke('RtcAnswer', fromUserId, JSON.stringify(answer));
  } catch (e) {
    console.error(e);
    showToast('Çağrı alınamadı.', 'error');
  }
});
connection.on('RtcAnswer', async (fromUserId, answerJson) => {
  try {
    if (!rtc.pc || rtc.peerId !== fromUserId) return;
    const answer = JSON.parse(answerJson);
    await rtc.pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (e) { console.error(e); }
});
connection.on('RtcIceCandidate', async (fromUserId, candidateJson) => {
  try {
    if (!rtc.pc || rtc.peerId !== fromUserId) return;
    const cand = JSON.parse(candidateJson);
    await rtc.pc.addIceCandidate(new RTCIceCandidate(cand));
  } catch (e) { console.error(e); }
});
connection.on('RtcHangup', async (fromUserId) => {
  if (rtc.peerId === fromUserId) {
    showToast('Karşı taraf görüşmeyi sonlandırdı.', 'info');
    await endCall(false);
  }
});

function renderMessageBubble(m, mine, nameOverride) {
  const row = document.createElement('div');
  row.className = `d-flex ${mine ? 'justify-content-end' : 'justify-content-start'} my-1`;
  const wrap = document.createElement('div');
  wrap.className = `d-flex align-items-end msg-wrap ${mine ? 'flex-row-reverse' : ''}`;

  const fromId = m.fromUserId || m.FromUserId;
  const img = document.createElement('img');
  img.className = 'avatar-small';
  img.src = mine ? (myAvatarUrl || defaultAvatarSvg()) : (avatarCache.get(fromId) || defaultAvatarSvg());
  img.onerror = () => { img.src = defaultAvatarSvg(); };
  if (!mine && !avatarCache.has(fromId)) ensureAvatarLoaded(fromId, img);

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${mine ? 'message-bubble-sent' : 'message-bubble-received'}`;
  const senderName = nameOverride ?? (mine ? (me?.displayName || me?.email || 'Ben') : (userCache.get(fromId) || ''));
  const content = m.content || m.Content || '';
  const nameEl = document.createElement('div');
  nameEl.className = `small ${mine ? 'opacity-75' : 'text-muted'}`;
  nameEl.textContent = senderName || '';
  const bodyEl = document.createElement('div');
  if (content.startsWith('[img]')) {
    const img = document.createElement('img');
    img.src = content.substring(5);
    img.alt = 'resim';
    img.style.maxWidth = '260px';
    img.style.borderRadius = '6px';
    img.style.display = 'block';
    bubble.appendChild(nameEl); bubble.appendChild(img);
  } else if (content.startsWith('[loc]')) {
    const coords = content.substring(5);
    const [lat, lon] = coords.split(',');
    const a = document.createElement('a');
    a.href = `https://www.google.com/maps?q=${lat},${lon}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `Konum: ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)} (Haritada aç)`;
    bubble.appendChild(nameEl); bubble.appendChild(a);
  } else {
    bodyEl.textContent = content;
    bubble.appendChild(nameEl); bubble.appendChild(bodyEl);
  }

  if (mine) { wrap.appendChild(bubble); wrap.appendChild(img); }
  else { wrap.appendChild(img); wrap.appendChild(bubble); }

  if (m.id || m.Id) {
    const del = document.createElement('button');
    del.className = `btn btn-sm ${mine ? 'btn-light' : 'btn-outline-secondary'} ms-2`;
    del.title = 'Sil';
    del.innerHTML = '<i class="bi bi-trash"></i>';
    del.onclick = async () => { await api(`/api/messages/${m.id || m.Id}/delete`, { method: 'POST' }); await loadHistory(activeFriendId); };
    wrap.appendChild(del);
  }

  row.appendChild(wrap);
  return row;
}

function defaultAvatarSvg() {
  return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%23cccccc'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><rect x='16' y='40' width='32' height='16' rx='8' fill='%23ffffff'/></svg>";
}

async function ensureAvatarLoaded(userId, imgEl) {
  try {
    const u = await api(`/api/users/${userId}`);
    const url = u.profile?.avatarUrl || defaultAvatarSvg();
    avatarCache.set(userId, url);
    if (imgEl) imgEl.src = url;
    if (!userCache.has(userId)) userCache.set(userId, u.displayName || u.email || userId);
  } catch {}
}

async function loadHistory(otherId) {
  chatMessages.innerHTML = '';
  const list = await api(`/api/messages/${otherId}`);
  list.forEach(m => {
    const mine = (m.fromUserId || m.FromUserId) === (me?.id);
    const name = mine ? (me?.displayName || me?.email) : (userCache.get(otherId) || otherId);
    chatMessages.appendChild(renderMessageBubble(m, mine, name));
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function startHub() {
  try {
    await connection.start();
  } catch (err) {
    console.error(err);
    setTimeout(startHub, 2000);
  }
}

async function setActiveChat(friendId, friendName) {
  activeFriendId = friendId;
  const name = friendName || (await getUserName(friendId));
  document.getElementById('chatHeader').textContent = `Özel Sohbet: ${name}`;
  localStorage.setItem('lastChatUserId', friendId);
  await loadHistory(friendId);
  document.getElementById('chatCard').scrollIntoView({ behavior: 'smooth' });
}

async function restoreLastChat() {
  const lastId = localStorage.getItem('lastChatUserId');
  if (lastId) {
    try {
      const name = await getUserName(lastId);
      await setActiveChat(lastId, name);
    } catch {}
  }
}

async function getUserName(userId) {
  if (userCache.has(userId)) return userCache.get(userId);
  try {
    const u = await api(`/api/users/${userId}`);
    const name = u.displayName || u.email || userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

async function openFriendProfile(userId) {
  const placeholder = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%25' height='100%25' fill='%23cccccc'/><circle cx='48' cy='36' r='18' fill='%23ffffff'/><rect x='24' y='60' width='48' height='24' rx='12' fill='%23ffffff'/></svg>";
  const u = await api(`/api/users/${userId}`);
  document.getElementById('fpName').textContent = u.displayName || u.email || '';
  document.getElementById('fpEmail').textContent = u.email || '';
  document.getElementById('fpPhone').textContent = u.phoneNumber || 'Gizli';
  document.getElementById('fpGender').textContent = u.profile?.gender || '';
  document.getElementById('fpAddress').textContent = u.profile?.address || 'Gizli';
  document.getElementById('fpEducation').textContent = u.profile?.education || '';
  const img = document.getElementById('fpAvatar');
  img.src = u.profile?.avatarUrl || placeholder;
  img.onerror = () => { img.src = placeholder; };
  bootstrap.Modal.getOrCreateInstance(document.getElementById('friendProfileModal')).show();
}

async function openMyProfile() {
  const placeholder = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%25' height='100%25' fill='%23cccccc'/><circle cx='48' cy='36' r='18' fill='%23ffffff'/><rect x='24' y='60' width='48' height='24' rx='12' fill='%23ffffff'/></svg>";
  try {
    const p = await api('/api/profile');
    document.getElementById('mpDisplayName').value = p.displayName || '';
    document.getElementById('mpEmail').textContent = p.email || '';
    document.getElementById('mpPhone').value = p.phoneNumber || '';
    document.getElementById('mpAvatarUrl').value = p.profile?.avatarUrl || '';
    document.getElementById('mpGender').value = p.profile?.gender || '';
    document.getElementById('mpAddress').value = p.profile?.address || '';
    document.getElementById('mpEducation').value = p.profile?.education || '';
    document.getElementById('mpPhonePublic').checked = !!p.profile?.phonePublic;
    document.getElementById('mpAddressPublic').checked = !!p.profile?.addressPublic;
    const img = document.getElementById('mpAvatar');
    img.src = p.profile?.avatarUrl || placeholder;
    img.onerror = () => { img.src = placeholder; };
    const modalEl = document.getElementById('myProfileModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    const saveBtn = document.getElementById('btnMyProfileSave');
    saveBtn.onclick = async () => {
      const displayName = document.getElementById('mpDisplayName').value;
      const phoneNumber = document.getElementById('mpPhone').value;
      const profile = {
        avatarUrl: document.getElementById('mpAvatarUrl').value,
        gender: document.getElementById('mpGender').value,
        address: document.getElementById('mpAddress').value,
        education: document.getElementById('mpEducation').value,
        phonePublic: document.getElementById('mpPhonePublic').checked,
        addressPublic: document.getElementById('mpAddressPublic').checked
      };
      await api('/api/profile', { method: 'POST', body: JSON.stringify({ displayName, phoneNumber, profile }) });
      modal.hide();
      await refreshMe();
    };
  } catch (e) { console.error(e); }
}

function showToast(message, type = 'info', delay = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) { alert(message); return; }
  const toastEl = document.createElement('div');
  const color = type === 'success' ? 'success' : type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'secondary';
  toastEl.className = `toast align-items-center text-bg-${color} border-0`;
  toastEl.style.minWidth = '280px';
  toastEl.style.maxWidth = '520px';
  toastEl.style.pointerEvents = 'auto';
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  toastEl.setAttribute('aria-atomic', 'true');
  toastEl.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  container.appendChild(toastEl);
  const t = new bootstrap.Toast(toastEl, { delay });
  t.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

async function api(path, options) {
  try {
    const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
    if (!res.ok) {
      // 401 Unauthorized - Session süresi dolmuş veya auth gerekli
      if (res.status === 401) {
        console.warn('Session expired or unauthorized:', path);
        // Sadece auth endpoint değilse kullanıcıyı logout yap
        if (!path.startsWith('/api/auth/')) {
          handleAuthExpired();
        }
      }
      throw new Error(await res.text());
    }
    if (res.headers.get('Content-Type')?.includes('application/json')) return res.json();
    return null;
  } catch (error) {
    console.error('API Error:', path, error);
    throw error;
  }
}

// Session süresi dolduğunda çağrılır
function handleAuthExpired() {
  if (me) {  // Sadece daha önce login olmuşsa
    me = null;
    activeFriendId = null;
    chatMessages.innerHTML = '';
    document.getElementById('meBox').textContent = 'Oturum süresi doldu. Lütfen tekrar giriş yapın.';
    document.getElementById('welcomeUser').textContent = '';
    localStorage.removeItem('lastChatUserId');
    showLandingShellUI();
    showToast('Oturum süresi doldu. Lütfen tekrar giriş yapın.', 'warning');
  }
}

async function refreshMe() {
  try {
    console.log('Checking authentication status...');
    me = await api('/api/auth/me');
    const p = await api('/api/profile');
    myAvatarUrl = p?.profile?.avatarUrl || defaultAvatarSvg();
    
    // Başarılı authentication - UI'ı güncelle
    document.getElementById('meBox').innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <img src="${myAvatarUrl}" class="avatar-small" alt="avatar" onerror="this.src='${defaultAvatarSvg()}'" />
        <div>
          <div class="fw-bold">${me.displayName || me.email}</div>
          <small class="text-muted">Çevrimiçi</small>
        </div>
      </div>`;
    document.getElementById('welcomeUser').innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <span>Hoş geldin, <strong>${me.displayName || me.email}</strong></span>
        <button class="btn btn-sm btn-outline-secondary" onclick="openMyProfile()">Bilgilerim</button>
      </div>`;
    
    showAppShellUI();
    console.log('Authentication successful, loading app data...');
    
    // If logged in user is an admin, open admin panel automatically
    try {
      if (typeof AdminPanel !== 'undefined') {
        const isAdmin = await AdminPanel.checkAdminAuth();
        console.log('[refreshMe] admin check:', isAdmin);
        if (isAdmin) {
          // show an admin quick button in header
          const headerActions = document.querySelector('.d-flex.align-items-center.gap-2');
          if (headerActions && !document.getElementById('btnOpenAdminPanel')) {
            const btn = document.createElement('button');
            btn.id = 'btnOpenAdminPanel';
            btn.className = 'btn btn-sm btn-outline-secondary';
            btn.textContent = 'Admin Panel';
            btn.onclick = () => AdminPanel.showAdminPanel();
            headerActions.insertBefore(btn, headerActions.firstChild);
          }
          // Automatically open admin panel for admins
          AdminPanel.showAdminPanel();
        }
      }
    } catch (e) { console.warn('Admin auto-open failed', e); }

    // Paralel olarak diğer verileri yükle  
    await Promise.all([refreshUsers(), refreshFriends(), refreshRequests()]);
    await startHub();
    await restoreLastChat();
    
  } catch (error) {
    console.log('Authentication failed:', error.message);
    me = null;
    document.getElementById('meBox').textContent = 'Giriş yapılmadı';
    document.getElementById('welcomeUser').textContent = '';
    showLandingShellUI();
  }
}

async function refreshUsers() {
  try {
    const [users, friends] = await Promise.all([
      api('/api/users'),
      api('/api/friends')
    ]);
    const friendSet = new Set((friends || []).map(f => f.id));
    const ul = document.getElementById('usersList');
    ul.innerHTML = '';
    const term = (document.getElementById('usersSearch')?.value || '').trim().toLowerCase();
    users.filter(u => u.id !== me.id)
      .filter(u => !term || (u.displayName || u.email || '').toLowerCase().includes(term))
      .forEach(u => {
      userCache.set(u.id, u.displayName || u.email);
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex align-items-center justify-content-between';
      const left = document.createElement('div'); left.className = 'd-flex align-items-center gap-2';
      const img = document.createElement('img'); img.className = 'avatar-small'; img.alt = 'avatar';
      const avatarUrl = u.avatarUrl || defaultAvatarSvg();
      img.src = avatarUrl; img.onerror = ()=>{ img.src = defaultAvatarSvg(); };
      avatarCache.set(u.id, avatarUrl);
      const name = document.createElement('span'); name.textContent = `${u.displayName || u.email}`;
      // Online status indicator
      const statusDot = document.createElement('span');
      statusDot.className = `status-indicator ${u.isOnline ? 'online' : 'offline'}`;
      statusDot.setAttribute('data-user-id', u.id);
      statusDot.title = u.isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
      left.appendChild(img); left.appendChild(name); left.appendChild(statusDot);
      if (friendSet.has(u.id)) {
        const badge = document.createElement('span');
        badge.className = 'badge text-bg-secondary';
        badge.textContent = 'Arkadaşsınız';
        li.appendChild(left); li.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline-primary';
        btn.textContent = 'Arkadaşlık isteği';
        btn.onclick = async () => {
          const confirmed = await showConfirm(
            'Arkadaşlık İsteği',
            `${u.displayName || u.email} adlı kişiye arkadaşlık isteği göndermek istediğinizden emin misiniz?`,
            'Gönder',
            'btn-primary'
          );
          if (!confirmed) return;
          
          try {
            await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ toUserId: u.id }) });
            btn.textContent = 'İstek gönderildi';
            btn.disabled = true;
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-secondary');
            await refreshRequests();
          } catch (e) {
            console.error(e);
            showToast('İstek gönderilirken bir hata oluştu.', 'error');
          }
        };
        li.appendChild(left); li.appendChild(btn);
      }
      ul.appendChild(li);
    });
  } catch (error) {
    console.error('Error refreshing users:', error);
    if (error.message && !error.message.includes('401')) {
      showToast('Kullanıcı listesi yüklenirken hata oluştu.', 'warning');
    }
  }
}

async function refreshFriends() {
  try {
    const [friends, blocks] = await Promise.all([
      api('/api/friends'),
      api('/api/friends/blocks')
    ]);
  const ul = document.getElementById('friendsList');
  ul.innerHTML = '';
  friends.forEach(f => {
    userCache.set(f.id, f.displayName || f.email);
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    const left = document.createElement('div'); left.className = 'd-flex align-items-center gap-2 flex-grow-1 overflow-hidden';
    const img = document.createElement('img'); img.className = 'avatar-small'; img.alt = 'avatar';
    img.src = f.avatarUrl || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%23cccccc'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><rect x='16' y='40' width='32' height='16' rx='8' fill='%23ffffff'/></svg>";
    img.onerror = ()=>{ img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%23cccccc'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><rect x='16' y='40' width='32' height='16' rx='8' fill='%23ffffff'/></svg>"; };
    const name = document.createElement('span'); name.className = 'friend-name'; name.textContent = `${f.displayName || f.email}`;
    // Online status indicator
    const statusDot = document.createElement('span');
    statusDot.className = `status-indicator ${f.isOnline ? 'online' : 'offline'}`;
    statusDot.setAttribute('data-user-id', f.id);
    statusDot.title = f.isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
    left.appendChild(img); left.appendChild(name); left.appendChild(statusDot);
    left.style.cursor = 'pointer';
    left.onclick = () => openFriendProfile(f.id);
    const wrap = document.createElement('div'); wrap.className = 'friend-actions d-flex align-items-center gap-1 flex-shrink-0';
    const chatBtn = document.createElement('button'); chatBtn.className = 'icon-btn primary'; chatBtn.title = 'Sohbet';
    chatBtn.innerHTML = '<i class="bi bi-chat-dots"></i>';
    chatBtn.onclick = async () => { await setActiveChat(f.id, f.displayName || f.email); document.getElementById('chatInput').focus(); };
    const profBtn = document.createElement('button'); profBtn.className = 'icon-btn secondary'; profBtn.title = 'Profil';
    profBtn.innerHTML = '<i class="bi bi-person"></i>';
    profBtn.onclick = async () => { await openFriendProfile(f.id); };
    const videoBtn = document.createElement('button'); videoBtn.className = 'icon-btn primary'; videoBtn.title = 'Görüntülü Görüşme';
    videoBtn.innerHTML = '<i class="bi bi-camera-video"></i>';
    videoBtn.onclick = async () => { await startVideoCall(f.id); };
    const blocked = blocks.includes(f.id);
    const blockBtn = document.createElement('button'); blockBtn.className = `icon-btn ${blocked ? 'secondary' : 'danger'}`; blockBtn.title = blocked ? 'Engeli Kaldır' : 'Engelle';
    blockBtn.innerHTML = '<i class="bi bi-slash-circle"></i>';
    blockBtn.onclick = async ()=>{
      // Get fresh blocks status
      const currentBlocks = await api('/api/friends/blocks');
      const isBlocked = currentBlocks.includes(f.id);
      const action = isBlocked ? 'engeli kaldırmak' : 'engellemek';
      const confirmed = await showConfirm(
        isBlocked ? 'Engeli Kaldır' : 'Engelle',
        `${f.displayName || f.email} adlı kişiyi ${action} istediğinizden emin misiniz?`,
        isBlocked ? 'Engeli Kaldır' : 'Engelle',
        isBlocked ? 'btn-warning' : 'btn-danger'
      );
      if (!confirmed) return;
      
      try {
        if (isBlocked) {
          await api('/api/friends/unblock', { method:'POST', body: JSON.stringify({ userId: f.id }) });
        } else {
          await api('/api/friends/block', { method:'POST', body: JSON.stringify({ userId: f.id }) });
        }
        await refreshFriends();
        showToast(isBlocked ? 'Engel kaldırıldı.' : 'Kullanıcı engellendi.', 'success');
      } catch (e) {
        console.error('Block/unblock error:', e);
        showToast('İşlem sırasında bir hata oluştu.', 'error');
      }
    };
    const removeBtn = document.createElement('button'); removeBtn.className = 'icon-btn dark'; removeBtn.title = 'Sil';
    removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
    removeBtn.onclick = async ()=>{ 
      const confirmed = await showConfirm(
        'Arkadaşı Sil',
        `${f.displayName || f.email} adlı kişiyi arkadaş listenizden silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`,
        'Sil',
        'btn-danger'
      );
      if (!confirmed) return;
      
      try {
        await api('/api/friends/remove', { method:'POST', body: JSON.stringify({ userId: f.id }) }); 
        await refreshFriends();
        showToast('Arkadaş başarıyla silindi.', 'success');
      } catch (e) {
        showToast('Arkadaş silinirken bir hata oluştu.', 'error');
      }
    };
    wrap.appendChild(chatBtn); wrap.appendChild(profBtn); wrap.appendChild(videoBtn); wrap.appendChild(blockBtn); wrap.appendChild(removeBtn);
    li.appendChild(left);
    li.appendChild(wrap);
    ul.appendChild(li);
  });
  } catch (error) {
    console.error('Error refreshing friends:', error);
    if (error.message && !error.message.includes('401')) {
      showToast('Arkadaş listesi yüklenirken hata oluştu.', 'warning');
    }
  }
}

// Update online status indicator for a specific user
function updateUserStatusIndicator(userId, isOnline) {
  const indicators = document.querySelectorAll(`[data-user-id="${userId}"] .status-indicator, .status-indicator[data-user-id="${userId}"]`);
  indicators.forEach(indicator => {
    indicator.classList.toggle('online', isOnline);
    indicator.classList.toggle('offline', !isOnline);
    indicator.title = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
  });
}

// Centralized confirmation utility
function showConfirm(title, message, actionText, actionClass = 'btn-primary') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    if (!modal) {
      console.error('Confirmation modal not found!');
      resolve(false);
      return;
    }
    
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const actionBtn = document.getElementById('confirmModalAction');
    
    if (!titleEl || !messageEl || !actionBtn) {
      console.error('Modal elements not found!');
      resolve(false);
      return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    actionBtn.textContent = actionText;
    actionBtn.className = `btn ${actionClass}`;
    
    // Remove existing event listeners
    const newActionBtn = actionBtn.cloneNode(true);
    actionBtn.parentNode.replaceChild(newActionBtn, actionBtn);
    
    // Create modal instance
    const modalInstance = new bootstrap.Modal(modal);
    
    // Add event listeners
    newActionBtn.onclick = () => {
      modalInstance.hide();
      resolve(true);
    };
    
    // Handle modal close events
    const handleModalClose = () => {
      resolve(false);
      modal.removeEventListener('hidden.bs.modal', handleModalClose);
    };
    
    modal.addEventListener('hidden.bs.modal', handleModalClose);
    modalInstance.show();
  });
}

async function refreshRequests() {
  try {
    const { incoming, outgoing } = await api('/api/friends/requests');
  
  // Ensure users are cached for proper display
  if (userCache.size === 0) {
    try {
      const users = await api('/api/users');
      users.forEach(u => userCache.set(u.id, u.displayName || u.email));
    } catch (e) {
      console.warn('Could not load users for request display:', e);
    }
  }
  
  const inc = document.getElementById('incomingList');
  const out = document.getElementById('outgoingList');
  inc.innerHTML = ''; out.innerHTML = '';
  
  incoming.forEach(r => {
    // Get sender info
    const senderInfo = userCache.get(r.fromUserId) || 'Bilinmeyen kullanıcı';
    
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    
    const leftDiv = document.createElement('div');
    leftDiv.innerHTML = `
      <div class="fw-bold">${senderInfo}</div>
      <small class="text-muted">Arkadaşlık isteği gönderdi</small>
    `;
    
    const div = document.createElement('div');
    const ac = document.createElement('button'); ac.className = 'btn btn-sm btn-success me-2'; ac.textContent = 'Kabul'; 
    ac.onclick = async ()=>{ 
      const fromUser = userManager.users?.find(u => u.id === r.fromUserId) || { displayName: r.fromUserId };
      const confirmed = await showConfirm(
        'Arkadaşlık İsteğini Kabul Et',
        `${fromUser.displayName || fromUser.email || 'Bu kullanıcının'} arkadaşlık isteğini kabul etmek istediğinizden emin misiniz?`,
        'Kabul Et',
        'btn-success'
      );
      if (!confirmed) return;
      
      try {
        await api('/api/friends/respond', { method:'POST', body: JSON.stringify({ requestId: r.id, accept: true }) }); 
        await Promise.all([refreshFriends(), refreshRequests()]); 
        showToast('Arkadaşlık isteği kabul edildi.', 'success');
      } catch (e) {
        showToast('İstek kabul edilirken bir hata oluştu.', 'error');
      }
    };
    const rej = document.createElement('button'); rej.className = 'btn btn-sm btn-outline-danger'; rej.textContent = 'Reddet';
    rej.onclick = async ()=>{ 
      const fromUser = userManager.users?.find(u => u.id === r.fromUserId) || { displayName: r.fromUserId };
      const confirmed = await showConfirm(
        'Arkadaşlık İsteğini Reddet',
        `${fromUser.displayName || fromUser.email || 'Bu kullanıcının'} arkadaşlık isteğini reddetmek istediğinizden emin misiniz?`,
        'Reddet',
        'btn-danger'
      );
      if (!confirmed) return;
      
      try {
        await api('/api/friends/respond', { method:'POST', body: JSON.stringify({ requestId: r.id, accept: false }) }); 
        await refreshRequests(); 
        showToast('Arkadaşlık isteği reddedildi.', 'info');
      } catch (e) {
        showToast('İstek reddedilirken bir hata oluştu.', 'error');
      }
    };
    div.appendChild(ac); div.appendChild(rej);
    li.appendChild(leftDiv);
    li.appendChild(div);
    inc.appendChild(li);
  });
  
  outgoing.forEach(r => {
    // Get recipient info
    const recipientInfo = userCache.get(r.toUserId) || 'Bilinmeyen kullanıcı';
    
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    
    li.innerHTML = `
      <div>
        <div class="fw-bold">${recipientInfo}</div>
        <small class="text-muted">İstek gönderildi • Yanıt bekleniyor</small>
      </div>
      <span class="badge bg-secondary">Bekliyor</span>
    `;
    
    out.appendChild(li);
  });
  } catch (error) {
    console.error('Error refreshing requests:', error);
    if (error.message && !error.message.includes('401')) {
      showToast('Arkadaşlık istekleri yüklenirken hata oluştu.', 'warning');
    }
  }
}

const regModalEl = document.getElementById('registerModal');
const loginModalEl = document.getElementById('loginModal');
document.getElementById('btnShowRegister').onclick = () => bootstrap.Modal.getOrCreateInstance(regModalEl).show();
document.getElementById('btnShowLogin').onclick = () => bootstrap.Modal.getOrCreateInstance(loginModalEl).show();
const usersSearchEl = document.getElementById('usersSearch');
if (usersSearchEl) usersSearchEl.addEventListener('input', () => { refreshUsers(); });

document.getElementById('btnRegister').onclick = async () => {
  const form = document.getElementById('registerForm');
  form.classList.add('was-validated');
  if (!form.checkValidity()) { showToast('Lütfen formdaki hataları düzeltin.', 'warning'); return; }
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const displayName = document.getElementById('regDisplayName').value.trim();
  try {
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
    showToast('Kayıt başarılı! Şimdi giriş yapabilirsiniz.', 'success');
    form.reset();
    form.classList.remove('was-validated');
    bootstrap.Modal.getOrCreateInstance(regModalEl).hide();
  } catch (e) {
    console.error(e);
    showToast('Kayıt başarısız: ' + (e.message || 'Hata oluştu'), 'error');
  }
};
document.getElementById('btnLogin').onclick = async () => {
  const form = document.getElementById('loginForm');
  form.classList.add('was-validated');
  if (!form.checkValidity()) { showToast('Lütfen e-posta ve şifrenizi girin.', 'warning'); return; }
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    // Login başarılı - refreshMe() UI değişikliklerini yapacak
    await refreshMe();
    showToast('Giriş başarılı. Hoş geldiniz!', 'success');
    form.reset();
    form.classList.remove('was-validated');
    bootstrap.Modal.getOrCreateInstance(loginModalEl).hide();
  } catch (e) {
    console.error(e);
    showToast('Giriş başarısız: ' + (e.message || 'Hatalı bilgiler'), 'error');
  }
};

const btnLandingLogin = document.getElementById('btnLandingLogin');
if (btnLandingLogin) btnLandingLogin.onclick = async () => {
  const email = document.getElementById('landingEmail').value.trim();
  const password = document.getElementById('landingPassword').value;
  if (!email || !password) { showToast('E-posta ve şifre gerekli.', 'warning'); return; }
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    // Login başarılı - refreshMe() UI değişikliklerini yapacak
    await refreshMe();
  } catch (e) {
    console.error(e);
    showToast('Giriş başarısız: ' + (e.message || 'Hatalı bilgiler'), 'error');
  }
};
const btnLandingRegister = document.getElementById('btnLandingRegister');
if (btnLandingRegister) btnLandingRegister.onclick = () => {
  const regModalEl = document.getElementById('registerModal');
  bootstrap.Modal.getOrCreateInstance(regModalEl).show();
};
const landingForgot = document.getElementById('landingForgot');
if (landingForgot) landingForgot.onclick = async (e) => {
  e.preventDefault();
  const email = document.getElementById('landingEmail').value.trim();
  if (!email) { showToast('E-posta gerekli.', 'warning'); return; }
  try {
    await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
    showToast('E-postanı kontrol et. Geçici şifre gönderildi.', 'success');
  } catch (e) {
    console.error(e);
    showToast('İşlem başarısız.', 'error');
  }
};

async function performLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn('Logout API call failed:', error);
    // Server-side logout başarısız olsa da client-side temizle
  }
  
  // Client-side state temizle
  me = null; 
  activeFriendId = null; 
  chatMessages.innerHTML = '';
  document.getElementById('meBox').textContent = 'Çıkış yapıldı. Tekrar kayıt/giriş yapabilirsiniz.';
  document.getElementById('welcomeUser').textContent = '';
  localStorage.removeItem('lastChatUserId');
  
  // SignalR bağlantısını kapat
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    try {
      await connection.stop();
    } catch (error) {
      console.warn('SignalR disconnection failed:', error);
    }
  }
  
  showLandingShellUI();
  showToast('Çıkış yapıldı.', 'success');
}
document.getElementById('btnLogout').onclick = performLogout;

document.getElementById('btnSend').onclick = async () => {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || !activeFriendId) return;
  try {
    await connection.invoke('SendPrivateMessage', activeFriendId, message);
    chatMessages.appendChild(renderMessageBubble({ id: 0, content: message, fromUserId: me.id }, true));
    chatMessages.scrollTop = chatMessages.scrollHeight;
    input.value = '';
  } catch (err) { console.error(err); }
};

// Enter to send
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btnSend').click();
  }
});

// Image attach
const btnAttach = document.getElementById('btnAttach');
const fileImage = document.getElementById('fileImage');
if (btnAttach && fileImage) {
  btnAttach.onclick = () => fileImage.click();
  fileImage.onchange = async () => {
    if (!fileImage.files || fileImage.files.length === 0 || !activeFriendId) return;
    const file = fileImage.files[0];
    if (!file.type.startsWith('image/')) { showToast('Lütfen bir resim seçin.', 'warning'); return; }
    // 1MB sınırı (örnek)
    if (file.size > 1024 * 1024) { showToast('Resim 1MB üzerinde, lütfen daha küçük yükleyin.', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      try {
        await connection.invoke('SendPrivateAttachment', activeFriendId, dataUrl);
        chatMessages.appendChild(renderMessageBubble({ id: 0, content: `[img]${dataUrl}`, fromUserId: me.id }, true));
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } catch (e) { console.error(e); showToast('Resim gönderilemedi.', 'error'); }
      finally { fileImage.value = ''; }
    };
    reader.readAsDataURL(file);
  };
}

// Share location
const btnShareLocation = document.getElementById('btnShareLocation');
if (btnShareLocation) {
  btnShareLocation.onclick = async () => {
    if (!activeFriendId) return;
    if (!('geolocation' in navigator)) { showToast('Tarayıcı konum desteklemiyor.', 'warning'); return; }
    btnShareLocation.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      }).then(async (pos) => {
        const { latitude, longitude } = pos.coords;
        await connection.invoke('SendPrivateLocation', activeFriendId, latitude, longitude);
        chatMessages.appendChild(renderMessageBubble({ id: 0, content: `[loc]${latitude},${longitude}`, fromUserId: me.id }, true));
        chatMessages.scrollTop = chatMessages.scrollHeight;
      });
    } catch (e) {
      console.error(e); showToast('Konum alınamadı.', 'error');
    } finally {
      btnShareLocation.disabled = false;
    }
  };
}

async function openVideoModal() {
  const modalEl = document.getElementById('videoCallModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  const dialogEl = modalEl.querySelector('.modal-dialog');
  const btnWide = document.getElementById('btnModalWide');
  const btnFull = document.getElementById('btnModalFull');
  if (btnWide) {
    btnWide.onclick = () => {
      dialogEl.classList.toggle('modal-xl');
    };
  }
  if (btnFull) {
    btnFull.onclick = async () => {
      try {
        if (!document.fullscreenElement) {
          await modalEl.requestFullscreen();
          btnFull.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
        } else {
          await document.exitFullscreen();
          btnFull.innerHTML = '<i class="bi bi-fullscreen"></i>';
        }
      } catch {}
    };
  }
  const btn = document.getElementById('btnHangup');
  btn.onclick = async () => { await endCall(true); };
  const rv = document.getElementById('remoteVideo');
  const lv = document.getElementById('localVideo');
  let zoom = 1, offsetX = 0, offsetY = 0;
  const applyTransform = () => {
    rv.style.transform = `scale(${zoom}) translate(${offsetX}px, ${offsetY}px)`;
    rv.style.transformOrigin = 'center center';
  };
  const clampZoom = (z) => Math.max(1, Math.min(4, z));
  document.getElementById('btnZoomIn').onclick = () => { zoom = clampZoom(zoom + 0.2); applyTransform(); };
  document.getElementById('btnZoomOut').onclick = () => { zoom = clampZoom(zoom - 0.2); applyTransform(); };
  document.getElementById('btnZoomReset').onclick = () => { zoom = 1; offsetX = 0; offsetY = 0; applyTransform(); };
  document.getElementById('btnPipSize').onclick = () => { lv.classList.toggle('large'); };

  let dragging = false, startX = 0, startY = 0;
  const stage = modalEl.querySelector('.video-stage');
  stage.onmousedown = (e) => { if (zoom <= 1) return; dragging = true; startX = e.clientX; startY = e.clientY; e.preventDefault(); };
  window.onmouseup = () => { dragging = false; };
  window.onmousemove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX; const dy = e.clientY - startY;
    startX = e.clientX; startY = e.clientY;
    offsetX += dx / zoom; offsetY += dy / zoom;
    applyTransform();
  };
  modalEl.addEventListener('hidden.bs.modal', async () => {
    if (rtc.pc) await endCall(true);
    zoom = 1; offsetX = 0; offsetY = 0; applyTransform();
    stage.onmousedown = null; window.onmouseup = null; window.onmousemove = null;
    lv.classList.remove('large');
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
    dialogEl.classList.remove('modal-xl');
  }, { once: true });
}

async function ensureLocalStream() {
  if (rtc.localStream) return rtc.localStream;
  try {
    rtc.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const lv = document.getElementById('localVideo');
    if (lv) lv.srcObject = rtc.localStream;
    if (rtc.pc) rtc.localStream.getTracks().forEach(t => rtc.pc.addTrack(t, rtc.localStream));
    return rtc.localStream;
  } catch (e) {
    showToast('Kamera/Mikrofon erişimi reddedildi.', 'error');
    throw e;
  }
}

async function ensurePeerConnection() {
  if (rtc.pc) return rtc.pc;
  rtc.pc = new RTCPeerConnection(rtcConfig);
  rtc.pc.onicecandidate = async (e) => {
    if (e.candidate && rtc.peerId) {
      try { await connection.invoke('RtcIceCandidate', rtc.peerId, JSON.stringify(e.candidate)); } catch {}
    }
  };
  rtc.pc.ontrack = (e) => {
    const rv = document.getElementById('remoteVideo');
    if (rv) rv.srcObject = e.streams[0];
    rtc.remoteStream = e.streams[0];
  };
  rtc.pc.onconnectionstatechange = async () => {
    const s = rtc.pc?.connectionState;
    if (s === 'failed' || s === 'disconnected' || s === 'closed') {
      await endCall(false);
    }
  };
  if (rtc.localStream) rtc.localStream.getTracks().forEach(t => rtc.pc.addTrack(t, rtc.localStream));
  return rtc.pc;
}

async function startVideoCall(toUserId) {
  try {
    if (rtc.pc && rtc.peerId && rtc.peerId !== toUserId) {
      showToast('Zaten bir görüşme devam ediyor.', 'warning');
      return;
    }
    rtc.isCaller = true;
    rtc.peerId = toUserId;
    await openVideoModal();
    await ensurePeerConnection();
    await ensureLocalStream();
    const offer = await rtc.pc.createOffer();
    await rtc.pc.setLocalDescription(offer);
    await connection.invoke('RtcOffer', toUserId, JSON.stringify(offer));
  } catch (e) {
    console.error(e);
    showToast('Çağrı başlatılamadı.', 'error');
    await endCall(false);
  }
}

async function endCall(notifyPeer) {
  try {
    if (notifyPeer && rtc.peerId) {
      try { await connection.invoke('RtcHangup', rtc.peerId); } catch {}
    }
    if (rtc.localStream) {
      rtc.localStream.getTracks().forEach(t => t.stop());
    }
    if (rtc.pc) try { rtc.pc.close(); } catch {}
  } finally {
    rtc.pc = null;
    rtc.localStream = null;
    rtc.remoteStream = null;
    rtc.peerId = null;
    rtc.isCaller = false;
    const lv = document.getElementById('localVideo'); if (lv) lv.srcObject = null;
    const rv = document.getElementById('remoteVideo'); if (rv) rv.srcObject = null;
    const modalEl = document.getElementById('videoCallModal');
    const inst = bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
  }
}

// Initialize systems
refreshMe();

// Initialize theme system
ThemeManager.init();

// Admin Panel System
const AdminPanel = {
  currentAdmin: null,
  
  async checkAdminAuth() {
    try {
      console.log('[AdminPanel] calling /api/admin/me to verify admin status');
      this.currentAdmin = await api('/api/admin/me');
      console.log('[AdminPanel] /api/admin/me returned:', this.currentAdmin);
      return true;
    } catch (err) {
      console.warn('[AdminPanel] admin auth check failed:', err);
      this.currentAdmin = null;
      return false;
    }
  },
  
  showAdminPanel() {
    const adminPanel = document.getElementById('adminPanel');
    const landingShell = document.getElementById('landingShell');
    const appShell = document.getElementById('appShell');
    
    if (landingShell) landingShell.style.display = 'none';
    if (appShell) appShell.style.display = 'none';
    if (adminPanel) adminPanel.style.display = '';
    
    if (this.currentAdmin) {
      const adminName = this.currentAdmin.displayName || this.currentAdmin.DisplayName || this.currentAdmin.email || this.currentAdmin.Email || 'Admin';
      document.getElementById('adminWelcome').textContent = `Hoş geldin, ${adminName}`;
    }
    
    this.loadUsers();
  },
  
  hideAdminPanel() {
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) adminPanel.style.display = 'none';
    
    // Check if user was authenticated before admin mode
    if (me) {
      showAppShellUI();
    } else {
      showLandingShellUI();
    }
  },
  
  async loadUsers() {
    const loading = document.getElementById('adminUsersLoading');
    const table = document.getElementById('adminUsersTable');
    
    try {
      loading.classList.remove('d-none');
      const users = await api('/api/admin/users');
      
      table.innerHTML = '';
      let totalUsers = 0;
      let activeUsers = 0;
      let lockedUsers = 0;
      
      users.forEach(user => {
        const email = user.email || user.Email || '';
        const displayName = user.displayName || user.DisplayName || '';
        const id = user.id || user.Id || '';
        const isLocked = (user.isLocked ?? user.IsLocked) || false;

        totalUsers++;
        if (isLocked) lockedUsers++; else activeUsers++;

        const row = document.createElement('tr');
        const statusBadge = isLocked ? '<span class="badge bg-warning">Engelli</span>' : '<span class="badge bg-success">Aktif</span>';

        row.innerHTML = `
          <td>${email}</td>
          <td>${displayName || '-'}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" onclick="AdminPanel.editUser('${id}')" title="Düzenle">
                <i class="bi bi-pencil"></i>
              </button>
              ${!isLocked ? 
                `<button class="btn btn-outline-warning" onclick="AdminPanel.lockUser('${id}', '${email}')" title="Engelle">
                  <i class="bi bi-lock"></i>
                </button>` :
                `<button class="btn btn-outline-success" onclick="AdminPanel.unlockUser('${id}')" title="Engeli Kaldır">
                  <i class="bi bi-unlock"></i>
                </button>`
              }
              <button class="btn btn-outline-danger" onclick="AdminPanel.deleteUser('${id}', '${email}')" title="Sil">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        `;
        table.appendChild(row);
      });
      
      // Update statistics
      document.getElementById('totalUsersCount').textContent = totalUsers;
      document.getElementById('activeUsersCount').textContent = activeUsers;
      document.getElementById('lockedUsersCount').textContent = lockedUsers;
      
    } catch (error) {
      console.error('Error loading users:', error);
      showToast('Kullanıcılar yüklenirken hata oluştu.', 'error');
    } finally {
      loading.classList.add('d-none');
    }
  },
  
  showAddUserModal() {
    document.getElementById('userModalTitle').textContent = 'Yeni Kullanıcı Ekle';
    document.getElementById('userFormId').value = '';
    document.getElementById('userFormEmail').value = '';
    document.getElementById('userFormDisplayName').value = '';
    document.getElementById('userFormPassword').value = '';
    document.getElementById('userFormPassword').required = true;
    document.getElementById('passwordOptionalText').style.display = 'none';
    
    const form = document.getElementById('userForm');
    form.classList.remove('was-validated');
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal')).show();
  },
  
  async editUser(userId) {
    try {
      const user = await api(`/api/users/${userId}`);
      
      document.getElementById('userModalTitle').textContent = 'Kullanıcı Düzenle';
      document.getElementById('userFormId').value = userId;
      document.getElementById('userFormEmail').value = user.email;
      document.getElementById('userFormDisplayName').value = user.displayName || '';
      document.getElementById('userFormPassword').value = '';
      document.getElementById('userFormPassword').required = false;
      document.getElementById('passwordOptionalText').style.display = '';
      
      const form = document.getElementById('userForm');
      form.classList.remove('was-validated');
      
      bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal')).show();
    } catch (error) {
      showToast('Kullanıcı bilgileri alınırken hata oluştu.', 'error');
    }
  },
  
  async saveUser() {
    const form = document.getElementById('userForm');
    form.classList.add('was-validated');
    
    if (!form.checkValidity()) return;
    
    const userId = document.getElementById('userFormId').value;
    const email = document.getElementById('userFormEmail').value.trim();
    const displayName = document.getElementById('userFormDisplayName').value.trim();
    const password = document.getElementById('userFormPassword').value;
    
    try {
      if (userId) {
        // Update user
        await api(`/api/admin/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({
            Email: email,
            DisplayName: displayName,
            Password: password || undefined
          })
        });
        showToast('Kullanıcı başarıyla güncellendi.', 'success');
      } else {
        // Create user
        await api('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            Email: email,
            DisplayName: displayName,
            Password: password
          })
        });
        showToast('Kullanıcı başarıyla oluşturuldu.', 'success');
      }
      
      bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal')).hide();
      this.loadUsers();
      
    } catch (error) {
      console.error('Save user error:', error);
      showToast('Kullanıcı kaydedilirken hata oluştu: ' + (error.message || 'Bilinmeyen hata'), 'error');
    }
  },
  
  lockUser(userId, email) {
    document.getElementById('lockUserId').value = userId;
    document.getElementById('lockUserMessage').textContent = `${email} kullanıcısını engellemek istediğinizden emin misiniz?`;
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('lockUserModal')).show();
  },
  
  async confirmLockUser() {
    const userId = document.getElementById('lockUserId').value;
    const lockoutDays = parseInt(document.getElementById('lockoutDays').value);
    
    try {
      await api(`/api/admin/users/${userId}/lock`, {
        method: 'POST',
        body: JSON.stringify({ LockoutDays: lockoutDays })
      });
      
      showToast('Kullanıcı başarıyla engellendi.', 'success');
      bootstrap.Modal.getOrCreateInstance(document.getElementById('lockUserModal')).hide();
      this.loadUsers();
      
    } catch (error) {
      console.error('Lock user error:', error);
      showToast('Kullanıcı engellenirken hata oluştu.', 'error');
    }
  },
  
  async unlockUser(userId) {
    const confirmed = await showConfirm(
      'Engeli Kaldır',
      'Bu kullanıcının engelini kaldırmak istediğinizden emin misiniz?',
      'Engeli Kaldır',
      'btn-success'
    );
    
    if (!confirmed) return;
    
    try {
      await api(`/api/admin/users/${userId}/unlock`, { method: 'POST' });
      showToast('Kullanıcının engeli kaldırıldı.', 'success');
      this.loadUsers();
    } catch (error) {
      console.error('Unlock user error:', error);
      showToast('Engel kaldırılırken hata oluştu.', 'error');
    }
  },
  
  async deleteUser(userId, email) {
    const confirmed = await showConfirm(
      'Kullanıcıyı Sil',
      `${email} kullanıcısını kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz ve kullanıcının tüm mesajları silinecektir.`,
      'Sil',
      'btn-danger'
    );
    
    if (!confirmed) return;
    
    try {
      await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      showToast('Kullanıcı başarıyla silindi.', 'success');
      this.loadUsers();
    } catch (error) {
      console.error('Delete user error:', error);
      showToast('Kullanıcı silinirken hata oluştu.', 'error');
    }
  },
  
  async logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Admin logout API failed:', error);
    }
    
    this.currentAdmin = null;
    this.hideAdminPanel();
    showToast('Admin çıkışı yapıldı.', 'success');
  }
};

// Admin Panel Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Admin login link
  const adminLoginLink = document.getElementById('adminLoginLink');
  if (adminLoginLink) {
    adminLoginLink.onclick = (e) => {
      e.preventDefault();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('adminLoginModal')).show();
    };
  }
  
  // Admin login button
  const btnAdminLogin = document.getElementById('btnAdminLogin');
    if (btnAdminLogin) {
    btnAdminLogin.onclick = async () => {
      const form = document.getElementById('adminLoginForm');
      form.classList.add('was-validated');
      
      if (!form.checkValidity()) return;
      
      const email = document.getElementById('adminLoginEmail').value.trim();
      const password = document.getElementById('adminLoginPassword').value;
      
      try {
        console.log('[Admin] calling /api/admin/login for', email);
        const res = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        console.log('[Admin] /api/admin/login call completed', res);
        
        const ok = await AdminPanel.checkAdminAuth();
        console.log('[Admin] checkAdminAuth returned', ok);
        if (ok) {
          AdminPanel.showAdminPanel();
        } else {
          showToast('Admin yetkisi doğrulanamadı.', 'error');
        }
        
        bootstrap.Modal.getOrCreateInstance(document.getElementById('adminLoginModal')).hide();
        showToast('Admin girişi başarılı.', 'success');
        
        form.reset();
        form.classList.remove('was-validated');
        
      } catch (error) {
        console.error('Admin login error:', error);
        showToast('Admin girişi başarısız: Yetkisiz erişim', 'error');
      }
    };
  }
  
  // Admin panel buttons
  const btnBackToChat = document.getElementById('btnBackToChat');
  if (btnBackToChat) {
    btnBackToChat.onclick = () => AdminPanel.hideAdminPanel();
  }
  
  const btnAdminLogout = document.getElementById('btnAdminLogout');
  if (btnAdminLogout) {
    btnAdminLogout.onclick = () => AdminPanel.logout();
  }
  
  const btnAddUser = document.getElementById('btnAddUser');
  if (btnAddUser) {
    btnAddUser.onclick = () => AdminPanel.showAddUserModal();
  }
  
  const btnSaveUser = document.getElementById('btnSaveUser');
  if (btnSaveUser) {
    btnSaveUser.onclick = () => AdminPanel.saveUser();
  }
  
  const btnLockUser = document.getElementById('btnLockUser');
  if (btnLockUser) {
    btnLockUser.onclick = () => AdminPanel.confirmLockUser();
  }
});

// Make AdminPanel globally accessible
window.AdminPanel = AdminPanel;

// --- Ensure admin handlers are attached immediately ---
// Sometimes this script is loaded after DOMContentLoaded; attach handlers now if elements exist
{
  const adminLoginLinkImmediate = document.getElementById('adminLoginLink');
  if (adminLoginLinkImmediate) {
    adminLoginLinkImmediate.onclick = (e) => {
      e.preventDefault();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('adminLoginModal')).show();
    };
  }

  const btnAdminLoginImmediate = document.getElementById('btnAdminLogin');
  if (btnAdminLoginImmediate) {
    btnAdminLoginImmediate.onclick = async () => {
      const form = document.getElementById('adminLoginForm');
      form.classList.add('was-validated');
      if (!form.checkValidity()) return;
      const email = document.getElementById('adminLoginEmail').value.trim();
      const password = document.getElementById('adminLoginPassword').value;
      try {
        console.log('[Admin Immediate] calling /api/admin/login for', email);
        const res = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        console.log('[Admin Immediate] /api/admin/login returned', res);

        const ok = await AdminPanel.checkAdminAuth();
        console.log('[Admin Immediate] checkAdminAuth returned', ok);
        if (ok) {
          AdminPanel.showAdminPanel();
        } else {
          showToast('Admin yetkisi doğrulanamadı.', 'error');
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById('adminLoginModal')).hide();
        showToast('Admin girişi başarılı.', 'success');

        form.reset();
        form.classList.remove('was-validated');
      } catch (error) {
        console.error('Admin login error:', error);
        showToast('Admin girişi başarısız: Yetkisiz erişim', 'error');
      }
    };
  }

    // Other admin controls (attach immediately if present)
    const btnBackToChatImmediate = document.getElementById('btnBackToChat');
    if (btnBackToChatImmediate) btnBackToChatImmediate.onclick = () => AdminPanel.hideAdminPanel();

    const btnAdminLogoutImmediate = document.getElementById('btnAdminLogout');
    if (btnAdminLogoutImmediate) btnAdminLogoutImmediate.onclick = () => AdminPanel.logout();

    const btnAddUserImmediate = document.getElementById('btnAddUser');
    if (btnAddUserImmediate) btnAddUserImmediate.onclick = () => AdminPanel.showAddUserModal();

    const btnSaveUserImmediate = document.getElementById('btnSaveUser');
    if (btnSaveUserImmediate) btnSaveUserImmediate.onclick = () => AdminPanel.saveUser();

    const btnLockUserImmediate = document.getElementById('btnLockUser');
    if (btnLockUserImmediate) btnLockUserImmediate.onclick = () => AdminPanel.confirmLockUser();
}
