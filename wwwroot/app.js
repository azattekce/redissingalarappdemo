// Extracted client script from index.html for separation of concerns.
// Note: This mirrors the previous inline script one-to-one.

let me = null;
let activeFriendId = null;
const chatMessages = document.getElementById('chatMessages');
const userCache = new Map();
const avatarCache = new Map(); // userId -> avatar url
let myAvatarUrl = null;

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
  bubble.className = `msg-bubble ${mine ? 'bg-primary text-white' : 'bg-light'}`;
  const senderName = nameOverride ?? (mine ? (me?.displayName || me?.email || 'Ben') : (userCache.get(fromId) || ''));
  const content = m.content || m.Content || '';
  const nameEl = document.createElement('div');
  nameEl.className = `small ${mine ? 'text-white-50' : 'text-muted'}`;
  nameEl.textContent = senderName || '';
  const textEl = document.createElement('div');
  textEl.textContent = content;
  bubble.appendChild(nameEl); bubble.appendChild(textEl);

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
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(await res.text());
  if (res.headers.get('Content-Type')?.includes('application/json')) return res.json();
  return null;
}

async function refreshMe() {
  try {
    me = await api('/api/auth/me');
    const p = await api('/api/profile');
    myAvatarUrl = p?.profile?.avatarUrl || defaultAvatarSvg();
    document.getElementById('meBox').textContent = `${me.displayName || me.email} (${me.id})`;
    document.getElementById('welcomeUser').innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <span>Hoş geldin, <strong>${me.displayName || me.email}</strong></span>
        <button class="btn btn-sm btn-outline-secondary" onclick="openMyProfile()">Bilgilerim</button>
      </div>`;
    document.getElementById('btnShowRegister').style.display = 'none';
    document.getElementById('btnShowLogin').style.display = 'none';
    document.getElementById('btnLogout').style.display = '';
    document.getElementById('landingShell').style.display = 'none';
    document.getElementById('appShell').style.display = '';
    await Promise.all([refreshUsers(), refreshFriends(), refreshRequests()]);
    await startHub();
    await restoreLastChat();
  } catch {
    me = null;
    document.getElementById('meBox').textContent = 'Giriş yapılmadı';
    document.getElementById('welcomeUser').textContent = '';
    document.getElementById('btnShowRegister').style.display = '';
    document.getElementById('btnShowLogin').style.display = '';
    document.getElementById('btnLogout').style.display = 'none';
    document.getElementById('landingShell').style.display = '';
    document.getElementById('appShell').style.display = 'none';
  }
}

async function refreshUsers() {
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
      left.appendChild(img); left.appendChild(name);
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
          try {
            await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ toUserId: u.id }) });
            btn.textContent = 'İstek gönderildi';
            btn.disabled = true;
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-secondary');
            await refreshRequests();
          } catch (e) {
            console.error(e);
            alert('İstek gönderilirken bir hata oluştu.');
          }
        };
        li.appendChild(left); li.appendChild(btn);
      }
      ul.appendChild(li);
    });
}

async function refreshFriends() {
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
    left.appendChild(img); left.appendChild(name);
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
      if (blocks.includes(f.id)) {
        await api('/api/friends/unblock', { method:'POST', body: JSON.stringify({ userId: f.id }) });
      } else {
        await api('/api/friends/block', { method:'POST', body: JSON.stringify({ userId: f.id }) });
      }
      await refreshFriends();
    };
    const removeBtn = document.createElement('button'); removeBtn.className = 'icon-btn dark'; removeBtn.title = 'Sil';
    removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
    removeBtn.onclick = async ()=>{ await api('/api/friends/remove', { method:'POST', body: JSON.stringify({ userId: f.id }) }); await refreshFriends(); };
    wrap.appendChild(chatBtn); wrap.appendChild(profBtn); wrap.appendChild(videoBtn); wrap.appendChild(blockBtn); wrap.appendChild(removeBtn);
    li.appendChild(left);
    li.appendChild(wrap);
    ul.appendChild(li);
  });
}

async function refreshRequests() {
  const { incoming, outgoing } = await api('/api/friends/requests');
  const inc = document.getElementById('incomingList');
  const out = document.getElementById('outgoingList');
  inc.innerHTML = ''; out.innerHTML = '';
  incoming.forEach(r => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.textContent = `İstek #${r.id} -> size`;
    const div = document.createElement('div');
    const ac = document.createElement('button'); ac.className = 'btn btn-sm btn-success me-2'; ac.textContent = 'Kabul'; ac.onclick = async ()=>{ await api('/api/friends/respond', { method:'POST', body: JSON.stringify({ requestId: r.id, accept: true }) }); await Promise.all([refreshFriends(), refreshRequests()]); };
    const dc = document.createElement('button'); dc.className = 'btn btn-sm btn-outline-danger'; dc.textContent = 'Reddet'; dc.onclick = async ()=>{ await api('/api/friends/respond', { method:'POST', body: JSON.stringify({ requestId: r.id, accept: false }) }); await refreshRequests(); };
    div.appendChild(ac); div.appendChild(dc);
    li.appendChild(div);
    inc.appendChild(li);
  });
  outgoing.forEach(r => {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    li.textContent = `İstek #${r.id} -> gönderildi (bekliyor)`;
    out.appendChild(li);
  });
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
  await api('/api/auth/logout', { method: 'POST' });
  me = null; activeFriendId = null; chatMessages.innerHTML = '';
  document.getElementById('meBox').textContent = 'Çıkış yapıldı. Tekrar kayıt/giriş yapabilirsiniz.';
  document.getElementById('welcomeUser').textContent = '';
  localStorage.removeItem('lastChatUserId');
  document.getElementById('btnShowRegister').style.display = '';
  document.getElementById('btnShowLogin').style.display = '';
  document.getElementById('btnLogout').style.display = 'none';
  document.getElementById('landingShell').style.display = '';
  document.getElementById('appShell').style.display = 'none';
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

refreshMe();
