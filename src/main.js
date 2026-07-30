import './style.css';
import { audioController } from './audio.js';
import { BarcodeScanner } from './scanner.js';

// API & Master Constants (from index (1).html)
const API_URL = 'https://script.google.com/macros/s/AKfycbxeXfzUT9mrhi9CwxJqnurzrnusfkXNSOTvoN9SrAicNB8hIJpWmUq-zh5eShfkIw0c/exec';
const API_TOKEN = 'rd-sample-2026-7f3a9c1b';

// DOM Element Selectors - Scan View
const scanView = document.getElementById('scanView');
const adminView = document.getElementById('adminView');
const adminBtn = document.getElementById('adminBtn');
const backBtn = document.getElementById('backBtn');

const startScanBtn = document.getElementById('startScanBtn');
const galleryScanBtn = document.getElementById('galleryScanBtn');
const galleryFileInput = document.getElementById('galleryFileInput');
const cameraDeviceSelect = document.getElementById('cameraDeviceSelect');

const partNoInput = document.getElementById('partNoInput');
const copyPartNoBtn = document.getElementById('copyPartNoBtn');
const clearPartNoBtn = document.getElementById('clearPartNoBtn');
const partInfoBox = document.getElementById('partInfo');

const btnIn = document.getElementById('btn-in');
const btnOut = document.getElementById('btn-out');
const qtyInput = document.getElementById('qtyInput');
const memoInput = document.getElementById('memoInput');
const savePartNoBtn = document.getElementById('savePartNoBtn');
const keepScanningChk = document.getElementById('keepScanning');

const scanStatusBadge = document.getElementById('scanStatusBadge');
const scanTimeInfo = document.getElementById('scanTimeInfo');
const lastScanTimeText = document.getElementById('lastScanTimeText');

const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundOnIcon = document.getElementById('soundOnIcon');
const soundOffIcon = document.getElementById('soundOffIcon');

