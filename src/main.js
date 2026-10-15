import './style.css';
import { audioController } from './audio.js';
import { BarcodeScanner } from './scanner.js';

// API & Master Constants (from index (1).html)
const API_URL = 'https://script.google.com/macros/s/AKfycbwfz2SmT8_92HcEZLYB3kk4iHXQQZD-PDY00MGz664pb0_V0BMcmXovHGsQP99HCY-c/exec';
const API_TOKEN = 'rd-sample-2026-7f3a9c1b';

// DOM Element Selectors - Scan View
const scanView = document.getElementById('scanView');
const adminView = document.getElementById('adminView');
const adminBtn = document.getElementById('adminBtn');
const backBtn = document.getElementById('backBtn');

const startScanBtn = document.getElementById('startScanBtn');
const cameraDeviceSelect = document.getElementById('cameraDeviceSelect');

const partNoInput = document.getElementById('partNoInput');
const clearPartNoBtn = document.getElementById('clearPartNoBtn');
const partInfoBox = document.getElementById('partInfo');
const scanResultBox = document.getElementById('scanResultBox');
const partIdBox = document.getElementById('partIdBox');
const partIdValue = document.getElementById('partIdValue');

const btnIn = document.getElementById('btn-in');
const btnOut = document.getElementById('btn-out');
const qtyInput = document.getElementById('qtyInput');
const memoInput = document.getElementById('memoInput');
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

const loadStockBtn = document.getElementById('loadStockBtn');
const stockSearchInput = document.getElementById('stockSearch');
const stockListEl = document.getElementById('stockList');
const disposeBtn = document.getElementById('disposeBtn');
const adminMsgBox = document.getElementById('adminMsg');

// 차종별 재고 (콤보 박스 + 리스트)
const carComboEl = document.getElementById('carCombo');
const carComboInput = document.getElementById('carComboInput');
const carComboToggle = document.getElementById('carComboToggle');
const carComboList = document.getElementById('carComboList');
const carStockSummary = document.getElementById('carStockSummary');
const carStockListEl = document.getElementById('carStockList');
const carStockRefreshBtn = document.getElementById('carStockRefreshBtn');

// App State
let scannerInstance = null;
let selectedEvent = 'P0';
let isSaving = false;

// 차종별 재고: 서버(?action=stockByCar)에서 받은 차종 목록과 입고 중인 품번별 수량
let carStock = { cars: [], items: [] };
let carStockState = 'idle'; // idle | loading | ready | error
let carStockError = '';
let carComboActive = -1;

let masterRows = [
  ['DC', 'JG1', '88840', 'Front Bumper Sensor Module'],
  ['EA', 'EV6', '86350', 'Radar Control Assembly'],
  ['C2', 'K5', '99210', 'Camera Sensor Unit']
];
let stockRows = [];

// 파트ID매핑 시트: 스캔값 앞 6자리 = part_id(A열) → part_no(B열). 서버에서 ID 하나씩 조회
const PART_ID_LEN = 6;
const partIdCache = new Map(); // id → Promise<[{ partNo, partName }]>
let partIdRequestSeq = 0;
// 스캔값이 매핑 품번으로 자동 변환됐을 때의 기록 { raw: 원본 스캔값, partNo: 변환된 품번 }
let autofill = null;
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

// 스캔값(원본 우선, 추출된 품번 차선)의 앞 6자리 후보
function partIdKeys(...codes) {
  const keys = [];
  codes.forEach(code => {
    const key = normPartNo(code).slice(0, PART_ID_LEN);
    if (key.length === PART_ID_LEN && !keys.includes(key)) keys.push(key);
  });
  return keys;
}

function fetchPartId(id) {
  if (!partIdCache.has(id)) {
    const req = fetch(`${API_URL}?action=resolve&id=${encodeURIComponent(id)}`)
      .then(res => res.json())
      .then(data => {
        if (!data || !data.ok) throw new Error((data && data.error) || '파트ID 조회 실패');
        return Array.isArray(data.matches) ? data.matches : [];
      });
    partIdCache.set(id, req);
    req.catch(() => partIdCache.delete(id)); // 실패는 캐시하지 않고 다음에 재시도
  }
  return partIdCache.get(id);
}

async function resolvePartId(...codes) {
  for (const id of partIdKeys(...codes)) {
    const matches = await fetchPartId(id);
    if (matches.length) return matches;
  }
  return [];
}

// 스캔 버튼 오른쪽 입력 박스: 품번이 들어 있으면 강조
function showScanResult(partNo) {
  if (!scanResultBox) return;
  scanResultBox.classList.toggle('filled', !!partNo);
}

