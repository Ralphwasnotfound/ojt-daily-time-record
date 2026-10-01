<script>
import AuthorizedStudents from '../../components/AuthorizedStudents.vue'
import PendingRegistrations from '../../components/PendingRegistrations.vue'
import AdminRecords from '../../components/AdminRecords.vue'
export default { name: 'StudentsView', components: { AuthorizedStudents, PendingRegistrations, AdminRecords } }
</script>
<template><div class="space-y-6"><header><h1 class="text-2xl font-semibold text-stone-900 sm:text-3xl">Students</h1><p class="mt-2 text-sm leading-6 text-stone-600">Monitor registered OJT students and their current attendance status.</p></header><AuthorizedStudents ref="roster" @changed="$refs.pending.load()" /><PendingRegistrations ref="pending" @reviewed="$refs.directory.refresh(); $refs.roster.refresh()" /><h2 class="text-lg font-semibold">Student Directory</h2><AdminRecords ref="directory" kind="students" /></div></template>
