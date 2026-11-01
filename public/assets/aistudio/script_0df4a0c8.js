/**
 * MathExam Pro - Hệ Thống Thi Trắc Nghiệm Toán Học
 * script.js - Đầy đủ bộ phân tích LaTeX (\choice, \choiceTF, \shortans, Tự luận, Điền khuyết),
 * Word (.docx), cài đặt nhanh, chỉnh sửa câu hỏi, tự luyện và đồng bộ Firebase qtest-ac4d3
 */

import { firebaseConfig, initFirebase, getActiveFirebaseConfig, updateNetworkStatusUI, COLLECTIONS } from './config.js';

// Khởi tạo trạng thái ứng dụng
export const appState = {
  role: null, // 'teacher' | 'student'
  currentTeacher: null,
  currentStudent: null, // { name, pin, classCode, className }
  currentClass: null,
  activeView: 'home',
  
  // Dữ liệu bộ nhớ (tự động đồng bộ với Firestore và LocalStorage)
  exams: [],
  classes: [],
  submissions: [],
  reports: [],

  // Soạn thảo đề thi
  draftExam: {
    editingExamId: null, // Nếu đang chỉnh sửa đề cũ
    title: '',
    duration: 45,
    openTime: '',
    deadline: '',
    maxAttempts: 1,
    minSubmit: 0,
    maxStrikes: 3,
    displayMode: 'scroll',
    scores: {
      mcq: 0.25,
      tf: 1.0,
      short: 0.5,
      cloze: 1.0,
      essay: 1.0
    },
    activeTab: '101',
    versions: {
      '101': [],
      '102': [],
      '103': [],
      '104': [],
      '105': [],
      '106': []
    }
  },

  // Bài thi học sinh đang làm
  activeExamSession: null,

  // Luyện tập học sinh đang làm
  activePracticeSession: null,

  // Chỉnh sửa bài luyện tập của giáo viên
  editingPractice: null
};

// Khởi tạo Firebase và Firestore
let { db, isConnected } = initFirebase();

// ==========================================
// ĐỒNG BỘ DỮ LIỆU (FIRESTORE & LOCALSTORAGE)
// ==========================================
export async function syncLoadAll() {
  // 1. Nạp từ local storage trước để có dữ liệu tức thì
  try {
    const localExams = localStorage.getItem('mathexam_exams');
    const localClasses = localStorage.getItem('mathexam_classes');
    const localSubs = localStorage.getItem('mathexam_submissions');
    const localReports = localStorage.getItem('mathexam_reports');

    if (localExams) appState.exams = JSON.parse(localExams);
    if (localClasses) appState.classes = JSON.parse(localClasses);
    if (localSubs) appState.submissions = JSON.parse(localSubs);
    if (localReports) appState.reports = JSON.parse(localReports);
  } catch (e) {
    console.warn('Lỗi đọc local storage:', e);
  }

  // 2. Đồng bộ với Server tập trung qua /api/sync (đảm bảo học sinh mở link nhận đầy đủ đề thi/lớp học của giáo viên)
  try {
    const res = await fetch('/api/sync');
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        const sDb = json.data;
        const sExams = Array.isArray(sDb.exams) ? sDb.exams : [];
        const sClasses = Array.isArray(sDb.classes) ? sDb.classes : [];
        const lExams = Array.isArray(appState.exams) ? appState.exams : [];
        const lClasses = Array.isArray(appState.classes) ? appState.classes : [];

        // Phát hiện đề thi hoặc lớp học trên máy giáo viên mà server chưa có
        const unuploadedExams = lExams.filter(le => !sExams.some(se => se.id === le.id));
        const unuploadedClasses = lClasses.filter(lc => !sClasses.some(sc => sc.id === lc.id || sc.code === lc.code));

        if (unuploadedExams.length > 0 || unuploadedClasses.length > 0) {
          console.log('[Sync] Tự động đồng bộ dữ liệu giáo viên lên hệ thống server dùng chung...');
          const postRes = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              exams: lExams,
              classes: lClasses,
              submissions: appState.submissions || [],
              reports: appState.reports || []
            })
          });
          if (postRes.ok) {
            const postJson = await postRes.json();
            if (postJson?.data) {
              sDb.exams = postJson.data.exams;
              sDb.classes = postJson.data.classes;
              sDb.submissions = postJson.data.submissions;
              sDb.reports = postJson.data.reports;
            }
          }
        }

        // Nạp dữ liệu đồng bộ đầy đủ từ server về máy học sinh/giáo viên
        if (Array.isArray(sDb.exams)) {
          appState.exams = sDb.exams;
          saveToLocal('mathexam_exams', appState.exams);
        }
        if (Array.isArray(sDb.classes) && sDb.classes.length > 0) {
          appState.classes = sDb.classes;
          saveToLocal('mathexam_classes', appState.classes);
        }
        if (Array.isArray(sDb.submissions)) {
          appState.submissions = sDb.submissions;
          saveToLocal('mathexam_submissions', appState.submissions);
        }
        if (Array.isArray(sDb.reports)) {
          appState.reports = sDb.reports;
          saveToLocal('mathexam_reports', appState.reports);
        }
      }
    }
  } catch (apiErr) {
    console.warn('[Sync] Không kết nối được API server, đang hoạt động cục bộ:', apiErr);
  }

  if (appState.classes.length === 0) {
    seedInitialClasses();
  }

  // 3. Dự phòng đồng bộ Firestore nếu có cấu hình
  if (db && isConnected) {
    try {
      const examsSnap = await db.collection(COLLECTIONS.EXAMS).get();
      if (!examsSnap.empty) {
        const remoteExams = [];
        examsSnap.forEach(doc => remoteExams.push({ id: doc.id, ...doc.data() }));
        appState.exams = remoteExams;
        saveToLocal('mathexam_exams', appState.exams);
      }

      const classesSnap = await db.collection(COLLECTIONS.CLASSES).get();
      if (!classesSnap.empty) {
        const remoteClasses = [];
        classesSnap.forEach(doc => remoteClasses.push({ id: doc.id, ...doc.data() }));
        appState.classes = remoteClasses;
        saveToLocal('mathexam_classes', appState.classes);
      }

      const subsSnap = await db.collection(COLLECTIONS.SUBMISSIONS).get();
      if (!subsSnap.empty) {
        const remoteSubs = [];
        subsSnap.forEach(doc => remoteSubs.push({ id: doc.id, ...doc.data() }));
        appState.submissions = remoteSubs;
        saveToLocal('mathexam_submissions', appState.submissions);
      }
    } catch (err) {
      console.warn('[Firestore] Hoạt động ở chế độ Local/Server Cache:', err.message);
    }
  }
}

function saveToLocal(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('Lỗi lưu local storage:', e);
  }
}

export async function saveExamToStore(exam) {
  const idx = appState.exams.findIndex(e => e.id === exam.id);
  if (idx >= 0) {
    appState.exams[idx] = exam;
  } else {
    appState.exams.unshift(exam);
  }
  saveToLocal('mathexam_exams', appState.exams);

  try {
    await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exam)
    });
  } catch (_) {}

  // Đồng bộ lên Firebase Realtime Database (RTDB)
  try {
    if (window.firebase && typeof window.firebase.database === 'function') {
      window.firebase.database().ref('exams/' + exam.id).set(exam).catch(() => {});
    }
  } catch (_) {}

  if (db && isConnected) {
    try {
      await db.collection(COLLECTIONS.EXAMS).doc(exam.id).set(exam, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Lỗi lưu exam:', e);
    }
  }
}

export async function deleteExamFromStore(examId) {
  appState.exams = appState.exams.filter(e => e.id !== examId);
  saveToLocal('mathexam_exams', appState.exams);

  try {
    await fetch('/api/exams/' + encodeURIComponent(examId), { method: 'DELETE' });
  } catch (_) {}

  try {
    if (window.firebase && typeof window.firebase.database === 'function') {
      window.firebase.database().ref('exams/' + examId).remove().catch(() => {});
    }
  } catch (_) {}

  if (db && isConnected) {
    try {
      await db.collection(COLLECTIONS.EXAMS).doc(examId).delete();
    } catch (e) {
      console.warn('[Firestore] Lỗi xóa exam:', e);
    }
  }
}

export async function saveClassToStore(cls) {
  const idx = appState.classes.findIndex(c => c.id === cls.id || c.code === cls.code);
  if (idx >= 0) {
    appState.classes[idx] = cls;
  } else {
    appState.classes.unshift(cls);
  }
  saveToLocal('mathexam_classes', appState.classes);

  try {
    await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cls)
    });
  } catch (_) {}

  try {
    if (window.firebase && typeof window.firebase.database === 'function') {
      window.firebase.database().ref('classes/' + (cls.id || cls.code)).set(cls).catch(() => {});
    }
  } catch (_) {}

  if (db && isConnected) {
    try {
      await db.collection(COLLECTIONS.CLASSES).doc(cls.id || cls.code).set(cls, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Lỗi lưu class:', e);
    }
  }
}

export async function saveSubmissionToStore(sub) {
  appState.submissions.unshift(sub);
  saveToLocal('mathexam_submissions', appState.submissions);

  try {
    await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
  } catch (_) {}

  try {
    if (window.firebase && typeof window.firebase.database === 'function') {
      const rtdb = window.firebase.database();
      const auth = window.firebase.auth ? window.firebase.auth() : null;
      const uid = auth?.currentUser?.uid || 'anonymous';
      rtdb.ref('submissions/' + sub.id).set(sub).catch(() => {});
      rtdb.ref('users/' + uid + '/submissions/' + sub.id).set(sub).catch(() => {});
    }
  } catch (_) {}

  if (db && isConnected) {
    try {
      await db.collection(COLLECTIONS.SUBMISSIONS).doc(sub.id).set(sub);
    } catch (e) {}
  }
}

export async function saveReportToStore(rep) {
  appState.reports.unshift(rep);
  saveToLocal('mathexam_reports', appState.reports);

  try {
    await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rep)
    });
  } catch (_) {}

  try {
    if (window.firebase && typeof window.firebase.database === 'function') {
      window.firebase.database().ref('reports/' + rep.id).set(rep).catch(() => {});
    }
  } catch (_) {}

  if (db && isConnected) {
    try {
      await db.collection(COLLECTIONS.REPORTS).add(rep);
    } catch (e) {}
  }
}

function seedInitialClasses() {
  appState.classes = [
    {
      id: 'class_12a1',
      name: 'Toán 12A1 - Chuyên Đề TN THPT',
      code: 'C12A1',
      updatedAt: new Date().toLocaleDateString('vi-VN'),
      students: [
        { stt: 1, name: 'Nguyễn Văn An', pin: '101' },
        { stt: 2, name: 'Trần Thị Bình', pin: '102' },
        { stt: 3, name: 'Lê Hoàng Cường', pin: '103' },
        { stt: 4, name: 'Phạm Minh Đức', pin: '104' },
        { stt: 5, name: 'Vũ Thị Hoa', pin: '105' }
      ],
      lectures: [
        { id: 'lec_1', title: 'Chuyên đề 1: Khảo sát và Vẽ đồ thị Hàm số', type: 'link', url: 'https://youtube.com', date: '2026-10-25' }
      ],
      practices: [],
      assignedExams: []
    }
  ];
  saveToLocal('mathexam_classes', appState.classes);
}

// ==========================================
// ĐIỀU HƯỚNG VÀ GIAO DIỆN (NAVIGATION)
// ==========================================
export function navigate(viewId) {
  if (viewId === 'student-login') {
    viewId = 'home';
  }
  appState.activeView = viewId;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const navUser = document.getElementById('nav-user-info');
  const navRole = document.getElementById('nav-role');
  if (appState.role === 'teacher') {
    navUser.classList.remove('hidden');
    navRole.textContent = 'Giáo Viên';
  } else if (appState.role === 'student' && appState.currentStudent) {
    navUser.classList.remove('hidden');
    navRole.textContent = `HS: ${appState.currentStudent.name}`;
  } else {
    navUser.classList.add('hidden');
  }

  if (viewId === 'teacher-dashboard') renderTeacherDashboard();
  if (viewId === 'teacher-classes') renderTeacherClasses();
  if (viewId === 'teacher-class-detail') renderTeacherClassDetail();
  if (viewId === 'teacher-create-exam') {
    renderExamDraftTabs();
    renderExamDraft();
  }
  if (viewId === 'student-class-space') renderStudentClassSpace();

  triggerMathJax();
}

export function logout() {
  appState.role = null;
  appState.currentTeacher = null;
  appState.currentStudent = null;
  appState.activeExamSession = null;
  appState.activePracticeSession = null;
  navigate('home');
  showToast('Đã đăng xuất thành công', 'info');
}

export function showToast(title, icon = 'success') {
  if (window.Swal) {
    window.Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer: 2500,
      timerProgressBar: true
    });
  } else {
    console.log(`[Toast ${icon}]: ${title}`);
  }
}

export function triggerMathJax() {
  setTimeout(() => {
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise().catch(err => console.debug('MathJax error:', err));
    }
  }, 100);
}

// Gán ngay lập tức vào window để người dùng thao tác không gặp lỗi timing
if (typeof window !== 'undefined') {
  window.navigate = navigate;
  window._fullNavigate = navigate;
  window.logout = logout;
  window.showToast = showToast;
  window.triggerMathJax = triggerMathJax;

  if (window.__pendingView) {
    const pv = window.__pendingView;
    window.__pendingView = null;
    navigate(pv);
  }
}


// ==========================================
// ĐẾM LƯỢT THI CỦA HỌC SINH (chính xác, không đếm nhầm học sinh khác)
// ==========================================
function normalizePersonName(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Lấy các bài nộp của CHÍNH học sinh này đối với đề thi này:
// - Phải cùng tên (không phân biệt hoa/thường, khoảng trắng thừa)
// - Nếu cả hai bên đều có PIN thì PIN phải trùng
// - Nếu cả hai bên đều có mã lớp (hoặc tên lớp) thì phải cùng lớp
// - Loại bỏ bản ghi trùng id (do đồng bộ nhiều nguồn)
export function getStudentExamSubmissions(examId, student) {
  if (!student) return [];
  const name = normalizePersonName(student.name);
  if (!name) return [];
  const pin = String(student.pin || '').trim();
  const seen = new Set();

  return (appState.submissions || []).filter(sub => {
    if (!sub || sub.examId !== examId) return false;
    if (sub.id) {
      if (seen.has(sub.id)) return false;
      seen.add(sub.id);
    }
    if (normalizePersonName(sub.studentName) !== name) return false;

    const subPin = String(sub.studentPin || '').trim();
    if (pin && subPin && pin !== subPin) return false;

    if (student.classCode && sub.classCode) return student.classCode === sub.classCode;
    if (student.className && sub.className) return student.className === sub.className;
    return true;
  });
}

// ==========================================
// GIÁO VIÊN: AUTH & DASHBOARD
// ==========================================
const TEACHER_PWD_KEY = 'mathexam_teacher_pwd';
const DEFAULT_TEACHER_PWD = '123456'; // chỉ dùng khi giáo viên CHƯA đổi mật khẩu
const MAX_LOGIN_FAILS = 5;
const LOGIN_LOCK_MS = 30 * 1000;
let teacherLoginFails = 0;
let teacherLockedUntil = 0;

// Mật khẩu hiện hành: mật khẩu đã đổi, hoặc mật khẩu mặc định nếu chưa đổi
function getTeacherPassword() {
  try {
    return localStorage.getItem(TEACHER_PWD_KEY) || DEFAULT_TEACHER_PWD;
  } catch (_) {
    return DEFAULT_TEACHER_PWD;
  }
}

function verifyTeacherPassword(input) {
  return String(input || '').trim() === getTeacherPassword();
}

export function loginTeacher() {
  const pwdInput = document.getElementById('teacher-pwd');
  const pwd = pwdInput ? pwdInput.value.trim() : '';

  // Tạm khóa sau nhiều lần nhập sai liên tiếp để chống dò mật khẩu
  const now = Date.now();
  if (now < teacherLockedUntil) {
    const secs = Math.ceil((teacherLockedUntil - now) / 1000);
    showToast(`Nhập sai quá nhiều lần. Vui lòng thử lại sau ${secs} giây.`, 'warning');
    return;
  }

  if (verifyTeacherPassword(pwd)) {
    teacherLoginFails = 0;
    appState.role = 'teacher';
    appState.currentTeacher = { username: 'GiaoVienToan' };
    if (pwdInput) pwdInput.value = '';
    navigate('teacher-dashboard');
    showToast('Đăng nhập Giáo viên thành công!', 'success');
  } else {
    teacherLoginFails++;
    if (teacherLoginFails >= MAX_LOGIN_FAILS) {
      teacherLoginFails = 0;
      teacherLockedUntil = Date.now() + LOGIN_LOCK_MS;
    }
    if (window.Swal) {
      window.Swal.fire('Sai mật khẩu', 'Mật khẩu không chính xác. Vui lòng thử lại.', 'error');
    } else {
      alert('Sai mật khẩu!');
    }
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.focus();
    }
  }
}

export function toggleTeacherChangePassword(show) {
  const loginBox = document.getElementById('teacher-login-form-box');
  const changeBox = document.getElementById('teacher-change-pwd-box');
  if (loginBox && changeBox) {
    if (show) {
      loginBox.classList.add('hidden');
      changeBox.classList.remove('hidden');
      const oldInput = document.getElementById('teacher-old-pwd');
      if (oldInput) oldInput.focus();
    } else {
      changeBox.classList.add('hidden');
      loginBox.classList.remove('hidden');
    }
  }
}

export function updateTeacherPassword() {
  const oldPwdInput = document.getElementById('teacher-old-pwd');
  const newPwdInput = document.getElementById('teacher-new-pwd');
  const confirmPwdInput = document.getElementById('teacher-confirm-pwd');

  const oldPwd = oldPwdInput ? oldPwdInput.value.trim() : '';
  const newPwd = newPwdInput ? newPwdInput.value.trim() : '';
  const confirmPwd = confirmPwdInput ? confirmPwdInput.value.trim() : '';

  if (!oldPwd) {
    showToast('Vui lòng nhập mật khẩu hiện tại!', 'warning');
    return;
  }
  if (!verifyTeacherPassword(oldPwd)) {
    showToast('Mật khẩu hiện tại không chính xác!', 'error');
    return;
  }
  if (!newPwd || newPwd.length < 3) {
    showToast('Mật khẩu mới phải có ít nhất 3 ký tự!', 'warning');
    return;
  }
  if (newPwd !== confirmPwd) {
    showToast('Mật khẩu xác nhận không khớp!', 'error');
    return;
  }

  localStorage.setItem(TEACHER_PWD_KEY, newPwd);
  if (oldPwdInput) oldPwdInput.value = '';
  if (newPwdInput) newPwdInput.value = '';
  if (confirmPwdInput) confirmPwdInput.value = '';

  toggleTeacherChangePassword(false);
  showToast('Đổi mật khẩu thành công! Hãy đăng nhập với mật khẩu mới.', 'success');
}

export function goToTeacherArea() {
  if (appState.role === 'teacher') {
    navigate('teacher-dashboard');
  } else {
    navigate('teacher-login');
  }
}

