# Online OJT Monitoring & DTR

Phase 1 frontend foundation using Vue 3, JavaScript, the Options API, Vite, Tailwind CSS, and Vue Router.

## Run locally

Use Node.js 24 LTS (or a version supported by Vite).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The login placeholder links to both workspace previews; no credentials are needed.

```sh
npm run build
npm run preview
```

The build writes to `dist/`. Preview serves that production build locally. If the default npm cache is not writable, add `--cache .npm-cache` to the install command.

## Structure

```text
src/
  assets/main.css
  components/PlaceholderPage.vue
  layouts/
    StudentLayout.vue
    AdminLayout.vue
  router/index.js
  views/
    auth/LoginView.vue
    student/
      StudentDashboard.vue
      AttendanceView.vue
      ActivityView.vue
      HistoryView.vue
    admin/
      AdminDashboard.vue
      StudentsView.vue
      StudentDetailsView.vue
      ActivityMonitorView.vue
  App.vue
  main.js
```

## Routes

| URL | Page |
| --- | --- |
| `/` | Login |
| `/student` | Student dashboard |
| `/student/attendance` | Attendance |
| `/student/activity` | Activity update |
| `/student/history` | History |
| `/admin` | Admin dashboard |
| `/admin/students` | Students |
| `/admin/students/:id` | Student details |
| `/admin/activity` | Activity monitor |

Unknown URLs redirect to `/`. Student and admin pages render within their respective layouts. The student details page receives the URL's `id` as a prop. Routes are public placeholders, with no authorization checks.

Vue components use ordinary `export default` Options API objects. Tailwind is loaded through its Vite plugin and `src/assets/main.css`. Extend the individual views as later phases are approved.

HTML5 history routing requires a future production host to serve `index.html` for application URLs. Vite handles this during development and local preview.

## Scope

Only layouts, navigation, routing, and placeholder screens are implemented. Authentication, data persistence, Firebase, camera/photo handling, attendance actions, reports, and mobile widgets are not implemented. No backend or state management library is included.
