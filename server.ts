import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File lưu trữ dữ liệu đồng bộ
const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

interface StoreData {
  exams: any[];
  classes: any[];
  submissions: any[];
  reports: any[];
}

const initialData: StoreData = {
  exams: [],
  classes: [
    {
      id: 'class_12a1',
      name: 'Toán 12A1 - Chuyên Đề TN THPT',
      code: 'C12A1',
      updatedAt: 'Hôm nay',
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
  reports: []
};

let store: StoreData = initialData;

if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    store = JSON.parse(raw);
    if (!store.classes || store.classes.length === 0) {
      store.classes = initialData.classes;
    }
  } catch (e) {
    console.warn('[Server] Lỗi đọc file data/store.json, khởi tạo mặc định:', e);
  }
} else {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (_) {}
}

function persistStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn('[Server] Lỗi lưu data/store.json:', e);
  }
}

// ==========================================
// API ROUTES
// ==========================================

// 0. Kiểm tra kết nối nhanh (Health / Connectivity Check)
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});
app.head('/api/ping', (req, res) => {
  res.status(200).end();
});

// 1. Đồng bộ toàn bộ dữ liệu
app.get('/api/sync', (req, res) => {
  res.json({ success: true, data: store });
});

app.post('/api/sync', (req, res) => {
  const { exams, classes, submissions, reports } = req.body || {};

  if (Array.isArray(exams)) {
    exams.forEach(ex => {
      const idx = store.exams.findIndex((e: any) => e.id === ex.id);
      if (idx >= 0) store.exams[idx] = ex;
      else store.exams.unshift(ex);
    });
  }

  if (Array.isArray(classes)) {
    classes.forEach(cls => {
      const idx = store.classes.findIndex((c: any) => c.id === cls.id || c.code === cls.code);
      if (idx >= 0) store.classes[idx] = cls;
      else store.classes.unshift(cls);
    });
  }

  if (Array.isArray(submissions)) {
    submissions.forEach(sub => {
      if (!store.submissions.some((s: any) => s.id === sub.id)) {
        store.submissions.unshift(sub);
      }
    });
  }

  if (Array.isArray(reports)) {
    reports.forEach(rep => {
      if (!store.reports.some((r: any) => r.id === rep.id)) {
        store.reports.unshift(rep);
      }
    });
  }

  persistStore();
  res.json({ success: true, data: store });
});

// 2. Quản lý Đề thi
app.get('/api/exams', (req, res) => {
  res.json({ success: true, exams: store.exams });
});

app.post('/api/exams', (req, res) => {
  const exam = req.body;
  if (!exam || !exam.id) {
    res.status(400).json({ error: 'Missing exam id' });
    return;
  }
  const idx = store.exams.findIndex((e: any) => e.id === exam.id);
  if (idx >= 0) {
    store.exams[idx] = exam;
  } else {
    store.exams.unshift(exam);
  }
  persistStore();
  res.json({ success: true, exam });
});

app.delete('/api/exams/:id', (req, res) => {
  const id = req.params.id;
  store.exams = store.exams.filter((e: any) => e.id !== id);
  persistStore();
  res.json({ success: true });
});

// 3. Quản lý Lớp học
app.get('/api/classes', (req, res) => {
  res.json({ success: true, classes: store.classes });
});

app.post('/api/classes', (req, res) => {
  const cls = req.body;
  if (!cls || (!cls.id && !cls.code)) {
    res.status(400).json({ error: 'Missing class id or code' });
    return;
  }
  const idx = store.classes.findIndex((c: any) => c.id === cls.id || c.code === cls.code);
  if (idx >= 0) {
    store.classes[idx] = cls;
  } else {
    store.classes.unshift(cls);
  }
  persistStore();
  res.json({ success: true, class: cls });
});

app.delete('/api/classes/:id', (req, res) => {
  const id = req.params.id;
  store.classes = store.classes.filter((c: any) => c.id !== id && c.code !== id);
  persistStore();
  res.json({ success: true });
});

// 4. Bài nộp & Báo cáo
app.get('/api/submissions', (req, res) => {
  res.json({ success: true, submissions: store.submissions });
});

app.post('/api/submissions', (req, res) => {
  const sub = req.body;
  if (sub && sub.id) {
    store.submissions.unshift(sub);
    persistStore();
  }
  res.json({ success: true, submission: sub });
});

app.get('/api/reports', (req, res) => {
  res.json({ success: true, reports: store.reports });
});

app.post('/api/reports', (req, res) => {
  const rep = req.body;
  if (rep) {
    store.reports.unshift(rep);
    persistStore();
  }
  res.json({ success: true, report: rep });
});

// 5. Phục vụ tài liệu đề thi mẫu nếu cần
app.get('/assets/aistudio/de_01_ee035459.tex', (req, res) => {
  const samplePath = path.resolve(__dirname, 'public/assets/aistudio/de_01_ee035459.tex');
  if (fs.existsSync(samplePath)) {
    res.sendFile(samplePath);
  } else {
    res.status(404).send('Not found');
  }
});

// ==========================================
// VITE DEV SERVER / PRODUCTION STATIC
// ==========================================
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MathExam Pro Server] Đang chạy tại http://localhost:${PORT}`);
  });
}

startServer();
