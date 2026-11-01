/**
 * Cấu hình Firebase Server và Môi trường ứng dụng MathExam Pro
 * Tự động đồng bộ với backend mới qtest11-3c48a
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCbG59BO_ALM9zIhqslIcaZH6RuVefm3mo",
  authDomain: "qtest11-3c48a.firebaseapp.com",
  databaseURL: "https://qtest11-3c48a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "qtest11-3c48a",
  storageBucket: "qtest11-3c48a.firebasestorage.app",
  messagingSenderId: "1001348645526",
  appId: "1:1001348645526:web:42d986da12fcc9554cb8b7",
  measurementId: "G-GKP3YNQE2E"
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
    if (window.firebase.firestore && typeof window.firebase.firestore.setLogLevel === 'function') {
      try { window.firebase.firestore.setLogLevel('silent'); } catch(_) {}
    }

    if (typeof window.firebase.firestore === 'function') {
      try {
        db = window.firebase.firestore();
        try {
          db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
        } catch (_) {}
      } catch (fsErr) {
        db = null;
      }
    }
    
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
    
    isFirebaseConnected = !!(rtdb || db);
    console.log('[Firebase] Đã khởi tạo dịch vụ Firebase cho Project:', cfg.projectId);
    updateNetworkStatusUI(navigator.onLine !== false);
  } catch (error) {
    console.warn('[Firebase] Kết nối dịch vụ Firebase tùy chọn, sử dụng chế độ LocalStorage & Server Sync:', error);
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

// Kiểm tra kết nối THỰC TẾ
let netProbing = false;
let netFailCount = 0;
let netWasOnline = true;

async function probeRealConnectivity() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return true;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
  try {
    await fetch(location.origin + '/api/ping', {
      method: 'GET',
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

// Lắng nghe sự kiện ngắt mạng (offline) và kết nối lại (online)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    netFailCount = 0;
    checkRealNetworkStatus();
  });

  window.addEventListener('offline', () => {
    netWasOnline = false;
    updateNetworkStatusUI(false);
  });

  setInterval(() => {
    checkRealNetworkStatus();
  }, 15000);

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
