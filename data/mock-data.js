/**
 * C4T Attendance — Mock Data Layer
 *
 * Centralises all demonstration data so the render layer never depends on
 * hard-coded arrays.  Swap to a real API by replacing the helpers below
 * while keeping the same return shape.
 */

window.C4T_MOCK_DATA = (() => {
  /* ── employee attendance records ─────────────────────────── */
  const attendanceRecords = [
    ['2026/07/16', '09:02', '18:00', 'normal'],
    ['2026/07/15', '09:00', '18:04', 'normal'],
    ['2026/07/14', '09:17', '18:02', 'late'],
  ];

  /* ── staff roster ─────────────────────────────────────────── */
  const staffRoster = [
    { name: '黃嘉怡', role: '營運助理', status: 'active', initials: 'WH', email: 'ka.yee@c4t.example' },
    { name: '潘家明', role: '客戶主任', status: 'active', initials: 'PK', email: 'staff@c4t.example' },
    { name: '陳雅雯', role: '設計助理', status: 'active', initials: 'CY', email: 'staff@c4t.example' },
  ];

  /* ── admin data table records ─────────────────────────────── */
  const adminTableData = [
    { date: '2026/07/16', name: '黃嘉怡', checkIn: '09:02', checkOut: '—', gps: '範圍內', wifi: '已確認', status: 'verified' },
    { date: '2026/07/16', name: '潘家明', checkIn: '09:01', checkOut: '—', gps: '範圍內', wifi: '待確認', status: 'pending' },
    { date: '2026/07/16', name: '陳雅雯', checkIn: '09:17', checkOut: '—', gps: '範圍內', wifi: '已確認', status: 'late' },
  ];

  /* ── helpers ──────────────────────────────────────────────── */
  function dayOfWeek(dateStr) {
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return days[new Date(dateStr).getDay()];
  }

  function getCurrentWeekday() {
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return days[new Date().getDay()];
  }

  return {
    attendanceRecords,
    getAttendanceRecords: () => attendanceRecords,
    staffRoster,
    getStaffRoster: () => staffRoster,
    adminTableData,
    getAdminTableData: () => adminTableData,
    dayOfWeek,
    getCurrentWeekday,
    /* summary helpers */
    getMonthlySummary: () => ({ daysWorked: 12, onTime: 11, lateDays: 1 }),
  };
})();
