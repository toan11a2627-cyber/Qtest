/**
 * Cấu hình Firebase Server và Môi trường ứng dụng MathExam Pro
 * Tự động đồng bộ với backend mới qtest-ac4d3
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBmCAWoPosXEguXANoPzy17TkiLw1ve008",
  authDomain: "qtest-ac4d3.firebaseapp.com",
  databaseURL: "https://qtest-ac4d3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "qtest-ac4d3",
  storageBucket: "qtest-ac4d3.firebasestorage.app",
  messagingSenderId: "412867160771",
  appId: "1:412867160771:web:2e9885aa0141fc4cf95076",
  measurementId: "G-NVTSEKN248"
};

// Lưu cấu hình vào window để các script khác và HTML dễ dàng truy cập
if (typeof window !== 'undefined') {
  window.firebaseConfig = firebaseConfig;
}

// Khởi tạo Firebase App, Firestore và Realtime Database Service
let app = null;
let db = null;
let rtdb = null;
let isFirebaseConnected = false;

export function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem('mathexam_firebase_custom_config');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Lỗi đọc cấu hình tùy chỉnh từ localStorage:', e);
  }
  return firebaseConfig;
}

export async function ensureSilentFirebaseAuth(customAuth) {
  try {
    const authInstance = customAuth || (window.firebase && typeof window.firebase.auth === 'function' ? window.firebase.auth() : null);
    if (!authInstance) return null;

    if (authInstance.currentUser) {
      return authInstance.currentUser;
    }

    // 1. Thử xác thực ẩn danh (Anonymous Auth) trước
    if (typeof authInstance.signInAnonymously === 'function') {
      try {
        const anonRes = await authInstance.signInAnonymously();
        console.log('[Firebase Auth] Xác thực ẩn danh ngầm thành công:', anonRes.user?.uid);
        return anonRes.user;
      } catch (anonErr) {
        console.log('[Firebase Auth] Anonymous auth chưa bật trên Console, chuyển sang tài khoản hệ thống ngầm:', anonErr.message);
      }
    }

    // 2. Tự động xác thực ngầm bằng tài khoản hệ thống cố định
    if (typeof authInstance.signInWithEmailAndPassword === 'function') {
      try {
        const credRes = await authInstance.signInWithEmailAndPassword("test@example.com", "matkhau123");
        console.log('[Firebase Auth] Tự động xác thực ngầm qua tài khoản hệ thống thành công:', credRes.user?.uid);
        return credRes.user;
      } catch (credErr) {
        console.warn('[Firebase Auth] Lỗi xác thực tài khoản hệ thống ngầm:', credErr.message);
      }
    }
  } catch (err) {
    console.warn('[Firebase Auth] Ngoại lệ xác thực ngầm:', err);
  }
  return null;
}

export function initFirebase() {
  if (typeof window === 'undefined' || !window.firebase) {
    console.log('[Firebase] Thư viện Firebase compat chưa sẵn sàng hoặc đang ở môi trường node');
    return { app: null, db: null, rtdb: null, auth: null, isConnected: false };
  }

  let authInstance = null;

  try {
    const cfg = getActiveFirebaseConfig();
    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      app = window.firebase.initializeApp(cfg);
    } else {
      app = window.firebase.app();
    }
    db = window.firebase.firestore();
    
    // Khởi tạo Realtime Database nếu có hàm database
    if (typeof window.firebase.database === 'function') {
      try {
        rtdb = window.firebase.database();
      } catch (rtdbErr) {
        console.warn('[Firebase RTDB] Không thể khởi tạo RTDB compat:', rtdbErr);
      }
    }

    // Khởi tạo Auth
    if (typeof window.firebase.auth === 'function') {
      try {
        authInstance = window.firebase.auth();
        // Tự động xác thực ngầm (không cần giao diện đăng nhập)
        ensureSilentFirebaseAuth(authInstance);
      } catch (authErr) {
        console.warn('[Firebase Auth] Không thể khởi tạo Auth:', authErr);
      }
    }
    
    // Enable offline persistence if available
    try {
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    } catch (_) {}

    isFirebaseConnected = true;
    console.log('[Firebase] Đã kết nối thành công tới Project:', cfg.projectId);
    updateNetworkStatusUI(navigator.onLine !== false);
  } catch (error) {
    console.warn('[Firebase] Kết nối Firestore không khả dụng, sử dụng chế độ LocalStorage & Server Sync:', error);
    isFirebaseConnected = false;
    updateNetworkStatusUI(navigator.onLine !== false);
  }

  return { app, db, rtdb, auth: authInstance, isConnected: isFirebaseConnected };
}

export function updateNetworkStatusUI(isOnline) {
  const statusEl = document.getElementById('network-status');
  if (!statusEl) return;
  const online = isOnline !== undefined ? !!isOnline : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  if (online) {
    statusEl.className = 'text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition';
    statusEl.innerHTML = `<i class="fa-solid fa-wifi text-[10px]"></i> <span>Online</span>`;
    statusEl.title = 'Hệ thống đang kết nối mạng trực tuyến';
  } else {
    statusEl.className = 'text-xs px-2.5 py-1 rounded-full font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition animate-pulse';
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-[10px]"></i> <span>Offline</span>`;
    statusEl.title = 'Mất kết nối mạng - Đang hoạt động ở chế độ ngoại tuyến';
  }
}

// Kiểm tra kết nối THỰC TẾ: navigator.onLine chỉ biết thiết bị còn nối Wi-Fi/LAN hay không,
// không phát hiện được trường hợp mất Internet (modem rớt mạng, server không truy cập được...).
let netProbing = false;
let netFailCount = 0;
let netWasOnline = true;

async function probeRealConnectivity() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  // Chạy từ file:// thì không có máy chủ để kiểm tra, dùng trạng thái của trình duyệt
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return true;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    // Chỉ cần máy chủ phản hồi (kể cả mã lỗi HTTP) là mạng vẫn thông
    await fetch(location.origin + '/?_ping=' + Date.now(), {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    return true;
  } catch (_) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkRealNetworkStatus() {
  if (netProbing) return;
  netProbing = true;
  try {
    const reachable = await probeRealConnectivity();
    const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    netFailCount = reachable ? 0 : netFailCount + 1;
    // Trình duyệt báo offline -> hiển thị ngay; lỗi kết nối thực tế -> xác nhận sau 2 lần liên tiếp để tránh chớp tắt
    const online = !browserOffline && (reachable || netFailCount < 2);
    updateNetworkStatusUI(online);
    if (online && !netWasOnline && typeof window.syncLoadAll === 'function') {
      window.syncLoadAll();
    }
    netWasOnline = online;
  } finally {
    netProbing = false;
  }
}

// Lắng nghe sự kiện ngắt mạng (offline) và kết nối lại (online) ngay lập tức
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Network] Trình duyệt báo đã có mạng, đang kiểm tra kết nối thực tế...');
    netFailCount = 0;
    checkRealNetworkStatus();
  });

  window.addEventListener('offline', () => {
    console.warn('[Network] Ngắt kết nối mạng (Offline)');
    netWasOnline = false;
    updateNetworkStatusUI(false);
  });

  // Kiểm tra chu kỳ định kỳ kết nối thực tế để cập nhật trạng thái ngay cả khi trình duyệt không phát sự kiện
  setInterval(() => {
    checkRealNetworkStatus();
  }, 5000);

  // Kiểm tra trạng thái mạng thực tế của trình duyệt lúc tải trang
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      updateNetworkStatusUI(navigator.onLine !== false);
      checkRealNetworkStatus();
    });
  } else {
    updateNetworkStatusUI(navigator.onLine !== false);
    checkRealNetworkStatus();
  }
}

// Các tên Collection trong Firestore
export const COLLECTIONS = {
  EXAMS: 'exams',
  CLASSES: 'classes',
  SUBMISSIONS: 'submissions',
  REPORTS: 'reports'
};

if (typeof window !== 'undefined') {
  window.ensureSilentFirebaseAuth = ensureSilentFirebaseAuth;
}

export default {
  firebaseConfig,
  getActiveFirebaseConfig,
  initFirebase,
  ensureSilentFirebaseAuth,
  updateNetworkStatusUI,
  checkRealNetworkStatus,
  COLLECTIONS
};
