import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith('/') ? process.env.DATA_DIR : join(root, process.env.DATA_DIR))
  : join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new Database(join(dataDir, 'english-zone.sqlite'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL UNIQUE,grade TEXT NOT NULL,parent_phone TEXT NOT NULL,password_hash TEXT NOT NULL,student_code TEXT NOT NULL UNIQUE,account_status TEXT NOT NULL DEFAULT 'Active',payment_status TEXT NOT NULL DEFAULT 'Pending',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY,name TEXT NOT NULL,level TEXT NOT NULL,description TEXT NOT NULL,price REAL NOT NULL,status TEXT NOT NULL DEFAULT 'Active',progress INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments (student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'Active',progress INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(student_id,course_id));
CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',lesson_link TEXT NOT NULL DEFAULT '',lesson_type TEXT NOT NULL DEFAULT 'External Link',position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT NOT NULL,exam_date TEXT NOT NULL,duration TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Available');
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id),amount REAL NOT NULL,transaction_ref TEXT NOT NULL,sender_phone TEXT NOT NULL,payment_date TEXT NOT NULL,proof_path TEXT,status TEXT NOT NULL DEFAULT 'Pending',rejection_reason TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grades (id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id),assessment TEXT NOT NULL,score REAL NOT NULL,total REAL NOT NULL DEFAULT 100,comment TEXT NOT NULL DEFAULT '',grade_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id),attendance_date TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY,title TEXT NOT NULL,audience TEXT NOT NULL,body TEXT NOT NULL,announcement_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exam_questions (id TEXT PRIMARY KEY,exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,prompt TEXT NOT NULL,options_json TEXT NOT NULL DEFAULT '[]',correct_answer TEXT NOT NULL,points REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS exam_submissions (id TEXT PRIMARY KEY,exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,answers_json TEXT NOT NULL,score REAL NOT NULL DEFAULT 0,submitted_at TEXT NOT NULL,UNIQUE(exam_id,student_id));
`);
const lessonColumns = db.prepare('PRAGMA table_info(lessons)').all().map(column => column.name);
if (!lessonColumns.includes('lesson_link')) db.exec("ALTER TABLE lessons ADD COLUMN lesson_link TEXT NOT NULL DEFAULT ''");
if (!lessonColumns.includes('lesson_type')) db.exec("ALTER TABLE lessons ADD COLUMN lesson_type TEXT NOT NULL DEFAULT 'External Link'");

const now = () => new Date().toISOString().slice(0, 10);
const id = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
if (!db.prepare('SELECT id FROM courses LIMIT 1').get()) {
  const insert = db.prepare('INSERT INTO courses (id,name,level,description,price,status,progress,created_at) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('c1','English Foundations','Secondary 2','Build strong grammar, vocabulary, and everyday communication skills.',650,'Active',72,now());
  insert.run('c2','Academic Writing Lab','Secondary 3','Write clearly, organize ideas, and prepare for school examinations.',750,'Active',38,now());
  insert.run('c3','Conversation Club','All levels','Practice confident speaking through friendly weekly challenges.',450,'Active',0,now());
}
if (!db.prepare('SELECT id FROM students LIMIT 1').get()) {
  db.prepare('INSERT INTO students (id,name,phone,email,grade,parent_phone,password_hash,student_code,account_status,payment_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('s1','Maya Hassan','01000000000','maya@example.com','Secondary 2','01011111111',bcrypt.hashSync('maya123',12),'EZ-1048','Active','Approved',now());
  db.prepare('INSERT INTO enrollments (student_id,course_id,status,progress) VALUES (?,?,?,?)').run('s1','c1','Active',72);
}

export { db, bcrypt, id, now };