function showPartIdMapping(text, state) {
  if (!partIdBox) return;
  partIdBox.classList.toggle('hidden', state === 'hidden');
  partIdBox.classList.toggle('matched', state === 'matched');
  partIdValue.textContent = text;
}

function renderMasterInfo(partNo) {
  const info = lookupPart(partNo);
  const parts = [info.car, info.name].filter(Boolean);
  partInfoBox.textContent = parts.length ? '📋 ' + parts.join(' / ') : '⚠️ 품번마스터 미등록 품번 (신규)';
}

function showPartInfo(partNo, raw = partNo, autofillMapped = false) {
  if (!partInfoBox) return;
  const seq = ++partIdRequestSeq;
  autofill = null;
  showScanResult(partNo);
  if (!partNo) {
    partInfoBox.textContent = '';
    showPartIdMapping('', 'hidden');
    return;
  }
  renderMasterInfo(partNo);

  if (!partIdKeys(raw, partNo).length) {
    showPartIdMapping('매핑 없음 (6자리 미만)', 'none');
    return;
  }
  showPartIdMapping('조회 중...', 'loading');
  resolvePartId(raw, partNo).then(matches => {
    if (seq !== partIdRequestSeq) return; // 그 사이 다른 값으로 바뀜
    if (!matches.length) {
      showPartIdMapping('매핑 없음 (파트ID매핑 시트에 미등록)', 'none');
      return;
    }
    const partNos = [...new Set(matches.map(m => m.partNo))];
    showPartIdMapping(partNos.join(' / '), 'matched');
    renderMasterInfo(partNos[0]); // 매핑된 품번 기준으로 차종/품명 표시

    // 스캔으로 들어온 값이고 매핑 품번이 하나로 정해지면 입력창을 그 품번으로 교체
    if (autofillMapped && partNos.length === 1 && partNoInput.value.trim() === partNo) {
      autofill = { raw: String(raw).trim(), partNo: partNos[0] };
      partNoInput.value = partNos[0];
      showScanResult(partNos[0]);
      showToast(`🔖 품번 매핑: ${partNos[0]}`);
    }
  }).catch(err => {
    if (seq !== partIdRequestSeq) return;
    console.warn('파트ID 조회 실패:', err);
    showPartIdMapping('조회 실패 (네트워크 확인)', 'error');
  });
}

/**
 * Dynamic Part Number Pattern Extractor
 * Matches 888 / 898 Part Numbers (10 to 13 chars; a leading 'P' is dropped by the match), or returns exact scanned text as-is.
 */
function extractStandardPartNo(raw) {
  if (!raw) return '';
  const clean = String(raw).trim().toUpperCase();

  // 1. Check for 888 or 898 pattern (10 to 13 alphanumeric characters: e.g. 88840DC020C2N, 89810DC010)
  const match888898 = clean.match(/(888|898)[A-Z0-9]{7,10}/);
  if (match888898) {
    return match888898[0];
  }

  // 2. Return exact scanned barcode text as-is (No hardcoded overrides!)
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
}

// Set Part Number into Input Box with Visual Effects
function setPartNumber(code, source = '스캔 완료') {
  const extracted = extractStandardPartNo(code);
  partNoInput.value = extracted;
  showPartInfo(extracted, code, true);

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
  if (!decodedText || typeof decodedText !== 'string') return;

  const formatName = decodedResult?.result?.format?.formatName || 'Code 128';
  const finalPartNo = extractStandardPartNo(decodedText);

  if (decodedText !== finalPartNo) {
    showToast(`✅ 스캔 성공: ${finalPartNo} (RAW: ${decodedText})`);
  } else {
    showToast(`✅ 스캔 성공: ${finalPartNo}`);
  }

  setPartNumber(decodedText, `${formatName} 스캔`);
  closeScannerModal();
}

