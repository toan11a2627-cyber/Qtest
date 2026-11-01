import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Thư mục lưu trữ database tập trung
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Khởi tạo thư mục và database ban đầu nếu chưa có
function getInitialDb() {
  return {
    exams: [],
    classes: [
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
    ],
    submissions: [],
    reports: [],
    lastUpdated: new Date().toISOString()
  };
}

function readDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = getInitialDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Server DB] Lỗi đọc db.json:', err);
    return getInitialDb();
  }
}

function writeDb(data: any) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Server DB] Lỗi ghi db.json:', err);
    return false;
  }
}

// ==========================================
// API ROUTES CHO ĐỒNG BỘ DỮ LIỆU TẬP TRUNG
// ==========================================

// 1. Lấy toàn bộ dữ liệu hiện tại
app.get('/api/sync', (req, res) => {
  const db = readDb();
  res.json({ success: true, data: db });
});

// 2. Đồng bộ / Merge toàn bộ từ client (khi giáo viên mở laptop có sẵn dữ liệu)
app.post('/api/sync', (req, res) => {
  const db = readDb();
  const { exams, classes, submissions, reports, forceUpload } = req.body;

  if (Array.isArray(exams) && exams.length > 0) {
    // Merge exams theo id
    exams.forEach((ex: any) => {
      const idx = db.exams.findIndex((e: any) => e.id === ex.id);
      if (idx >= 0) db.exams[idx] = ex;
      else db.exams.unshift(ex);
    });
  }

  if (Array.isArray(classes) && classes.length > 0) {
    // Merge classes theo id hoặc code
    classes.forEach((cl: any) => {
      const idx = db.classes.findIndex((c: any) => c.id === cl.id || c.code === cl.code);
      if (idx >= 0) db.classes[idx] = cl;
      else db.classes.unshift(cl);
    });
  }

  if (Array.isArray(submissions) && submissions.length > 0) {
    submissions.forEach((sub: any) => {
      const idx = db.submissions.findIndex((s: any) => s.id === sub.id);
      if (idx >= 0) db.submissions[idx] = sub;
      else db.submissions.unshift(sub);
    });
  }

  if (Array.isArray(reports) && reports.length > 0) {
    reports.forEach((rep: any) => {
      const idx = db.reports.findIndex((r: any) => r.id === rep.id);
      if (idx >= 0) db.reports[idx] = rep;
      else db.reports.unshift(rep);
    });
  }

  writeDb(db);
  res.json({ success: true, data: db });
});

// 3. Quản lý đề thi (Exams)
app.post('/api/exams', (req, res) => {
  const exam = req.body;
  if (!exam || !exam.id) {
    return res.status(400).json({ success: false, message: 'Thiếu thông tin exam' });
  }
  const db = readDb();
  const idx = db.exams.findIndex((e: any) => e.id === exam.id);
  if (idx >= 0) db.exams[idx] = exam;
  else db.exams.unshift(exam);
  writeDb(db);
  res.json({ success: true, exam });
});

app.delete('/api/exams/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.exams = db.exams.filter((e: any) => e.id !== id);
  // Cập nhật lại các lớp có gán đề thi này
  db.classes.forEach((c: any) => {
    if (Array.isArray(c.assignedExams)) {
      c.assignedExams = c.assignedExams.filter((eid: string) => eid !== id);
    }
  });
  writeDb(db);
  res.json({ success: true, id });
});

// 4. Quản lý lớp học (Classes)
app.post('/api/classes', (req, res) => {
  const cls = req.body;
  if (!cls || (!cls.id && !cls.code)) {
    return res.status(400).json({ success: false, message: 'Thiếu thông tin lớp học' });
  }
  const db = readDb();
  const idx = db.classes.findIndex((c: any) => c.id === cls.id || c.code === cls.code);
  if (idx >= 0) db.classes[idx] = cls;
  else db.classes.unshift(cls);
  writeDb(db);
  res.json({ success: true, class: cls });
});

app.delete('/api/classes/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.classes = db.classes.filter((c: any) => c.id !== id && c.code !== id);
  writeDb(db);
  res.json({ success: true, id });
});

// 5. Quản lý bài nộp (Submissions)
app.post('/api/submissions', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.id) {
    return res.status(400).json({ success: false, message: 'Thiếu thông tin bài nộp' });
  }
  const db = readDb();
  db.submissions.unshift(sub);
  writeDb(db);
  res.json({ success: true, submission: sub });
});

// 6. Quản lý báo cáo bất thường (Reports)
app.post('/api/reports', (req, res) => {
  const rep = req.body;
  const db = readDb();
  db.reports.unshift(rep);
  writeDb(db);
  res.json({ success: true, report: rep });
});

// 7. Trang công cụ Firebase Ghi Dữ Liệu
app.get(['/firebase', '/firebase.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, 'firebase.html'));
});

// ==========================================
// MOUNT VITE MIDDLEWARE (DEV) / STATIC (PROD)
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MathExam Pro Server] Server is running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
