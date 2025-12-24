// Global attack polling
let attackPollInterval;

function startAttackPolling() {
  if (attackPollInterval) return;
  attackPollInterval = setInterval(async () => {
    try {
      const ongoing = await api.getOngoingAttacks();
      updateOngoingUI(ongoing);
    } catch {}
  }, 5000);
}

function stopAttackPolling() {
  clearInterval(attackPollInterval);
  attackPollInterval = null;
}

function updateOngoingUI(list) {
  const el = document.getElementById('ongoingList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p class="no-data">No ongoing attacks</p>';
    return;
  }
  el.innerHTML = list.map(a => `
    <div class="attack-item">
      <div><strong>${a.target}</strong> <span class="method-tag">${a.method}</span></div>
      <div><span>${a.time}</span> <span class="status running">RUNNING</span></div>
    </div>
  `).join('');
}

// Auto start polling on panel pages
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('ongoingList')) startAttackPolling();
});

// Cleanup on page unload
window.addEventListener('beforeunload', stopAttackPolling);