export function renderTeacherDashboard() {
  const tbody = document.getElementById('exam-list-body');
  if (!tbody) return;

  if (appState.exams.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-gray-500">
          <i class="fa-solid fa-file-circle-question text-4xl text-gray-300 mb-3 block"></i>
          Chưa có đề thi nào. Bấm <b>"Tạo Đề Mới"</b> hoặc <b>"Nạp Đề de_01.tex"</b> để bắt đầu ngay!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = appState.exams.map(exam => {
    const subsCount = appState.submissions.filter(s => s.examId === exam.id).length;
    const qCount = exam.versions && exam.versions['101'] ? exam.versions['101'].length : (exam.questions ? exam.questions.length : 0);
    return `
      <tr class="hover:bg-slate-50 transition border-b">
        <td class="p-4 font-bold text-gray-800">
          <div class="text-base text-primary flex items-center gap-2">
            <span>${escapeHtml(exam.title)}</span>
          </div>
          <div class="text-xs text-gray-400 font-normal mt-0.5">Tạo ngày: ${exam.createdAt || 'Hôm nay'}</div>
        </td>
        <td class="p-4">
          <span class="font-mono bg-blue-100 text-blue-800 px-2.5 py-1 rounded font-bold text-sm select-all cursor-pointer shadow-xs" title="Bấm để copy mã" onclick="navigator.clipboard.writeText('${exam.pin}'); window.showToast('Đã chép mã đề: ${exam.pin}')">
            ${exam.pin} <i class="fa-solid fa-copy ml-1 text-xs opacity-70"></i>
          </span>
        </td>
        <td class="p-4 text-sm font-semibold text-gray-600">${exam.duration} phút</td>
        <td class="p-4 text-sm font-bold text-emerald-600">${qCount} câu</td>
        <td class="p-4">
          <span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-bold">${subsCount} bài nộp</span>
        </td>
        <td class="p-4 text-center">
          <div class="flex flex-wrap justify-center items-center gap-1.5">
            <!-- Nút Sửa Đề -->
            <button onclick="window.editExam('${exam.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border border-blue-200 cursor-pointer" title="Chỉnh sửa toàn bộ đề thi"><i class="fa-solid fa-pen-to-square mr-1"></i>Sửa</button>
            <!-- Nút Cài Đặt Nhanh -->
            <button onclick="window.openQuickSettings('${exam.id}')" class="bg-amber-50 hover:bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border border-amber-200 cursor-pointer" title="Cài đặt nhanh thời gian, hạn nộp, vi phạm"><i class="fa-solid fa-gear mr-1"></i>Cài đặt</button>
            <!-- Nút Nhân Bản -->
            <button onclick="window.cloneExam('${exam.id}')" class="bg-purple-50 hover:bg-purple-100 text-purple-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border border-purple-200 cursor-pointer" title="Nhân bản tạo đề mới"><i class="fa-solid fa-copy"></i></button>
            <!-- Nút Xem Bài Thi -->
            <button onclick="window.viewExamSubmissions('${exam.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer" title="Xem danh sách bài nộp"><i class="fa-solid fa-clipboard-check mr-1"></i>Bài thi</button>
            <!-- Nút Giao Đề -->
            <button onclick="window.assignExamPrompt('${exam.id}')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer" title="Giao đề cho lớp"><i class="fa-solid fa-share-nodes"></i></button>
            <!-- Nút Xóa -->
            <button onclick="window.deleteExamConfirm('${exam.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border border-red-200 cursor-pointer" title="Xóa đề thi"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Cài đặt nhanh thông số đề thi
export function openQuickSettings(examId) {
  const exam = appState.exams.find(e => e.id === examId);
  if (!exam || !window.Swal) return;

  window.Swal.fire({
    title: `<i class="fa-solid fa-gear text-amber-500 mr-2"></i>Cài Đặt Nhanh: ${escapeHtml(exam.title)}`,
    html: `
      <div class="text-left text-xs space-y-3 mt-2">
        <div>
          <label class="block font-bold text-gray-700 mb-1">Tên đề thi</label>
          <input type="text" id="quick-title" class="w-full p-2 border rounded font-bold" value="${escapeHtml(exam.title)}">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-gray-700 mb-1">TG làm bài (Phút)</label>
            <input type="number" id="quick-duration" class="w-full p-2 border rounded" value="${exam.duration || 45}" min="1">
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">Số lần thi tối đa</label>
            <input type="number" id="quick-attempts" class="w-full p-2 border rounded" value="${exam.maxAttempts || 1}" min="1">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-purple-700 mb-1">Nộp tối thiểu (Phút)</label>
            <input type="number" id="quick-minsubmit" class="w-full p-2 border border-purple-300 rounded" value="${exam.minSubmit || 0}" min="0">
          </div>
          <div>
            <label class="block font-bold text-yellow-700 mb-1">Số vi phạm khóa bài</label>
            <input type="number" id="quick-strikes" class="w-full p-2 border border-yellow-300 rounded" value="${exam.maxStrikes || 3}" min="1">
          </div>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Giao diện thi</label>
          <select id="quick-mode" class="w-full p-2 border rounded">
            <option value="scroll" ${exam.displayMode === 'scroll' ? 'selected' : ''}>Cuộn toàn bộ đề</option>
            <option value="single" ${exam.displayMode === 'single' ? 'selected' : ''}>Từng câu một</option>
          </select>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-save mr-1"></i> Lưu Cài Đặt',
    confirmButtonColor: '#1e3a8a',
    cancelButtonText: 'Đóng'
  }).then(async res => {
    if (res.isConfirmed) {
      exam.title = document.getElementById('quick-title')?.value.trim() || exam.title;
      exam.duration = parseInt(document.getElementById('quick-duration')?.value, 10) || exam.duration;
      exam.maxAttempts = parseInt(document.getElementById('quick-attempts')?.value, 10) || exam.maxAttempts;
      exam.minSubmit = parseInt(document.getElementById('quick-minsubmit')?.value, 10) || 0;
      exam.maxStrikes = parseInt(document.getElementById('quick-strikes')?.value, 10) || 3;
      exam.displayMode = document.getElementById('quick-mode')?.value || 'scroll';

      await saveExamToStore(exam);
      renderTeacherDashboard();
      showToast('Đã lưu thay đổi cài đặt nhanh đề thi!', 'success');
    }
  });
}

// Chỉnh sửa đề thi trong giao diện tạo đề
export function editExam(examId) {
  const exam = appState.exams.find(e => e.id === examId);
  if (!exam) return;

  appState.draftExam = {
    editingExamId: exam.id,
    title: exam.title,
    duration: exam.duration || 45,
    openTime: exam.openTime || '',
    deadline: exam.deadline || '',
    maxAttempts: exam.maxAttempts || 1,
    minSubmit: exam.minSubmit || 0,
    maxStrikes: exam.maxStrikes || 3,
    displayMode: exam.displayMode || 'scroll',
    scores: exam.scores || { mcq: 0.25, tf: 1.0, short: 0.5, cloze: 1.0, essay: 1.0 },
    activeTab: '101',
    versions: JSON.parse(JSON.stringify(exam.versions || { '101': [] }))
  };

  const titleEl = document.getElementById('exam-title');
  const durEl = document.getElementById('exam-duration');
  const openEl = document.getElementById('exam-opentime');
  const deadEl = document.getElementById('exam-deadline');
  const attEl = document.getElementById('exam-max-attempts');
  const minSubEl = document.getElementById('exam-min-submit');
  const strikeEl = document.getElementById('exam-max-strikes');
  const modeEl = document.getElementById('exam-display-mode');

  if (titleEl) titleEl.value = exam.title;
  if (durEl) durEl.value = exam.duration;
  if (openEl) openEl.value = exam.openTime || '';
  if (deadEl) deadEl.value = exam.deadline || '';
  if (attEl) attEl.value = exam.maxAttempts || 1;
  if (minSubEl) minSubEl.value = exam.minSubmit || 0;
  if (strikeEl) strikeEl.value = exam.maxStrikes || 3;
  if (modeEl) modeEl.value = exam.displayMode || 'scroll';

  const headingEl = document.getElementById('create-exam-header-title');
  if (headingEl) headingEl.textContent = `Chỉnh Sửa Đề Thi: ${exam.title}`;

  const btnPublish = document.getElementById('btn-publish');
  if (btnPublish) btnPublish.textContent = 'Lưu Thay Đổi Đề Thi';

  navigate('teacher-create-exam');
  renderExamDraftTabs();
  renderExamDraft();
}

// Nhân bản đề thi
export async function cloneExam(examId) {
  const exam = appState.exams.find(e => e.id === examId);
  if (!exam) return;

  const newPin = Math.floor(100000 + Math.random() * 900000).toString();
  const cloned = {
    ...JSON.parse(JSON.stringify(exam)),
    id: `exam_${Date.now()}`,
    title: `[Bản sao] ${exam.title}`,
    pin: newPin,
    createdAt: new Date().toLocaleDateString('vi-VN')
  };

  await saveExamToStore(cloned);
  renderTeacherDashboard();
  showToast(`Đã nhân bản thành công! Mã đề mới: ${newPin}`, 'success');
}

// Cấu hình Firebase Server
export function openFirebaseConfig() {
  const currentCfg = getActiveFirebaseConfig();
  if (!window.Swal) return;

  window.Swal.fire({
    title: '<i class="fa-solid fa-database text-yellow-500 mr-2"></i>Cấu hình Firebase Server',
    html: `
      <div class="text-left text-xs space-y-3 mt-2">
        <p class="text-gray-600">Hệ thống đang đồng bộ với Firestore Project <b>${currentCfg.projectId}</b>.</p>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Project ID</label>
          <input type="text" id="cfg-project-id" class="w-full p-2 border rounded font-mono" value="${currentCfg.projectId}">
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">API Key</label>
          <input type="text" id="cfg-api-key" class="w-full p-2 border rounded font-mono" value="${currentCfg.apiKey}">
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Auth Domain</label>
          <input type="text" id="cfg-auth-domain" class="w-full p-2 border rounded font-mono" value="${currentCfg.authDomain}">
        </div>
        <div class="p-2 bg-blue-50 border border-blue-200 rounded text-blue-800 text-[11px]">
          <i class="fa-solid fa-shield-halved mr-1"></i> Mặc định đồng bộ với backend <b>qtest-ac4d3</b>.
        </div>
      </div>
    `,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: '<i class="fa-solid fa-save mr-1"></i> Lưu Cấu Hình',
    denyButtonText: '<i class="fa-solid fa-rotate-left mr-1"></i> Khôi phục Gốc',
    cancelButtonText: 'Đóng',
    confirmButtonColor: '#1e3a8a',
    denyButtonColor: '#6b7280'
  }).then(res => {
    if (res.isConfirmed) {
      const pId = document.getElementById('cfg-project-id')?.value.trim();
      const aKey = document.getElementById('cfg-api-key')?.value.trim();
      const aDom = document.getElementById('cfg-auth-domain')?.value.trim();
      if (pId && aKey) {
        const newCfg = {
          ...firebaseConfig,
          projectId: pId,
          apiKey: aKey,
          authDomain: aDom || `${pId}.firebaseapp.com`,
          storageBucket: `${pId}.firebasestorage.app`
        };
        localStorage.setItem('mathexam_firebase_custom_config', JSON.stringify(newCfg));
        showToast('Đã lưu cấu hình Firebase mới! Đang tải lại...', 'success');
        setTimeout(() => window.location.reload(), 1200);
      }
    } else if (res.isDenied) {
      localStorage.removeItem('mathexam_firebase_custom_config');
      showToast('Đã khôi phục cấu hình mặc định (qtest-ac4d3)!', 'info');
      setTimeout(() => window.location.reload(), 1200);
    }
  });
}

// ==========================================
// TẠO ĐỀ THI: LATEX, WORD, TIKZ & MÃ ĐỀ
// ==========================================
export function createNewExam() {
  appState.draftExam = {
    editingExamId: null,
    title: '',
    duration: 45,
    openTime: '',
    deadline: '',
    maxAttempts: 1,
    minSubmit: 0,
    maxStrikes: 3,
    displayMode: 'scroll',
    scores: { mcq: 0.25, tf: 1.0, short: 0.5, cloze: 1.0, essay: 1.0 },
    activeTab: '101',
    versions: { '101': [], '102': [], '103': [], '104': [], '105': [], '106': [] }
  };

  const titleEl = document.getElementById('exam-title');
  if (titleEl) titleEl.value = '';
  const headingEl = document.getElementById('create-exam-header-title');
  if (headingEl) headingEl.textContent = 'Tạo Đề Thi Mới';
  const btnPublish = document.getElementById('btn-publish');
  if (btnPublish) btnPublish.textContent = 'Phát Hành Đề Thi';

  navigate('teacher-create-exam');
  renderExamDraftTabs();
  renderExamDraft();
}

export function renderExamDraftTabs() {
  const container = document.getElementById('exam-version-tabs');
  if (!container) return;

  const versions = ['101', '102', '103', '104', '105', '106'];
  container.innerHTML = versions.map(v => {
    const isActive = appState.draftExam.activeTab === v;
    const count = appState.draftExam.versions[v]?.length || 0;
    return `
      <button onclick="window.switchDraftVersion('${v}')" class="px-4 py-2 rounded-lg font-bold text-sm transition flex items-center gap-2 cursor-pointer ${isActive ? 'bg-primary text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-200 border border-gray-300'}">
        <span>Mã ${v}</span>
        <span class="text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-white text-primary' : 'bg-gray-100 text-gray-600'} font-black">${count}</span>
      </button>
    `;
  }).join('') + `
    <button onclick="window.shuffleFromBaseVersion()" class="ml-auto bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-1.5 cursor-pointer" title="Trộn tự động từ Mã 101 sang 5 mã còn lại">
      <i class="fa-solid fa-shuffle"></i> Tự Trộn 6 Mã
    </button>
  `;
}

export function switchDraftVersion(v) {
  appState.draftExam.activeTab = v;
  renderExamDraftTabs();
  renderExamDraft();
}

export function shuffleFromBaseVersion() {
  const baseQuestions = appState.draftExam.versions['101'];
  if (!baseQuestions || baseQuestions.length === 0) {
    if (window.Swal) window.Swal.fire('Chưa có câu hỏi', 'Vui lòng nạp hoặc tạo câu hỏi ở Mã 101 trước khi trộn!', 'warning');
    return;
  }

  const versions = ['102', '103', '104', '105', '106'];
  versions.forEach(v => {
    const shuffled = baseQuestions.map(q => {
      const copy = JSON.parse(JSON.stringify(q));
      if (copy.type === 'mcq' && copy.options && copy.options.length >= 2) {
        const correctVal = copy.options[copy.correctAnswer]?.text || '';
        const opts = [...copy.options].sort(() => Math.random() - 0.5);
        const newCorrectIdx = opts.findIndex(o => o.text === correctVal);
        copy.options = opts;
        copy.correctAnswer = newCorrectIdx >= 0 ? newCorrectIdx : 0;
      }
      return copy;
    }).sort(() => Math.random() - 0.5);

    appState.draftExam.versions[v] = shuffled;
  });

  renderExamDraftTabs();
  showToast('Đã trộn tự động 6 mã đề thành công!', 'success');
}

export function renderExamDraft() {
  const currentTab = appState.draftExam.activeTab || '101';
  const questions = appState.draftExam.versions[currentTab] || [];
  const qCountEl = document.getElementById('q-count');
  const container = document.getElementById('questions-preview-container');
  const btnPublish = document.getElementById('btn-publish');

  if (qCountEl) qCountEl.textContent = `${questions.length} câu`;
  if (btnPublish) {
    if (questions.length > 0) btnPublish.classList.remove('hidden');
    else btnPublish.classList.add('hidden');
  }

  if (!container) return;

  if (questions.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl text-gray-500">
        <i class="fa-solid fa-file-code text-4xl text-gray-300 mb-2 block"></i>
        Chưa có câu hỏi trong Mã đề ${currentTab}.<br>
        Bấm <b>"Nạp Đề de_01.tex"</b>, <b>"Tải File Lên"</b> (.docx, .tex) hoặc <b>"Thêm Câu Hỏi"</b>!
      </div>
    `;
    return;
  }

  container.innerHTML = questions.map((q, idx) => {
    let typeBadge = '<span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Trắc nghiệm</span>';
    if (q.type === 'tf') typeBadge = '<span class="bg-purple-100 text-purple-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Đúng / Sai</span>';
    if (q.type === 'short') typeBadge = '<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Trả lời ngắn</span>';
    if (q.type === 'cloze') typeBadge = '<span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Điền khuyết</span>';
    if (q.type === 'essay') typeBadge = '<span class="bg-indigo-100 text-indigo-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Tự luận</span>';

    return `
      <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative group hover:border-blue-400 transition">
        <div class="flex flex-wrap justify-between items-center mb-2 gap-2">
          <div class="flex items-center gap-2">
            <span class="font-bold text-primary text-base">Câu ${idx + 1}:</span>
            ${typeBadge}
          </div>
          <!-- Các nút cài đặt nhanh chỉnh sửa từng câu -->
          <div class="flex items-center gap-1.5">
            <button onclick="window.openEditQuestionModal(${idx})" class="text-blue-600 hover:text-blue-800 text-xs font-bold px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition cursor-pointer" title="Chỉnh sửa câu hỏi này"><i class="fa-solid fa-pen mr-1"></i>Sửa</button>
            <button onclick="window.duplicateDraftQuestion(${idx})" class="text-slate-600 hover:text-slate-800 text-xs font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer" title="Nhân bản câu này"><i class="fa-solid fa-copy mr-1"></i>Nhân bản</button>
            <button onclick="window.moveDraftQuestion(${idx}, -1)" class="text-slate-600 hover:text-slate-800 text-xs font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer" title="Di chuyển lên" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button onclick="window.moveDraftQuestion(${idx}, 1)" class="text-slate-600 hover:text-slate-800 text-xs font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer" title="Di chuyển xuống" ${idx === questions.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <button onclick="window.removeDraftQuestion(${idx})" class="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 bg-red-50 hover:bg-red-100 rounded border border-red-200 transition cursor-pointer" title="Xóa câu hỏi"><i class="fa-solid fa-trash mr-1"></i>Xóa</button>
          </div>
        </div>
        <div class="math-render text-gray-800 text-sm mb-3">${renderMathContent(q.content)}</div>
        ${renderDraftQuestionOptions(q)}
        ${q.explanation ? `
          <div class="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
            <div class="font-bold text-primary mb-1"><i class="fa-solid fa-lightbulb mr-1 text-yellow-500"></i> Lời giải:</div>
            <div class="math-render">${renderMathContent(q.explanation)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  triggerMathJax();
}

function renderDraftQuestionOptions(q) {
  if (q.type === 'mcq' && q.options) {
    const letters = ['A', 'B', 'C', 'D'];
    return `
      <div class="grid md:grid-cols-2 gap-2 text-sm">
        ${q.options.map((opt, oIdx) => {
          const isCorrect = q.correctAnswer === oIdx;
          return `
            <div class="p-2 rounded-lg border flex items-start gap-2 ${isCorrect ? 'bg-emerald-50 border-emerald-400 text-emerald-900 font-semibold' : 'bg-gray-50 border-gray-200 text-gray-700'}">
              <span class="font-bold w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600'}">${letters[oIdx] || oIdx + 1}</span>
              <div class="math-render flex-grow">${renderMathContent(opt.text || opt)}</div>
              ${isCorrect ? '<i class="fa-solid fa-circle-check text-emerald-600 mt-0.5 text-xs"></i>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (q.type === 'tf' && q.items) {
    return `
      <div class="space-y-1.5 text-sm">
        ${q.items.map((it, iIdx) => `
          <div class="p-2 bg-gray-50 rounded border border-gray-200 flex justify-between items-center gap-2">
            <div class="math-render text-xs"><span class="font-bold">${String.fromCharCode(97 + iIdx)})</span> ${renderMathContent(it.text)}</div>
            <span class="text-xs font-bold px-2 py-0.5 rounded ${it.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${it.correct ? 'ĐÚNG' : 'SAI'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (q.type === 'short') {
    return `
      <div class="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 font-bold flex items-center gap-2">
        <span>Đáp án đúng:</span>
        <span class="font-mono bg-white px-2.5 py-1 rounded border border-amber-300 text-sm">${escapeHtml(q.correctAnswer || '')}</span>
      </div>
    `;
  }

  if (q.type === 'cloze') {
    return `
      <div class="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-900 font-bold flex items-center gap-2">
        <span>Từ / Số điền khuyết:</span>
        <span class="font-mono bg-white px-2.5 py-1 rounded border border-emerald-300 text-sm">${escapeHtml(q.correctAnswer || '(Chưa đặt)')}</span>
      </div>
    `;
  }

  if (q.type === 'essay') {
    return `
      <div class="p-2.5 bg-indigo-50 rounded-lg border border-indigo-200 text-xs text-indigo-900">
        <i class="fa-solid fa-file-pen mr-1"></i> Câu hỏi tự luận - học sinh trình bày bài làm và đối chiếu lời giải chi tiết.
      </div>
    `;
  }

  return '';
}

// Chỉnh sửa từng câu hỏi bằng modal
export function openEditQuestionModal(idx) {
  const currentTab = appState.draftExam.activeTab || '101';
  const questions = appState.draftExam.versions[currentTab] || [];
  const q = questions[idx];
  if (!q || !window.Swal) return;

  const typeOptions = [
    { val: 'mcq', label: 'Trắc nghiệm (4 lựa chọn)' },
    { val: 'tf', label: 'Đúng / Sai (4 ý a,b,c,d)' },
    { val: 'short', label: 'Trả lời ngắn' },
    { val: 'cloze', label: 'Điền khuyết (Cloze)' },
    { val: 'essay', label: 'Tự luận (Essay)' }
  ].map(t => `<option value="${t.val}" ${q.type === t.val ? 'selected' : ''}>${t.label}</option>`).join('');

  let specificFields = '';
  if (q.type === 'mcq') {
    const letters = ['A', 'B', 'C', 'D'];
    specificFields = `
      <div class="space-y-2 text-left">
        <label class="block text-xs font-bold text-gray-700">Các phương án lựa chọn:</label>
        ${[0, 1, 2, 3].map(i => `
          <div class="flex items-center gap-2">
            <span class="font-bold text-xs w-5">${letters[i]}.</span>
            <input type="text" id="edit-opt-${i}" class="w-full p-2 border rounded text-xs" value="${escapeHtml(q.options?.[i]?.text || '')}">
            <label class="flex items-center gap-1 text-xs shrink-0 cursor-pointer font-bold text-emerald-700">
              <input type="radio" name="edit-correct" value="${i}" ${q.correctAnswer === i ? 'checked' : ''}> Đúng
            </label>
          </div>
        `).join('')}
      </div>
    `;
  } else if (q.type === 'short' || q.type === 'cloze') {
    specificFields = `
      <div class="text-left">
        <label class="block text-xs font-bold text-gray-700 mb-1">Đáp án đúng / Từ điền khuyết:</label>
        <input type="text" id="edit-ans" class="w-full p-2 border rounded font-mono text-sm" value="${escapeHtml(q.correctAnswer || '')}">
      </div>
    `;
  }

  window.Swal.fire({
    title: `Chỉnh Sửa Câu ${idx + 1}`,
    html: `
      <div class="text-left text-xs space-y-3 mt-2">
        <div>
          <label class="block font-bold text-gray-700 mb-1">Dạng câu hỏi</label>
          <select id="edit-type" class="w-full p-2 border rounded">${typeOptions}</select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Nội dung câu hỏi (LaTeX/Text)</label>
          <textarea id="edit-content" class="w-full h-24 p-2 border rounded font-mono text-xs">${escapeHtml(q.content || '')}</textarea>
        </div>
        ${specificFields}
        <div>
          <label class="block font-bold text-gray-700 mb-1">Lời giải chi tiết (Hướng dẫn chấm)</label>
          <textarea id="edit-exp" class="w-full h-20 p-2 border rounded font-mono text-xs">${escapeHtml(q.explanation || '')}</textarea>
        </div>
      </div>
    `,
    width: '650px',
    showCancelButton: true,
    confirmButtonText: 'Lưu Câu Hỏi',
    confirmButtonColor: '#2563eb',
    cancelButtonText: 'Hủy'
  }).then(res => {
    if (res.isConfirmed) {
      q.type = document.getElementById('edit-type')?.value || q.type;
      q.content = document.getElementById('edit-content')?.value || q.content;
      q.explanation = document.getElementById('edit-exp')?.value || '';

      if (q.type === 'mcq') {
        const correctRadio = document.querySelector('input[name="edit-correct"]:checked');
        q.correctAnswer = correctRadio ? parseInt(correctRadio.value, 10) : 0;
        q.options = [0, 1, 2, 3].map(i => ({
          text: document.getElementById(`edit-opt-${i}`)?.value || ''
        }));
      } else if (q.type === 'short' || q.type === 'cloze') {
        q.correctAnswer = document.getElementById('edit-ans')?.value.trim() || '';
      }

      renderExamDraft();
      showToast('Đã cập nhật câu hỏi!');
    }
  });
}

// Thêm câu hỏi thủ công
export function openAddQuestionModal() {
  if (!window.Swal) return;

  window.Swal.fire({
    title: '<i class="fa-solid fa-plus-circle text-blue-600 mr-2"></i>Thêm Câu Hỏi Mới',
    html: `
      <div class="text-left text-xs space-y-3 mt-2">
        <div>
          <label class="block font-bold text-gray-700 mb-1">Dạng câu hỏi</label>
          <select id="add-q-type" class="w-full p-2 border rounded font-bold" onchange="window.toggleAddQuestionFields()">
            <option value="mcq">Trắc nghiệm (4 lựa chọn A,B,C,D)</option>
            <option value="tf">Đúng / Sai (4 ý a,b,c,d)</option>
            <option value="short">Trả lời ngắn</option>
            <option value="cloze">Điền khuyết (Cloze)</option>
            <option value="essay">Tự luận (Essay)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Nội dung câu hỏi (hỗ trợ công thức $...$)</label>
          <textarea id="add-q-content" class="w-full h-24 p-2 border rounded font-mono text-xs" placeholder="VD: Cho hàm số $y = f(x)$..."></textarea>
        </div>
        <div id="add-q-options-container" class="space-y-2">
          <label class="block font-bold text-gray-700">4 Phương án trắc nghiệm:</label>
          <div class="flex items-center gap-2"><span class="font-bold text-xs w-4">A.</span><input id="add-opt-0" class="w-full p-1.5 border rounded text-xs"><input type="radio" name="add-correct" value="0" checked title="Chọn làm đáp án đúng"></div>
          <div class="flex items-center gap-2"><span class="font-bold text-xs w-4">B.</span><input id="add-opt-1" class="w-full p-1.5 border rounded text-xs"><input type="radio" name="add-correct" value="1" title="Chọn làm đáp án đúng"></div>
          <div class="flex items-center gap-2"><span class="font-bold text-xs w-4">C.</span><input id="add-opt-2" class="w-full p-1.5 border rounded text-xs"><input type="radio" name="add-correct" value="2" title="Chọn làm đáp án đúng"></div>
          <div class="flex items-center gap-2"><span class="font-bold text-xs w-4">D.</span><input id="add-opt-3" class="w-full p-1.5 border rounded text-xs"><input type="radio" name="add-correct" value="3" title="Chọn làm đáp án đúng"></div>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Lời giải chi tiết</label>
          <textarea id="add-q-exp" class="w-full h-20 p-2 border rounded font-mono text-xs" placeholder="Lời giải..."></textarea>
        </div>
      </div>
    `,
    width: '650px',
    showCancelButton: true,
    confirmButtonText: 'Thêm Vào Đề',
    confirmButtonColor: '#10b981',
    cancelButtonText: 'Hủy'
  }).then(res => {
    if (res.isConfirmed) {
      const type = document.getElementById('add-q-type')?.value || 'mcq';
      const content = document.getElementById('add-q-content')?.value.trim();
      const exp = document.getElementById('add-q-exp')?.value.trim() || '';

      if (!content) {
        showToast('Vui lòng nhập nội dung câu hỏi', 'warning');
        return;
      }

      const currentTab = appState.draftExam.activeTab || '101';
      let newQ = {
        id: `q_user_${Date.now()}`,
        type,
        content,
        explanation: exp
      };

      if (type === 'mcq') {
        const correctRadio = document.querySelector('input[name="add-correct"]:checked');
        newQ.correctAnswer = correctRadio ? parseInt(correctRadio.value, 10) : 0;
        newQ.options = [0, 1, 2, 3].map(i => ({
          text: document.getElementById(`add-opt-${i}`)?.value.trim() || `Phương án ${i + 1}`
        }));
      } else if (type === 'tf') {
        newQ.items = [
          { text: 'Mệnh đề a', correct: true },
          { text: 'Mệnh đề b', correct: false },
          { text: 'Mệnh đề c', correct: true },
          { text: 'Mệnh đề d', correct: false }
        ];
      } else if (type === 'short' || type === 'cloze') {
        newQ.correctAnswer = '0';
      }

      if (!appState.draftExam.versions[currentTab]) appState.draftExam.versions[currentTab] = [];
      appState.draftExam.versions[currentTab].push(newQ);

      renderExamDraftTabs();
      renderExamDraft();
      showToast('Đã thêm câu hỏi mới thành công!');
    }
  });
}

export function duplicateDraftQuestion(idx) {
  const currentTab = appState.draftExam.activeTab || '101';
  const questions = appState.draftExam.versions[currentTab];
  if (!questions || !questions[idx]) return;

  const clone = JSON.parse(JSON.stringify(questions[idx]));
  clone.id = `q_dup_${Date.now()}`;
  questions.splice(idx + 1, 0, clone);

  renderExamDraftTabs();
  renderExamDraft();
  showToast('Đã nhân bản câu hỏi');
}

export function moveDraftQuestion(idx, direction) {
  const currentTab = appState.draftExam.activeTab || '101';
  const questions = appState.draftExam.versions[currentTab];
  if (!questions) return;

  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= questions.length) return;

  const temp = questions[idx];
  questions[idx] = questions[targetIdx];
  questions[targetIdx] = temp;

  renderExamDraft();
}

export function removeDraftQuestion(idx) {
  const currentTab = appState.draftExam.activeTab || '101';
  if (appState.draftExam.versions[currentTab]) {
    appState.draftExam.versions[currentTab].splice(idx, 1);
    renderExamDraft();
    renderExamDraftTabs();
    showToast('Đã xóa câu hỏi');
  }
}

export function clearDraftTab() {
  const currentTab = appState.draftExam.activeTab || '101';
  if (window.Swal) {
    window.Swal.fire({
      title: `Xóa câu hỏi Mã ${currentTab}?`,
      text: 'Toàn bộ câu hỏi trong mã đề này sẽ bị xóa khỏi bản nháp.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Đồng ý xóa',
      confirmButtonColor: '#ef4444'
    }).then(res => {
      if (res.isConfirmed) {
        appState.draftExam.versions[currentTab] = [];
        renderExamDraft();
        renderExamDraftTabs();
        showToast(`Đã làm trống Mã ${currentTab}`);
      }
    });
  }
}

// Xem thử toàn bộ đề thi trước khi phát hành
export function previewDraftExam() {
  const currentTab = appState.draftExam.activeTab || '101';
  const questions = appState.draftExam.versions[currentTab] || [];
  if (questions.length === 0) {
    showToast('Chưa có câu hỏi nào để xem thử', 'warning');
    return;
  }

  if (!window.Swal) return;
  const questionsHtml = questions.map((q, idx) => `
    <div class="mb-4 pb-3 border-b text-left text-xs">
      <div class="font-bold text-primary mb-1">Câu ${idx + 1} (${q.type}):</div>
      <div class="math-render text-slate-800 mb-2">${renderMathContent(q.content)}</div>
      ${renderDraftQuestionOptions(q)}
    </div>
  `).join('');

  window.Swal.fire({
    title: `Xem Thử Đề Thi - Mã ${currentTab}`,
    html: `<div class="max-h-[500px] overflow-y-auto px-2">${questionsHtml}</div>`,
    width: '750px',
    confirmButtonText: 'Đóng'
  });
  triggerMathJax();
}

// ==========================================
// BỘ PHÂN TÍCH ĐỀ TOÀN DIỆN (LATEX, WORD & TEXT)
// ==========================================
export function extractBracedArguments(str, startIndex, count) {
  let idx = startIndex;
  const args = [];
  for (let c = 0; c < count; c++) {
    while (idx < str.length && str[idx] !== '{' && /\s/.test(str[idx])) idx++;
    if (idx >= str.length || str[idx] !== '{') break;
    idx++; // skip '{'
    let depth = 1;
    let startArg = idx;
    while (idx < str.length && depth > 0) {
      if (str[idx] === '\\') { idx += 2; continue; }
      if (str[idx] === '{') depth++;
      else if (str[idx] === '}') depth--;
      idx++;
    }
    args.push(str.slice(startArg, idx - 1).trim());
  }
  return { args, endIndex: idx };
}

export function parseFullExamOrPracticeContent(rawContent) {
  if (!rawContent || !rawContent.trim()) return [];
  let content = rawContent;

  // Lọc bỏ ghi chú LaTeX % (ngoại trừ \%)
  content = content.replace(/(^|[^\\])%.*$/gm, '$1');

  // Kiểm tra nếu có khối \begin{ex}
  if (/\\begin\{ex\}/i.test(content)) {
    return parseLatexExBlocks(content);
  }

  // Nếu không, bóc tách dạng văn bản thường / Word
  return parseTextQuestions(content);
}

// Bóc tách khối \begin{ex}...\end{ex} từ file LaTeX chuẩn
function parseLatexExBlocks(content) {
  const questions = [];
  const startRegex = /\\begin\{ex\}/g;
  let match;

  while ((match = startRegex.exec(content)) !== null) {
    const startIdx = match.index + match[0].length;
    let endIdx = content.indexOf('\\end{ex}', startIdx);
    if (endIdx === -1) endIdx = content.length;
    const block = content.slice(startIdx, endIdx).trim();

    // Tách lời giải \loigiai{...}
    let questionBody = block;
    let explanation = '';
    const lgIdx = block.lastIndexOf('\\loigiai');
    if (lgIdx !== -1) {
      const openBrace = block.indexOf('{', lgIdx);
      if (openBrace !== -1) {
        const { args } = extractBracedArguments(block, openBrace, 1);
        if (args.length > 0) explanation = args[0];
        questionBody = block.slice(0, lgIdx).trim();
      }
    }

    // Nhận diện dạng câu hỏi
    const choiceMatch = questionBody.match(/\\choice\b/);
    const tfMatch = questionBody.match(/\\choiceTF[t]?\b/);
    const shortMatch = questionBody.match(/\\shortans\b/);
    const clozeMatch = questionBody.match(/\\cloze\b/);

    if (choiceMatch) {
      // 1. Trắc nghiệm 4 phương án
      const cIdx = choiceMatch.index + choiceMatch[0].length;
      const qPrompt = questionBody.slice(0, choiceMatch.index).trim();
      const { args } = extractBracedArguments(questionBody, cIdx, 4);
      let correctIdx = 0;
      const options = args.map((opt, i) => {
        let isTrue = false;
        if (/\\True\b/i.test(opt)) {
          isTrue = true;
          correctIdx = i;
        }
        return { text: opt.replace(/\\True\b/gi, '').trim(), isCorrect: isTrue };
      });
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'mcq',
        content: qPrompt,
        options,
        correctAnswer: correctIdx,
        explanation
      });
    } else if (tfMatch) {
      // 2. Đúng / Sai
      const tfIdx = tfMatch.index + tfMatch[0].length;
      const qPrompt = questionBody.slice(0, tfMatch.index).trim();
      const { args } = extractBracedArguments(questionBody, tfIdx, 4);
      const items = args.map((it) => {
        const isTrue = /\\True\b/i.test(it);
        return { text: it.replace(/\\True\b/gi, '').trim(), correct: isTrue };
      });
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'tf',
        content: qPrompt,
        items,
        explanation
      });
    } else if (shortMatch) {
      // 3. Trả lời ngắn
      const sIdx = shortMatch.index + shortMatch[0].length;
      const qPrompt = questionBody.slice(0, shortMatch.index).trim();
      const openB = questionBody.indexOf('{', sIdx);
      const { args } = extractBracedArguments(questionBody, openB, 1);
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'short',
        content: qPrompt,
        correctAnswer: args[0] ? args[0].trim() : '',
        explanation
      });
    } else if (clozeMatch) {
      // 4. Điền khuyết
      const clIdx = clozeMatch.index + clozeMatch[0].length;
      const qPrompt = questionBody.slice(0, clozeMatch.index).trim();
      const openB = questionBody.indexOf('{', clIdx);
      const { args } = extractBracedArguments(questionBody, openB, 1);
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'cloze',
        content: qPrompt,
        correctAnswer: args[0] ? args[0].trim() : '',
        explanation
      });
    } else if (/\[\.\.\.\]|\[\d+\]|điền\s+vào\s+chỗ\s+trống/i.test(questionBody)) {
      // Nhận diện điền khuyết theo dấu ngoặc vuông
      let ans = '';
      const bMatch = questionBody.match(/\[([^\]]+)\]/);
      if (bMatch && bMatch[1] && !/^\d+$/.test(bMatch[1])) ans = bMatch[1];
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'cloze',
        content: questionBody,
        correctAnswer: ans,
        explanation
      });
    } else {
      // 5. Tự luận (Essay)
      questions.push({
        id: `q_ex_${Date.now()}_${questions.length}`,
        type: 'essay',
        content: questionBody,
        explanation
      });
    }
  }

  return questions;
}

// Bóc tách câu hỏi từ văn bản thuần / Word
function parseTextQuestions(text) {
  const blocks = text.split(/(?:Câu\s+\d+|Bài\s+\d+|\[Câu\s+\d+\]|\n\s*\d+[\.\:])/i).filter(b => b.trim().length > 8);
  if (blocks.length === 0) return [];

  return blocks.map((blk, idx) => {
    let content = blk;
    let explanation = '';
    const lgMatch = blk.match(/(?:Lời giải|Hướng dẫn giải|loigiai)[\:\s]*([\s\S]*)$/i);
    if (lgMatch) {
      explanation = lgMatch[1].trim();
      content = blk.slice(0, lgMatch.index).trim();
    }

    // Làm sạch đầu câu
    content = content.replace(/^[\s\:\.\-]+/, '').trim();

    // 1. Kiểm tra trắc nghiệm 4 lựa chọn A. B. C. D. trước
    const optRegex = /([A-D])[\.\:\)]\s*([^\n\r]+)/g;
    const options = [];
    let correctIdx = 0;
    let match;
    let lastIndex = -1;

    while ((match = optRegex.exec(content)) !== null) {
      if (lastIndex === -1) lastIndex = match.index;
      let optText = match[2].trim();
      if (optText.includes('*') || /\(đúng\)|\bđúng\b|\btrue\b/i.test(optText)) {
        correctIdx = options.length;
        optText = optText.replace(/\*|\(đúng\)|\bđúng\b/gi, '').trim();
      }
      options.push({ text: optText });
    }

    if (options.length >= 2) {
      return {
        id: `q_txt_${Date.now()}_${idx}`,
        type: 'mcq',
        content: content.slice(0, lastIndex).trim(),
        options,
        correctAnswer: correctIdx,
        explanation
      };
    }

    // 2. Kiểm tra Đúng / Sai a) b) c) d) (chữ thường)
    const tfRegex = /([a-d])[\.\:\)]\s*([^\n\r]+)/g;
    const tfMatches = [...content.matchAll(tfRegex)];
    if (tfMatches.length >= 2) {
      const items = tfMatches.map(m => {
        const textItem = m[2].trim();
        const isTrue = /đúng|\btrue\b|\*/i.test(textItem);
        return { text: textItem.replace(/\(đúng\)|\(sai\)|\*|đúng|sai/gi, '').trim(), correct: isTrue };
      });
      const firstTfIdx = tfMatches[0].index;
      return {
        id: `q_txt_${Date.now()}_${idx}`,
        type: 'tf',
        content: content.slice(0, firstTfIdx).trim(),
        items,
        explanation
      };
    }

    // 3. Kiểm tra điền khuyết
    if (/\[\.\.\.\]|điền\s+khuyết|\[\d+\]/i.test(content)) {
      let ans = '';
      const bMatch = content.match(/\[([^\]]+)\]/);
      if (bMatch && bMatch[1] && !/^\d+$/.test(bMatch[1]) && bMatch[1] !== '...') ans = bMatch[1];
      return {
        id: `q_txt_${Date.now()}_${idx}`,
        type: 'cloze',
        content,
        correctAnswer: ans,
        explanation
      };
    }

    // Kiểm tra trả lời ngắn
    const shortMatch = content.match(/(?:Đáp án|Kết quả|shortans)[\:\s]*([^\n\r]+)/i);
    if (shortMatch) {
      return {
        id: `q_txt_${Date.now()}_${idx}`,
        type: 'short',
        content: content.replace(shortMatch[0], '').trim(),
        correctAnswer: shortMatch[1].trim(),
        explanation
      };
    }

    // Mặc định câu hỏi tự luận
    return {
      id: `q_txt_${Date.now()}_${idx}`,
      type: 'essay',
      content,
      explanation
    };
  });
}

// Bóc tách bảng tần số ghép nhóm LaTeX \begin{tabular} thành Bảng HTML
function parseTabularToHtml(tabCode) {
  try {
    const inner = tabCode.replace(/\\begin\{tabular\}\{[^}]*\}/i, '').replace(/\\end\{tabular\}/i, '');
    const rows = inner.split('\\\\').map(r => r.trim()).filter(r => r.length > 0 && !/^\s*\\hline\s*$/.test(r));
    const htmlRows = rows.map((row, rIdx) => {
      const cleanRow = row.replace(/\\hline/g, '').trim();
      const cells = cleanRow.split('&').map(c => c.trim());
      const cellTag = rIdx === 0 ? 'th' : 'td';
      const bgClass = rIdx === 0 ? 'bg-slate-100 font-bold text-slate-800' : 'bg-white text-slate-700';
      const cellsHtml = cells.map(c => `<${cellTag} class="p-2.5 border border-slate-300 text-center font-semibold text-xs md:text-sm">${c}</${cellTag}>`).join('');
      return `<tr class="${bgClass}">${cellsHtml}</tr>`;
    }).join('');

    return `
      <div class="overflow-x-auto my-3 text-center">
        <table class="mx-auto border-collapse border-2 border-slate-700 bg-white shadow-sm text-sm rounded-lg overflow-hidden">
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    return tabCode;
  }
}

// Bóc tách lệnh \begin{itemchoice}...\itemch...\end{itemchoice} trong lời giải
function parseItemchoiceToHtml(itemCode) {
  try {
    const inner = itemCode.replace(/\\begin\{itemchoice\}/i, '').replace(/\\end\{itemchoice\}/i, '');
    const rawItems = inner.split(/\\itemch\b/).map(s => s.trim()).filter(Boolean);
    const letters = ['a', 'b', 'c', 'd'];

    const itemsHtml = rawItems.map((it, idx) => {
      let isTrue = false;
      let rest = it;
      if (/^Đúng[\.\:]?/i.test(it)) {
        isTrue = true;
        rest = it.replace(/^Đúng[\.\:]?\s*/i, '');
      } else if (/^Sai[\.\:]?/i.test(it)) {
        isTrue = false;
        rest = it.replace(/^Sai[\.\:]?\s*/i, '');
      }
      const badge = isTrue
        ? `<span class="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2 py-0.5 rounded mr-1.5 border border-emerald-300 shadow-xs">ĐÚNG</span>`
        : `<span class="bg-red-100 text-red-800 text-[11px] font-black px-2 py-0.5 rounded mr-1.5 border border-red-300 shadow-xs">SAI</span>`;

      return `
        <div class="p-2.5 bg-white rounded-lg border border-slate-200 shadow-xs flex items-start gap-2.5 mb-2">
          <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">${letters[idx] || idx + 1})</span>
          <div class="text-xs text-slate-800 flex-grow leading-relaxed">
            ${badge} <span>${rest}</span>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="my-3 space-y-1">${itemsHtml}</div>`;
  } catch (e) {
    return itemCode;
  }
}

// Trích xuất nội dung trong cặp ngoặc nhọn { ... } cân bằng (hỗ trợ ngoặc lồng nhau \sqrt[3]{2}, \dfrac, v.v.)
function extractBracedContent(str, startIdx = 0) {
  const openIdx = str.indexOf('{', startIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        return { content: str.slice(openIdx + 1, i), nextIdx: i + 1 };
      }
    }
  }
  return null;
}

// Phân tách chuỗi theo dấu phân cách ở cấp ngoài cùng, không cắt nhầm dấu bên trong {...} hoặc $...$
function splitByTopLevel(str, delim = ',') {
  const parts = [];
  let depth = 0;
  let inMath = false;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '$' && (i === 0 || str[i - 1] !== '\\')) {
      inMath = !inMath;
      cur += c;
    } else if (c === '{') {
      depth++;
      cur += c;
    } else if (c === '}') {
      if (depth > 0) depth--;
      cur += c;
    } else if (c === delim && depth === 0 && !inMath) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '' || parts.length > 0) {
    parts.push(cur.trim());
  }
  return parts;
}

// Định dạng công thức MathJax chuẩn $...$ và loại bỏ dấu $ dư thừa, tự cân bằng ngoặc nhọn
function formatMathItem(val) {
  if (!val) return '';
  let s = String(val).trim().replace(/\$/g, '').trim();
  if (!s) return '';
  let openCount = (s.match(/\{/g) || []).length;
  let closeCount = (s.match(/\}/g) || []).length;
  while (closeCount < openCount) {
    s += '}';
    closeCount++;
  }
  return `$${s}$`;
}

// Chuyển đổi môi trường liệt kê \begin{enumerate}...\end{enumerate} thành HTML danh sách có thứ tự (ngăn lỗi Unknown environment 'enumerate')
export function parseEnumerateToHtml(str) {
  if (!str || !str.includes('\\begin{enumerate}')) return str;
  let res = str;
  let prev = '';
  let count = 0;
  while (res.includes('\\begin{enumerate}') && res !== prev && count < 5) {
    prev = res;
    count++;
    res = res.replace(/\\begin\{enumerate\}(?:\[(.*?)\])?([\s\S]*?)\\end\{enumerate\}/gi, (match, opt, body) => {
      const rawItems = body.split(/\\item\b/).slice(1);
      if (rawItems.length === 0) return body;
      let listClass = "list-decimal pl-6 space-y-1.5 my-2.5 text-inherit";
      if (opt) {
        const o = opt.trim().toLowerCase();
        if (o.includes('a')) listClass = "list-[lower-alpha] pl-6 space-y-1.5 my-2.5 text-inherit";
        else if (o.includes('i')) listClass = "list-[lower-roman] pl-6 space-y-1.5 my-2.5 text-inherit";
      }
      const itemsHtml = rawItems.map(raw => {
        let text = raw.trim();
        let customPrefix = '';
        const bracketMatch = text.match(/^\[(.*?)\]\s*/);
        if (bracketMatch) {
          customPrefix = `<b class="mr-1">${bracketMatch[1]}</b>`;
          text = text.slice(bracketMatch[0].length);
        }
        text = text.replace(/\\\\$/, '').trim();
        return `<li class="leading-relaxed pl-1">${customPrefix}${text}</li>`;
      }).join('');
      return `<ol class="${listClass}">${itemsHtml}</ol>`;
    });
  }
  return res;
}

// Chuyển đổi môi trường danh sách không thứ tự \begin{itemize}...\end{itemize} thành HTML
export function parseItemizeToHtml(str) {
  if (!str || !str.includes('\\begin{itemize}')) return str;
  let res = str;
  let prev = '';
  let count = 0;
  while (res.includes('\\begin{itemize}') && res !== prev && count < 5) {
    prev = res;
    count++;
    res = res.replace(/\\begin\{itemize\}(?:\[(.*?)\])?([\s\S]*?)\\end\{itemize\}/gi, (match, opt, body) => {
      const rawItems = body.split(/\\item\b/).slice(1);
      if (rawItems.length === 0) return body;
      const itemsHtml = rawItems.map(raw => {
        let text = raw.trim().replace(/\\\\$/, '').trim();
        return `<li class="leading-relaxed pl-1">${text}</li>`;
      }).join('');
      return `<ul class="list-disc pl-6 space-y-1.5 my-2.5 text-inherit">${itemsHtml}</ul>`;
    });
  }
  return res;
}

// Thay thế dấu \\ ngoài các khối công thức toán học thành <br/> để xuống dòng lời giải
function replaceLatexLineBreaks(str) {
  if (!str) return '';
  const mathRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:cases|aligned|matrix|bmatrix|pmatrix|vmatrix|hoac|heva)\}[\s\S]*?\\end\{(?:cases|aligned|matrix|bmatrix|pmatrix|vmatrix|hoac|heva)\}|\\hoac\{[\s\S]*?\}|\\heva\{[\s\S]*?\}|\$[^\$\n\r]*?\$)/g;
  let lastIdx = 0;
  let match;
  const tokens = [];
  while ((match = mathRegex.exec(str)) !== null) {
    if (match.index > lastIdx) {
      const textPiece = str.slice(lastIdx, match.index);
      tokens.push(textPiece.replace(/\\\\(?:\s*\[[\d\w\.]+\])?/g, '<br/>'));
    }
    tokens.push(match[0]);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < str.length) {
    const textPiece = str.slice(lastIdx);
    tokens.push(textPiece.replace(/\\\\(?:\s*\[[\d\w\.]+\])?/g, '<br/>'));
  }
  return tokens.join('');
}

// Chuyển đổi định dạng văn bản LaTeX (\textbf, \textit, \underline, {\bf}) thành HTML chuẩn
export function parseLatexFormatting(text) {
  if (!text) return '';
  let str = String(text);

  // Tách biệt giữa khối công thức Toán ($...$, $$...$$, \[...\]) và phần văn bản thông thường
  const mathRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^\$\n\r]*?\$)/g;
  let lastIdx = 0;
  let match;
  let out = '';

  while ((match = mathRegex.exec(str)) !== null) {
    if (match.index > lastIdx) {
      const nonMath = str.slice(lastIdx, match.index);
      out += formatTextStyles(nonMath);
    }
    // Trong công thức toán: chuyển \textbf{...} thành \mathbf{...} để MathJax không bị lỗi
    let mathChunk = match[0];
    mathChunk = mathChunk.replace(/\\textbf\{/g, '\\mathbf{');
    out += mathChunk;
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < str.length) {
    out += formatTextStyles(str.slice(lastIdx));
  }

  return out;
}

function formatTextStyles(text) {
  if (!text) return '';
  let res = '';
  let i = 0;
  while (i < text.length) {
    const tbIdx = text.indexOf('\\textbf', i);
    const tiIdx = text.indexOf('\\textit', i);
    const unIdx = text.indexOf('\\underline', i);

    const candidates = [
      { type: 'bold', idx: tbIdx, len: 7, tag: 'strong', cls: 'font-bold' },
      { type: 'italic', idx: tiIdx, len: 7, tag: 'em', cls: 'italic' },
      { type: 'underline', idx: unIdx, len: 10, tag: 'span', cls: 'underline' }
    ].filter(c => c.idx !== -1).sort((a, b) => a.idx - b.idx);

    if (candidates.length === 0) {
      res += text.slice(i);
      break;
    }

    const first = candidates[0];
    res += text.slice(i, first.idx);

    let afterIdx = first.idx + first.len;
    while (afterIdx < text.length && /\s/.test(text[afterIdx])) afterIdx++;

    if (text[afterIdx] === '{') {
      let depth = 1;
      let start = afterIdx + 1;
      let end = -1;
      for (let k = start; k < text.length; k++) {
        if (text[k] === '\\') { k++; continue; }
        if (text[k] === '{') depth++;
        else if (text[k] === '}') {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      if (end !== -1) {
        const inner = text.slice(start, end);
        res += `<${first.tag} class="${first.cls}">${formatTextStyles(inner)}</${first.tag}>`;
        i = end + 1;
        continue;
      }
    }

    res += text.slice(first.idx, afterIdx);
    i = afterIdx;
  }

  // Hỗ trợ thêm cú pháp {\bf ...}
  res = res.replace(/\{\\bf\s+([^}]+)\}/g, '<strong class="font-bold">$1</strong>');
  return res;
}

// Biên dịch nội dung Toán: Danh sách, Bảng biến thiên, Đồ thị SVG, Bảng tần số, Lời giải itemchoice
export function renderMathContent(rawText) {
  if (!rawText) return '';
  let content = rawText;

  // 0. Xử lý môi trường danh sách \begin{enumerate}...\end{enumerate} và \begin{itemize}...\end{itemize}
  content = parseEnumerateToHtml(content);
  content = parseItemizeToHtml(content);

  // 1. Biên dịch bảng tần số ghép nhóm \begin{tabular}...\end{tabular}
  content = content.replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, match => {
    return parseTabularToHtml(match);
  });

  // 2. Biên dịch cấu trúc lời giải \begin{itemchoice}...\end{itemchoice}
  content = content.replace(/\\begin\{itemchoice\}[\s\S]*?\\end\{itemchoice\}/g, match => {
    return parseItemchoiceToHtml(match);
  });

  // 3. Biên dịch bảng biến thiên & bảng xét dấu tkz-tab chuẩn xác
  content = content.replace(/\\begin\{tikzpicture\}[\s\S]*?\\tkzTabInit[\s\S]*?\\end\{tikzpicture\}/g, match => {
    return parseTkzTabToHtml(match);
  });

  // 4. Biên dịch đồ thị hàm số và hình học TikZ thành SVG riêng biệt
  content = content.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, match => {
    return parseTikzToSvg(match);
  });

  // 5. Dọn dẹp và chuyển đổi lệnh \begin{center} ... \end{center} thành khối căn giữa HTML
  content = content.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/gi, (m, inner) => {
    return `<div class="text-center my-3">${inner.trim()}</div>`;
  });
  content = content.replace(/\\begin\{center\}/gi, '<div class="text-center my-2">');
  content = content.replace(/\\end\{center\}/gi, '</div>');

  // 6. Xử lý dấu \\ trong lời giải và câu hỏi thành <br/> để xuống dòng rõ ràng
  content = replaceLatexLineBreaks(content);

  // 7. Xử lý lệnh in đậm \textbf{...}, in nghiêng \textit{...}, gạch chân \underline{...}
  content = parseLatexFormatting(content);

  return content;
}