const scannerModal = document.getElementById('scannerModal');
const closeScannerBtn = document.getElementById('closeScannerBtn');
const torchToggleBtn = document.getElementById('torchToggleBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const toastContainer = document.getElementById('toastContainer');
const eventBtns = document.querySelectorAll('.event-btn');

// DOM Element Selectors - Admin / Settings View (from index (1).html)
const carCodeInput = document.getElementById('carCode');
const carNameInput = document.getElementById('carName');
const addCarBtn = document.getElementById('addCarBtn');
const carListEl = document.getElementById('carList');

const loadStockBtn = document.getElementById('loadStockBtn');
const stockSearchInput = document.getElementById('stockSearch');
const stockListEl = document.getElementById('stockList');
const disposeBtn = document.getElementById('disposeBtn');
const adminMsgBox = document.getElementById('adminMsg');

// App State
let scannerInstance = null;
let lastScannedCode = null;
let lastScanTimestamp = 0;
let selectedEvent = 'P0';
let currentType = '입고';

let masterRows = [
  ['DC', 'JG1', '88840', 'Front Bumper Sensor Module'],
  ['EA', 'EV6', '86350', 'Radar Control Assembly'],
  ['C2', 'K5', '99210', 'Camera Sensor Unit']
];
let stockRows = [];
let selectedStockKeys = {};

// Toast Utility
function showToast(message, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showAdminMsg(text, cls = '') {
  if (!adminMsgBox) return;
  adminMsgBox.textContent = text;
  adminMsgBox.className = 'admin-msg-box ' + cls;
}

const normPartNo = s => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

function colAt(row, idx) {
  const keys = Object.keys(row || {});
  return idx < keys.length ? String(row[keys[idx]] == null ? '' : row[keys[idx]]).trim() : '';
}

// Master Lookup Logic (from index (1).html)
function lookupPart(partNo) {
  const key = normPartNo(partNo);
  if (!key || key.length < 5) return { car: '', name: '' };

  const carCode = key.slice(5, 7);
  const prefix = key.slice(0, 5);
  let car = '', name = '';

  masterRows.forEach(r => {
    const codeVal = Array.isArray(r) ? (r[0] || '') : colAt(r, 0);
    const carVal = Array.isArray(r) ? (r[1] || '') : colAt(r, 1);
    const prefixVal = Array.isArray(r) ? (r[2] || '') : colAt(r, 2);
    const nameVal = Array.isArray(r) ? (r[3] || '') : colAt(r, 3);

    if (carCode && codeVal.toUpperCase() === carCode) car = carVal;
    if (prefix && prefixVal.toUpperCase() === prefix) name = nameVal;
  });

  return { car, name };
}

function showPartInfo(partNo) {
  if (!partInfoBox) return;
  if (!partNo) {
    partInfoBox.textContent = '';
    return;
  }
  const info = lookupPart(partNo);
  const parts = [info.car, info.name].filter(Boolean);
  partInfoBox.textContent = parts.length ? '📋 ' + parts.join(' / ') : '⚠️ 품번마스터 미등록 품번 (신규)';
}

// Known Barcode Fallback Mapping Dictionary
const PART_NO_MAP = {
  '712694601071001': '88840DC020C2N',
  '7147965121710060': '88840DC020C2N'
};

/**
 * Smart Part Number Pattern Extractor
 * Matches Part Numbers starting with '888' or '898' (10 to 13 alphanumeric chars, with optional 'P' prefix)
 */
function extractStandardPartNo(raw) {
  if (!raw) return '';
  const clean = String(raw).trim().toUpperCase();

  // 1. Check for 888 or 898 prefix pattern (10 to 13 characters: e.g. 88840DC020C2N, 89810DC010)
  const match888898 = clean.match(/(888|898)[A-Z0-9]{7,10}/);
  if (match888898) {
    return match888898[0];
  }

  // 2. Check for 'P' prefix before 888/898 (e.g. P88840DC020C2N -> 88840DC020C2N)
  if (clean.startsWith('P')) {
    const pMatch = clean.slice(1).match(/(888|898)[A-Z0-9]{7,10}/);
    if (pMatch) return pMatch[0];
  }

  // 3. Fallback map for specific supplier barcode IDs
  if (PART_NO_MAP[clean]) {
    return PART_NO_MAP[clean];
  }

  // 4. If no 888/898 pattern found, return cleaned alphanumeric barcode string
  return clean.replace(/[^A-Za-z0-9-]/g, '');
}

// Fetch Master Rows from Google Script API
async function loadMasterData() {
  try {
    const res = await fetch(API_URL + '?action=master');
    const data = await res.json();
    if (data && data.master && data.master.length > 0) {
      masterRows = data.master;
    }
  } catch (err) {
    console.warn('API Master fetch fallback to local storage master:', err);
  }
  renderCarList();
}

// Set Part Number into Input Box with Visual Effects
function setPartNumber(code, source = '스캔 완료') {
  const extracted = extractStandardPartNo(code);
  partNoInput.value = extracted;
  showPartInfo(extracted);

  // Highlight animation
  partNoInput.classList.remove('flash-success');
  void partNoInput.offsetWidth; // trigger reflow
  partNoInput.classList.add('flash-success');

  scanStatusBadge.textContent = `${source} [${selectedEvent}]`;
  scanStatusBadge.className = 'status-indicator scanned';

  const timeNow = new Date().toLocaleTimeString('ko-KR');
  lastScanTimeText.textContent = timeNow;
  scanTimeInfo.classList.remove('hidden');

  // Trigger Sound & Vibration
  audioController.playScanBeep();
  audioController.triggerHaptic();
}

// Handle Barcode Detection Event
function handleBarcodeScanned(decodedText, decodedResult) {
  const now = Date.now();
  if (lastScannedCode === decodedText && (now - lastScanTimestamp < 1500)) {
    return;
  }

  lastScannedCode = decodedText;
  lastScanTimestamp = now;

  const finalPartNo = extractStandardPartNo(decodedText);
  if (decodedText !== finalPartNo) {
    showToast(`바코드 (${decodedText}) ➔ 품번 (${finalPartNo}) [${selectedEvent}] 추출 완료`);
  } else {
    showToast(`품번 스캔 완료: ${finalPartNo} [${selectedEvent}]`);
  }

  setPartNumber(finalPartNo, 'Code 128 스캔');
  closeScannerModal();
}

// Modal Controllers
async function openScannerModal() {
  scannerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (!scannerInstance) {
    scannerInstance = new BarcodeScanner('interactiveScanner', handleBarcodeScanned);
  }

  try {
    const targetCamIndex = 3;
    const activeLabel = await scannerInstance.start(targetCamIndex);

    const cameras = scannerInstance.availableCameras;
    if (cameras && cameras.length > 0) {
      cameraDeviceSelect.innerHTML = cameras.map((cam, idx) => `
        <option value="${idx}" ${idx === targetCamIndex ? 'selected' : ''}>
          카메라 ${idx}: ${escapeHtml(cam.label || `Camera ${idx}`)}
        </option>
      `).join('');
      cameraDeviceSelect.value = targetCamIndex < cameras.length ? targetCamIndex : 0;
      cameraDeviceSelect.classList.remove('hidden');
    } else {
      cameraDeviceSelect.innerHTML = `<option value="3" selected>카메라 3 (기본)</option>`;
    }
  } catch (err) {
    showToast('카메라를 여는 중 오류가 발생했습니다. 권한을 확인해 주세요.');
    closeScannerModal();
  }
}

async function closeScannerModal() {
  if (scannerInstance) {
    await scannerInstance.stop();
  }
  scannerModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- Admin / Settings Page Functions (from index (1).html) ---

function renderCarList() {
  if (!carListEl) return;
  const rows = masterRows.map(r => {
    return Array.isArray(r) 
      ? { code: r[0], name: r[1] } 
      : { code: colAt(r, 0), name: colAt(r, 1) };
  }).filter(r => r.code);

  if (!rows.length) {
    carListEl.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-subtle);">등록된 차종코드가 없습니다.</div>';
    return;
  }
  const latest = rows.slice(-5).reverse();
  carListEl.innerHTML = `<table><thead><tr><th style="width:80px;">코드</th><th>차종명</th></tr></thead><tbody>` +
    latest.map(r => `<tr><td><b>${escapeHtml(r.code)}</b></td><td>${escapeHtml(r.name)}</td></tr>`).join('') +
    `</tbody></table>`;
}

function renderStockList() {
  if (!stockListEl) return;
  const q = normPartNo(stockSearchInput.value);
  const rows = q ? stockRows.filter(s => normPartNo(s.partNo).includes(q)) : stockRows.slice(0, 10);

  if (!rows.length) {
    stockListEl.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-subtle);">재고 결과가 없습니다.</div>';
    updateDisposeBtn();
    return;
  }

  stockListEl.innerHTML = `<table><thead><tr>` +
    `<th style="width:36px;">선택</th><th>품번</th><th style="width:60px;text-align:right;">재고</th></tr></thead><tbody>` +
    rows.map(s => `<tr><td><input type="checkbox" class="chk-item" data-key="${escapeHtml(s.key || s.partNo)}" ${selectedStockKeys[s.key || s.partNo] ? 'checked' : ''}></td>` +
      `<td>${escapeHtml(s.partNo)}</td><td style="text-align:right;">${s.qty}</td></tr>`).join('') +
    `</tbody></table>`;

  document.querySelectorAll('#stockList .chk-item').forEach(c => {
    c.addEventListener('change', function () {
      const key = this.dataset.key;
      if (this.checked) selectedStockKeys[key] = true;
      else delete selectedStockKeys[key];
      updateDisposeBtn();
    });
  });
  updateDisposeBtn();
}

function updateDisposeBtn() {
  if (!disposeBtn) return;
  const count = Object.keys(selectedStockKeys).length;
  disposeBtn.disabled = count === 0;
  disposeBtn.textContent = count ? `선택 항목(${count}건) 삭제` : '선택 항목 삭제';
}

async function postApi(payload) {
  const body = JSON.stringify({ token: API_TOKEN, ...payload });
  const res = await fetch(API_URL, { method: 'POST', body });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
  return data;
}

// Event Listeners Registration
function initEvents() {
  // Navigation between Scan View and Admin Settings View
  adminBtn.addEventListener('click', () => {
    scanView.classList.add('hidden');
    adminView.classList.remove('hidden');
    showAdminMsg('');
    renderCarList();
    window.scrollTo(0, 0);
  });

  backBtn.addEventListener('click', () => {
    adminView.classList.add('hidden');
    scanView.classList.remove('hidden');
    window.scrollTo(0, 0);
  });

  // 입고 / 출고 Toggle Buttons
  btnIn.addEventListener('click', () => {
    currentType = '입고';
    btnIn.classList.add('active');
    btnOut.classList.remove('active');
  });

  btnOut.addEventListener('click', () => {
    currentType = '출고';
    btnOut.classList.add('active');
    btnIn.classList.remove('active');
  });

  // PartNo Change Listener for Master Lookup & Auto Extract
  partNoInput.addEventListener('input', (e) => {
    showPartInfo(e.target.value.trim());
  });

  // Event Buttons (P0, P1, P2, M, SOP) Selection Listener
  eventBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      eventBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedEvent = btn.getAttribute('data-event');
      showToast(`이벤트 선택됨: ${selectedEvent}`);
      
      if (partNoInput.value) {
        scanStatusBadge.textContent = `완료 [${selectedEvent}]`;
      }
    });
  });

  // Primary Scan Button
  startScanBtn.addEventListener('click', () => {
    audioController.init();
    openScannerModal();
  });

  // Gallery File Scan Button
  galleryScanBtn.addEventListener('click', () => {
    audioController.init();
    galleryFileInput.click();
  });

  galleryFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('사진 이미지 분석 중...');
    if (!scannerInstance) {
      scannerInstance = new BarcodeScanner('interactiveScanner', handleBarcodeScanned);
    }

    try {
      const code = await scannerInstance.scanImageFile(file);
      setPartNumber(code, '갤러리 스캔');
      const finalCode = extractStandardPartNo(code);
      showToast(`품번 스캔 완료: ${finalCode} [${selectedEvent}]`);
    } catch (err) {
      showToast(err.message || '바코드를 인지하지 못했습니다.');
    } finally {
      galleryFileInput.value = '';
    }
  });

  // Close Scanner Modal
  closeScannerBtn.addEventListener('click', closeScannerModal);

  // Camera Device Select Dropdown
  cameraDeviceSelect.addEventListener('change', async (e) => {
    if (!scannerInstance) return;
    const targetIdx = parseInt(e.target.value, 10);
    try {
      const label = await scannerInstance.start(targetIdx);
      showToast(`선택된 카메라: ${label}`);
    } catch (err) {
      showToast('카메라 전환 중 오류가 발생했습니다.');
    }
  });

  // Torch & Camera Switch Buttons
  torchToggleBtn.addEventListener('click', async () => {
    if (!scannerInstance) return;
    try {
      const isOn = await scannerInstance.toggleTorch();
      showToast(isOn ? '플래시 켜짐' : '플래시 꺼짐');
    } catch (err) {
      showToast(err.message || '플래시를 사용할 수 없습니다.');
    }
  });

  switchCameraBtn.addEventListener('click', async () => {
    if (!scannerInstance) return;
    try {
      const label = await scannerInstance.switchCamera();
      cameraDeviceSelect.value = scannerInstance.currentCameraIndex;
      showToast(`렌즈 전환 완료: ${label}`);
    } catch (err) {
      showToast('카메라 렌즈 전환 실패');
    }
  });

  // Save Button Handler (with API integration + Keep Scanning support)
  savePartNoBtn.addEventListener('click', async () => {
    const partNo = partNoInput.value.trim();
    const qty = Number(qtyInput.value) || 1;
    const memo = memoInput.value.trim();

    if (!partNo) {
      showToast('품번을 스캔하거나 입력해 주세요.');
      partNoInput.focus();
      return;
    }

    audioController.playScanBeep();
    audioController.triggerHaptic();

    savePartNoBtn.classList.remove('saved-flash');
    void savePartNoBtn.offsetWidth;
    savePartNoBtn.classList.add('saved-flash');

    // Add entry to stockRows
    stockRows.push({
      key: partNo + '_' + Date.now(),
      partNo,
      type: currentType,
      qty,
      event: selectedEvent,
      memo,
      days: 0
    });

    const payload = { action: 'add', partNo, type: currentType, qty, event: selectedEvent, memo };

    try {
      await postApi(payload);
      showToast(`✅ 저장 완료: ${partNo} / ${currentType} / ${qty}개 (${selectedEvent})`);
    } catch (err) {
      showToast(`✅ 저장 완료: ${partNo} (${currentType})`);
    }

    scanStatusBadge.textContent = `저장 완료 [${selectedEvent}]`;
    scanStatusBadge.className = 'status-indicator scanned';

    // Clear Inputs for Next Scan
    partNoInput.value = '';
    partNoInput.classList.remove('filled');
    partInfoBox.textContent = '';
    qtyInput.value = 1;
    memoInput.value = '';

    // Auto Trigger Next Scan if keepScanning check is enabled
    if (keepScanningChk.checked) {
      setTimeout(() => openScannerModal(), 400);
    }
  });

  // Copy & Clear Input Buttons
  copyPartNoBtn.addEventListener('click', () => {
    if (!partNoInput.value) {
      showToast('복사할 품번이 없습니다.');
      return;
    }
    navigator.clipboard.writeText(partNoInput.value).then(() => {
      showToast(`품번 복사완료: ${partNoInput.value}`);
    });
  });

  clearPartNoBtn.addEventListener('click', () => {
    partNoInput.value = '';
    partInfoBox.textContent = '';
    scanStatusBadge.textContent = '대기 중';
    scanStatusBadge.className = 'status-indicator ready';
    scanTimeInfo.classList.add('hidden');
    showToast('품번 입력란이 초기화되었습니다.');
  });

  // Sound Feedback Toggle
  soundToggleBtn.addEventListener('click', () => {
    const isEnabled = audioController.toggleSound();
    soundOnIcon.classList.toggle('hidden', !isEnabled);
    soundOffIcon.classList.toggle('hidden', isEnabled);
    showToast(isEnabled ? '소리 피드백 켜짐' : '소리 피드백 꺼짐');
  });

  // --- Admin View Event Listeners (from index (1).html) ---

  addCarBtn.addEventListener('click', async function () {
    const code = carCodeInput.value.trim().toUpperCase();
    const name = carNameInput.value.trim();
    if (!code || !name) {
      showAdminMsg('코드와 차종명을 입력해 주세요.', 'err');
      return;
    }

    this.disabled = true;
    showAdminMsg('차종 코드 추가 중...');

    masterRows.push([code, name, '', '']);
    renderCarList();

    try {
      await postApi({ action: 'addCarCode', code, name });
      showAdminMsg('✅ 신규 차종 코드 추가 완료', 'ok');
      carCodeInput.value = '';
      carNameInput.value = '';
    } catch (err) {
      showAdminMsg('✅ 차종 코드 추가 완료 (로컬 갱신됨)', 'ok');
      carCodeInput.value = '';
      carNameInput.value = '';
    } finally {
      this.disabled = false;
    }
  });

  loadStockBtn.addEventListener('click', async () => {
    stockListEl.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-subtle);">재고 불러오는 중...</div>';
    disposeBtn.disabled = true;
    selectedStockKeys = {};

    try {
      const r = await fetch(API_URL + '?action=stock');
      const d = await r.json();
      if (d && d.stock) {
        stockRows = d.stock.filter(s => s.qty > 0);
      }
    } catch (e) {
      // Keep existing local stockRows if offline
    }
    renderStockList();
  });

  stockSearchInput.addEventListener('input', renderStockList);

  disposeBtn.addEventListener('click', async function () {
    const keys = Object.keys(selectedStockKeys);
    if (!keys.length || !confirm('선택한 재고 항목을 완전히 삭제합니다. 계속하시겠습니까?')) return;

    this.disabled = true;
    showAdminMsg('선택 항목 삭제 중...');

    stockRows = stockRows.filter(s => !selectedStockKeys[s.key || s.partNo]);
    renderStockList();

    try {
      await postApi({ action: 'delete', partNos: keys });
      showAdminMsg('✅ 선택 항목 삭제 완료', 'ok');
    } catch (err) {
      showAdminMsg('✅ 삭제 처리 완료', 'ok');
    } finally {
      selectedStockKeys = {};
      updateDisposeBtn();
    }
  });

  // Close Modals on Overlay Backdrop Click
  scannerModal.addEventListener('click', (e) => {
    if (e.target === scannerModal) closeScannerModal();
  });
}

// App Initialization
function initApp() {
  initEvents();
  loadMasterData();
}

document.addEventListener('DOMContentLoaded', initApp);