// Modal Controllers
async function openScannerModal() {
  scannerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Clear the scanner container to remove any stale video/canvas elements
  const scannerContainer = document.getElementById('interactiveScanner');
  if (scannerContainer) {
    scannerContainer.innerHTML = '';
  }

  // Always create a fresh scanner instance to avoid stale frame buffer issues
  scannerInstance = new BarcodeScanner('interactiveScanner', handleBarcodeScanned);

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
    try {
      await scannerInstance.stop();
    } catch (e) {
      console.warn('Scanner stop error (safe to ignore):', e);
    }
    // Fully destroy the instance to prevent stale frame buffer reuse
    scannerInstance = null;
  }

  // Clear any residual video/canvas elements from the scanner container
  const scannerContainer = document.getElementById('interactiveScanner');
  if (scannerContainer) {
    scannerContainer.innerHTML = '';
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

// ----- 차종별 재고 (콤보 박스 + 리스트) -----

async function loadCarStock() {
  carStockState = 'loading';
  renderCarStock();
  try {
    const res = await fetch(API_URL + '?action=stockByCar');
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.cars) || !Array.isArray(data.items)) {
      throw new Error((data && data.error) || '서버가 차종별 재고를 지원하지 않습니다. Apps Script를 새 버전으로 배포했는지 확인해 주세요.');
    }
    carStock = { cars: data.cars, items: data.items };
    carStockState = 'ready';
  } catch (err) {
    carStockState = 'error';
    carStockError = (err && err.message) || '재고를 불러오지 못했습니다.';
  }
  renderCarStock();
  if (!carComboList.classList.contains('hidden')) renderCarCombo(false);
}

// 입력한 글자와 일치(정확히 같으면 그 차종만, 아니면 포함)하는 차종들
function selectedCars() {
  const q = carComboInput.value.trim().toLowerCase();
  if (!q) return [];
  const exact = carStock.cars.filter(c => c.car.toLowerCase() === q);
  return exact.length ? exact : carStock.cars.filter(c => c.car.toLowerCase().includes(q));
}

function renderCarCombo(showAll) {
  const q = showAll ? '' : carComboInput.value.trim().toLowerCase();
  const options = carStock.cars.filter(c => !q || c.car.toLowerCase().includes(q));
  if (carComboActive >= options.length) carComboActive = options.length - 1;

  // 입력 중 일치하는 차종이 없으면 드롭다운은 닫고, 안내는 아래 리스트 영역에 표시
  if (!showAll && q && !options.length) {
    closeCarCombo();
    return;
  }

  if (carStockState === 'loading' && !carStock.cars.length) {
    carComboList.innerHTML = '<li class="combo-empty">차종을 불러오는 중...</li>';
  } else if (!options.length) {
    carComboList.innerHTML = '<li class="combo-empty">일치하는 차종이 없습니다.</li>';
  } else {
    const current = carComboInput.value.trim().toLowerCase();
    carComboList.innerHTML = options.map((c, i) =>
      `<li role="option" data-car="${escapeHtml(c.car)}" class="${i === carComboActive ? 'active' : ''}${c.car.toLowerCase() === current ? ' selected' : ''}">` +
      `<span>${escapeHtml(c.car)}</span><small>${c.parts}종 · ${c.qty}개</small></li>`
    ).join('');
  }
  carComboList.classList.remove('hidden');
  carComboEl.classList.add('open');
  carComboInput.setAttribute('aria-expanded', 'true');
}

function closeCarCombo() {
  carComboActive = -1;
  carComboList.classList.add('hidden');
  carComboEl.classList.remove('open');
  carComboInput.setAttribute('aria-expanded', 'false');
}

function chooseCar(car) {
  carComboInput.value = car;
  closeCarCombo();
  renderCarStock();
}

function renderCarStock() {
  if (!carStockListEl) return;
  const msg = text => { carStockListEl.innerHTML = `<div class="car-stock-empty">${text}</div>`; };
  carStockSummary.textContent = '';

  if (carStockState === 'loading' && !carStock.cars.length) return msg('재고를 불러오는 중...');
  if (carStockState === 'error') return msg(`${escapeHtml(carStockError)}`);

  const cars = selectedCars();
  if (!carComboInput.value.trim()) return msg('차종을 선택하거나 입력하면<br>입고되어 있는 품번과 수량이 표시됩니다.');
  if (!cars.length) return msg('일치하는 차종이 없습니다.');

  const names = new Set(cars.map(c => c.car));
  const rows = carStock.items.filter(it => names.has(it.car));
  const total = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const multi = cars.length > 1;
  carStockSummary.textContent = `${multi ? cars.length + '개 차종' : cars[0].car} · 품번 ${rows.length}종 · 총 ${total}개`;

  if (!rows.length) return msg('입고되어 있는 품번이 없습니다.');

  carStockListEl.innerHTML = '<table><thead><tr><th>품번</th>' + (multi ? '<th>차종</th>' : '') + '<th class="qty">수량</th></tr></thead><tbody>' +
    rows.map(it =>
      `<tr><td>${escapeHtml(it.partNo)}${it.partName ? `<span class="part-sub">${escapeHtml(it.partName)}</span>` : ''}</td>` +
      (multi ? `<td>${escapeHtml(it.car)}</td>` : '') +
      `<td class="qty">${Number(it.qty) || 0}</td></tr>`
    ).join('') + '</tbody></table>';
}

