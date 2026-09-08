import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, bcrypt, id, now } from './db.js';

const root = dirname(fileURLToPath(import.meta.url));
const app = express();
const proofDir = join(root, 'data', 'payment-proofs');
mkdirSync(proofDir, { recursive: true });
const upload = multer({ dest: proofDir, limits: { fileSize: 5 * 1024 * 1024 } });
const JWT_SECRET = process.env.JWT_SECRET || 'english-zone-development-secret-change-me';
const TEACHER_CODE = process.env.TEACHER_CODE || 'Abdelrahman3177';
const INSTA_PAY = '01014812293';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const sign = payload => jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
const setSession = (res, payload) => res.cookie('ez_session', sign(payload), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 });
const auth = (req, res, next) => { try { req.user = jwt.verify(req.cookies.ez_session || '', JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Authentication required.' }); } };
const teacherOnly = (req, res, next) => req.user?.role === 'teacher' ? next() : res.status(403).json({ error: 'Teacher access required.' });
const studentOnly = (req, res, next) => req.user?.role === 'student' ? next() : res.status(403).json({ error: 'Student access required.' });
const studentHasCourseAccess = (studentId, courseId) => {
	const course = db.prepare('SELECT price FROM courses WHERE id=?').get(courseId);
	if (!course) return false;
	if (Number(course.price) === 0) return true;
	return Boolean(db.prepare("SELECT 1 FROM payments WHERE student_id=? AND course_id=? AND status='Approved' LIMIT 1").get(studentId, courseId));
};
const courseAccess = (req, res, next) => studentHasCourseAccess(req.user.id, req.courseId) ? next() : res.status(402).json({ error: 'Teacher approval is required for this paid course.' });
const studentView = s => ({ id:s.id,name:s.name,phone:s.phone,email:s.email,grade:s.grade,parentPhone:s.parent_phone,code:s.student_code,status:s.account_status,payment:s.payment_status,joined:s.created_at });
const courseView = c => ({ id:c.id,name:c.name,level:c.level,description:c.description,price:c.price,status:c.status,progress:c.progress,students:db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id=?').get(c.id).count });

app.post('/api/auth/student-code', (req,res) => { const s=db.prepare("SELECT * FROM students WHERE lower(student_code)=lower(?) AND account_status='Active'").get(req.body.code?.trim()); if(!s)return res.status(401).json({error:'We could not find an active student with that code.'}); setSession(res,{role:'student',id:s.id}); res.json({student:studentView(s)}); });
app.post('/api/auth/student-data', async (req,res) => { const s=db.prepare('SELECT * FROM students WHERE lower(email)=lower(?)').get(req.body.email?.trim()); if(!s || !(await bcrypt.compare(req.body.password || '',s.password_hash)))return res.status(401).json({error:'Email or password is incorrect.'}); setSession(res,{role:'student',id:s.id}); res.json({student:studentView(s)}); });
app.post('/api/auth/teacher', (req,res) => { if(req.body.code!==TEACHER_CODE)return res.status(401).json({error:'That teacher code is not valid.'}); setSession(res,{role:'teacher'}); res.json({teacher:{name:'Mr. Abdulrahman Mohammed'}}); });
app.post('/api/auth/logout', (req,res) => { res.clearCookie('ez_session'); res.json({ok:true}); });
app.get('/api/auth/me', auth, (req,res) => { if(req.user.role==='teacher')return res.json({role:'teacher',teacher:{name:'Mr. Abdulrahman Mohammed'}}); res.json({role:'student',student:studentView(db.prepare('SELECT * FROM students WHERE id=?').get(req.user.id))}); });

app.post('/api/students', async (req,res) => { const {name,phone,email,grade,parentPhone,password,course}=req.body; if(!name||!phone||!email||!grade||!parentPhone||!password||password.length<6)return res.status(400).json({error:'Please complete every required field.'}); try { const student={id:id('student'),code:`EZ-${Math.floor(1000+Math.random()*8999)}`}; db.prepare('INSERT INTO students (id,name,phone,email,grade,parent_phone,password_hash,student_code,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(student.id,name,phone,email,grade,parentPhone,await bcrypt.hash(password,12),student.code,now()); const c=db.prepare('SELECT id FROM courses WHERE name=?').get(course)||db.prepare('SELECT id FROM courses LIMIT 1').get(); db.prepare('INSERT INTO enrollments (student_id,course_id) VALUES (?,?)').run(student.id,c.id); const saved=db.prepare('SELECT * FROM students WHERE id=?').get(student.id); setSession(res,{role:'student',id:student.id}); res.status(201).json({student:studentView(saved)}); } catch(error) { res.status(409).json({error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'An account with this email already exists.':'Could not create the account.'}); } });

app.get('/api/courses', (req,res) => res.json({courses:db.prepare('SELECT * FROM courses ORDER BY created_at').all().map(courseView)}));
app.get('/api/student/courses', auth, studentOnly, (req,res) => res.json({courses:db.prepare('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.student_id=?').all(req.user.id).map(courseView)}));
app.get('/api/student/exams', auth, studentOnly, (req,res) => res.json({exams:db.prepare(`SELECT e.*,c.name AS course FROM exams e JOIN courses c ON c.id=e.course_id JOIN enrollments en ON en.course_id=e.course_id WHERE en.student_id=? AND (c.price=0 OR EXISTS (SELECT 1 FROM payments p WHERE p.student_id=? AND p.course_id=c.id AND p.status='Approved')) ORDER BY e.exam_date`).all(req.user.id, req.user.id)}));
app.post('/api/student/exams/:id/submit', auth, studentOnly, (req,res) => { const exam=db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id); if(!exam)return res.status(404).json({error:'Exam not found.'}); if(!studentHasCourseAccess(req.user.id, exam.course_id))return res.status(402).json({error:'Teacher approval is required for this paid course.'}); const questions=db.prepare('SELECT * FROM exam_questions WHERE exam_id=?').all(exam.id); const answers=req.body.answers||{}; const incorrect=questions.filter(q=>answers[q.id]!==q.correct_answer).map(q=>({prompt:q.prompt,selected:answers[q.id] ?? null,correctAnswer:q.correct_answer,correctText:JSON.parse(q.options_json)[Number(q.correct_answer)]})); const score=questions.reduce((total,q)=>total+(answers[q.id]===q.correct_answer?q.points:0),0); db.prepare('INSERT INTO exam_submissions (id,exam_id,student_id,answers_json,score,submitted_at) VALUES (?,?,?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET answers_json=excluded.answers_json,score=excluded.score,submitted_at=excluded.submitted_at').run(id('submission'),exam.id,req.user.id,JSON.stringify(answers),score,new Date().toISOString()); res.json({score,total:questions.reduce((total,q)=>total+q.points,0),incorrect,status:'Submitted'}); });
app.get('/api/student/exams/:id', auth, studentOnly, (req,res) => { const exam=db.prepare('SELECT e.*,c.name AS course FROM exams e JOIN courses c ON c.id=e.course_id JOIN enrollments en ON en.course_id=e.course_id WHERE e.id=? AND en.student_id=?').get(req.params.id,req.user.id); if(!exam)return res.status(404).json({error:'Exam not found or not available.'}); if(!studentHasCourseAccess(req.user.id, exam.course_id))return res.status(402).json({error:'Teacher approval is required for this paid course.'}); const questions=db.prepare('SELECT id,prompt,options_json AS options,points FROM exam_questions WHERE exam_id=? ORDER BY rowid').all(exam.id).map(q=>({...q,options:JSON.parse(q.options)})); const submission=db.prepare('SELECT score,submitted_at FROM exam_submissions WHERE exam_id=? AND student_id=?').get(exam.id,req.user.id); res.json({exam,questions,submission}); });
app.patch('/api/student/profile', auth, studentOnly, (req,res) => { const {name,phone,email,grade,parentPhone}=req.body; if(!name||!phone||!email||!grade||!parentPhone)return res.status(400).json({error:'Profile fields are required.'}); try { db.prepare('UPDATE students SET name=?,phone=?,email=?,grade=?,parent_phone=? WHERE id=?').run(name,phone,email,grade,parentPhone,req.user.id); res.json({student:studentView(db.prepare('SELECT * FROM students WHERE id=?').get(req.user.id))}); } catch(error) { res.status(409).json({error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'Email is already in use.':'Could not update profile.'}); } });
app.post('/api/courses', auth, teacherOnly, (req,res) => { const {name,level,description,price}=req.body; if(!name||!level||!description||!Number.isFinite(Number(price)))return res.status(400).json({error:'Course fields are required.'}); const course={id:id('course')}; db.prepare('INSERT INTO courses (id,name,level,description,price,created_at) VALUES (?,?,?,?,?,?)').run(course.id,name,level,description,Number(price),now()); res.status(201).json({course:courseView(db.prepare('SELECT * FROM courses WHERE id=?').get(course.id))}); });
app.post('/api/student/payments', auth, studentOnly, upload.single('proof'), (req,res) => { const c=db.prepare('SELECT * FROM courses WHERE id=? OR name=?').get(req.body.course,req.body.course); if(!c)return res.status(404).json({error:'Course not found.'}); db.prepare('INSERT OR IGNORE INTO enrollments (student_id,course_id,status,progress) VALUES (?,?,?,?)').run(req.user.id,c.id,'Active',0); db.prepare('INSERT INTO payments (id,student_id,course_id,amount,transaction_ref,sender_phone,payment_date,proof_path,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id('payment'),req.user.id,c.id,c.price,req.body.transaction,req.body.sender,req.body.date,req.file?.path||null,now()); db.prepare("UPDATE students SET payment_status='Pending' WHERE id=?").run(req.user.id); res.status(201).json({message:'Your payment request has been submitted and will be reviewed by the teacher.',status:'Pending',course:c.name,amount:c.price,instaPay:INSTA_PAY}); });
app.get('/api/student/payments', auth, studentOnly, (req,res) => res.json({payments:db.prepare('SELECT p.*,c.name AS course FROM payments p JOIN courses c ON c.id=p.course_id WHERE p.student_id=? ORDER BY p.created_at DESC').all(req.user.id)}));

app.get('/api/teacher/students', auth, teacherOnly, (req,res) => res.json({students:db.prepare('SELECT * FROM students ORDER BY created_at DESC').all().map(studentView)}));
app.delete('/api/teacher/students/:id', auth, teacherOnly, (req,res) => {
	const student = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
	if (!student) return res.status(404).json({ error: 'Student not found.' });
	try {
		db.transaction(() => {
			db.prepare('DELETE FROM exam_submissions WHERE student_id=?').run(req.params.id);
			db.prepare('DELETE FROM attendance WHERE student_id=?').run(req.params.id);
			db.prepare('DELETE FROM grades WHERE student_id=?').run(req.params.id);
			db.prepare('DELETE FROM payments WHERE student_id=?').run(req.params.id);
			db.prepare('DELETE FROM enrollments WHERE student_id=?').run(req.params.id);
			db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
		})();
		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ error: 'Could not delete student.' });
	}
});
app.post('/api/teacher/students', auth, teacherOnly, async (req,res) => { const {name,phone,email,parentPhone,password,grade='Not specified',course}=req.body; if(!name||!phone||!email||!parentPhone)return res.status(400).json({error:'Please complete every required student field.'}); try { const student={id:id('student'),code:`EZ-${Math.floor(1000+Math.random()*8999)}`}; const generatedPassword=password||`${student.code}-welcome`; db.prepare('INSERT INTO students (id,name,phone,email,grade,parent_phone,password_hash,student_code,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(student.id,name,phone,email,grade,parentPhone,await bcrypt.hash(generatedPassword,12),student.code,now()); const selected=course?db.prepare('SELECT id FROM courses WHERE name=? OR id=?').get(course,course):null; if(selected)db.prepare('INSERT INTO enrollments (student_id,course_id) VALUES (?,?)').run(student.id,selected.id); res.status(201).json({student:studentView(db.prepare('SELECT * FROM students WHERE id=?').get(student.id)),generatedPassword:password?undefined:generatedPassword}); } catch(error) { res.status(409).json({error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'An account with this email already exists.':'Could not create the student.'}); } });
app.get('/api/teacher/courses', auth, teacherOnly, (req,res) => res.json({courses:db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all().map(courseView)}));
app.delete('/api/teacher/courses/:id', auth, teacherOnly, (req,res) => {
	const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
	if (!course) return res.status(404).json({ error: 'Course not found.' });
	try {
		db.transaction(() => {
			db.prepare('DELETE FROM exam_submissions WHERE exam_id IN (SELECT id FROM exams WHERE course_id=?)').run(req.params.id);
			db.prepare('DELETE FROM exam_questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id=?)').run(req.params.id);
			db.prepare('DELETE FROM exams WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM lessons WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM payments WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM grades WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM attendance WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM enrollments WHERE course_id=?').run(req.params.id);
			db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id);
		})();
		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ error: 'Could not delete course.' });
	}
});
app.get('/api/teacher/exams', auth, teacherOnly, (req,res) => res.json({exams:db.prepare('SELECT e.id,e.title,e.exam_date AS date,e.duration,e.status,c.name AS course,c.id AS course_id FROM exams e JOIN courses c ON c.id=e.course_id ORDER BY e.exam_date').all()}));
app.get('/api/teacher/payments', auth, teacherOnly, (req,res) => res.json({payments:db.prepare('SELECT p.*,p.student_id,s.name AS student,c.name AS course FROM payments p JOIN students s ON s.id=p.student_id JOIN courses c ON c.id=p.course_id ORDER BY p.created_at DESC').all()}));
app.patch('/api/teacher/payments/:id', auth, teacherOnly, (req,res) => { const p=db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id); if(!p)return res.status(404).json({error:'Payment not found.'}); if(!['Approved','Rejected'].includes(req.body.status))return res.status(400).json({error:'Invalid payment status.'}); db.prepare('UPDATE payments SET status=?,rejection_reason=? WHERE id=?').run(req.body.status,req.body.reason||null,p.id); db.prepare('UPDATE students SET payment_status=? WHERE id=?').run(req.body.status,p.student_id); res.json({ok:true}); });
app.post('/api/teacher/exams', auth, teacherOnly, (req,res) => { const c=db.prepare('SELECT id FROM courses WHERE id=? OR name=?').get(req.body.courseId,req.body.courseId); if(!c)return res.status(404).json({error:'Course not found.'}); const exam={id:id('exam')}; db.prepare('INSERT INTO exams (id,course_id,title,exam_date,duration) VALUES (?,?,?,?,?)').run(exam.id,c.id,req.body.title,req.body.date,req.body.duration); res.status(201).json({ok:true,id:exam.id}); });
app.patch('/api/teacher/exams/:id', auth, teacherOnly, (req,res) => { const exam=db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id); const c=db.prepare('SELECT id FROM courses WHERE id=? OR name=?').get(req.body.courseId,req.body.courseId); if(!exam||!c)return res.status(404).json({error:'Exam or course not found.'}); if(!req.body.title||!req.body.date||!Number(req.body.duration)||Number(req.body.duration)<1)return res.status(400).json({error:'Title, date, and a valid duration are required.'}); db.prepare('UPDATE exams SET course_id=?,title=?,exam_date=?,duration=? WHERE id=?').run(c.id,req.body.title,req.body.date,req.body.duration,exam.id); res.json({ok:true}); });
app.post('/api/teacher/exams/:id/questions', auth, teacherOnly, (req,res) => { const exam=db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id); const count=db.prepare('SELECT COUNT(*) AS count FROM exam_questions WHERE exam_id=?').get(req.params.id).count; if(!exam)return res.status(404).json({error:'Exam not found.'}); if(count>=100)return res.status(400).json({error:'An exam can contain up to 100 questions.'}); if(!req.body.prompt||!Array.isArray(req.body.options)||req.body.options.length!==4)return res.status(400).json({error:'Four answer choices are required.'}); db.prepare('INSERT INTO exam_questions (id,exam_id,prompt,options_json,correct_answer,points) VALUES (?,?,?,?,?,?)').run(id('question'),exam.id,req.body.prompt,JSON.stringify(req.body.options),req.body.correctAnswer,Number(req.body.points||1)); res.status(201).json({ok:true}); });
app.get('/api/teacher/exams/:id/questions', auth, teacherOnly, (req,res) => { const exam=db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id); if(!exam)return res.status(404).json({error:'Exam not found.'}); res.json({questions:db.prepare('SELECT id,prompt,options_json AS options,correct_answer AS correctAnswer,points FROM exam_questions WHERE exam_id=? ORDER BY rowid').all(exam.id).map(q=>({...q,options:JSON.parse(q.options)}))}); });
app.patch('/api/teacher/exam-questions/:id', auth, teacherOnly, (req,res) => { const q=db.prepare('SELECT id FROM exam_questions WHERE id=?').get(req.params.id); if(!q)return res.status(404).json({error:'Question not found.'}); db.prepare('UPDATE exam_questions SET prompt=?,options_json=?,correct_answer=?,points=? WHERE id=?').run(req.body.prompt,JSON.stringify(req.body.options||[]),req.body.correctAnswer,Number(req.body.points||1),q.id); res.json({ok:true}); });
app.delete('/api/teacher/exam-questions/:id', auth, teacherOnly, (req,res) => { const result=db.prepare('DELETE FROM exam_questions WHERE id=?').run(req.params.id); if(!result.changes)return res.status(404).json({error:'Question not found.'}); res.json({ok:true}); });
const validLessonTypes = new Set(['Video','PDF','External Link']);
const lessonPayload = body => ({ title:body.title?.trim(), description:(body.description ?? body.content ?? '').trim(), link:body.link?.trim(), type:body.type || 'External Link', order:Number(body.order ?? body.position ?? 0) });
const validLesson = lesson => lesson.title && lesson.link && validLessonTypes.has(lesson.type) && Number.isInteger(lesson.order) && lesson.order >= 0 && /^https?:\/\/\S+$/i.test(lesson.link);
app.post('/api/teacher/lessons', auth, teacherOnly, (req,res) => { const c=db.prepare('SELECT id FROM courses WHERE id=? OR name=?').get(req.body.courseId,req.body.courseId); const lesson=lessonPayload(req.body); if(!c)return res.status(404).json({error:'Course not found.'}); if(!validLesson(lesson))return res.status(400).json({error:'Lesson title, valid HTTP link, type, and order are required.'}); const saved={id:id('lesson')}; db.prepare('INSERT INTO lessons (id,course_id,title,content,lesson_link,lesson_type,position) VALUES (?,?,?,?,?,?,?)').run(saved.id,c.id,lesson.title,lesson.description,lesson.link,lesson.type,lesson.order); res.status(201).json({lesson:db.prepare('SELECT id,title,content AS description,lesson_link AS link,lesson_type AS type,position AS "order" FROM lessons WHERE id=?').get(saved.id)}); });
app.get('/api/courses/:id/lessons', auth, (req,res) => { if (req.user.role === 'student') { if (!db.prepare("SELECT payment_status FROM students WHERE id=? AND payment_status='Approved'").get(req.user.id)) return res.status(402).json({error:'Your payment must be approved before accessing lessons.'}); if (!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND course_id=?').get(req.user.id,req.params.id)) return res.status(403).json({error:'You are not enrolled in this course.'}); } res.json({lessons:db.prepare('SELECT id,title,content AS description,lesson_link AS link,lesson_type AS type,position AS "order" FROM lessons WHERE course_id=? ORDER BY position,id').all(req.params.id)}); });
app.patch('/api/teacher/lessons/:id', auth, teacherOnly, (req,res) => { const existing=db.prepare('SELECT * FROM lessons WHERE id=?').get(req.params.id); const lesson=lessonPayload({...existing,...req.body}); if(!existing)return res.status(404).json({error:'Lesson not found.'}); if(!validLesson(lesson))return res.status(400).json({error:'Lesson title, valid HTTP link, type, and order are required.'}); db.prepare('UPDATE lessons SET title=?,content=?,lesson_link=?,lesson_type=?,position=? WHERE id=?').run(lesson.title,lesson.description,lesson.link,lesson.type,lesson.order,existing.id); res.json({lesson:db.prepare('SELECT id,title,content AS description,lesson_link AS link,lesson_type AS type,position AS "order" FROM lessons WHERE id=?').get(existing.id)}); });
app.delete('/api/teacher/lessons/:id', auth, teacherOnly, (req,res) => { const result=db.prepare('DELETE FROM lessons WHERE id=?').run(req.params.id); if(!result.changes)return res.status(404).json({error:'Lesson not found.'}); res.json({ok:true}); });
app.post('/api/teacher/grades', auth, teacherOnly, (req,res) => { const s=db.prepare('SELECT id FROM students WHERE student_code=?').get(req.body.code); const c=db.prepare('SELECT id FROM courses WHERE id=? OR name=?').get(req.body.courseId,req.body.courseId); if(!s)return res.status(404).json({error:'Student code was not found.'}); if(!c)return res.status(404).json({error:'Course not found.'}); db.prepare('INSERT INTO grades (id,student_id,course_id,assessment,score,total,comment,grade_date) VALUES (?,?,?,?,?,?,?,?)').run(id('grade'),s.id,c.id,req.body.assessment,Number(req.body.score),Number(req.body.total||100),req.body.comment||'',now()); res.status(201).json({ok:true}); });
app.post('/api/teacher/attendance', auth, teacherOnly, (req,res) => { const s=db.prepare('SELECT id FROM students WHERE student_code=?').get(req.body.code); const c=db.prepare('SELECT id FROM courses WHERE id=? OR name=?').get(req.body.courseId,req.body.courseId); if(!s)return res.status(404).json({error:'Student code was not found.'}); if(!c)return res.status(404).json({error:'Course not found.'}); db.prepare('INSERT INTO attendance (id,student_id,course_id,attendance_date,status,note) VALUES (?,?,?,?,?,?)').run(id('attendance'),s.id,c.id,req.body.date,req.body.status,req.body.note||''); res.status(201).json({ok:true}); });
app.post('/api/teacher/announcements', auth, teacherOnly, (req,res) => { db.prepare('INSERT INTO announcements (id,title,audience,body,announcement_date) VALUES (?,?,?,?,?)').run(id('announcement'),req.body.title,req.body.audience,req.body.body,req.body.date||now()); res.status(201).json({ok:true}); });
app.delete('/api/teacher/announcements/:id', auth, teacherOnly, (req,res) => {
	const result = db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
	if (!result.changes) return res.status(404).json({ error: 'Announcement not found.' });
	res.json({ ok: true });
});

app.get('/', (req,res) => res.sendFile(join(root,'index.html')));
app.get('/index.html', (req,res) => res.sendFile(join(root,'index.html')));
app.get('/app.js', (req,res) => res.type('application/javascript').sendFile(join(root,'app.js')));
app.get('/styles.css', (req,res) => res.type('text/css').sendFile(join(root,'styles.css')));
app.use((req,res,next) => req.path.startsWith('/api/') ? next() : res.status(404).json({ error: 'Not found.' }));
app.use((error,req,res,next) => { console.error(error); res.status(500).json({error:'Unexpected server error.'}); });
app.listen(process.env.PORT||4173, () => console.log(`English Zone running at http://localhost:${process.env.PORT||4173}`));