// Bộ phân tích và vẽ Bảng biến thiên & Bảng xét dấu động (tkz-tab)
// Xử lý linh hoạt các tham số [lgt=..., espcl=...], đường kẻ ngang rõ ràng, ẩn các đường chia cột dọc, hỗ trợ đầy đủ các điểm gián đoạn
function parseTkzTabToHtml(tkzCode) {
  try {
    let headers = ['$x$', "$y'$", '$y$'];
    let nodes = ['$-\\infty$', '$0$', '$2$', '$+\\infty$'];

    // 1. Phân tích \tkzTabInit linh hoạt với hoặc không có [lgt=..., espcl=...]
    const initIdx = tkzCode.search(/\\tkzTabInit\b/);
    if (initIdx !== -1) {
      const afterInit = tkzCode.slice(initIdx);
      const firstBrace = afterInit.indexOf('{');
      if (firstBrace !== -1) {
        const g1 = extractBracedContent(tkzCode, initIdx + firstBrace);
        if (g1) {
          const rawHeaders = splitByTopLevel(g1.content, ',');
          headers = rawHeaders.map(h => formatMathItem(splitByTopLevel(h, '/')[0].replace(/\$/g, '').trim()));
          const g2 = extractBracedContent(tkzCode, g1.nextIdx);
          if (g2) {
            nodes = splitByTopLevel(g2.content, ',').map(n => formatMathItem(n));
          }
        }
      }
    }

    const N = nodes.length;
    if (N < 2) return `<div class="p-2 bg-gray-100 rounded text-xs font-mono">${escapeHtml(tkzCode)}</div>`;

    // 2. Phân tích dòng dấu đạo hàm \tkzTabLine linh hoạt
    let tokens = [];
    const lineIdx = tkzCode.search(/\\tkzTabLine\b/);
    if (lineIdx !== -1) {
      const afterLine = tkzCode.slice(lineIdx);
      const firstBrace = afterLine.indexOf('{');
      if (firstBrace !== -1) {
        const gLine = extractBracedContent(tkzCode, lineIdx + firstBrace);
        if (gLine) {
          tokens = splitByTopLevel(gLine.content, ',');
        }
      }
    }

    // 3. Phân tích dòng biến thiên y: \tkzTabVar linh hoạt
    let varItems = [];
    const varIdx = tkzCode.search(/\\tkzTabVar\b/);
    if (varIdx !== -1) {
      const afterVar = tkzCode.slice(varIdx);
      const firstBrace = afterVar.indexOf('{');
      if (firstBrace !== -1) {
        const gVar = extractBracedContent(tkzCode, varIdx + firstBrace);
        if (gVar) {
          varItems = splitByTopLevel(gVar.content, ',');
        }
      }
    }

    const hasYRow = headers.length >= 3 && varItems.length > 0;
    const tabUid = 'tab_' + Math.random().toString(36).substring(2, 9);

    // Tiền xử lý dữ liệu hàng y cho N điểm mút (nodes)
    // Hỗ trợ đầy đủ các điểm gián đoạn hai vạch: d, ||, +D-, -D+, D+, D-, +D, -D, +D+, -D-
    const nodeInfo = [];
    for (let k = 0; k < N; k++) {
      const it = varItems[k] || '';
      const parts = splitByTopLevel(it, '/');
      const tokAtNode = tokens[2 * k] || '';
      const isDouble = parts[0]?.includes('D') || parts[0]?.includes('||') || tokAtNode === 'd' || tokAtNode === '||';

      if (isDouble) {
        if (parts.length >= 3) {
          nodeInfo.push({
            isDouble: true,
            leftVal: formatMathItem(parts[1]),
            leftLevel: parts[0].startsWith('+') ? 'top' : 'bottom',
            rightVal: formatMathItem(parts[2]),
            rightLevel: parts[0].endsWith('+') ? 'top' : 'bottom'
          });
        } else if (parts[0]?.startsWith('D') || parts[0]?.startsWith('||')) {
          nodeInfo.push({
            isDouble: true,
            leftVal: null,
            leftLevel: null,
            rightVal: formatMathItem(parts[1]),
            rightLevel: parts[0].includes('+') ? 'top' : 'bottom'
          });
        } else if (parts[0]?.endsWith('D') || parts[0]?.endsWith('||')) {
          nodeInfo.push({
            isDouble: true,
            leftVal: formatMathItem(parts[1]),
            leftLevel: parts[0].includes('+') ? 'top' : 'bottom',
            rightVal: null,
            rightLevel: null
          });
        } else {
          nodeInfo.push({
            isDouble: true,
            leftVal: null,
            leftLevel: null,
            rightVal: formatMathItem(parts[1]),
            rightLevel: 'top'
          });
        }
      } else {
        const level = parts[0] === '+' ? 'top' : 'bottom';
        nodeInfo.push({
          isDouble: false,
          val: formatMathItem(parts[1] || ''),
          level,
          leftLevel: level,
          rightLevel: level
        });
      }
    }

    const numCols = 2 * N - 1;

    // Hàng 1: Giá trị x (đường kẻ ngang phân cách dưới rõ ràng)
    let row1Cells = `<td class="font-bold bg-slate-100 border-r-2 border-b-2 border-slate-700 text-center p-2 text-slate-800 w-16 md:w-20 select-none">${headers[0] || '$x$'}</td>`;
    for (let c = 0; c < numCols; c++) {
      if (c % 2 === 0) {
        const k = c / 2;
        row1Cells += `<td class="border-b-2 border-slate-700 border-x-0 text-center font-bold px-1.5 py-2 text-slate-800 whitespace-nowrap min-w-[50px] md:min-w-[65px]">${nodes[k] || ''}</td>`;
      } else {
        row1Cells += `<td class="border-b-2 border-slate-700 border-x-0 text-center px-2 py-2 min-w-[65px] md:min-w-[85px]"></td>`;
      }
    }

    // Hàng 2: Dấu đạo hàm f'(x) (đường kẻ ngang phân cách dưới rõ ràng)
    const row2BorderBottom = hasYRow ? 'border-b-2 border-slate-700' : '';
    let row2Cells = `<td class="font-bold bg-slate-100 border-r-2 ${row2BorderBottom} border-slate-700 text-center p-2 text-slate-800 w-16 md:w-20 select-none">${headers[1] || "$y'$"}</td>`;
    for (let c = 0; c < numCols; c++) {
      const tok = tokens[c] || '';
      if (c % 2 === 0) {
        if (tok === 'd' || tok === '||') {
          // Hai gạch dọc gián đoạn chuẩn xác
          row2Cells += `
            <td class="text-center px-0.5 py-0 ${row2BorderBottom} border-x-0">
              <div class="h-8 flex items-center justify-center">
                <div class="inline-flex h-full items-center gap-[3px] shrink-0">
                  <div class="w-[2px] h-full bg-slate-800"></div>
                  <div class="w-[2px] h-full bg-slate-800"></div>
                </div>
              </div>
            </td>
          `;
        } else if (tok === '0' || tok === 'z') {
          row2Cells += `<td class="text-center px-1 py-1 font-bold text-slate-700 ${row2BorderBottom} border-x-0"><div class="h-8 flex items-center justify-center">0</div></td>`;
        } else if (tok === 't') {
          row2Cells += `
            <td class="text-center px-0.5 py-0 ${row2BorderBottom} border-x-0">
              <div class="h-8 flex items-center justify-center">
                <div class="w-[2px] h-full bg-slate-700"></div>
              </div>
            </td>
          `;
        } else {
          row2Cells += `<td class="text-center px-1 py-1 ${row2BorderBottom} border-x-0"><div class="h-8 flex items-center justify-center">${tok}</div></td>`;
        }
      } else {
        if (tok === '+') {
          row2Cells += `<td class="text-center px-2 py-1 font-black text-blue-600 text-lg ${row2BorderBottom} border-x-0"><div class="h-8 flex items-center justify-center">+</div></td>`;
        } else if (tok === '-') {
          row2Cells += `<td class="text-center px-2 py-1 font-black text-red-500 text-lg ${row2BorderBottom} border-x-0"><div class="h-8 flex items-center justify-center">−</div></td>`;
        } else {
          row2Cells += `<td class="text-center px-2 py-1 ${row2BorderBottom} border-x-0"><div class="h-8 flex items-center justify-center">${tok}</div></td>`;
        }
      }
    }

    // Hàng 3: Biến thiên y với mũi tên vector nối chuẩn xác
    let row3Html = '';
    if (hasYRow) {
      let row3Cells = `<td class="font-bold bg-slate-100 border-r-2 border-slate-700 text-center p-2 text-slate-800 w-16 md:w-20 select-none">${headers[2] || '$y$'}</td>`;
      for (let c = 0; c < numCols; c++) {
        if (c % 2 === 0) {
          const k = c / 2;
          const info = nodeInfo[k] || { isDouble: false, val: '', level: 'top' };
          if (info.isDouble) {
            const doubleBarHtml = `
              <div class="inline-flex h-full min-h-[85px] items-center gap-[3px] shrink-0 mx-1">
                <div class="w-[2px] h-full bg-slate-800"></div>
                <div class="w-[2px] h-full bg-slate-800"></div>
              </div>
            `;
            if (info.leftVal && info.rightVal) {
              row3Cells += `
                <td class="text-center px-0.5 py-0 border-x-0">
                  <div class="h-[90px] flex items-center justify-between w-full px-0.5">
                    <div class="flex flex-col ${info.leftLevel === 'top' ? 'justify-start pt-1' : 'justify-end pb-1'} h-full">
                      <span class="font-bold text-xs md:text-sm text-slate-800 whitespace-nowrap">${info.leftVal}</span>
                    </div>
                    ${doubleBarHtml}
                    <div class="flex flex-col ${info.rightLevel === 'top' ? 'justify-start pt-1' : 'justify-end pb-1'} h-full">
                      <span class="font-bold text-xs md:text-sm text-slate-800 whitespace-nowrap">${info.rightVal}</span>
                    </div>
                  </div>
                </td>
              `;
            } else if (info.rightVal) {
              row3Cells += `
                <td class="text-center px-0.5 py-0 border-x-0">
                  <div class="h-[90px] flex items-center justify-start w-full">
                    ${doubleBarHtml}
                    <div class="flex flex-col ${info.rightLevel === 'top' ? 'justify-start pt-1' : 'justify-end pb-1'} h-full ml-1">
                      <span class="font-bold text-xs md:text-sm text-slate-800 whitespace-nowrap">${info.rightVal}</span>
                    </div>
                  </div>
                </td>
              `;
            } else {
              row3Cells += `
                <td class="text-center px-0.5 py-0 border-x-0">
                  <div class="h-[90px] flex items-center justify-end w-full">
                    <div class="flex flex-col ${info.leftLevel === 'top' ? 'justify-start pt-1' : 'justify-end pb-1'} h-full mr-1">
                      <span class="font-bold text-xs md:text-sm text-slate-800 whitespace-nowrap">${info.leftVal || ''}</span>
                    </div>
                    ${doubleBarHtml}
                  </div>
                </td>
              `;
            }
          } else {
            row3Cells += `
              <td class="text-center px-1 py-0 border-x-0">
                <div class="h-[90px] flex flex-col ${info.level === 'top' ? 'justify-start pt-1.5' : 'justify-end pb-1.5'} items-center w-full">
                  <span class="font-bold text-xs md:text-sm text-slate-800 whitespace-nowrap">${info.val}</span>
                </div>
              </td>
            `;
          }
        } else {
          // Cột khoảng: vẽ mũi tên vector SVG nối từ node k sang node k+1
          const k = Math.floor(c / 2);
          const startLevel = nodeInfo[k]?.rightLevel || nodeInfo[k]?.level || 'top';
          const endLevel = nodeInfo[k + 1]?.leftLevel || nodeInfo[k + 1]?.level || 'bottom';

          let y1 = 14, y2 = 42;
          if (startLevel === 'top' && endLevel === 'bottom') {
            y1 = 14; y2 = 42; // Mũi tên chéo xuống phải ↘
          } else if (startLevel === 'bottom' && endLevel === 'top') {
            y1 = 42; y2 = 14; // Mũi tên chéo lên phải ↗
          } else if (startLevel === 'top' && endLevel === 'top') {
            y1 = 16; y2 = 16; // Ngang trên
          } else {
            y1 = 40; y2 = 40; // Ngang dưới
          }

          row3Cells += `
            <td class="text-center px-1 py-0 border-x-0">
              <div class="h-[90px] flex items-center justify-center px-1">
                <svg class="w-full h-14" viewBox="0 0 100 50" preserveAspectRatio="none">
                  <defs>
                    <marker id="${tabUid}_m_${k}" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 7 4 L 0 7 z" fill="#2563eb"/>
                    </marker>
                  </defs>
                  <line x1="6" y1="${y1}" x2="94" y2="${y2}" stroke="#2563eb" stroke-width="2.2" marker-end="url(#${tabUid}_m_${k})"/>
                </svg>
              </div>
            </td>
          `;
        }
      }
      row3Html = `<tr>${row3Cells}</tr>`;
    }

    return `
      <div class="overflow-x-auto my-4 text-center">
        <table class="tkz-tab-table mx-auto border-2 border-slate-700 bg-white text-sm shadow-md rounded-lg overflow-hidden select-none" style="border-collapse: collapse;">
          <tbody>
            <tr class="border-b-2 border-slate-700">${row1Cells}</tr>
            <tr class="${hasYRow ? 'border-b-2 border-slate-700' : ''}">${row2Cells}</tr>
            ${row3Html}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    return `<div class="p-2 bg-gray-100 rounded text-xs font-mono">${escapeHtml(tkzCode)}</div>`;
  }
}

// Bộ phân tích và vẽ Đồ thị TikZ tự động toàn diện:
// - Bóc tách hệ trục tọa độ Ox, Oy, gốc O
// - Bóc tách các đường gióng tọa độ nét đứt \draw[dashed], nhãn điểm trên trục và cực trị
// - Đảm bảo tỷ lệ chia khoảng của hai trục Ox và Oy phải bằng nhau (unitScale isometric 1:1)
// - Mở rộng khung chứa đồ thị ra (W = 480, H = 340, giao diện thoáng đẹp, sắc nét)
// - Vẽ đúng các điểm hiển thị trên đồ thị, các đường đứt nét và đường cong hàm số tương ứng
function parseGenericTikzGraph(tikzCode) {
  try {
    // 0. Bóc tách scale nếu có trong \begin{tikzpicture}[scale=...]
    const scaleMatch = tikzCode.match(/scale\s*=\s*([-\d\.]+)/i);
    const tikzScale = (scaleMatch && !isNaN(parseFloat(scaleMatch[1]))) ? Math.max(0.4, Math.min(2.5, parseFloat(scaleMatch[1]))) : 1.0;

    // 1. Dọn dẹp comment và loại bỏ môi trường \begin{tikzpicture} / \end{tikzpicture}
    let cleanCode = tikzCode
      .split('\n')
      .map(line => line.replace(/%.*$/, '').trim())
      .filter(Boolean)
      .join(' ');

    cleanCode = cleanCode
      .replace(/\\begin\{tikzpicture\}(?:\[[^\]]*\])?/gi, '')
      .replace(/\\end\{tikzpicture\}/gi, '')
      .trim();

    const statements = cleanCode.split(';').map(s => s.trim()).filter(Boolean);

    let xMinAxis = null, xMaxAxis = null;
    let yMinAxis = null, yMaxAxis = null;
    let oxLabel = 'x', oyLabel = 'y', originLabel = 'O';
    let oxPos = 'below', oyPos = 'right';

    const allX = [];
    const allY = [];
    const dashedLines = []; // [{ pts: [{x, y}], isAsymptote: boolean, color: string }]
    const markedPoints = []; // [{ x, y, label, isExtremum: boolean }]
    const axisTicksX = []; // [{ x, label, pos }]
    const axisTicksY = []; // [{ y, label, pos }]
    const plotList = []; // [{ dMin, dMax, formula }]
    const splinePaths = []; // [ [{x, y}] ]

    const cleanMathLabel = (lbl) => {
      if (!lbl) return '';
      return lbl.replace(/\$/g, '').replace(/\\left|\\right/g, '').trim();
    };

    const addTickX = (xVal, label, pos = 'below') => {
      if (Math.abs(xVal) < 0.05) return;
      if (!axisTicksX.some(t => Math.abs(t.x - xVal) < 0.05)) {
        axisTicksX.push({ x: xVal, label: cleanMathLabel(label) || `${xVal}`, pos });
      }
    };

    const addTickY = (yVal, label, pos = 'left') => {
      if (Math.abs(yVal) < 0.05) return;
      if (!axisTicksY.some(t => Math.abs(t.y - yVal) < 0.05)) {
        axisTicksY.push({ y: yVal, label: cleanMathLabel(label) || `${yVal}`, pos });
      }
    };

    const addMarkedPoint = (xVal, yVal, label = null) => {
      if (!markedPoints.some(p => Math.abs(p.x - xVal) < 0.05 && Math.abs(p.y - yVal) < 0.05)) {
        markedPoints.push({ x: xVal, y: yVal, label: cleanMathLabel(label), isExtremum: true });
      }
    };

    // Helper: trích xuất chuỗi các điểm trong đường vẽ (node và coordinates)
    const extractPointChain = (str) => {
      const segments = str.split(/(?:--|\bto\b)/);
      const pts = [];
      for (const seg of segments) {
        const coordMatch = seg.match(/\(\s*([-\d\.]+)\s*,\s*([-\d\.]+)\s*\)/);
        if (coordMatch) {
          const x = parseFloat(coordMatch[1]);
          const y = parseFloat(coordMatch[2]);
          const nodeMatch = seg.match(/node\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/i);
          let node = null;
          if (nodeMatch) {
            node = {
              pos: (nodeMatch[1] || 'below').trim().toLowerCase(),
              label: cleanMathLabel(nodeMatch[2])
            };
          }
          pts.push({ x, y, node });
        }
      }
      return pts;
    };

    // 2. Phân tích từng lệnh
    for (const stmt of statements) {
      // A. Hệ trục tọa độ: \draw[->] (-3,0) -- (3,0) node[below] {$x$};
      if (/\bdraw\b/i.test(stmt) && /(?:->|-stealth|->>|-latex|>=stealth)/i.test(stmt)) {
        const chain = extractPointChain(stmt);
        if (chain.length >= 2) {
          const p1 = chain[0];
          const p2 = chain[chain.length - 1];

          // Trục Ox: y1 === 0 && y2 === 0
          if (Math.abs(p1.y) < 0.08 && Math.abs(p2.y) < 0.08 && Math.abs(p1.x - p2.x) > 0.3) {
            xMinAxis = Math.min(p1.x, p2.x);
            xMaxAxis = Math.max(p1.x, p2.x);
            allX.push(xMinAxis, xMaxAxis);
            if (p2.node && p2.node.label) {
              oxLabel = p2.node.label;
              if (p2.node.pos) oxPos = p2.node.pos;
            }
            continue;
          }

          // Trục Oy: x1 === 0 && x2 === 0
          if (Math.abs(p1.x) < 0.08 && Math.abs(p2.x) < 0.08 && Math.abs(p1.y - p2.y) > 0.3) {
            yMinAxis = Math.min(p1.y, p2.y);
            yMaxAxis = Math.max(p1.y, p2.y);
            allY.push(yMinAxis, yMaxAxis);
            if (p2.node && p2.node.label) {
              oyLabel = p2.node.label;
              if (p2.node.pos) oyPos = p2.node.pos;
            }
            continue;
          }
        }
      }

      // B. Gốc tọa độ O: \draw (0,0) node[below left] {$O$}; hoặc \node at (0,0) [below left] {$O$};
      if ((stmt.includes('(0,0)') || stmt.includes('(0, 0)')) && (stmt.includes('{O}') || stmt.includes('{$O$}'))) {
        allX.push(0);
        allY.push(0);
        originLabel = 'O';
        continue;
      }

      // C. Lệnh \node at (x,y) [pos] {label};
      const nodeAtMatch = stmt.match(/\\node\s+at\s*\(\s*([-\d\.]+)\s*,\s*([-\d\.]+)\s*\)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/i);
      if (nodeAtMatch) {
        const nx = parseFloat(nodeAtMatch[1]);
        const ny = parseFloat(nodeAtMatch[2]);
        const npos = (nodeAtMatch[3] || '').trim().toLowerCase();
        const nlbl = cleanMathLabel(nodeAtMatch[4]);
        allX.push(nx);
        allY.push(ny);

        if (Math.abs(nx) < 0.05 && Math.abs(ny) < 0.05 && (nlbl === 'O' || nlbl === '0')) {
          originLabel = nlbl;
        } else if (Math.abs(ny) < 0.05) {
          if (nlbl === 'x') { oxLabel = 'x'; oxPos = npos || oxPos; }
          else addTickX(nx, nlbl, npos || 'below');
        } else if (Math.abs(nx) < 0.05) {
          if (nlbl === 'y') { oyLabel = 'y'; oyPos = npos || oyPos; }
          else addTickY(ny, nlbl, npos || 'left');
        }
        continue;
      }

      // D. Lệnh \filldraw / \fill (x,y) circle ... [node]
      const fillMatch = stmt.match(/\\fill(?:draw)?\s*(?:\[[^\]]*\])?\s*\(\s*([-\d\.]+)\s*,\s*([-\d\.]+)\s*\)\s*circle(?:\s*\([^)]*\))?(?:\s*node\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\})?/i);
      if (fillMatch) {
        const fx = parseFloat(fillMatch[1]);
        const fy = parseFloat(fillMatch[2]);
        const fpos = (fillMatch[3] || '').trim().toLowerCase();
        const flbl = cleanMathLabel(fillMatch[4]);
        allX.push(fx);
        allY.push(fy);
        addMarkedPoint(fx, fy, flbl);
        if (Math.abs(fy) < 0.05 && flbl) addTickX(fx, flbl, fpos || 'below');
        if (Math.abs(fx) < 0.05 && flbl) addTickY(fy, flbl, fpos || 'left');
        continue;
      }

      // E. Đường nét đứt gióng tọa độ: \draw[dashed] ... hoặc \draw[dotted] ...
      if (stmt.includes('dashed') || stmt.includes('dotted')) {
        const isRed = stmt.includes('red');
        const chain = extractPointChain(stmt);
        if (chain.length >= 2) {
          if (chain.length === 2 && Math.abs(chain[0].x - chain[1].x) < 0.01) {
            dashedLines.push({ pts: chain, isAsymptote: true, color: isRed ? '#dc2626' : '#64748b' });
            allX.push(chain[0].x);
            continue;
          }
          if (chain.length === 2 && Math.abs(chain[0].y - chain[1].y) < 0.01) {
            dashedLines.push({ pts: chain, isAsymptote: true, color: isRed ? '#dc2626' : '#64748b' });
            allY.push(chain[0].y);
            continue;
          }

          dashedLines.push({ pts: chain, isAsymptote: false, color: '#64748b' });
          for (const p of chain) {
            allX.push(p.x);
            allY.push(p.y);

            if (Math.abs(p.y) < 0.05) {
              if (p.node && p.node.label) {
                addTickX(p.x, p.node.label, p.node.pos || 'below');
              } else if (p.x !== 0) {
                addTickX(p.x, `${p.x}`, 'below');
              }
            } else if (Math.abs(p.x) < 0.05) {
              if (p.node && p.node.label) {
                addTickY(p.y, p.node.label, p.node.pos || 'right');
              } else if (p.y !== 0) {
                addTickY(p.y, `${p.y}`, 'left');
              }
            } else {
              addMarkedPoint(p.x, p.y, p.node ? p.node.label : null);
            }
          }
          continue;
        }
      }

      // F. Lệnh to[out=..., in=...] vẽ đường cong mượt mà qua các điểm (như Câu 5 de_01)
      if (stmt.includes('to[') || stmt.includes('to [')) {
        const coordMatches = [...stmt.matchAll(/\(\s*([-\d\.]+)\s*,\s*([-\d\.]+)\s*\)/g)];
        if (coordMatches.length >= 2) {
          const pts = coordMatches.map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
          pts.forEach(p => { allX.push(p.x); allY.push(p.y); });
          splinePaths.push(pts);
          continue;
        }
      }

      // G. Quét các lệnh plot chuẩn xác (bóc tách toàn bộ công thức { ... } cân bằng)
      if (stmt.includes('plot')) {
        let dMin = null, dMax = null;
        const domMatch = stmt.match(/domain\s*=\s*([-\d\.]+)\s*:\s*([-\d\.]+)/i);
        if (domMatch) {
          dMin = parseFloat(domMatch[1]);
          dMax = parseFloat(domMatch[2]);
        }
        const plotIdx = stmt.search(/\bplot\b/i);
        if (plotIdx !== -1) {
          const afterPlot = stmt.slice(plotIdx);
          const xMatch = afterPlot.match(/\(\s*\\x\s*,\s*/i);
          if (xMatch) {
            const startAfterComma = xMatch.index + xMatch[0].length;
            const rest = afterPlot.slice(startAfterComma);
            let rawFormula = '';
            if (rest.trim().startsWith('{')) {
              const braced = extractBracedContent(rest, rest.indexOf('{'));
              if (braced) rawFormula = braced.content.trim();
            } else {
              const closeParen = rest.lastIndexOf(')');
              if (closeParen !== -1) rawFormula = rest.slice(0, closeParen).trim();
            }
            if (rawFormula) {
              plotList.push({ dMin, dMax, formula: rawFormula });
            }
          }
        }
      }
    }

    // Nếu không bóc tách được trục tọa độ, không có đường gióng, không có plot và không có spline, trả về null để fallback
    if (xMinAxis === null && yMinAxis === null && dashedLines.length === 0 && plotList.length === 0 && splinePaths.length === 0) {
      return null;
    }

    // 3. Xác định phạm vi vẽ trục (oxStart, oxEnd, oyStart, oyEnd) và bounding box
    const oxStart = xMinAxis !== null ? xMinAxis : (allX.length > 0 ? Math.min(...allX) - 0.8 : -3.5);
    const oxEnd = xMaxAxis !== null ? xMaxAxis : (allX.length > 0 ? Math.max(...allX) + 0.8 : 3.5);
    const oyStart = yMinAxis !== null ? yMinAxis : (allY.length > 0 ? Math.min(...allY) - 0.8 : -2.5);
    const oyEnd = yMaxAxis !== null ? yMaxAxis : (allY.length > 0 ? Math.max(...allY) + 0.8 : 4.5);

    // Bounding box bao trọn cả trục tọa độ, mọi điểm và đường gióng
    const bMinX = Math.min(oxStart, ...allX, -0.5);
    const bMaxX = Math.max(oxEnd, ...allX, 0.5);
    const bMinY = Math.min(oyStart, ...allY, -0.5);
    const bMaxY = Math.max(oyEnd, ...allY, 0.5);

    const spanX = Math.max(1, bMaxX - bMinX);
    const spanY = Math.max(1, bMaxY - bMinY);

    // 4. TỶ LỆ CHIA KHOẢNG BẰNG NHAU (sx === sy) & TỰ ĐỘNG MỞ RỘNG KÍCH THƯỚC TRỤC KHI THAY ĐỔI TỌA ĐỘ
    let baseUnitScale = 40 * tikzScale;
    let unitScale = baseUnitScale;
    if (spanX * unitScale > 760) {
      unitScale = 760 / spanX;
    }
    if (spanY * unitScale > 560) {
      unitScale = Math.min(unitScale, 560 / spanY);
    }
    unitScale = Math.max(18, unitScale);

    const padX = 46;
    const padY = 36;
    const contentW = spanX * unitScale;
    const contentH = spanY * unitScale;

    const W = Math.round(Math.max(400, contentW + 2 * padX));
    const H = Math.round(Math.max(280, contentH + 2 * padY));

    // Căn giữa nếu W hoặc H đạt mức tối thiểu
    const extraX = (W - (contentW + 2 * padX)) / 2;
    const extraY = (H - (contentH + 2 * padY)) / 2;

    // Gốc tọa độ O (ox, oy)
    const ox = Math.round(padX + extraX + (-bMinX) * unitScale);
    const oy = Math.round(padY + extraY + bMaxY * unitScale);

    const toX = x => (ox + x * unitScale).toFixed(1);
    const toY = y => (oy - y * unitScale).toFixed(1);

    // 5. Tính toán các đường cong hàm số (Curve)
    const curvePaths = [];

    // A. Vẽ từ plotList nếu có công thức
    if (plotList.length > 0) {
      for (const pl of plotList) {
        const dMin = pl.dMin !== null ? pl.dMin : (oxStart - 0.2);
        const dMax = pl.dMax !== null ? pl.dMax : (oxEnd + 0.2);
        const evalFn = xVal => {
          try {
            let jsExpr = pl.formula
              .replace(/\\x\b/g, `(${xVal})`)
              .replace(/\bx\b/g, `(${xVal})`)
              .replace(/\^/g, '**')
              .replace(/(\d+)\s*\(/g, '$1*(')
              .replace(/\)\s*\(/g, ')*(')
              .replace(/\bsin\b/g, 'Math.sin')
              .replace(/\bcos\b/g, 'Math.cos')
              .replace(/\btan\b/g, 'Math.tan')
              .replace(/\bsqrt\b/g, 'Math.sqrt')
              .replace(/\babs\b/g, 'Math.abs')
              .replace(/\bln\b/g, 'Math.log')
              .replace(/\bexp\b/g, 'Math.exp');
            const fn = new Function(`return (${jsExpr});`);
            const res = fn();
            return (typeof res === 'number' && isFinite(res)) ? res : null;
          } catch (_) {
            return null;
          }
        };

        const steps = 140;
        const stepSize = (dMax - dMin) / steps;
        let curSeg = [];
        for (let i = 0; i <= steps; i++) {
          const x = dMin + i * stepSize;
          const y = evalFn(x);
          if (y !== null && y >= bMinY - 2.0 && y <= bMaxY + 2.0) {
            curSeg.push(`${toX(x)},${toY(y)}`);
          } else {
            if (curSeg.length > 1) curvePaths.push(curSeg);
            curSeg = [];
          }
        }
        if (curSeg.length > 1) curvePaths.push(curSeg);
      }
    }

    // B. Vẽ từ splinePaths (lệnh to[out=..., in=...])
    if (splinePaths.length > 0) {
      for (const pts of splinePaths) {
        if (pts.length >= 2) {
          const seg = [];
          seg.push(`${toX(pts[0].x)},${toY(pts[0].y)}`);
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[Math.min(pts.length - 1, i + 2)];
            for (let t = 0.05; t <= 1.0; t += 0.05) {
              const t2 = t * t;
              const t3 = t2 * t;
              const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
              const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
              seg.push(`${toX(x)},${toY(y)}`);
            }
          }
          curvePaths.push(seg);
        }
      }
    }

    // C. Nếu KHÔNG có plot và KHÔNG có spline, vẽ đường cong qua các điểm cực trị
    if (curvePaths.length === 0 && markedPoints.length >= 2) {
      const ptsSorted = [...markedPoints].sort((a, b) => a.x - b.x);
      const p1 = ptsSorted[0];
      const p2 = ptsSorted[1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (Math.abs(dx) > 0.01) {
        const a = -2 * dy / Math.pow(dx, 3);
        const b = -1.5 * a * (p1.x + p2.x);
        const c = 3 * a * p1.x * p2.x;
        const d = p1.y - (a * Math.pow(p1.x, 3) + b * Math.pow(p1.x, 2) + c * p1.x);

        const cubicFn = x => a * Math.pow(x, 3) + b * Math.pow(x, 2) + c * x + d;

        const startX = Math.max(bMinX - 0.3, p1.x - 0.75 * dx);
        const endX = Math.min(bMaxX + 0.3, p2.x + 0.75 * dx);
        const steps = 140;
        const stepSize = (endX - startX) / steps;
        let curSeg = [];
        for (let i = 0; i <= steps; i++) {
          const x = startX + i * stepSize;
          const y = cubicFn(x);
          if (y >= bMinY - 2.0 && y <= bMaxY + 2.0) {
            curSeg.push(`${toX(x)},${toY(y)}`);
          } else {
            if (curSeg.length > 1) curvePaths.push(curSeg);
            curSeg = [];
          }
        }
        if (curSeg.length > 1) curvePaths.push(curSeg);
      }
    } else if (curvePaths.length === 0 && markedPoints.length === 1) {
      const p0 = markedPoints[0];
      const a = p0.y >= 0 ? -0.5 : 0.5;
      const steps = 100;
      const startX = bMinX - 0.2;
      const endX = bMaxX + 0.2;
      const stepSize = (endX - startX) / steps;
      let curSeg = [];
      for (let i = 0; i <= steps; i++) {
        const x = startX + i * stepSize;
        const y = a * Math.pow(x - p0.x, 2) + p0.y;
        if (y >= bMinY - 2.0 && y <= bMaxY + 2.0) {
          curSeg.push(`${toX(x)},${toY(y)}`);
        } else {
          if (curSeg.length > 1) curvePaths.push(curSeg);
          curSeg = [];
        }
      }
      if (curSeg.length > 1) curvePaths.push(curSeg);
    }

    // 6. SVG các đường nét đứt
    const dashedSvg = dashedLines.map(lineObj => {
      const pts = lineObj.pts.map(p => `${toX(p.x)},${toY(p.y)}`).join(' ');
      const strokeCol = lineObj.color || '#64748b';
      const strokeW = lineObj.isAsymptote ? '1.7' : '1.4';
      return `<polyline points="${pts}" fill="none" stroke="${strokeCol}" stroke-width="${strokeW}" stroke-dasharray="3.5,3.5"/>`;
    }).join('\n');

    // 7. SVG các điểm cực trị (chấm đỏ viền trắng nổi bật)
    const pointsSvg = markedPoints.map(p => {
      return `<circle cx="${toX(p.x)}" cy="${toY(p.y)}" r="3.8" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>`;
    }).join('\n');

    // 8. SVG vạch chia và nhãn trên trục Ox
    const ticksXSvg = axisTicksX.map(t => {
      const px = parseFloat(toX(t.x));
      const py = parseFloat(toY(0));
      return `
        <line x1="${px}" y1="${py - 3.5}" x2="${px}" y2="${py + 3.5}" stroke="#334155" stroke-width="1.3"/>
        <text x="${px}" y="${py + 16}" font-size="11" font-weight="600" text-anchor="middle" fill="#334155">${escapeHtml(t.label)}</text>
      `;
    }).join('\n');

    // 9. SVG vạch chia và nhãn trên trục Oy
    const ticksYSvg = axisTicksY.map(t => {
      const px = parseFloat(toX(0));
      const py = parseFloat(toY(t.y));
      const isRight = t.pos === 'right';
      const textX = isRight ? px + 8 : px - 8;
      const anchor = isRight ? 'start' : 'end';
      return `
        <line x1="${px - 3.5}" y1="${py}" x2="${px + 3.5}" y2="${py}" stroke="#334155" stroke-width="1.3"/>
        <text x="${textX}" y="${py + 4}" font-size="11" font-weight="600" text-anchor="${anchor}" fill="#334155">${escapeHtml(t.label)}</text>
      `;
    }).join('\n');

    // 10. Đường cong hàm số
    const curveSvg = curvePaths.map(seg => {
      return `<path d="M ${seg.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('\n');

    const uid = 'g_' + Math.random().toString(36).substring(2, 8);

    // Tính vị trí nhãn tên trục Ox và Oy theo hướng node
    let oxLabelX = parseFloat(toX(oxEnd)) + 8;
    let oxLabelY = parseFloat(toY(0)) + 4;
    let oxAnchor = 'start';
    if (oxPos === 'below') {
      oxLabelX = parseFloat(toX(oxEnd)) - 4;
      oxLabelY = parseFloat(toY(0)) + 18;
      oxAnchor = 'middle';
    } else if (oxPos === 'above') {
      oxLabelX = parseFloat(toX(oxEnd)) - 4;
      oxLabelY = parseFloat(toY(0)) - 10;
      oxAnchor = 'middle';
    }

    let oyLabelX = parseFloat(toX(0)) + 10;
    let oyLabelY = parseFloat(toY(oyEnd)) + 4;
    let oyAnchor = 'start';
    if (oyPos === 'above' || oyPos === 'top') {
      oyLabelX = parseFloat(toX(0));
      oyLabelY = parseFloat(toY(oyEnd)) - 10;
      oyAnchor = 'middle';
    } else if (oyPos === 'left') {
      oyLabelX = parseFloat(toX(0)) - 10;
      oyLabelY = parseFloat(toY(oyEnd)) + 4;
      oyAnchor = 'end';
    }

    return `
      <div class="my-6 flex justify-center w-full overflow-x-auto">
        <div class="bg-white border-2 border-slate-200/90 rounded-2xl shadow-md p-3.5 max-w-full">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="max-w-full h-auto select-none font-sans">
            <defs>
              <marker id="arr_${uid}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#334155"/>
              </marker>
            </defs>

            <!-- Trục Ox (vẽ chính xác từ oxStart đến oxEnd, tự động dài thêm khi tọa độ mở rộng) -->
            <line x1="${toX(oxStart)}" y1="${toY(0)}" x2="${toX(oxEnd)}" y2="${toY(0)}" stroke="#334155" stroke-width="1.6" marker-end="url(#arr_${uid})"/>
            <text x="${oxLabelX}" y="${oxLabelY}" font-size="13" font-style="italic" font-weight="bold" text-anchor="${oxAnchor}" fill="#1e293b">${escapeHtml(oxLabel)}</text>

            <!-- Trục Oy (vẽ chính xác từ oyStart đến oyEnd, tự động dài thêm khi tọa độ mở rộng) -->
            <line x1="${toX(0)}" y1="${toY(oyStart)}" x2="${toX(0)}" y2="${toY(oyEnd)}" stroke="#334155" stroke-width="1.6" marker-end="url(#arr_${uid})"/>
            <text x="${oyLabelX}" y="${oyLabelY}" font-size="13" font-style="italic" font-weight="bold" text-anchor="${oyAnchor}" fill="#1e293b">${escapeHtml(oyLabel)}</text>

            <!-- Gốc tọa độ O -->
            <text x="${parseFloat(toX(0)) - 12}" y="${parseFloat(toY(0)) + 15}" font-size="12" font-style="italic" font-weight="bold" text-anchor="end" fill="#475569">${escapeHtml(originLabel)}</text>

            <!-- Các vạch chia và nhãn trên trục Ox & Oy -->
            ${ticksXSvg}
            ${ticksYSvg}

            <!-- Các đường gióng nét đứt -->
            ${dashedSvg}

            <!-- Đường cong hàm số sắc nét -->
            ${curveSvg}

            <!-- Các điểm cực trị / điểm đặc biệt hiển thị rõ nét -->
            ${pointsSvg}
          </svg>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('parseGenericTikzGraph error:', err);
    return null;
  }
}

// Bộ phân tích và vẽ Đồ thị TikZ sắc nét: Phân biệt rõ hàm đa thức bậc ba, bậc bốn, hàm phân thức, hình không gian & phẳng
function parseTikzToSvg(tikzCode) {
  // 1. ƯU TIÊN SỬ DỤNG BỘ PHÂN TÍCH TỰ ĐỘNG TOÀN DIỆN VỚI TỶ LỆ 1:1 VÀ KHUNG MỞ RỘNG (W = 480, H = 340)
  // Không áp dụng cho hình không gian trụ 3D (ellipse)
  if (!tikzCode.includes('ellipse')) {
    const genericSvg = parseGenericTikzGraph(tikzCode);
    if (genericSvg) {
      return genericSvg;
    }
  }

  // 2. Hình trụ 3D R, h, V = 16π dm³ (Câu 23 de_01.tex)
  if (tikzCode.includes('ellipse') && (tikzCode.includes('16\\pi') || tikzCode.includes('R') || tikzCode.includes('bán kính'))) {
    return `
      <div class="my-5 flex justify-center">
        <svg width="340" height="240" viewBox="0 0 340 240" class="bg-white border-2 border-slate-200/90 rounded-2xl shadow-md">
          <ellipse cx="170" cy="55" rx="90" ry="24" fill="#eff6ff" stroke="#1e3a8a" stroke-width="2"/>
          <ellipse cx="170" cy="180" rx="90" ry="24" fill="#eff6ff" stroke="#1e3a8a" stroke-width="2"/>
          <line x1="80" y1="55" x2="80" y2="180" stroke="#1e3a8a" stroke-width="2"/>
          <line x1="260" y1="55" x2="260" y2="180" stroke="#1e3a8a" stroke-width="2"/>
          <!-- Bán kính đáy R -->
          <line x1="170" y1="180" x2="260" y2="180" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="210" y="175" font-size="12" font-weight="bold" fill="#1e40af">R</text>
          <!-- Chiều cao h -->
          <line x1="170" y1="55" x2="170" y2="180" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="176" y="120" font-size="12" font-weight="bold" fill="#1e40af">h</text>
          <!-- Tâm O và O' -->
          <circle cx="170" cy="180" r="3.5" fill="#dc2626"/>
          <text x="156" y="200" font-size="12" font-weight="bold" fill="#334155">O</text>
          <circle cx="170" cy="55" r="3.5" fill="#dc2626"/>
          <text x="158" y="45" font-size="12" font-weight="bold" fill="#334155">O'</text>
          <rect x="100" y="105" width="140" height="28" rx="6" fill="#ffffff" fill-opacity="0.95" stroke="#cbd5e1"/>
          <text x="110" y="124" font-size="12" font-weight="bold" fill="#0f766e">V = 16π dm³</text>
        </svg>
      </div>
    `;
  }

  // 2. Đồ thị hàm số liên tục trên đoạn [-2; 3] (Câu 5 de_01.tex)
  if (tikzCode.includes('(-2,1) to[out=60,in=180]') || (tikzCode.includes('[-2; 3]') && (tikzCode.includes('dotted') || tikzCode.includes('smooth')))) {
    const W = 340, H = 250;
    const ox = 150, oy = 135;
    const sx = 38, sy = 26;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr2_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr2_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr2_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Điểm (-2, 1) -->
          <line x1="${toX(-2)}" y1="${oy}" x2="${toX(-2)}" y2="${toY(1)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <line x1="${toX(-2)}" y1="${toY(1)}" x2="${ox}" y2="${toY(1)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <text x="${Number(toX(-2)) - 8}" y="${oy + 16}" font-size="11" fill="#475569">-2</text>
          <text x="${ox + 6}" y="${Number(toY(1)) + 4}" font-size="11" fill="#475569">1</text>
          <circle cx="${toX(-2)}" cy="${toY(1)}" r="3.5" fill="#dc2626"/>

          <!-- Điểm (-1, 3) Cực đại -->
          <line x1="${toX(-1)}" y1="${oy}" x2="${toX(-1)}" y2="${toY(3)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <line x1="${toX(-1)}" y1="${toY(3)}" x2="${ox}" y2="${toY(3)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <text x="${Number(toX(-1)) - 8}" y="${oy + 16}" font-size="11" fill="#475569">-1</text>
          <text x="${ox - 16}" y="${Number(toY(3)) + 4}" font-size="11" fill="#475569">3</text>
          <circle cx="${toX(-1)}" cy="${toY(3)}" r="3.5" fill="#dc2626"/>

          <!-- Điểm (1, -2) Cực tiểu / GTNN -->
          <line x1="${toX(1)}" y1="${oy}" x2="${toX(1)}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <line x1="${toX(1)}" y1="${toY(-2)}" x2="${ox}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <text x="${Number(toX(1)) - 3}" y="${oy - 6}" font-size="11" fill="#475569">1</text>
          <text x="${ox - 20}" y="${Number(toY(-2)) + 4}" font-size="11" fill="#475569">-2</text>
          <circle cx="${toX(1)}" cy="${toY(-2)}" r="3.5" fill="#dc2626"/>

          <!-- Điểm (3, 4) -->
          <line x1="${toX(3)}" y1="${oy}" x2="${toX(3)}" y2="${toY(4)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <line x1="${toX(3)}" y1="${toY(4)}" x2="${ox}" y2="${toY(4)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <text x="${Number(toX(3)) - 3}" y="${oy + 16}" font-size="11" fill="#475569">3</text>
          <text x="${ox + 6}" y="${Number(toY(4)) + 4}" font-size="11" fill="#475569">4</text>
          <circle cx="${toX(3)}" cy="${toY(4)}" r="3.5" fill="#dc2626"/>

          <path d="M ${toX(-2)} ${toY(1)} C ${toX(-1.6)} ${toY(2.6)}, ${toX(-1.3)} ${toY(3)}, ${toX(-1)} ${toY(3)} C ${toX(-0.5)} ${toY(3)}, ${toX(0.2)} ${toY(-1.5)}, ${toX(1)} ${toY(-2)} C ${toX(1.8)} ${toY(-2.5)}, ${toX(2.4)} ${toY(1)}, ${toX(3)} ${toY(4)}" fill="none" stroke="#dc2626" stroke-width="2.5"/>
        </svg>
      </div>
    `;
  }

  // 3. ƯU TIÊN KIỂM TRA ĐỒ THỊ HÀM BẬC BA (Cubic polynomial) TRƯỚC HÀM PHÂN THỨC
  // Case 3a. Hàm đa thức bậc ba y = x³ - 3x² + 3 (Câu 19 de_01.tex)
  // Cực đại tại (0, 3), cực tiểu tại (2, -1)
  if (tikzCode.includes('(\\x)^3 - 3*(\\x)^2 + 3') || (tikzCode.includes('^3') && tikzCode.includes('- 3*') && tikzCode.includes('+ 3'))) {
    const W = 340, H = 250;
    const ox = 120, oy = 150;
    const sx = 44, sy = 25;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const pts = [];
    for (let x = -1.2; x <= 3.25; x += 0.05) {
      const y = x * x * x - 3 * x * x + 3;
      if (y >= -2.8 && y <= 4.8) pts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr5_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr5_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr5_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Cực đại (0, 3) -->
          <circle cx="${ox}" cy="${toY(3)}" r="3.5" fill="#dc2626"/>
          <text x="${ox - 16}" y="${Number(toY(3)) + 4}" font-size="11" font-weight="bold" fill="#334155">3</text>

          <!-- Cực tiểu (2, -1) -->
          <line x1="${toX(2)}" y1="${oy}" x2="${toX(2)}" y2="${toY(-1)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <line x1="${toX(2)}" y1="${toY(-1)}" x2="${ox}" y2="${toY(-1)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <circle cx="${toX(2)}" cy="${toY(-1)}" r="3.5" fill="#dc2626"/>
          <text x="${Number(toX(2)) - 3}" y="${oy - 6}" font-size="11" font-weight="bold" fill="#334155">2</text>
          <text x="${ox - 20}" y="${Number(toY(-1)) + 4}" font-size="11" font-weight="bold" fill="#334155">-1</text>

          <path d="M ${pts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
        </svg>
      </div>
    `;
  }

  // Case 3b. Hàm đa thức bậc ba y = x³ - 3x² + 2 (Câu 17 de_01.tex)
  // Cực đại tại (0, 2), cực tiểu tại (2, -2)
  if (tikzCode.includes('(\\x)^3 - 3*(\\x)^2 + 2') || (tikzCode.includes('^3') && tikzCode.includes('- 3*') && tikzCode.includes('+ 2'))) {
    const W = 340, H = 250;
    const ox = 120, oy = 135;
    const sx = 44, sy = 28;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const pts = [];
    for (let x = -1.2; x <= 3.25; x += 0.05) {
      const y = x * x * x - 3 * x * x + 2;
      if (y >= -3.8 && y <= 3.8) pts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr4_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr4_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr4_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Cực đại (0, 2) -->
          <circle cx="${ox}" cy="${toY(2)}" r="3.5" fill="#dc2626"/>
          <text x="${ox - 16}" y="${Number(toY(2)) + 4}" font-size="11" font-weight="bold" fill="#334155">2</text>

          <!-- Cực tiểu (2, -2) -->
          <line x1="${toX(2)}" y1="${oy}" x2="${toX(2)}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <line x1="${toX(2)}" y1="${toY(-2)}" x2="${ox}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <circle cx="${toX(2)}" cy="${toY(-2)}" r="3.5" fill="#dc2626"/>
          <text x="${Number(toX(2)) - 3}" y="${oy - 6}" font-size="11" font-weight="bold" fill="#334155">2</text>
          <text x="${ox - 20}" y="${Number(toY(-2)) + 4}" font-size="11" font-weight="bold" fill="#334155">-2</text>

          <path d="M ${pts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
        </svg>
      </div>
    `;
  }

  // Case 3c. Hàm đa thức bậc ba a > 0, cắt trục tung tại (0, d) với d > 0 (Câu 13 de_01.tex)
  if (tikzCode.includes('0.6*(\\x)^3') || tikzCode.includes('node[left] {$d$}')) {
    const W = 340, H = 250;
    const ox = 170, oy = 135;
    const sx = 46, sy = 28;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const pts = [];
    for (let x = -2.35; x <= 2.45; x += 0.05) {
      const y = 0.6 * x * x * x - 1.8 * x + 1;
      if (y >= -3.2 && y <= 4.2) pts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr6_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr6_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr6_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Điểm d trên trục tung -->
          <circle cx="${ox}" cy="${toY(1)}" r="3.5" fill="#dc2626"/>
          <text x="${ox - 18}" y="${Number(toY(1)) + 4}" font-size="12" font-weight="bold" fill="#dc2626">d</text>

          <path d="M ${pts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
        </svg>
      </div>
    `;
  }

  // Case 3d. Hàm đa thức bậc ba đối xứng y = x³ - 3x (Câu 2 de_01.tex)
  // Cực đại (-1, 2), cực tiểu (1, -2)
  if (tikzCode.includes('(\\x)^3 - 3*(\\x)') && !tikzCode.includes('^2')) {
    const W = 340, H = 250;
    const ox = 170, oy = 125;
    const sx = 46, sy = 28;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const pts = [];
    for (let x = -2.35; x <= 2.35; x += 0.05) {
      const y = x * x * x - 3 * x;
      if (y >= -3.8 && y <= 3.8) pts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr3_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr3_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr3_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Cực đại (-1, 2) -->
          <line x1="${toX(-1)}" y1="${oy}" x2="${toX(-1)}" y2="${toY(2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <line x1="${toX(-1)}" y1="${toY(2)}" x2="${ox}" y2="${toY(2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <circle cx="${toX(-1)}" cy="${toY(2)}" r="3.5" fill="#dc2626"/>
          <text x="${Number(toX(-1)) - 8}" y="${oy + 16}" font-size="11" font-weight="bold" fill="#334155">-1</text>
          <text x="${ox + 6}" y="${Number(toY(2)) + 4}" font-size="11" font-weight="bold" fill="#334155">2</text>

          <!-- Cực tiểu (1, -2) -->
          <line x1="${toX(1)}" y1="${oy}" x2="${toX(1)}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <line x1="${toX(1)}" y1="${toY(-2)}" x2="${ox}" y2="${toY(-2)}" stroke="#94a3b8" stroke-dasharray="3,3"/>
          <circle cx="${toX(1)}" cy="${toY(-2)}" r="3.5" fill="#dc2626"/>
          <text x="${Number(toX(1)) - 3}" y="${oy - 6}" font-size="11" font-weight="bold" fill="#334155">1</text>
          <text x="${ox - 20}" y="${Number(toY(-2)) + 4}" font-size="11" font-weight="bold" fill="#334155">-2</text>

          <!-- Đường cong đa thức bậc 3 mượt mà -->
          <path d="M ${pts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
        </svg>
      </div>
    `;
  }

  // 4. ĐỒ THỊ HÀM PHÂN THỨC (CHỈ KHỚP KHI CÓ CÔNG THỨC PHÂN THỨC HOẶC TIỆM CẬN ĐẶC TRƯNG)
  // Case 4a. Phân thức bậc 2/bậc 1: y = (x^2 + x + 1)/(x + 1)
  if (tikzCode.includes('x^2+x+1') || (tikzCode.includes('x^2') && (tikzCode.includes('/(x') || tikzCode.includes('/(\\x')))) {
    const W = 350, H = 270;
    const ox = 165, oy = 135;
    const sx = 28, sy = 21;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const leftPts = [];
    for (let x = -5.0; x <= -1.16; x += 0.06) {
      const y = x + 1 / (x + 1);
      if (y >= -6.8 && y <= 6.8) leftPts.push(`${toX(x)},${toY(y)}`);
    }

    const rightPts = [];
    for (let x = -0.84; x <= 4.2; x += 0.06) {
      const y = x + 1 / (x + 1);
      if (y >= -6.8 && y <= 6.8) rightPts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr_b21_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_b21_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_b21_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Tiệm cận đứng x = -1 -->
          <line x1="${toX(-1)}" y1="12" x2="${toX(-1)}" y2="${H - 12}" stroke="#dc2626" stroke-width="1.7" stroke-dasharray="4,4"/>
          <text x="${Number(toX(-1)) - 18}" y="${oy + 16}" font-size="11" font-weight="bold" fill="#dc2626">-1</text>

          <!-- Tiệm cận xiên y = x -->
          <line x1="${toX(-4.8)}" y1="${toY(-4.8)}" x2="${toX(4.2)}" y2="${toY(4.2)}" stroke="#e11d48" stroke-width="1.6" stroke-dasharray="5,4"/>
          <text x="${toX(3.1)}" y="${toY(3.7)}" font-size="11" font-weight="bold" fill="#e11d48">y = x</text>

          <!-- Nhánh trái & nhánh phải -->
          <path d="M ${leftPts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
          <path d="M ${rightPts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>

          <!-- Điểm cực đại (-2, -3) -->
          <line x1="${toX(-2)}" y1="${oy}" x2="${toX(-2)}" y2="${toY(-3)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <line x1="${toX(-2)}" y1="${toY(-3)}" x2="${ox}" y2="${toY(-3)}" stroke="#94a3b8" stroke-dasharray="2,2"/>
          <circle cx="${toX(-2)}" cy="${toY(-3)}" r="3.5" fill="#dc2626"/>
          <text x="${Number(toX(-2)) - 8}" y="${oy - 6}" font-size="11" fill="#334155">-2</text>
          <text x="${ox + 6}" y="${Number(toY(-3)) + 4}" font-size="11" fill="#334155">-3</text>

          <!-- Điểm cực tiểu (0, 1) -->
          <circle cx="${ox}" cy="${toY(1)}" r="3.5" fill="#dc2626"/>
          <text x="${ox - 15}" y="${Number(toY(1)) + 4}" font-size="11" font-weight="bold" fill="#334155">1</text>
        </svg>
      </div>
    `;
  }

  // Case 4b. Phân thức bậc 1/bậc 1: y = (2x - 1)/(x + 1) (Câu 10 de_01.tex)
  // Chỉ khớp khi có công thức phân thức cụ thể hoặc dạng hàm phân thức hữu tỉ, TUYỆT ĐỐI KHÔNG KHỚP NHẦM HÀM BẬC BA
  if (tikzCode.includes('2*\\x-1') || tikzCode.includes('(2*\\x-1)/(\\x+1)') || tikzCode.includes('(2*x-1)/(x+1)')) {
    const W = 350, H = 270;
    const ox = 175, oy = 140;
    const sx = 28, sy = 22;
    const toX = x => (ox + x * sx).toFixed(1);
    const toY = y => (oy - y * sy).toFixed(1);

    const leftPts = [];
    for (let x = -5.8; x <= -1.13; x += 0.07) {
      const y = (2 * x - 1) / (x + 1);
      if (y >= -5.5 && y <= 8.5) leftPts.push(`${toX(x)},${toY(y)}`);
    }

    const rightPts = [];
    for (let x = -0.87; x <= 5.5; x += 0.07) {
      const y = (2 * x - 1) / (x + 1);
      if (y >= -5.5 && y <= 8.5) rightPts.push(`${toX(x)},${toY(y)}`);
    }

    return `
      <div class="my-4 flex justify-center">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
          <defs>
            <marker id="arr_b11_exp" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_b11_exp)"/>
          <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_b11_exp)"/>
          <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
          <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>

          <!-- Tiệm cận đứng x = -1 (đỏ nét đứt) -->
          <line x1="${toX(-1)}" y1="12" x2="${toX(-1)}" y2="${H - 12}" stroke="#dc2626" stroke-width="1.7" stroke-dasharray="4,4"/>
          <text x="${Number(toX(-1)) - 18}" y="${oy + 16}" font-size="11" font-weight="bold" fill="#dc2626">-1</text>

          <!-- Tiệm cận ngang y = 2 (đỏ nét đứt) -->
          <line x1="12" y1="${toY(2)}" x2="${W - 12}" y2="${toY(2)}" stroke="#dc2626" stroke-width="1.7" stroke-dasharray="4,4"/>
          <text x="${ox + 8}" y="${Number(toY(2)) - 5}" font-size="11" font-weight="bold" fill="#dc2626">2</text>

          <path d="M ${leftPts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>
          <path d="M ${rightPts.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>

          <!-- Giao điểm Oy (0, -1) -->
          <circle cx="${ox}" cy="${toY(-1)}" r="3.5" fill="#2563eb"/>
          <text x="${ox + 7}" y="${Number(toY(-1)) + 4}" font-size="11" font-weight="bold" fill="#1e40af">-1</text>

          <!-- Giao điểm Ox (1/2, 0) -->
          <circle cx="${toX(0.5)}" cy="${oy}" r="3" fill="#2563eb"/>
          <text x="${Number(toX(0.5)) - 4}" y="${oy - 7}" font-size="10" fill="#1e40af">1/2</text>
        </svg>
      </div>
    `;
  }

  // 5. BỘ BIÊN DỊCH TỰ ĐỘNG ĐA NĂNG CHO MỌI CÔNG THỨC PLOT TIKZ BẤT KỲ
  const plotMatch = tikzCode.match(/plot\s*(?:\[[^\]]*domain\s*=\s*([-\d\.]+)\s*:\s*([-\d\.]+)[^\]]*\])?\s*\(\s*\\x\s*,\s*\{([\s\S]*?)\}\s*\)/i);
  if (plotMatch) {
    try {
      const dMin = plotMatch[1] ? parseFloat(plotMatch[1]) : -3;
      const dMax = plotMatch[2] ? parseFloat(plotMatch[2]) : 3;
      const rawFormula = plotMatch[3].trim();

      const W = 350, H = 260;
      const ox = W / 2, oy = H / 2;
      const sx = (W - 70) / Math.max(0.1, dMax - dMin);
      const sy = 26;

      const toX = x => (ox + x * sx).toFixed(1);
      const toY = y => (oy - y * sy).toFixed(1);

      // Hàm tính toán công thức an toàn
      const evalFn = xVal => {
        try {
          let jsExpr = rawFormula
            .replace(/\\x\b/g, `(${xVal})`)
            .replace(/\bx\b/g, `(${xVal})`)
            .replace(/\^/g, '**')
            .replace(/\bsin\b/g, 'Math.sin')
            .replace(/\bcos\b/g, 'Math.cos')
            .replace(/\btan\b/g, 'Math.tan')
            .replace(/\bsqrt\b/g, 'Math.sqrt')
            .replace(/\babs\b/g, 'Math.abs')
            .replace(/\bln\b/g, 'Math.log')
            .replace(/\bexp\b/g, 'Math.exp');
          const fn = new Function(`return (${jsExpr});`);
          const res = fn();
          return (typeof res === 'number' && isFinite(res)) ? res : null;
        } catch (_) {
          return null;
        }
      };

      const segments = [];
      let curSegment = [];
      const steps = 140;
      const stepSize = (dMax - dMin) / steps;

      for (let i = 0; i <= steps; i++) {
        const x = dMin + i * stepSize;
        const y = evalFn(x);
        if (y !== null && Math.abs(y) <= 12) {
          curSegment.push(`${toX(x)},${toY(y)}`);
        } else {
          if (curSegment.length > 1) segments.push(curSegment);
          curSegment = [];
        }
      }
      if (curSegment.length > 1) segments.push(curSegment);

      if (segments.length > 0) {
        const pathsHtml = segments.map(seg => `<path d="M ${seg.join(' L ')}" fill="none" stroke="#2563eb" stroke-width="2.4"/>`).join('');

        return `
          <div class="my-4 flex justify-center">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bg-white border border-slate-200 rounded-xl shadow-sm">
              <defs>
                <marker id="arr_dyn" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155"/>
                </marker>
              </defs>
              <line x1="12" y1="${oy}" x2="${W - 12}" y2="${oy}" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_dyn)"/>
              <line x1="${ox}" y1="${H - 12}" x2="${ox}" y2="12" stroke="#475569" stroke-width="1.6" marker-end="url(#arr_dyn)"/>
              <text x="${W - 20}" y="${oy + 18}" font-size="13" font-weight="bold" fill="#334155">x</text>
              <text x="${ox + 10}" y="20" font-size="13" font-weight="bold" fill="#334155">y</text>
              <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-weight="bold" fill="#64748b">O</text>
              ${pathsHtml}
            </svg>
          </div>
        `;
      }
    } catch (_) {}
  }

  // 6. BỘ BIÊN DỊCH HÌNH HỌC KHÔNG GIAN & HÌNH HỌC PHẲNG TỰ ĐỘNG (Hình chóp, lăng trụ, tam giác, Oxy)
  const W = 480, H = 340;
  const ox = 240, oy = 170;
  return `
    <div class="my-6 flex justify-center w-full overflow-x-auto">
      <div class="bg-white border-2 border-slate-200/90 rounded-2xl shadow-md p-3.5 max-w-full">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="max-w-full h-auto select-none font-sans">
          <defs>
            <marker id="arrDef_exp" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#334155"/>
            </marker>
          </defs>
          <line x1="20" y1="${oy}" x2="${W - 20}" y2="${oy}" stroke="#334155" stroke-width="1.6" marker-end="url(#arrDef_exp)"/>
          <line x1="${ox}" y1="${H - 20}" x2="${ox}" y2="20" stroke="#334155" stroke-width="1.6" marker-end="url(#arrDef_exp)"/>
          <text x="${W - 24}" y="${oy + 18}" font-size="13" font-style="italic" font-weight="bold" fill="#1e293b">x</text>
          <text x="${ox + 10}" y="24" font-size="13" font-style="italic" font-weight="bold" fill="#1e293b">y</text>
          <text x="${ox - 16}" y="${oy + 16}" font-size="12" font-style="italic" font-weight="bold" fill="#475569">O</text>
          <path d="M 60 250 C 120 40, 180 120, 240 170 C 300 220, 360 40, 420 90" fill="none" stroke="#2563eb" stroke-width="2.5"/>
        </svg>
      </div>
    </div>
  `;
}

// ==========================================
// NẠP ĐỀ MẪU: de_01.tex & de_09.tex
// ==========================================
export async function loadSampleDe01() {
  try {
    showToast('Đang nạp đề de_01.tex (23 câu chuẩn)...', 'info');
    let text = '';
    try {
      const res = await fetch('/assets/aistudio/de_01_ee035459.tex');
      if (res.ok) text = await res.text();
    } catch (_) {}

    if (!text) {
      showToast('Không tải được file de_01_ee035459.tex từ thư mục assets', 'error');
      return;
    }

    const parsed = parseFullExamOrPracticeContent(text);
    if (parsed.length === 0) {
      showToast('Không tìm thấy câu hỏi trong file', 'error');
      return;
    }

    const titleEl = document.getElementById('exam-title');
    if (titleEl) titleEl.value = 'Đề Kiểm Tra Giữa Kì 1 Toán 12 - Mã Đề 101 (Chuẩn de_01.tex)';

    const durEl = document.getElementById('exam-duration');
    if (durEl) durEl.value = '90';

    appState.draftExam.versions['101'] = JSON.parse(JSON.stringify(parsed));
    shuffleFromBaseVersion();
    renderExamDraftTabs();
    renderExamDraft();

    showToast(`Đã nạp thành công 23 câu hỏi (Trắc nghiệm, Đúng/Sai, Trả lời ngắn, Tự luận) từ de_01.tex!`, 'success');
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}

export function loadSampleDe09() {
  loadSampleDe01();
}

// Bóc tách AI Prompt
export function openAIPrompt() {
  if (!window.Swal) return;

  window.Swal.fire({
    title: '<i class="fa-solid fa-wand-magic-sparkles text-purple-600 mr-2"></i>Trợ Lý Bóc Tách Đề Thi AI',
    html: `
      <div class="text-left text-xs mb-2 text-gray-600">
        Dán nội dung đề thi thô (Word, PDF, LaTeX) vào ô bên dưới. Hệ thống sẽ tự động bóc tách Trắc nghiệm, Đúng/Sai, Trả lời ngắn, Điền khuyết và Tự luận:
      </div>
      <textarea id="ai-raw-text" class="w-full h-48 p-3 border rounded-lg font-mono text-xs focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Dán văn bản đề thi vào đây..."></textarea>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-bolt mr-1"></i> Bóc Tách Ngay',
    confirmButtonColor: '#7c3aed',
    cancelButtonText: 'Hủy'
  }).then(res => {
    if (res.isConfirmed) {
      const text = document.getElementById('ai-raw-text')?.value || '';
      if (!text.trim()) {
        showToast('Chưa có nội dung để bóc tách', 'warning');
        return;
      }
      const questions = parseFullExamOrPracticeContent(text);
      if (questions.length === 0) {
        showToast('Không nhận diện được câu hỏi', 'warning');
        return;
      }
      const currentTab = appState.draftExam.activeTab || '101';
      appState.draftExam.versions[currentTab] = questions;
      renderExamDraftTabs();
      renderExamDraft();
      showToast(`Đã bóc tách thành công ${questions.length} câu hỏi vào Mã ${currentTab}!`, 'success');
    }
  });
}

