# English Zone

English Zone is a responsive educational web app for Mr. Abdulrahman Mohammed. It includes a public landing page, student registration and login, student learning dashboard, teacher administration dashboard, course and exam management, grades, attendance, announcements, and InstaPay payment requests.

## Run locally

```bash
npm start
```

Open `http://localhost:4173`.

## Test access

- Student code: `EZ-1048`
- Student personal login: `maya@example.com` / `maya123`
- Teacher code: `Abdelrahman3177`

English Zone uses an Express API and persistent SQLite storage. Passwords are hashed with bcrypt, sessions use HTTP-only JWT cookies, and role guards protect student and teacher endpoints. Payment proofs are stored under `data/payment-proofs/` and are not publicly served.

## Main API areas

- `/api/auth/*` for student and teacher sessions.
- `/api/students` for validated student registration.
- `/api/courses` for public courses and teacher creation.
- `/api/student/*` for student-only courses and payments.
- `/api/teacher/*` for protected administration actions.

The app is intentionally image-free and uses CSS geometry and interface icons.
