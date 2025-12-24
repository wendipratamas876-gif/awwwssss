// Auto-delete VPS offline setiap 30 detik
setInterval(async () => {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    // Trigger check VPS status -> otomatis hapus yang offline
    await fetch('/api/vps/check', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch {}
}, 30000);