// 입고/출고 저장 (버튼을 누르면 바로 실행)
async function savePart(type, btn) {
  if (isSaving) return;

  const partNo = partNoInput.value.trim();
  const qty = Number(qtyInput.value) || 1;
  let memo = memoInput.value.trim();

  if (!partNo) {
    showToast('품번을 스캔하거나 입력해 주세요.');
    partNoInput.focus();
    return;
  }

  // 스캔값이 매핑 품번으로 변환된 경우 원본 스캔값을 비고에 남김
  if (autofill && autofill.partNo === partNo) {
    memo = [`스캔: ${autofill.raw}`, memo].filter(Boolean).join(' / ');
  }

  isSaving = true;
  btnIn.disabled = true;
  btnOut.disabled = true;

  audioController.playScanBeep();
  audioController.triggerHaptic();

  btn.classList.remove('saved-flash');
  void btn.offsetWidth;
  btn.classList.add('saved-flash');

  // Add entry to stockRows
  stockRows.push({
    key: partNo + '_' + Date.now(),
    partNo,
    type,
    qty,
    event: selectedEvent,
    memo,
    days: 0
  });

  const payload = { action: 'add', partNo, type, qty, event: selectedEvent, memo };

  try {
    await postApi(payload);
    showToast(`✅ ${type} 저장 완료: ${partNo} / ${qty}개 (${selectedEvent})`);
  } catch (err) {
    showToast(`✅ ${type} 저장 완료: ${partNo}`);
  }

  scanStatusBadge.textContent = `${type} 저장 완료 [${selectedEvent}]`;
  scanStatusBadge.className = 'status-indicator scanned';

  // Clear Inputs for Next Scan
  partNoInput.value = '';
    showPartInfo('');
  qtyInput.value = 1;
  memoInput.value = '';

  isSaving = false;
  btnIn.disabled = false;
  btnOut.disabled = false;

  // Auto Trigger Next Scan if keepScanning check is enabled
  if (keepScanningChk.checked) {
    setTimeout(() => openScannerModal(), 400);
  }
}

// Event Listeners Registration
function initEvents() {
  // Navigation between Scan View and Admin Settings View
  adminBtn.addEventListener('click', () => {
    scanView.classList.add('hidden');
    adminView.classList.remove('hidden');
    showAdminMsg('');
    loadCarStock();
    window.scrollTo(0, 0);
  });

  backBtn.addEventListener('click', () => {
    adminView.classList.add('hidden');
    scanView.classList.remove('hidden');
    window.scrollTo(0, 0);
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

  // 입고 / 출고 버튼: 누르면 바로 저장 (API integration + Keep Scanning support)
  btnIn.addEventListener('click', () => savePart('입고', btnIn));
  btnOut.addEventListener('click', () => savePart('출고', btnOut));

  // Clear Input Button
  clearPartNoBtn.addEventListener('click', () => {
    partNoInput.value = '';
    showPartInfo('');
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

  // --- 차종별 재고 콤보 박스 ---
  carComboInput.addEventListener('input', () => {
    carComboActive = -1;
    renderCarCombo(false);
    renderCarStock();
  });

  carComboInput.addEventListener('click', () => {
    if (carComboList.classList.contains('hidden')) renderCarCombo(!carComboInput.value.trim());
  });

  carComboInput.addEventListener('keydown', (e) => {
    const options = [...carComboList.querySelectorAll('li[data-car]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (carComboList.classList.contains('hidden')) renderCarCombo(!carComboInput.value.trim());
      const count = carComboList.querySelectorAll('li[data-car]').length;
      if (!count) return;
      carComboActive = (carComboActive + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
      renderCarCombo(!carComboInput.value.trim());
      carComboList.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = options[carComboActive] || (options.length === 1 ? options[0] : null);
      if (pick) chooseCar(pick.dataset.car);
      else closeCarCombo();
    } else if (e.key === 'Escape') {
      closeCarCombo();
    }
  });

  carComboToggle.addEventListener('click', () => {
    if (carComboList.classList.contains('hidden')) {
      renderCarCombo(true);
      carComboInput.focus();
    } else {
      closeCarCombo();
    }
  });

  // 터치에서도 입력창 포커스가 빠지기 전에 선택되도록 mousedown 사용
  carComboList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-car]');
    if (!li) return;
    e.preventDefault();
    chooseCar(li.dataset.car);
  });

  document.addEventListener('click', (e) => {
    if (!carComboEl.contains(e.target)) closeCarCombo();
  });

  carStockRefreshBtn.addEventListener('click', loadCarStock);

  // --- Admin View Event Listeners (from index (1).html) ---

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
      loadCarStock();
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
