# Laporan Migrasi Legacy AQILAH Swimming Club

Target Supabase: `nykenupjktgmsotfzrjj`  
SQL: `MIGRATE-ALL-LEGACY-DATA-SAFE.sql`

| Koleksi | Tabel tujuan | Backup | class_app_data | Unik | Dimigrasikan | Duplikat diabaikan | Tombstone diabaikan | Gagal | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| athletePackages | asc_athlete_packages | 1 | 1 | 1 | 1 | 1 | 0 | 0 | SELESAI |
| auditTrail | asc_audit_trail | 0 | 5 | 5 | 5 | 0 | 0 | 0 | SELESAI |
| coachNotifications | asc_coach_notifications | 4 | 5 | 5 | 5 | 4 | 0 | 0 | SELESAI |
| coachSalaries | asc_coach_salaries | 3 | 4 | 4 | 4 | 3 | 0 | 0 | SELESAI |
| competitionRegistrations | asc_competition_registrations | 3 | 3 | 3 | 3 | 3 | 0 | 0 | SELESAI |
| drylandTasks | asc_dryland_tasks | 1 | 1 | 1 | 1 | 1 | 0 | 0 | SELESAI |
| parentReminders | asc_parent_reminders | 0 | 0 | 0 | 0 | 0 | 0 | 0 | SELESAI |
| rescheduleRequests | asc_reschedule_requests | 0 | 0 | 0 | 0 | 0 | 0 | 0 | SELESAI |
| skillJournals | asc_skill_journals | 1 | 1 | 1 | 1 | 1 | 0 | 0 | SELESAI |
| versionHistory | asc_version_history | 0 | 5 | 5 | 5 | 0 | 0 | 0 | SELESAI |
| weeklyTargets | asc_weekly_targets | 1 | 1 | 1 | 1 | 1 | 0 | 0 | SELESAI |

## Verifikasi

- Total legacy unik: 26.
- Total row aktif setelah eksekusi pertama: 26.
- Total row aktif setelah eksekusi kedua: 26.
- Selisih setelah eksekusi kedua: 0.
- Duplikat `legacy_id`: 0, dijamin unique constraint setiap tabel.
- Tombstone pada koleksi yang dimigrasikan: 0.
- Insert menggunakan `ON CONFLICT (legacy_id) DO NOTHING`; row per-table yang lebih baru tidak ditimpa.
- `class_app_data` dan `class_app_data_backup` tidak dihapus atau diubah oleh migrasi.
- PostgREST schema reload berhasil.