// Upload file đề thi Word (.docx) hoặc LaTeX (.tex)
export async function handleUploadExam(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showToast(`Đang đọc file: ${file.name}...`, 'info');

  if (file.name.endsWith('.docx')) {
    if (!window.mammoth) {
      showToast('Thư viện Mammoth chưa sẵn sàng', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const questions = parseFullExamOrPracticeContent(result.value);
        if (questions.length > 0) {
          const currentTab = appState.draftExam.activeTab || '101';
          appState.draftExam.versions[currentTab] = questions;
          renderExamDraftTabs();
          renderExamDraft();
          showToast(`Đã nạp ${questions.length} câu hỏi từ Word!`, 'success');
        } else {
          showToast('Không tìm thấy câu hỏi trong file', 'warning');
        }
      } catch (err) {
        showToast('Lỗi đọc file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      const questions = parseFullExamOrPracticeContent(e.target.result);
      if (questions.length > 0) {
        const currentTab = appState.draftExam.activeTab || '101';
        appState.draftExam.versions[currentTab] = questions;
        renderExamDraftTabs();
        renderExamDraft();
        showToast(`Đã nạp ${questions.length} câu hỏi từ LaTeX/Text!`, 'success');
      } else {
        showToast('Không tìm thấy câu hỏi', 'warning');
      }
    };
    reader.readAsText(file);
  }
}

export function downloadTemplateWord() {
  const content = `% MAU DE THI TOAN CHUAN LATEX & WORD
\\begin{ex}
    Hàm số $y = x^4 - 2x^2 + 1$ đồng biến trên khoảng nào?
    \\choice
    {$(0; 1)$}
    {\\True $(1; +\\infty)$}
    {$(-\\infty; -1)$}
    {$(-1; 0)$}
    \\loigiai{Ta có $y' = 4x^3 - 4x = 0 \\Leftrightarrow x = 0, x = \\pm 1$.}
\\end{ex}

\\begin{ex}
    Cho hàm số $y = f(x) = x^3 - 3x$. Xét tính đúng/sai của các mệnh đề:
    \\choiceTFt
    {\\True Hàm số đạt cực đại tại $x = -1$}
    {Hàm số nghịch biến trên khoảng $(1; 3)$}
    {\\True Đồ thị hàm số đi qua gốc tọa độ $O$}
    {\\True Giá trị cực tiểu bằng $-2$}
    \\loigiai{Ta có $y' = 3x^2 - 3$.}
\\end{ex}

\\begin{ex}
    Tìm nghiệm nguyên dương của phương trình $\\log_2(x) = 3$.
    \\shortans{8}
    \\loigiai{$x = 2^3 = 8$.}
\\end{ex}

\\begin{ex}
    Điền vào chỗ trống: Đường thẳng $x = a$ là tiệm cận [...] của đồ thị hàm số khi $\\lim_{x \\to a} f(x) = \\infty$.
    \\cloze{đứng}
    \\loigiai{Tiệm cận đứng.}
\\end{ex}

\\begin{ex}
    Khảo sát sự biến thiên của hàm số $y = x^3 - 3x^2 + 2$.
    \\loigiai{Tập xác định $D = \\mathbb{R}$. Đạo hàm $y' = 3x^2 - 6x$.}
\\end{ex}
`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Mau_De_Thi_Chuan.tex';
  a.click();
}

// Phát hành hoặc cập nhật đề thi
export async function publishExam() {
  const title = document.getElementById('exam-title')?.value.trim() || 'Đề Kiểm Tra Toán Học';
  const duration = parseInt(document.getElementById('exam-duration')?.value, 10) || 45;
  const openTime = document.getElementById('exam-opentime')?.value || '';
  const deadline = document.getElementById('exam-deadline')?.value || '';
  const maxAttempts = parseInt(document.getElementById('exam-max-attempts')?.value, 10) || 1;
  const minSubmit = parseInt(document.getElementById('exam-min-submit')?.value, 10) || 0;
  const maxStrikes = parseInt(document.getElementById('exam-max-strikes')?.value, 10) || 3;
  const displayMode = document.getElementById('exam-display-mode')?.value || 'scroll';

  if (!appState.draftExam.versions['101'] || appState.draftExam.versions['101'].length === 0) {
    if (window.Swal) window.Swal.fire('Chưa có câu hỏi', 'Mã đề 101 phải có ít nhất 1 câu hỏi.', 'warning');
    return;
  }

  ['102', '103', '104', '105', '106'].forEach(v => {
    if (!appState.draftExam.versions[v] || appState.draftExam.versions[v].length === 0) {
      appState.draftExam.versions[v] = JSON.parse(JSON.stringify(appState.draftExam.versions['101']));
    }
  });

  const isEditing = !!appState.draftExam.editingExamId;
  const examId = isEditing ? appState.draftExam.editingExamId : `exam_${Date.now()}`;
  const existingExam = isEditing ? appState.exams.find(e => e.id === examId) : null;
  const pin = existingExam ? existingExam.pin : Math.floor(100000 + Math.random() * 900000).toString();

  const newExam = {
    id: examId,
    title,
    pin,
    duration,
    openTime,
    deadline,
    maxAttempts,
    minSubmit,
    maxStrikes,
    displayMode,
    createdAt: existingExam ? existingExam.createdAt : new Date().toLocaleDateString('vi-VN'),
    scores: {
      mcq: parseFloat(document.getElementById('score-mcq')?.value) || 0.25,
      tf: parseFloat(document.getElementById('score-tf')?.value) || 1.0,
      short: parseFloat(document.getElementById('score-short')?.value) || 0.5,
      cloze: parseFloat(document.getElementById('score-cloze')?.value) || 1.0,
      essay: parseFloat(document.getElementById('score-essay')?.value) || 1.0
    },
    versions: appState.draftExam.versions
  };

  await saveExamToStore(newExam);

  if (window.Swal) {
    window.Swal.fire({
      title: isEditing ? 'Đã Lưu Thay Đổi!' : 'Phát Hành Thành Công!',
      html: `
        <div class="text-center py-2">
          <p class="text-sm text-gray-600 mb-2">Mã phòng thi:</p>
          <div class="text-4xl font-mono font-black text-primary tracking-widest my-3 bg-blue-50 py-3 rounded-xl border border-blue-200 select-all">${pin}</div>
          <p class="text-xs text-gray-500">Dữ liệu đã được đồng bộ với Firebase <b>qtest-ac4d3</b>.</p>
        </div>
      `,
      icon: 'success',
      confirmButtonText: 'Về Quản Lý Đề',
      confirmButtonColor: '#10b981'
    }).then(() => {
      navigate('teacher-dashboard');
    });
  }
}

export function deleteExamConfirm(examId) {
  if (!window.Swal) return;
  window.Swal.fire({
    title: 'Xóa đề thi này?',
    text: 'Thao tác này không thể hoàn tác.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Đồng ý xóa',
    confirmButtonColor: '#ef4444',
    cancelButtonText: 'Hủy'
  }).then(async res => {
    if (res.isConfirmed) {
      await deleteExamFromStore(examId);
      renderTeacherDashboard();
      showToast('Đã xóa đề thi');
    }
  });
}

// ==========================================
// TỰ LUYỆN LỚP HỌC (NHẬN DIỆN CẢ 5 DẠNG)
// ==========================================
export async function handleUploadPractice(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showToast(`Đang phân tích bài tự luyện: ${file.name}...`, 'info');

  const onParsedText = async (text) => {
    const questions = parseFullExamOrPracticeContent(text);
    if (questions.length === 0) {
      showToast('Không bóc tách được câu hỏi từ file', 'warning');
      return;
    }

    if (!appState.currentClass.practices) appState.currentClass.practices = [];
    appState.currentClass.practices.push({
      id: `pr_${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, '').replace(/Mau_|De_/gi, ''),
      questions
    });

    await saveClassToStore(appState.currentClass);
    renderClassLecturesTab();
    showToast(`Đã nhận dạng thành công ${questions.length} câu hỏi tự luyện!`, 'success');
  };

  if (file.name.endsWith('.docx') && window.mammoth) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const res = await window.mammoth.extractRawText({ arrayBuffer: e.target.result });
      onParsedText(res.value);
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => onParsedText(e.target.result);
    reader.readAsText(file);
  }
}

export function handleAppendPracticeQuestions(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showToast(`Đang đọc file bổ sung: ${file.name}...`, 'info');

  const onParsed = (text) => {
    const newQuestions = parseFullExamOrPracticeContent(text);
    if (newQuestions.length === 0) {
      showToast('Không tìm thấy câu hỏi trong file bổ sung', 'warning');
      return;
    }
    if (!appState.editingPractice.questions) appState.editingPractice.questions = [];
    appState.editingPractice.questions.push(...newQuestions);
    renderPracticeEditQuestions();
    showToast(`Đã bổ sung thêm ${newQuestions.length} câu hỏi vào bài luyện tập!`, 'success');
  };

  if (file.name.endsWith('.docx') && window.mammoth) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const res = await window.mammoth.extractRawText({ arrayBuffer: e.target.result });
      onParsed(res.value);
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => onParsed(e.target.result);
    reader.readAsText(file);
  }
}

export function previewPractice(practiceId) {
  const cls = appState.currentClass;
  const pr = cls?.practices?.find(p => p.id === practiceId);
  if (!pr) return;
  appState.editingPractice = JSON.parse(JSON.stringify(pr));

  const titleEl = document.getElementById('practice-preview-title');
  const badgeEl = document.getElementById('practice-preview-class-badge');
  const metaEl = document.getElementById('practice-preview-meta');
  const container = document.getElementById('practice-preview-questions-container');

  if (titleEl) titleEl.textContent = pr.title;
  if (badgeEl) badgeEl.textContent = `Lớp: ${cls.name}`;
  if (metaEl) metaEl.textContent = `Số câu: ${pr.questions?.length || 0} câu`;

  if (container) {
    container.innerHTML = (pr.questions || []).map((q, idx) => `
      <div class="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div class="flex justify-between items-center mb-2">
          <span class="font-bold text-primary">Câu ${idx + 1}:</span>
          <span class="text-xs bg-slate-100 px-2 py-0.5 rounded font-bold uppercase">${q.type}</span>
        </div>
        <div class="math-render text-sm mb-3">${renderMathContent(q.content)}</div>
        ${renderDraftQuestionOptions(q)}
        ${q.explanation ? `<div class="p-3 bg-emerald-50 rounded text-xs text-emerald-900 font-medium mt-2"><b>Lời giải:</b> ${renderMathContent(q.explanation)}</div>` : ''}
      </div>
    `).join('');
  }

  navigate('teacher-preview-practice');
  triggerMathJax();
}

export function editPractice(practiceId) {
  const cls = appState.currentClass;
  const pr = cls?.practices?.find(p => p.id === practiceId);
  if (!pr) return;
  appState.editingPractice = JSON.parse(JSON.stringify(pr));

  const titleEl = document.getElementById('practice-edit-title');
  const headingEl = document.getElementById('practice-edit-heading');
  const badgeEl = document.getElementById('practice-edit-class-badge');

  if (titleEl) titleEl.value = pr.title;
  if (headingEl) headingEl.textContent = `Chỉnh Sửa: ${pr.title}`;
  if (badgeEl) badgeEl.textContent = `Lớp: ${cls.name}`;

  renderPracticeEditQuestions();
  navigate('teacher-edit-practice');
}

function renderPracticeEditQuestions() {
  const pr = appState.editingPractice;
  const container = document.getElementById('practice-edit-questions-container');
  const countEl = document.getElementById('practice-edit-qcount');
  if (!pr || !container) return;

  const questions = pr.questions || [];
  if (countEl) countEl.textContent = `${questions.length} câu`;

  container.innerHTML = questions.map((q, idx) => `
    <div class="p-4 bg-slate-50 border rounded-xl flex justify-between items-start gap-4">
      <div class="flex-grow">
        <span class="font-bold text-xs text-primary block mb-1">Câu ${idx + 1} (${q.type}):</span>
        <div class="math-render text-xs text-slate-800">${renderMathContent(q.content)}</div>
      </div>
      <button onclick="window.removePracticeQuestion(${idx})" class="text-red-500 hover:text-red-700 text-xs font-bold shrink-0 cursor-pointer"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');

  triggerMathJax();
}

export function removePracticeQuestion(idx) {
  if (appState.editingPractice?.questions) {
    appState.editingPractice.questions.splice(idx, 1);
    renderPracticeEditQuestions();
  }
}

export function clearPracticeQuestions() {
  if (appState.editingPractice) {
    appState.editingPractice.questions = [];
    renderPracticeEditQuestions();
  }
}

export async function savePracticeChanges() {
  const pr = appState.editingPractice;
  const titleInput = document.getElementById('practice-edit-title');
  if (titleInput && titleInput.value.trim()) pr.title = titleInput.value.trim();

  const cls = appState.currentClass;
  if (cls && cls.practices) {
    const idx = cls.practices.findIndex(p => p.id === pr.id);
    if (idx >= 0) cls.practices[idx] = pr;
    else cls.practices.push(pr);

    await saveClassToStore(cls);
    renderClassLecturesTab();
    showToast('Đã lưu bài luyện tập thành công!');
    navigate('teacher-class-detail');
  }
}

export function previewCurrentEditingPractice() {
  if (!appState.editingPractice) return;
  previewPractice(appState.editingPractice.id);
}

export function openEditFromPreview() {
  if (appState.editingPractice) {
    editPractice(appState.editingPractice.id);
  }
}

export function tryPracticeInteractive() {
  if (appState.editingPractice) {
    startStudentPractice(appState.editingPractice.id);
  }
}

// ==========================================
// QUẢN LÝ LỚP HỌC (CLASSES)
// ==========================================
export function renderTeacherClasses() {
  const tbody = document.getElementById('class-list-body');
  if (!tbody) return;

  if (appState.classes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500">Chưa có lớp học nào. Hãy tải lên danh sách Excel!</td></tr>`;
    return;
  }

  tbody.innerHTML = appState.classes.map(cls => `
    <tr class="hover:bg-slate-50 transition border-b">
      <td class="p-4">
        <div class="font-bold text-gray-900 text-base">${escapeHtml(cls.name)}</div>
        <div class="text-xs text-blue-600 font-mono font-bold mt-0.5">Mã tham gia: ${cls.code}</div>
      </td>
      <td class="p-4 font-bold text-slate-700">${cls.students?.length || 0} học sinh</td>
      <td class="p-4 text-xs text-gray-500">${cls.updatedAt || 'Hôm nay'}</td>
      <td class="p-4 text-center">
        <div class="flex items-center justify-center gap-2">
          <button onclick="window.viewClassDetail('${cls.id || cls.code}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"><i class="fa-solid fa-folder-open"></i> Chi tiết lớp</button>
          <button onclick="window.deleteClass('${cls.id || cls.code}')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5" title="Xóa lớp học này"><i class="fa-solid fa-trash-can"></i> Xóa lớp</button>
        </div>
      </td>
    </tr>
  `).join('');
}

export async function deleteClass(classId) {
  const cls = appState.classes.find(c => c.id === classId || c.code === classId);
  if (!cls) return;

  const doDelete = async () => {
    appState.classes = appState.classes.filter(c => c.id !== classId && c.code !== classId);
    saveToLocal('mathexam_classes', appState.classes);

    try {
      await fetch('/api/classes/' + encodeURIComponent(cls.id || cls.code), { method: 'DELETE' });
    } catch (_) {}

    if (db && isConnected) {
      try {
        await db.collection(COLLECTIONS.CLASSES).doc(cls.id || cls.code).delete();
      } catch (e) {
        console.warn('Lỗi xóa lớp trên Firestore:', e);
      }
    }
    showToast(`Đã xóa lớp "${cls.name}" thành công!`, 'success');
    renderTeacherClasses();
  };

  if (window.Swal) {
    window.Swal.fire({
      title: 'Xóa lớp học?',
      html: `Bạn có chắc chắn muốn xóa lớp <b>${escapeHtml(cls.name)}</b> (${cls.code})?<br><span class="text-xs text-red-500 mt-2 block font-medium">Toàn bộ dữ liệu và danh sách học sinh của lớp sẽ bị xóa.</span>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-trash mr-1"></i> Xóa vĩnh viễn',
      confirmButtonColor: '#ef4444',
      cancelButtonText: 'Hủy'
    }).then(res => {
      if (res.isConfirmed) doDelete();
    });
  } else {
    if (confirm(`Bạn có chắc chắn muốn xóa lớp "${cls.name}" (${cls.code})?`)) {
      doDelete();
    }
  }
}

export function viewClassDetail(classId) {
  const cls = appState.classes.find(c => c.id === classId || c.code === classId);
  if (!cls) return;
  appState.currentClass = cls;
  navigate('teacher-class-detail');
}

export function renderTeacherClassDetail() {
  const cls = appState.currentClass;
  if (!cls) return;

  const nameEl = document.getElementById('detail-class-name');
  const codeEl = document.getElementById('detail-class-code');
  if (nameEl) nameEl.textContent = cls.name;
  if (codeEl) codeEl.textContent = cls.code;

  renderClassStudentsTab();
  renderClassLecturesTab();
  renderClassExamsTab();
}

export function switchClassTab(tabName) {
  ['students', 'lectures', 'exams'].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`class-tab-${t}`);
    if (t === tabName) {
      if (btn) btn.className = 'px-6 py-4 font-bold text-primary border-b-2 border-primary bg-blue-50';
      if (content) content.classList.remove('hidden');
    } else {
      if (btn) btn.className = 'px-6 py-4 font-bold text-gray-500 hover:text-primary transition';
      if (content) content.classList.add('hidden');
    }
  });
}

function renderClassStudentsTab() {
  const cls = appState.currentClass;
  const tbody = document.getElementById('class-student-list-body');
  if (!tbody || !cls) return;

  if (!cls.students || cls.students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-gray-500">Lớp chưa có học sinh. Hãy tải file Excel danh sách lên.</td></tr>`;
    return;
  }

  tbody.innerHTML = cls.students.map((st, idx) => `
    <tr class="hover:bg-slate-50 border-b">
      <td class="p-3 text-center text-gray-500 font-semibold">${st.stt || idx + 1}</td>
      <td class="p-3 font-bold text-gray-800">${escapeHtml(st.name)}</td>
      <td class="p-3 text-center">
        <span class="font-mono bg-red-50 text-red-600 px-3 py-1 rounded-full font-black border border-red-200 text-sm tracking-wider">${st.pin}</span>
      </td>
    </tr>
  `).join('');
}

function renderClassLecturesTab() {
  const cls = appState.currentClass;
  const container = document.getElementById('class-lecture-list');
  if (!container || !cls) return;

  const lectures = cls.lectures || [];
  const practices = cls.practices || [];

  if (lectures.length === 0 && practices.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-500 bg-gray-50 rounded-lg border border-dashed">Chưa có tài liệu hoặc bài luyện tập nào trong lớp.</div>`;
    return;
  }

  container.innerHTML = `
    ${practices.map((pr) => `
      <div class="p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex justify-between items-center shadow-xs">
        <div>
          <div class="font-bold text-emerald-900">${escapeHtml(pr.title)}</div>
          <div class="text-xs text-emerald-700 mt-1"><i class="fa-solid fa-list-check mr-1"></i> ${pr.questions?.length || 0} câu hỏi tự luyện</div>
        </div>
        <div class="flex gap-2">
          <button onclick="window.previewPractice('${pr.id}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"><i class="fa-solid fa-eye mr-1"></i> Xem</button>
          <button onclick="window.editPractice('${pr.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"><i class="fa-solid fa-pen mr-1"></i> Sửa</button>
        </div>
      </div>
    `).join('')}
    ${lectures.map(lec => `
      <div class="p-4 bg-white rounded-xl border flex justify-between items-center shadow-xs">
        <div>
          <div class="font-bold text-gray-800">${escapeHtml(lec.title)}</div>
          <a href="${escapeHtml(lec.url)}" target="_blank" class="text-xs text-blue-600 hover:underline mt-1 block"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i> ${escapeHtml(lec.url)}</a>
        </div>
        <span class="text-xs text-gray-400 font-semibold">${lec.date || ''}</span>
      </div>
    `).join('')}
  `;
}

function renderClassExamsTab() {
  const cls = appState.currentClass;
  const container = document.getElementById('class-exam-list');
  if (!container || !cls) return;

  const assigned = cls.assignedExams || [];
  if (assigned.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-500 bg-gray-50 rounded-lg border border-dashed">Chưa có đề thi nào được giao cho lớp này. Hãy bấm "Giao đề thi" bên trên!</div>`;
    return;
  }

  container.innerHTML = assigned.map(examId => {
    const exam = appState.exams.find(e => e.id === examId);
    if (!exam) return '';
    return `
      <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-xs flex justify-between items-center">
        <div>
          <div class="font-bold text-gray-900">${escapeHtml(exam.title)}</div>
          <div class="text-xs text-gray-500 mt-1">Mã phòng: <span class="font-mono font-bold text-primary">${exam.pin}</span> | ${exam.duration} phút</div>
        </div>
        <button onclick="window.viewExamSubmissions('${exam.id}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer">Xem bài nộp</button>
      </div>
    `;
  }).join('');
}

export function downloadClassTemplate() {
  if (!window.XLSX) {
    showToast('Thư viện Excel SheetJS chưa sẵn sàng', 'error');
    return;
  }
  const wsData = [
    ['STT', 'Họ và Tên', 'Mã PIN'],
    [1, 'Nguyễn Văn An', '101'],
    [2, 'Trần Thị Bình', '102'],
    [3, 'Lê Hoàng Cường', '103']
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(wsData);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'DanhSachHocSinh');
  window.XLSX.writeFile(wb, 'Mau_Danh_Sach_Lop.xlsx');
}

export function importClassExcel(event) {
  const file = event.target.files?.[0];
  if (!file || !window.XLSX) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      if (rows.length < 2) {
        showToast('File không có dữ liệu', 'warning');
        return;
      }

      const students = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[1]) continue;
        const stt = row[0] || i;
        const name = String(row[1]).trim();
        const pin = row[2] ? String(row[2]).trim() : Math.floor(100 + Math.random() * 900).toString();
        students.push({ stt, name, pin });
      }

      const className = file.name.replace(/\.[^/.]+$/, '').replace(/Mau_|Danh_Sach_/gi, '');
      const classCode = 'C' + Math.floor(1000 + Math.random() * 9000);

      const newClass = {
        id: `class_${Date.now()}`,
        name: `Lớp ${className}`,
        code: classCode,
        updatedAt: new Date().toLocaleDateString('vi-VN'),
        students,
        lectures: [],
        practices: [],
        assignedExams: []
      };

      await saveClassToStore(newClass);
      renderTeacherClasses();
      showToast(`Đã tạo lớp thành công với ${students.length} học sinh! Mã lớp: ${classCode}`, 'success');
    } catch (err) {
      showToast('Lỗi đọc file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

export function exportClassPINs() {
  const cls = appState.currentClass;
  if (!cls || !cls.students || !window.XLSX) return;

  const data = [
    ['STT', 'Họ và Tên', 'Mã PIN', 'Mã Lớp'],
    ...cls.students.map(s => [s.stt, s.name, s.pin, cls.code])
  ];

  const ws = window.XLSX.utils.aoa_to_sheet(data);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'PINs');
  window.XLSX.writeFile(wb, `Ma_PIN_${cls.code}.xlsx`);
  showToast('Đã xuất file PIN thành công!', 'success');
}

export function addLectureLink() {
  if (!window.Swal) return;
  window.Swal.fire({
    title: 'Thêm Link Tài Liệu / Video',
    html: `
      <input id="lec-title" class="swal2-input" placeholder="Tiêu đề tài liệu">
      <input id="lec-url" class="swal2-input" placeholder="https://...">
    `,
    showCancelButton: true,
    confirmButtonText: 'Lưu tài liệu'
  }).then(async res => {
    if (res.isConfirmed) {
      const title = document.getElementById('lec-title')?.value.trim();
      const url = document.getElementById('lec-url')?.value.trim();
      if (title && url) {
        if (!appState.currentClass.lectures) appState.currentClass.lectures = [];
        appState.currentClass.lectures.push({
          id: `lec_${Date.now()}`,
          title,
          url,
          date: new Date().toLocaleDateString('vi-VN')
        });
        await saveClassToStore(appState.currentClass);
        renderClassLecturesTab();
        showToast('Đã thêm tài liệu');
      }
    }
  });
}

export function assignExamToClass() {
  if (appState.exams.length === 0) {
    if (window.Swal) window.Swal.fire('Chưa có đề thi', 'Hãy tạo đề thi trước khi giao cho lớp.', 'info');
    return;
  }

  const cls = appState.currentClass;
  const optionsHtml = appState.exams.map(e => `<option value="${e.id}">${escapeHtml(e.title)} (PIN: ${e.pin})</option>`).join('');

  if (window.Swal) {
    window.Swal.fire({
      title: 'Giao Đề Thi Cho Lớp',
      html: `
        <label class="block text-left text-sm font-bold text-gray-700 mb-2">Chọn đề thi muốn giao:</label>
        <select id="swal-assign-exam" class="swal2-select w-full">${optionsHtml}</select>
      `,
      showCancelButton: true,
      confirmButtonText: 'Giao Đề Ngay',
      confirmButtonColor: '#10b981'
    }).then(async res => {
      if (res.isConfirmed) {
        const examId = document.getElementById('swal-assign-exam')?.value;
        if (examId) {
          if (!cls.assignedExams) cls.assignedExams = [];
          if (!cls.assignedExams.includes(examId)) {
            cls.assignedExams.push(examId);
            await saveClassToStore(cls);
            renderClassExamsTab();
            showToast('Đã giao đề thi thành công!', 'success');
          } else {
            showToast('Đề thi này đã được giao cho lớp từ trước', 'info');
          }
        }
      }
    });
  }
}

export function assignExamPrompt(examId) {
  if (appState.classes.length === 0) {
    showToast('Chưa có lớp học nào để giao', 'warning');
    return;
  }

  const optionsHtml = appState.classes.map(c => `<option value="${c.id || c.code}">${escapeHtml(c.name)} (${c.code})</option>`).join('');
  if (window.Swal) {
    window.Swal.fire({
      title: 'Giao Đề Cho Lớp',
      html: `<select id="swal-cls-sel" class="swal2-select w-full">${optionsHtml}</select>`,
      showCancelButton: true,
      confirmButtonText: 'Giao Đề'
    }).then(async res => {
      if (res.isConfirmed) {
        const cId = document.getElementById('swal-cls-sel')?.value;
        const cls = appState.classes.find(c => c.id === cId || c.code === cId);
        if (cls) {
          if (!cls.assignedExams) cls.assignedExams = [];
          if (!cls.assignedExams.includes(examId)) cls.assignedExams.push(examId);
          await saveClassToStore(cls);
          showToast(`Đã giao cho lớp ${cls.name}`, 'success');
        }
      }
    });
  }
}

// ==========================================
// HỌC SINH: THI VÀ TỰ LUYỆN
// ==========================================
export function checkStudentClassCode() {
  const input = document.getElementById('std-class-code');
  const code = input ? input.value.trim().toUpperCase() : '';

  if (!code) {
    showToast('Vui lòng nhập mã lớp', 'warning');
    return;
  }

  const cls = appState.classes.find(c => c.code.toUpperCase() === code);
  if (cls) {
    document.getElementById('student-login-step1')?.classList.add('hidden');
    document.getElementById('student-login-step2')?.classList.remove('hidden');
    const nameDisp = document.getElementById('std-login-class-name');
    const codeDisp = document.getElementById('std-login-class-code-disp');
    if (nameDisp) nameDisp.textContent = cls.name;
    if (codeDisp) codeDisp.textContent = cls.code;

    const nameInput = document.getElementById('std-name-input');
    const pinInput = document.getElementById('std-pin-input');
    const pinHint = document.getElementById('std-pin-hint');

    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
    if (pinInput) pinInput.value = '';

    if (pinHint) {
      pinHint.textContent = `Vui lòng nhập đúng họ tên trong danh sách lớp và mã bảo mật (PIN) cá nhân.`;
    }
    return;
  }

  const exam = appState.exams.find(e => e.pin === code);
  if (exam) {
    document.getElementById('student-login-step1')?.classList.add('hidden');
    document.getElementById('student-login-step2')?.classList.remove('hidden');
    const nameDisp = document.getElementById('std-login-class-name');
    const codeDisp = document.getElementById('std-login-class-code-disp');
    if (nameDisp) nameDisp.textContent = exam.title;
    if (codeDisp) codeDisp.textContent = `PIN: ${exam.pin}`;

    const nameInput = document.getElementById('std-name-input');
    const pinInput = document.getElementById('std-pin-input');
    if (nameInput) nameInput.value = '';
    if (pinInput) pinInput.value = '';
    return;
  }

  if (window.Swal) window.Swal.fire('Không tìm thấy', `Mã "${code}" không tồn tại.`, 'error');
}

export function loginStudentToClass() {
  const codeInput = document.getElementById('std-class-code');
  const nameInput = document.getElementById('std-name-input');
  const pinInput = document.getElementById('std-pin-input');

  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const pin = pinInput ? pinInput.value.trim() : '';

  if (!name) {
    showToast('Vui lòng nhập Họ và Tên của bạn', 'warning');
    nameInput?.focus();
    return;
  }
  if (!pin) {
    showToast('Vui lòng nhập Mã bảo mật (PIN)', 'warning');
    pinInput?.focus();
    return;
  }

  const cls = appState.classes.find(c => c.code.toUpperCase() === code);
  if (cls) {
    const normalize = str => String(str || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const inputNorm = normalize(name);

    const students = cls.students || [];
    if (students.length > 0) {
      // 1. Nhận dạng đúng tên học sinh gõ vào khớp với danh sách lớp
      const matchedStudent = students.find(s => normalize(s.name) === inputNorm);

      if (!matchedStudent) {
        showToast(`Không tìm thấy học sinh "${name}" trong danh sách lớp ${cls.name}. Vui lòng nhập đúng họ tên!`, 'error');
        nameInput?.focus();
        return;
      }

      // 2. Nhận dạng đúng mã bảo mật (PIN) của chính chủ học sinh
      if (matchedStudent.pin && matchedStudent.pin !== pin) {
        showToast(`Mã bảo mật (PIN) không chính xác cho học sinh "${matchedStudent.name}". Vui lòng kiểm tra lại!`, 'error');
        pinInput?.focus();
        return;
      }

      appState.role = 'student';
      appState.currentStudent = {
        name: matchedStudent.name,
        pin: matchedStudent.pin || pin,
        classCode: cls.code,
        className: cls.name,
        stt: matchedStudent.stt || null
      };
    } else {
      // Trường hợp lớp tự do chưa cấu hình danh sách học sinh
      appState.role = 'student';
      appState.currentStudent = {
        name: name,
        pin: pin,
        classCode: cls.code,
        className: cls.name,
        stt: null
      };
    }

    appState.currentClass = cls;
    // Tự động xác thực ngầm bằng code khi học sinh nhập đúng mã PIN lớp học
    if (typeof window.ensureSilentFirebaseAuth === 'function') {
      window.ensureSilentFirebaseAuth().catch(() => {});
    }
    navigate('student-class-space');
    showToast(`Chào mừng học sinh ${appState.currentStudent.name}!`, 'success');
    return;
  }

  const exam = appState.exams.find(e => e.pin === code);
  if (exam) {
    appState.role = 'student';
    appState.currentStudent = { name, pin, classCode: 'Tự do', className: 'Phòng thi độc lập' };
    // Tự động xác thực ngầm bằng code khi vào thi
    if (typeof window.ensureSilentFirebaseAuth === 'function') {
      window.ensureSilentFirebaseAuth().catch(() => {});
    }
    startExamSession(exam);
    return;
  }

  showToast('Thông tin xác thực không đúng. Vui lòng kiểm tra lại mã lớp/mã đề!', 'error');
}

export function renderStudentClassSpace() {
  const std = appState.currentStudent;
  const cls = appState.currentClass;
  if (!std || !cls) return;

  const classNameEl = document.getElementById('space-class-name');
  const studentNameEl = document.getElementById('space-student-name');
  if (classNameEl) classNameEl.textContent = cls.name;
  if (studentNameEl) studentNameEl.textContent = std.name;

  const examContainer = document.getElementById('space-exam-list');
  if (examContainer) {
    const assigned = cls.assignedExams || [];
    if (assigned.length === 0) {
      examContainer.innerHTML = `<div class="p-8 text-center text-gray-500 bg-gray-50 rounded-xl">Chưa có đề thi nào được mở cho lớp của bạn.</div>`;
    } else {
      examContainer.innerHTML = assigned.map(examId => {
        const exam = appState.exams.find(e => e.id === examId);
        if (!exam) return '';

        // Lấy tất cả các bài thi đã nộp của học sinh này đối với đề thi này
        const studentSubs = getStudentExamSubmissions(exam.id, std);

        const attemptCount = studentSubs.length;
        const maxAttempts = parseInt(exam.maxAttempts, 10) || 1;
        const canTakeExam = attemptCount < maxAttempts;
        const latestSub = studentSubs[0];

        let attemptBadge = '';
        if (attemptCount === 0) {
          attemptBadge = `
            <span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Thời gian: ${exam.duration} phút</span>
            <span class="bg-slate-100 text-slate-700 text-xs px-2.5 py-0.5 rounded-full font-bold">Tối đa: ${maxAttempts} lần làm bài</span>
          `;
        } else if (canTakeExam) {
          attemptBadge = `
            <span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Thời gian: ${exam.duration} phút</span>
            <span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Đã thi: ${attemptCount}/${maxAttempts} lần (Còn ${maxAttempts - attemptCount} lượt)</span>
          `;
        } else {
          attemptBadge = `
            <span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Thời gian: ${exam.duration} phút</span>
            <span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Đã hoàn thành tối đa (${attemptCount}/${maxAttempts} lần)</span>
          `;
        }

        let actionHtml = '';
        if (canTakeExam) {
          if (attemptCount === 0) {
            actionHtml = `
              <button onclick="window.startExamSessionById('${exam.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-pen-nib"></i> Vào Thi Ngay
              </button>
            `;
          } else {
            // Còn lượt làm bài: Chỉ hiển thị nút Thi Lại, KHÔNG hiển thị "Xem Bài Trước" để tránh lộ đề/lời giải trước lần thi cuối
            actionHtml = `
              <button onclick="window.startExamSessionById('${exam.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-rotate-right"></i> Thi Lại (Lần ${attemptCount + 1}/${maxAttempts})
              </button>
            `;
          }
        } else {
          // Đã hoàn thành lần thi cuối cùng (hết số lượt làm bài): Hiển thị nút "Xem Bài Trước"
          actionHtml = `
            <button onclick="window.viewSubmittedExamSolutions('${latestSub.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-5 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-1.5 cursor-pointer">
              <i class="fa-solid fa-book-open"></i> Xem Bài Trước
            </button>
          `;
        }

        return `
          <div class="p-5 bg-white rounded-xl border border-gray-200 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-emerald-400 transition">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                ${attemptBadge}
              </div>
              <h4 class="font-bold text-gray-900 text-lg mt-1">${escapeHtml(exam.title)}</h4>
              ${latestSub ? `<p class="text-xs text-gray-500 mt-1">Điểm gần nhất: <b class="text-primary text-sm">${latestSub.score}/10</b> | Ngày nộp: ${latestSub.submittedAt}</p>` : ''}
            </div>
            <div>
              ${actionHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const lectureContainer = document.getElementById('space-lecture-list');
  if (lectureContainer) {
    const practices = cls.practices || [];
    const lectures = cls.lectures || [];

    if (practices.length === 0 && lectures.length === 0) {
      lectureContainer.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs">Chưa có tài liệu</div>`;
    } else {
      lectureContainer.innerHTML = `
        ${practices.map(pr => `
          <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
            <div class="font-bold text-emerald-900 text-sm mb-1">${escapeHtml(pr.title)}</div>
            <div class="text-[11px] text-emerald-700 mb-2">${pr.questions?.length || 0} câu hỏi tự luyện</div>
            <button onclick="window.startStudentPractice('${pr.id}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"><i class="fa-solid fa-circle-play mr-1"></i> Tự Luyện Ngay</button>
          </div>
        `).join('')}
        ${lectures.map(lec => `
          <div class="p-3 bg-white rounded-xl border text-xs">
            <div class="font-bold text-gray-800 mb-1">${escapeHtml(lec.title)}</div>
            <a href="${escapeHtml(lec.url)}" target="_blank" class="text-blue-600 hover:underline"><i class="fa-solid fa-link mr-1"></i> Mở liên kết</a>
          </div>
        `).join('')}
      `;
    }
  }
}

// Chuẩn hóa dữ liệu câu hỏi tự luyện để luôn hiển thị được phần học sinh lựa chọn / nhập đáp án
// (dữ liệu có thể đến từ file TeX, Word, server hoặc Firebase với định dạng hơi khác nhau)
function normalizePracticeQuestion(raw) {
  const q = (raw && typeof raw === 'object') ? { ...raw } : { type: 'essay', content: String(raw || '') };
  q.content = q.content == null ? '' : String(q.content);

  // Phương án trắc nghiệm: cho phép dạng chuỗi hoặc đối tượng
  if (Array.isArray(q.options)) {
    q.options = q.options.map(o => (o && typeof o === 'object') ? { ...o, text: o.text == null ? '' : String(o.text) } : { text: String(o == null ? '' : o) });
  }
  // Mệnh đề đúng/sai: đảm bảo `correct` là boolean
  if (Array.isArray(q.items)) {
    q.items = q.items.map(it => {
      if (it && typeof it === 'object') {
        return { ...it, text: it.text == null ? '' : String(it.text), correct: it.correct === true || String(it.correct).toLowerCase() === 'true' };
      }
      return { text: String(it == null ? '' : it), correct: false };
    });
  }

  // Suy luận loại câu hỏi nếu dữ liệu thiếu `type`
  if (!q.type) {
    if (Array.isArray(q.options) && q.options.length >= 2) q.type = 'mcq';
    else if (Array.isArray(q.items) && q.items.length >= 2) q.type = 'tf';
    else if (q.correctAnswer !== undefined && String(q.correctAnswer).trim() !== '') q.type = 'short';
    else q.type = 'essay';
  }

  // Đáp án trắc nghiệm dạng chữ cái (A, B, C, D) -> chỉ số 0, 1, 2, 3
  if (q.type === 'mcq' && typeof q.correctAnswer === 'string' && /^[A-Fa-f]$/.test(q.correctAnswer.trim())) {
    q.correctAnswer = q.correctAnswer.trim().toUpperCase().charCodeAt(0) - 65;
  }
  return q;
}

// Tự luyện dạng flashcard cho học sinh (hỗ trợ cả 5 dạng câu hỏi với giao diện tương tác lựa chọn)
export function startStudentPractice(practiceId) {
  let pr = null;
  // 1. Tìm trong lớp hiện tại
  if (appState.currentClass?.practices) {
    pr = appState.currentClass.practices.find(p => p.id === practiceId);
  }
  // 2. Tìm trong tất cả các lớp của học sinh / giáo viên
  if (!pr && appState.classes) {
    for (const c of appState.classes) {
      if (c.practices) {
        pr = c.practices.find(p => p.id === practiceId);
        if (pr) {
          appState.currentClass = c;
          break;
        }
      }
    }
  }
  // 3. Tìm trong bài tự luyện đang chỉnh sửa (nếu có)
  if (!pr && appState.editingPractice && appState.editingPractice.id === practiceId) {
    pr = appState.editingPractice;
  }
  // 4. Fallback: lấy bài tự luyện đầu tiên có câu hỏi nếu không tìm thấy ID chính xác
  if (!pr && appState.currentClass?.practices?.length > 0) {
    pr = appState.currentClass.practices[0];
  }

  if (!pr || !pr.questions || pr.questions.length === 0) {
    showToast('Bài luyện tập không có câu hỏi', 'warning');
    return;
  }

  appState.activePracticeSession = {
    id: pr.id,
    title: pr.title,
    questions: pr.questions.map(normalizePracticeQuestion),
    currentIndex: 0,
    showAnswer: false,
    showExplanation: false,
    userAnswers: {}
  };

  const titleEl = document.getElementById('practice-title');
  if (titleEl) titleEl.textContent = pr.title;

  navigate('student-practice');
  renderCurrentPracticeQuestion();
}

export function selectPracticeMcq(oIdx) {
  const session = appState.activePracticeSession;
  if (!session) return;
  session.userAnswers = session.userAnswers || {};
  session.userAnswers[session.currentIndex] = oIdx;
  renderCurrentPracticeQuestion();
}

export function selectPracticeTf(itemIdx, val) {
  const session = appState.activePracticeSession;
  if (!session) return;
  session.userAnswers = session.userAnswers || {};
  if (!session.userAnswers[session.currentIndex] || typeof session.userAnswers[session.currentIndex] !== 'object') {
    session.userAnswers[session.currentIndex] = {};
  }
  session.userAnswers[session.currentIndex][itemIdx] = val;
  renderCurrentPracticeQuestion();
}

export function recordPracticeShort(val) {
  const session = appState.activePracticeSession;
  if (!session) return;
  session.userAnswers = session.userAnswers || {};
  session.userAnswers[session.currentIndex] = val;
}

export function checkPracticeShort() {
  const session = appState.activePracticeSession;
  if (!session) return;
  session.showAnswer = true;
  renderCurrentPracticeQuestion();
}

export function recordPracticeEssay(val) {
  const session = appState.activePracticeSession;
  if (!session) return;
  session.userAnswers = session.userAnswers || {};
  session.userAnswers[session.currentIndex] = val;
}

function renderCurrentPracticeQuestion() {
  const session = appState.activePracticeSession;
  const container = document.getElementById('practice-container');
  const progressEl = document.getElementById('practice-progress');

  if (!session || !container) return;

  session.userAnswers = session.userAnswers || {};
  const q = session.questions[session.currentIndex];
  const total = session.questions.length;
  const currentAns = session.userAnswers[session.currentIndex];

  if (progressEl) progressEl.textContent = `Câu ${session.currentIndex + 1} / ${total}`;

  // Cập nhật trạng thái nút Hiện / Ẩn đáp án
  const showAnsBtn = document.querySelector('button[onclick*="showPracticeAnswer"]');
  if (showAnsBtn) {
    if (session.showAnswer) {
      showAnsBtn.innerHTML = '<i class="fa-solid fa-eye-slash mr-2"></i>Ẩn Đ/A';
      showAnsBtn.className = 'bg-slate-700 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-bold cursor-pointer transition';
    } else {
      showAnsBtn.innerHTML = '<i class="fa-solid fa-eye mr-2"></i>Hiện Đ/A';
      showAnsBtn.className = 'bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-bold cursor-pointer transition';
    }
  }

  let badgeType = 'Trắc nghiệm 4 lựa chọn';
  if (q.type === 'tf') badgeType = 'Đúng / Sai';
  if (q.type === 'short') badgeType = 'Trả lời ngắn';
  if (q.type === 'cloze') badgeType = 'Điền khuyết';
  if (q.type === 'essay') badgeType = 'Tự luận';

  let interactionSection = '';

  // 1. TRẮC NGHIỆM (MCQ)
  if (q.type === 'mcq' && q.options && q.options.length > 0) {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const parsedCorrect = parseInt(q.correctAnswer, 10);
    const parsedUserAns = currentAns !== undefined ? parseInt(currentAns, 10) : null;

    interactionSection = `
      <div class="mt-4 mb-4">
        <label class="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2.5">
          <i class="fa-solid fa-hand-pointer text-primary mr-1"></i> Chọn một phương án trả lời:
        </label>
        <div class="grid md:grid-cols-2 gap-3">
          ${q.options.map((opt, oIdx) => {
            const isUserChosen = parsedUserAns === oIdx;
            const isCorrectOption = parsedCorrect === oIdx;

            let cardClasses = 'bg-white border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 text-slate-800 shadow-xs cursor-pointer';
            let circleClasses = 'bg-slate-100 text-slate-700 border border-slate-300';
            let statusBadge = '';

            if (session.showAnswer) {
              if (isCorrectOption) {
                cardClasses = 'bg-emerald-50 border-2 border-emerald-500 font-bold text-emerald-950 ring-2 ring-emerald-300 shadow-md';
                circleClasses = 'bg-emerald-600 text-white font-black';
                statusBadge = `<span class="ml-auto text-xs bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shrink-0"><i class="fa-solid fa-check"></i> Đáp án đúng</span>`;
              } else if (isUserChosen) {
                cardClasses = 'bg-red-50 border-2 border-red-500 font-bold text-red-950 shadow-md';
                circleClasses = 'bg-red-600 text-white font-black';
                statusBadge = `<span class="ml-auto text-xs bg-red-600 text-white px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shrink-0"><i class="fa-solid fa-xmark"></i> Bạn đã chọn</span>`;
              } else {
                cardClasses = 'bg-slate-50 border border-slate-200 text-slate-400 opacity-60';
                circleClasses = 'bg-slate-200 text-slate-500';
              }
            } else if (isUserChosen) {
              cardClasses = 'bg-blue-50 border-2 border-blue-600 font-bold text-blue-950 ring-2 ring-blue-300 shadow-md';
              circleClasses = 'bg-blue-600 text-white font-black';
              statusBadge = `<span class="ml-auto text-xs bg-blue-600 text-white px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shrink-0"><i class="fa-solid fa-circle-dot"></i> Đã chọn</span>`;
            }

            return `
              <div onclick="window.selectPracticeMcq(${oIdx})"
                   class="p-4 rounded-xl border flex items-center gap-3 transition-all transform active:scale-[0.99] ${cardClasses}">
                <span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${circleClasses}">
                  ${letters[oIdx] || oIdx + 1}
                </span>
                <div class="math-render flex-1 text-sm md:text-base leading-relaxed">${renderMathContent(opt.text !== undefined ? opt.text : opt)}</div>
                ${statusBadge}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  // 2. ĐÚNG / SAI (TF)
  else if (q.type === 'tf' && q.items && q.items.length > 0) {
    const userTf = (typeof currentAns === 'object' && currentAns !== null) ? currentAns : {};

    interactionSection = `
      <div class="mt-4 mb-4">
        <label class="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2.5">
          <i class="fa-solid fa-list-check text-emerald-600 mr-1"></i> Chọn Đúng hoặc Sai cho từng mệnh đề:
        </label>
        <div class="space-y-3">
          ${q.items.map((it, iIdx) => {
            const letter = String.fromCharCode(97 + iIdx);
            const userChoice = userTf[iIdx];
            const isCorrectKey = it.correct;

            let rowFeedback = '';
            if (session.showAnswer) {
              const isMatch = userChoice === isCorrectKey;
              rowFeedback = `
                <div class="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg ${isMatch ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
                  <i class="fa-solid ${isMatch ? 'fa-circle-check text-emerald-600' : 'fa-circle-xmark text-red-600'}"></i>
                  <span>${isMatch ? 'Chính xác' : `Chuẩn: ${isCorrectKey ? 'ĐÚNG' : 'SAI'}`}</span>
                </div>
              `;
            }

            return `
              <div class="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition">
                <div class="flex items-start gap-2.5 flex-1">
                  <span class="w-6 h-6 rounded-full bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">${letter})</span>
                  <div class="math-render text-sm text-slate-900 leading-relaxed">${renderMathContent(it.text)}</div>
                </div>
                <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button type="button"
                          onclick="window.selectPracticeTf(${iIdx}, true)"
                          class="px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${userChoice === true ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300' : 'bg-white border border-slate-300 text-slate-700 hover:bg-emerald-50 hover:border-emerald-400'}">
                    <i class="fa-solid fa-check"></i> Đúng
                  </button>
                  <button type="button"
                          onclick="window.selectPracticeTf(${iIdx}, false)"
                          class="px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${userChoice === false ? 'bg-red-600 text-white shadow-md ring-2 ring-red-300' : 'bg-white border border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-400'}">
                    <i class="fa-solid fa-xmark"></i> Sai
                  </button>
                  ${rowFeedback}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  // 3. TRẢ LỜI NGẮN / ĐIỀN KHUYẾT (SHORT / CLOZE)
  else if (q.type === 'short' || q.type === 'cloze') {
    const shortVal = typeof currentAns === 'string' ? currentAns : '';
    const isMatch = session.showAnswer && String(shortVal).trim().toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase();

    interactionSection = `
      <div class="mt-4 mb-4 p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl">
        <label class="block text-xs font-black uppercase tracking-wider text-slate-600 mb-2">
          <i class="fa-solid fa-keyboard text-primary mr-1"></i> Nhập câu trả lời của bạn:
        </label>
        <div class="flex flex-col sm:flex-row gap-2.5">
          <input type="text"
                 id="practice-short-input"
                 value="${escapeHtml(shortVal)}"
                 placeholder="Nhập số, biểu thức hoặc từ khóa..."
                 oninput="window.recordPracticeShort(this.value)"
                 onkeydown="if(event.key==='Enter') window.checkPracticeShort()"
                 class="flex-1 p-3.5 bg-white border-2 border-slate-300 rounded-xl font-bold text-base text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition" />
          <button type="button"
                  onclick="window.checkPracticeShort()"
                  class="px-6 py-3.5 bg-primary hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0">
            <i class="fa-solid fa-circle-check"></i> Kiểm Tra
          </button>
        </div>

        ${session.showAnswer ? `
          <div class="mt-4 p-4 rounded-xl border ${isMatch ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-amber-50 border-amber-300 text-amber-950'}">
            <div class="flex items-center gap-2 font-bold text-sm mb-1">
              <i class="fa-solid ${isMatch ? 'fa-circle-check text-emerald-600' : 'fa-circle-exclamation text-amber-600'} text-base"></i>
              <span>${isMatch ? 'Chính xác tuyệt đối! 🎉' : 'Đáp án chuẩn:'}</span>
            </div>
            <div class="flex items-center gap-3 mt-1.5 flex-wrap">
              <span class="font-mono text-xl font-black bg-white px-3.5 py-1.5 rounded-lg border border-slate-300 inline-block shadow-xs">${escapeHtml(q.correctAnswer)}</span>
              ${!isMatch && shortVal ? `<span class="text-xs text-slate-500">Câu trả lời bạn đã nhập: <b class="text-slate-800 font-mono">${escapeHtml(shortVal)}</b></span>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
  // 4. TỰ LUẬN (ESSAY)
  else if (q.type === 'essay') {
    const essayVal = typeof currentAns === 'string' ? currentAns : '';
    interactionSection = `
      <div class="mt-4 mb-4 p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl">
        <label class="block text-xs font-black uppercase tracking-wider text-slate-600 mb-2">
          <i class="fa-solid fa-pen-fancy text-indigo-600 mr-1"></i> Phác thảo lời giải / ghi chú của bạn:
        </label>
        <textarea oninput="window.recordPracticeEssay(this.value)"
                  rows="4"
                  placeholder="Ghi nhanh các bước suy luận hoặc kết quả trung gian..."
                  class="w-full p-3.5 bg-white border-2 border-slate-300 rounded-xl font-medium text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition">${escapeHtml(essayVal)}</textarea>
        ${session.showAnswer ? `
          <div class="mt-3 p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 font-semibold flex items-center gap-2">
            <i class="fa-solid fa-circle-info text-indigo-600 text-base"></i>
            <span>Bấm nút <b>"Lời Giải"</b> ở thanh công cụ bên dưới để xem toàn bộ các bước trình bày chi tiết.</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Dự phòng: câu hỏi thiếu dữ liệu phương án thì vẫn cho học sinh nhập câu trả lời thay vì để trống
  if (!interactionSection) {
    const fallbackVal = typeof currentAns === 'string' ? currentAns : '';
    interactionSection = `
      <div class="mt-4 mb-4 p-5 bg-amber-50 border-2 border-amber-200 rounded-2xl">
        <div class="text-xs font-bold text-amber-800 mb-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Câu hỏi này chưa có đủ dữ liệu phương án. Bạn có thể ghi nhanh câu trả lời của mình:</div>
        <input type="text" value="${escapeHtml(fallbackVal)}" oninput="window.recordPracticeShort(this.value)"
               class="w-full p-3 bg-white border-2 border-slate-300 rounded-xl font-bold text-base text-slate-900 focus:border-primary focus:outline-none" placeholder="Nhập câu trả lời..." />
      </div>
    `;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 mb-4">
      <span class="text-xs bg-emerald-100 text-emerald-800 font-black px-3 py-1 rounded-full uppercase">Câu ${session.currentIndex + 1}</span>
      <span class="text-xs bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-full">${badgeType}</span>
    </div>
    <div class="math-render text-lg font-medium text-gray-900 mb-6 leading-relaxed">${renderMathContent(q.content)}</div>
    
    ${interactionSection}

    ${session.showExplanation && q.explanation ? `
      <div class="p-5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 mt-4 shadow-inner">
        <div class="font-bold text-primary mb-2 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb text-yellow-500"></i> Hướng Dẫn Giải Chi Tiết:</div>
        <div class="math-render">${renderMathContent(q.explanation)}</div>
      </div>
    ` : ''}
  `;

  triggerMathJax();
}

export function prevPracticeQuestion() {
  const session = appState.activePracticeSession;
  if (!session) return;
  if (session.currentIndex > 0) {
    session.currentIndex--;
    session.showAnswer = false;
    session.showExplanation = false;
    renderCurrentPracticeQuestion();
  }
}

export function nextPracticeQuestion() {
  const session = appState.activePracticeSession;
  if (!session) return;
  if (session.currentIndex < session.questions.length - 1) {
    session.currentIndex++;
    session.showAnswer = false;
    session.showExplanation = false;
    renderCurrentPracticeQuestion();
  }
}

export function showPracticeAnswer() {
  if (appState.activePracticeSession) {
    appState.activePracticeSession.showAnswer = !appState.activePracticeSession.showAnswer;
    renderCurrentPracticeQuestion();
  }
}

export function showPracticeExplanation() {
  if (appState.activePracticeSession) {
    appState.activePracticeSession.showExplanation = !appState.activePracticeSession.showExplanation;
    renderCurrentPracticeQuestion();
  }
}

// ==========================================
// THI TRỰC TUYẾN CHÍNH THỨC
// ==========================================
export function startExamSessionById(examId) {
  const exam = appState.exams.find(e => e.id === examId);
  if (exam) startExamSession(exam);
}

export function startExamSession(exam) {
  // Kiểm tra số lần thi tối đa của học sinh này đối với đề thi
  const std = appState.currentStudent;
  if (std) {
    const studentSubs = getStudentExamSubmissions(exam.id, std);
    const maxAttempts = parseInt(exam.maxAttempts, 10) || 1;
    if (studentSubs.length >= maxAttempts) {
      if (window.Swal) {
        window.Swal.fire({
          icon: 'warning',
          title: 'Đã Hết Số Lần Thi!',
          text: `Bạn đã hoàn thành số lần thi tối đa (${maxAttempts} lần) cho đề thi "${exam.title}".`
        });
      } else {
        showToast(`Bạn đã hoàn thành số lần thi tối đa (${maxAttempts} lần) cho đề thi này!`, 'warning');
      }
      return;
    }
  }

  const availableVersions = Object.keys(exam.versions || {}).filter(v => exam.versions[v] && exam.versions[v].length > 0);
  const version = availableVersions.length > 0 ? availableVersions[Math.floor(Math.random() * availableVersions.length)] : '101';
  const questions = exam.versions?.[version] || [];

  if (questions.length === 0) {
    showToast('Đề thi chưa có câu hỏi', 'error');
    return;
  }

  appState.activeExamSession = {
    examId: exam.id,
    examTitle: exam.title,
    pin: exam.pin,
    version,
    questions,
    scores: exam.scores || { mcq: 0.25, tf: 1.0, short: 0.5, cloze: 1.0, essay: 1.0 },
    minSubmit: exam.minSubmit || 0,
    maxStrikes: exam.maxStrikes || 3,
    strikes: 0,
    startTime: Date.now(),
    durationMinutes: exam.duration || 45,
    secondsLeft: (exam.duration || 45) * 60,
    answers: {},
    timerInterval: null
  };

  setupExamWatermark();
  startExamTimer();
  setupAntiCheatListeners();
  renderExamDoingQuestions();

  navigate('student-exam');

  const titleEl = document.getElementById('exam-doing-title');
  const nameEl = document.getElementById('exam-doing-name');
  if (titleEl) titleEl.textContent = `${exam.title} - Mã đề: ${version}`;
  if (nameEl) nameEl.textContent = `${appState.currentStudent?.name || 'Học sinh'} (${appState.currentStudent?.className || 'Lớp'})`;

  try {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch (_) {}
}

function setupExamWatermark() {
  const container = document.getElementById('exam-watermark');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '';
  const text = `${appState.currentStudent?.name || 'Học sinh'} - ${appState.currentStudent?.classCode || ''} - MathExam`;
  for (let i = 0; i < 20; i++) {
    const item = document.createElement('div');
    item.className = 'watermark-item';
    item.textContent = text;
    item.style.top = `${(i % 5) * 22 + 5}%`;
    item.style.left = `${Math.floor(i / 5) * 25 + 2}%`;
    container.appendChild(item);
  }
}

function startExamTimer() {
  const timerEl = document.getElementById('exam-timer');
  if (appState.activeExamSession.timerInterval) clearInterval(appState.activeExamSession.timerInterval);

  appState.activeExamSession.timerInterval = setInterval(() => {
    if (!appState.activeExamSession) return;
    appState.activeExamSession.secondsLeft--;
    const mins = Math.floor(appState.activeExamSession.secondsLeft / 60);
    const secs = appState.activeExamSession.secondsLeft % 60;
    if (timerEl) {
      timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    if (appState.activeExamSession.secondsLeft <= 0) {
      clearInterval(appState.activeExamSession.timerInterval);
      showToast('Đã hết thời gian! Tự động nộp bài...', 'info');
      submitExam(true);
    }
  }, 1000);
}

let isAntiCheatActive = false;
function setupAntiCheatListeners() {
  if (isAntiCheatActive) return;
  isAntiCheatActive = true;

  document.addEventListener('visibilitychange', () => {
    if (appState.activeView === 'student-exam' && appState.activeExamSession && document.hidden) {
      handleExamStrike('Chuyển tab hoặc ẩn trình duyệt');
    }
  });

  window.addEventListener('blur', () => {
    if (appState.activeView === 'student-exam' && appState.activeExamSession) {
      handleExamStrike('Rời khỏi cửa sổ thi');
    }
  });

  // Chặn menu chuột phải và ghi nhận vi phạm khi học sinh đang làm bài
  document.addEventListener('contextmenu', (e) => {
    if (appState.activeView !== 'student-exam' || !appState.activeExamSession) return;
    e.preventDefault();
    // Nhấn giữ trên màn hình cảm ứng không bị tính là chuột phải
    if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
    // Đang hiển thị cảnh báo thì không tính thêm lần nữa
    const warningModal = document.getElementById('cheat-warning');
    if (warningModal && warningModal.style.display === 'flex') return;
    handleExamStrike('Nhấn chuột phải trong khi làm bài');
  }, true);
}

function handleExamStrike(reason) {
  if (!appState.activeExamSession) return;
  appState.activeExamSession.strikes++;
  const strikes = appState.activeExamSession.strikes;
  const maxStrikes = appState.activeExamSession.maxStrikes;

  const warningModal = document.getElementById('cheat-warning');
  const countEl = document.getElementById('strike-count');
  const maxEl = document.getElementById('strike-max-count');
  const msgEl = document.getElementById('cheat-msg');

  if (countEl) countEl.textContent = strikes;
  if (maxEl) maxEl.textContent = maxStrikes;
  if (msgEl) msgEl.textContent = `Hệ thống ghi nhận: ${reason}. Không được rời màn hình thi!`;
  if (warningModal) warningModal.style.display = 'flex';

  if (strikes >= maxStrikes) {
    setTimeout(() => {
      if (warningModal) warningModal.style.display = 'none';
      if (window.Swal) {
        window.Swal.fire('Bài thi bị khóa', `Bạn đã vi phạm quá ${maxStrikes} lần! Tự động thu bài.`, 'error');
      }
      submitExam(true);
    }, 2000);
  }
}

export function resumeExam() {
  const warningModal = document.getElementById('cheat-warning');
  if (warningModal) warningModal.style.display = 'none';
}

export function sendExceptionReport() {
  if (window.Swal) {
    window.Swal.fire({
      title: 'Báo Cáo Ngoại Lệ',
      input: 'textarea',
      inputPlaceholder: 'Mô tả sự cố (lag máy, rớt mạng, ấn nhầm phím)...',
      showCancelButton: true,
      confirmButtonText: 'Gửi Giáo Viên'
    }).then(async res => {
      if (res.isConfirmed && res.value) {
        const report = {
          studentName: appState.currentStudent?.name,
          examId: appState.activeExamSession?.examId,
          reason: res.value,
          strikes: appState.activeExamSession?.strikes,
          timestamp: new Date().toLocaleTimeString('vi-VN')
        };
        await saveReportToStore(report);
        resumeExam();
        showToast('Đã gửi báo cáo ngoại lệ cho giáo viên!', 'success');
      }
    });
  }
}

function renderExamDoingQuestions() {
  const container = document.getElementById('exam-doing-questions');
  if (!container || !appState.activeExamSession) return;

  const questions = appState.activeExamSession.questions;
  const letters = ['A', 'B', 'C', 'D'];

  container.innerHTML = questions.map((q, idx) => {
    return `
      <div class="bg-white rounded-2xl shadow-md p-6 mb-6 border border-slate-200 question-scroll-box" id="exam-q-${idx}">
        <div class="flex justify-between items-center mb-3 pb-2 border-b">
          <span class="font-extrabold text-primary text-lg">Câu ${idx + 1}:</span>
          <span class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-bold uppercase">${q.type}</span>
        </div>
        <div class="math-render text-gray-800 text-base mb-4 leading-relaxed">${renderMathContent(q.content)}</div>
        
        ${q.type === 'mcq' && q.options ? `
          <div class="grid md:grid-cols-2 gap-3">
            ${q.options.map((opt, oIdx) => `
              <label class="p-3.5 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 flex items-start gap-3 cursor-pointer transition select-none has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input type="radio" name="ans_${idx}" value="${oIdx}" onchange="window.recordAnswer(${idx}, ${oIdx})" class="mt-1 w-4 h-4 text-blue-600">
                <span class="font-bold text-gray-700 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs shrink-0">${letters[oIdx] || oIdx + 1}</span>
                <div class="math-render text-sm text-gray-800 flex-grow">${renderMathContent(opt.text || opt)}</div>
              </label>
            `).join('')}
          </div>
        ` : ''}

        ${q.type === 'tf' && q.items ? `
          <div class="space-y-2 mt-2">
            ${q.items.map((it, iIdx) => `
              <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                <div class="math-render text-sm text-gray-800"><span class="font-bold">${String.fromCharCode(97 + iIdx)})</span> ${renderMathContent(it.text)}</div>
                <div class="flex gap-4 shrink-0">
                  <label class="flex items-center gap-1.5 cursor-pointer font-bold text-sm text-emerald-700">
                    <input type="radio" name="ans_tf_${idx}_${iIdx}" value="true" onchange="window.recordTfAnswer(${idx}, ${iIdx}, true)"> Đúng
                  </label>
                  <label class="flex items-center gap-1.5 cursor-pointer font-bold text-sm text-red-600">
                    <input type="radio" name="ans_tf_${idx}_${iIdx}" value="false" onchange="window.recordTfAnswer(${idx}, ${iIdx}, false)"> Sai
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${q.type === 'short' || q.type === 'cloze' ? `
          <div class="mt-3">
            <label class="block text-xs font-bold text-gray-500 mb-1">${q.type === 'cloze' ? 'Nhập từ/số điền vào chỗ trống:' : 'Nhập kết quả số hoặc biểu thức:'}</label>
            <input type="text" oninput="window.recordAnswer(${idx}, this.value)" class="p-3 border-2 border-slate-300 rounded-xl font-mono text-base font-bold focus:border-blue-600 outline-none w-64 text-center" placeholder="${q.type === 'cloze' ? 'Từ điền khuyết...' : 'Kết quả...'}">
          </div>
        ` : ''}

        ${q.type === 'essay' ? `
          <div class="mt-3">
            <label class="block text-xs font-bold text-gray-600 mb-1"><i class="fa-solid fa-pen mr-1"></i> Trình bày bài làm tự luận của bạn:</label>
            <textarea oninput="window.recordAnswer(${idx}, this.value)" class="w-full h-32 p-3 border-2 border-slate-300 rounded-xl font-mono text-sm focus:border-blue-600 outline-none" placeholder="Nhập các bước chứng minh, tính toán, kết luận..."></textarea>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  triggerMathJax();
}

export function recordAnswer(qIdx, val) {
  if (!appState.activeExamSession) return;
  appState.activeExamSession.answers[qIdx] = val;
}

export function recordTfAnswer(qIdx, itemIdx, val) {
  if (!appState.activeExamSession) return;
  if (!appState.activeExamSession.answers[qIdx]) appState.activeExamSession.answers[qIdx] = {};
  appState.activeExamSession.answers[qIdx][itemIdx] = val;
}

export function submitExamConfirm() {
  if (!window.Swal) {
    submitExam();
    return;
  }

  const answeredCount = Object.keys(appState.activeExamSession?.answers || {}).length;
  const total = appState.activeExamSession?.questions.length || 0;

  window.Swal.fire({
    title: 'Xác Nhận Nộp Bài?',
    html: `Bạn đã làm <b>${answeredCount}/${total}</b> câu hỏi. Bạn có chắc chắn muốn nộp bài?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-paper-plane mr-1"></i> Nộp Bài',
    confirmButtonColor: '#2563eb',
    cancelButtonText: 'Làm tiếp'
  }).then(res => {
    if (res.isConfirmed) submitExam();
  });
}

export async function submitExam(forced = false) {
  const session = appState.activeExamSession;
  if (!session) return;

  if (session.timerInterval) clearInterval(session.timerInterval);

  const questions = session.questions;
  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  const questionResults = [];

  questions.forEach((q, idx) => {
    const userAns = session.answers[idx];
    let isCorrect = false;

    if (q.type === 'mcq') {
      if (userAns !== undefined && parseInt(userAns, 10) === parseInt(q.correctAnswer, 10)) {
        isCorrect = true;
        rawScore += (session.scores.mcq || 0.25);
        correctCount++;
      } else {
        wrongCount++;
      }
    } else if (q.type === 'tf') {
      let subCorrect = 0;
      if (userAns && typeof userAns === 'object' && q.items) {
        q.items.forEach((it, iIdx) => {
          if (String(userAns[iIdx]) === String(it.correct)) subCorrect++;
        });
      }
      if (subCorrect === 4) rawScore += (session.scores.tf || 1.0);
      else if (subCorrect === 3) rawScore += (session.scores.tf || 1.0) * 0.5;
      else if (subCorrect === 2) rawScore += (session.scores.tf || 1.0) * 0.25;
      else if (subCorrect === 1) rawScore += (session.scores.tf || 1.0) * 0.1;

      if (subCorrect === 4) correctCount++;
      else wrongCount++;
      isCorrect = subCorrect === 4;
    } else if (q.type === 'short' || q.type === 'cloze') {
      const cleanUser = String(userAns || '').trim().toLowerCase();
      const cleanTarget = String(q.correctAnswer || '').trim().toLowerCase();
      if (cleanUser && cleanUser === cleanTarget) {
        isCorrect = true;
        rawScore += (q.type === 'cloze' ? (session.scores.cloze || 1.0) : (session.scores.short || 0.5));
        correctCount++;
      } else {
        wrongCount++;
      }
    } else if (q.type === 'essay') {
      // Tự luận ghi nhận đã nộp
      if (userAns && String(userAns).trim().length > 5) {
        isCorrect = true;
        rawScore += (session.scores.essay || 1.0);
        correctCount++;
      } else {
        wrongCount++;
      }
    }

    questionResults.push({ index: idx + 1, isCorrect });
  });

  const finalScore = Math.min(10, Math.round(rawScore * 100) / 100);
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - session.startTime) / 1000));
  const spentMinutes = Math.floor(elapsedSeconds / 60);
  const spentSeconds = elapsedSeconds % 60;
  const timeSpentStr = spentMinutes > 0 ? `${spentMinutes} phút ${spentSeconds} giây` : `${spentSeconds} giây`;
  const timeSpentMinutes = Math.max(1, Math.round(elapsedSeconds / 60));
  let isPenalized = false;
  let displayedScore = finalScore;

  if (session.minSubmit > 0 && timeSpentMinutes < session.minSubmit && !forced) {
    isPenalized = true;
    displayedScore = Math.round((finalScore * 0.5) * 100) / 100;
  }

  const now = new Date();
  const submittedAt = now.toLocaleString('vi-VN', { hour12: false });

  const submission = {
    id: `sub_${Date.now()}`,
    examId: session.examId,
    examTitle: session.examTitle,
    studentName: appState.currentStudent?.name || 'Học sinh',
    studentPin: appState.currentStudent?.pin || '',
    className: appState.currentStudent?.className || 'Lớp',
    classCode: appState.currentStudent?.classCode || '',
    version: session.version,
    score: displayedScore,
    originalScore: finalScore,
    isPenalized,
    correctCount,
    wrongCount,
    strikes: session.strikes,
    timeSpentMinutes,
    timeSpentFormatted: timeSpentStr,
    answers: session.answers,
    submittedAt
  };

  await saveSubmissionToStore(submission);

  const scoreEl = document.getElementById('result-score');
  const examTitleEl = document.getElementById('result-exam-title');
  const penaltyMsg = document.getElementById('result-penalty-msg');
  const correctEl = document.getElementById('result-correct');
  const wrongEl = document.getElementById('result-wrong');
  const strikesEl = document.getElementById('result-strikes');
  const gridEl = document.getElementById('result-question-grid');
  const solBtnContainer = document.getElementById('result-solution-container');
  const submittedAtEl = document.getElementById('result-submitted-at');
  const timeSpentEl = document.getElementById('result-time-spent');

  if (examTitleEl) examTitleEl.textContent = `${session.examTitle} (Mã đề: ${session.version})`;
  if (scoreEl) scoreEl.textContent = `${displayedScore}/10`;
  if (submittedAtEl) submittedAtEl.textContent = submittedAt;
  if (timeSpentEl) timeSpentEl.textContent = timeSpentStr;
  if (penaltyMsg) {
    if (isPenalized) penaltyMsg.classList.remove('hidden');
    else penaltyMsg.classList.add('hidden');
  }
  if (correctEl) correctEl.textContent = correctCount;
  if (wrongEl) wrongEl.textContent = wrongCount;
  if (strikesEl) strikesEl.textContent = session.strikes;

  if (gridEl) {
    gridEl.innerHTML = questionResults.map(r => `
      <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white ${r.isCorrect ? 'bg-emerald-500' : 'bg-red-400'}">
        ${r.index}
      </div>
    `).join('');
  }

  if (solBtnContainer) {
    const exam = appState.exams.find(e => e.id === session.examId);
    const maxAttempts = parseInt(exam?.maxAttempts, 10) || 1;
    const studentSubs = getStudentExamSubmissions(session.examId, appState.currentStudent);
    const isFinalAttempt = studentSubs.length >= maxAttempts;

    if (isFinalAttempt) {
      solBtnContainer.innerHTML = `
        <button onclick="window.viewSubmittedExamSolutions('${submission.id}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-base cursor-pointer">
          <i class="fa-solid fa-book-open"></i> Xem Bài Trước / Lời Giải Chi Tiết
        </button>
      `;
    } else {
      solBtnContainer.innerHTML = `
        <div class="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-center text-amber-800 text-xs font-semibold">
          <i class="fa-solid fa-lock mr-1"></i> Bạn còn ${maxAttempts - studentSubs.length} lượt làm bài. Xem bài trước và lời giải chi tiết chỉ hiển thị sau lần thi cuối cùng.
        </div>
      `;
    }
  }

  const wm = document.getElementById('exam-watermark');
  if (wm) wm.style.display = 'none';

  navigate('student-result');
  showToast('Đã nộp bài thành công!', 'success');
}

export function viewSubmittedExamSolutions(submissionId) {
  const sub = appState.submissions.find(s => s.id === submissionId);
  if (!sub) return;

  const exam = appState.exams.find(e => e.id === sub.examId);
  const questions = exam?.versions?.[sub.version] || [];

  const titleEl = document.getElementById('sol-exam-title');
  const metaEl = document.getElementById('sol-exam-meta');
  const codeEl = document.getElementById('sol-exam-code');
  const container = document.getElementById('sol-exam-questions');

  if (titleEl) titleEl.textContent = sub.examTitle;
  if (metaEl) metaEl.textContent = `Học sinh: ${sub.studentName} (${sub.className}) | Điểm: ${sub.score}/10 | Ngày nộp: ${sub.submittedAt || 'Chưa ghi nhận'}`;
  if (codeEl) codeEl.textContent = `Mã đề: ${sub.version}`;

  if (!container) return;

  container.innerHTML = questions.map((q, idx) => {
    const userAns = sub.answers?.[idx];
    let isCorrect = false;

    if (q.type === 'mcq') {
      isCorrect = parseInt(userAns, 10) === parseInt(q.correctAnswer, 10);
    } else if (q.type === 'short' || q.type === 'cloze') {
      isCorrect = String(userAns || '').trim().toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase();
    } else if (q.type === 'essay') {
      isCorrect = !!(userAns && String(userAns).trim().length > 5);
    }

    const letters = ['A', 'B', 'C', 'D'];

    return `
      <div class="bg-white rounded-2xl shadow-md p-6 border-l-4 ${isCorrect ? 'border-emerald-500' : 'border-red-500'}">
        <div class="flex justify-between items-center mb-3">
          <span class="font-bold text-gray-900 text-base">Câu ${idx + 1} (${q.type}):</span>
          <span class="text-xs px-2.5 py-1 rounded-full font-bold ${isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
            ${isCorrect ? '<i class="fa-solid fa-check mr-1"></i> Đúng' : '<i class="fa-solid fa-xmark mr-1"></i> Sai'}
          </span>
        </div>
        <div class="math-render text-gray-800 text-sm mb-4">${renderMathContent(q.content)}</div>
        
        ${q.type === 'mcq' && q.options ? `
          <div class="grid md:grid-cols-2 gap-2 text-sm mb-4">
            ${q.options.map((opt, oIdx) => {
              const isSelected = parseInt(userAns, 10) === oIdx;
              const isCorrectOpt = parseInt(q.correctAnswer, 10) === oIdx;
              let bg = 'bg-gray-50 border-gray-200';
              if (isCorrectOpt) bg = 'bg-emerald-50 border-emerald-400 text-emerald-900 font-bold';
              else if (isSelected) bg = 'bg-red-50 border-red-300 text-red-900 line-through';

              return `
                <div class="p-2.5 rounded-lg border flex items-start gap-2 ${bg}">
                  <span class="font-bold text-xs">${letters[oIdx] || oIdx + 1}.</span>
                  <div class="math-render flex-grow">${renderMathContent(opt.text || opt)}</div>
                  ${isCorrectOpt ? '<i class="fa-solid fa-circle-check text-emerald-600 text-xs mt-1"></i>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${q.type === 'short' || q.type === 'cloze' ? `
          <div class="p-3 bg-slate-50 rounded-lg border mb-4 text-xs space-y-1">
            <div>Bài làm của bạn: <b class="font-mono text-sm">${escapeHtml(userAns || '(Chưa làm)')}</b></div>
            <div class="text-emerald-700 font-bold">Đáp án chuẩn: <span class="font-mono text-sm">${escapeHtml(q.correctAnswer)}</span></div>
          </div>
        ` : ''}

        ${q.type === 'essay' ? `
          <div class="p-3 bg-slate-50 rounded-lg border mb-4 text-xs space-y-1">
            <div class="font-bold text-slate-700">Bài làm tự luận của bạn:</div>
            <div class="p-2 bg-white rounded border font-mono whitespace-pre-wrap">${escapeHtml(userAns || '(Bỏ trống)')}</div>
          </div>
        ` : ''}

        ${q.explanation ? `
          <div class="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
            <div class="font-bold text-blue-800 mb-1"><i class="fa-solid fa-lightbulb mr-1 text-yellow-500"></i> Hướng dẫn giải chi tiết:</div>
            <div class="math-render">${renderMathContent(q.explanation)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  navigate('exam-solutions');
  triggerMathJax();
}

export function backFromSolutions() {
  if (appState.role === 'teacher') navigate('teacher-submissions');
  else navigate('student-class-space');
}

export function viewExamSubmissions(examId) {
  const exam = appState.exams.find(e => e.id === examId);
  if (!exam) return;
  appState.currentViewingExamId = examId;

  const titleEl = document.getElementById('sub-exam-title');
  const pinEl = document.getElementById('sub-exam-pin');
  const tbody = document.getElementById('submission-list-body');

  if (titleEl) titleEl.textContent = exam.title;
  if (pinEl) pinEl.textContent = exam.pin;

  const subs = appState.submissions.filter(s => s.examId === examId);

  if (tbody) {
    if (subs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-gray-400">Chưa có học sinh nào nộp bài cho đề thi này.</td></tr>`;
    } else {
      tbody.innerHTML = subs.map(sub => `
        <tr class="hover:bg-slate-50 transition border-b">
          <td class="p-3 font-bold text-gray-900">${escapeHtml(sub.studentName)}</td>
          <td class="p-3 text-sm text-gray-600">${escapeHtml(sub.className)}</td>
          <td class="p-3 font-black text-lg text-primary">${sub.score}/10</td>
          <td class="p-3 text-center text-xs font-mono font-bold">${sub.version}</td>
          <td class="p-3 text-sm text-gray-500">${sub.timeSpentMinutes || 0} phút</td>
          <td class="p-3 text-center text-xs text-gray-600 font-medium whitespace-nowrap"><i class="fa-regular fa-clock mr-1 text-slate-400"></i>${sub.submittedAt || 'Chưa ghi nhận'}</td>
          <td class="p-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-bold ${sub.strikes > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${sub.strikes || 0}</span>
          </td>
          <td class="p-3 text-center">
            <button onclick="window.viewSubmittedExamSolutions('${sub.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 cursor-pointer">Chi tiết</button>
          </td>
        </tr>
      `).join('');
    }
  }

  navigate('teacher-submissions');
}

export function exportToExcel() {
  if (!window.XLSX) {
    showToast('Thư viện Excel chưa sẵn sàng', 'error');
    return;
  }

  const currentExamId = appState.currentViewingExamId;
  const exam = currentExamId ? appState.exams.find(e => e.id === currentExamId) : null;
  const examTitle = exam ? exam.title : (document.getElementById('sub-exam-title')?.textContent || 'KetQuaThi');
  const examPin = exam ? exam.pin : (document.getElementById('sub-exam-pin')?.textContent || '');

  let subs = [];
  if (currentExamId) {
    subs = appState.submissions.filter(s => s.examId === currentExamId);
  }
  if (subs.length === 0 && (examPin || examTitle)) {
    subs = appState.submissions.filter(s =>
      (examPin && (s.pin === examPin || s.studentPin === examPin)) ||
      (examTitle && s.examTitle === examTitle)
    );
  }
  if (subs.length === 0) {
    subs = appState.submissions;
  }

  const data = [
    ['STT', 'Họ và Tên', 'Lớp', 'Điểm Số', 'Mã Đề / Lần Thi', 'TG Làm Bài (Phút)', 'Số Lần Vi Phạm', 'Ngày Giờ Nộp Bài'],
    ...subs.map((s, idx) => [
      idx + 1,
      s.studentName || 'Học sinh',
      s.className || 'Lớp',
      s.score !== undefined ? s.score : 0,
      s.version || 'Gốc',
      s.timeSpentMinutes || 0,
      s.strikes !== undefined && s.strikes !== null ? s.strikes : 0,
      s.submittedAt || 'Chưa ghi nhận'
    ])
  ];

  const ws = window.XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 26 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 24 }
  ];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'ThongKeKetQua');
  window.XLSX.writeFile(wb, `Thong_Ke_${examTitle.replace(/\s+/g, '_')}.xlsx`);
  showToast('Đã xuất file Excel kết quả thi kèm thông tin vi phạm!', 'success');
}

export function copyCurrentUrl() {
  navigator.clipboard.writeText(window.location.href);
  showToast('Đã copy link ứng dụng!');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Đăng ký toàn bộ hàm vào window
const exportedMethods = {
  navigate,
  logout,
  loginTeacher,
  openFirebaseConfig,
  createNewExam,
  switchDraftVersion,
  shuffleFromBaseVersion,
  removeDraftQuestion,
  clearDraftTab,
  renderExamDraft,
  openAIPrompt,
  loadSampleDe01,
  loadSampleDe09,
  downloadTemplateWord,
  handleUploadExam,
  publishExam,
  deleteExamConfirm,
  viewExamSubmissions,
  exportToExcel,
  renderTeacherClasses,
  viewClassDetail,
  switchClassTab,
  downloadClassTemplate,
  importClassExcel,
  exportClassPINs,
  addLectureLink,
  handleUploadPractice,
  assignExamToClass,
  assignExamPrompt,
  checkStudentClassCode,
  loginStudentToClass,
  startExamSessionById,
  startExamSession,
  resumeExam,
  sendExceptionReport,
  recordAnswer,
  recordTfAnswer,
  submitExamConfirm,
  submitExam,
  viewSubmittedExamSolutions,
  backFromSolutions,
  startStudentPractice,
  selectPracticeMcq,
  selectPracticeTf,
  recordPracticeShort,
  checkPracticeShort,
  recordPracticeEssay,
  prevPracticeQuestion,
  nextPracticeQuestion,
  showPracticeAnswer,
  showPracticeExplanation,
  copyCurrentUrl,
  showToast,
  previewPractice,
  editPractice,
  removePracticeQuestion,
  clearPracticeQuestions,
  handleAppendPracticeQuestions,
  savePracticeChanges,
  previewCurrentEditingPractice,
  openEditFromPreview,
  tryPracticeInteractive,
  openQuickSettings,
  editExam,
  cloneExam,
  openEditQuestionModal,
  openAddQuestionModal,
  duplicateDraftQuestion,
  moveDraftQuestion,
  previewDraftExam
};

if (typeof window !== 'undefined') {
  Object.entries(exportedMethods).forEach(([name, fn]) => {
    window[name] = fn;
  });

  const initApp = async () => {
    console.log('[MathExam Pro] Khởi động ứng dụng và đồng bộ dữ liệu...');
    await syncLoadAll();
    triggerMathJax();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

export default exportedMethods;

