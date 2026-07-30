// Scan History and LocalStorage Management

const STORAGE_KEY = 'part_no_scan_history_v1';

export class HistoryManager {
  constructor() {
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (err) {
      console.error('Failed to load history:', err);
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch (err) {
      console.error('Failed to save history:', err);
    }
  }

  addEntry(code, format = 'CODE_128') {
    const timeStr = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const dateStr = new Date().toLocaleDateString('ko-KR');

    const newEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      code,
      format,
      timestamp: timeStr,
      date: dateStr,
      rawTime: Date.now()
    };

    // Prevent immediate duplicate duplicate spam if scanned within 2 seconds
    if (this.history.length > 0 && this.history[0].code === code && (Date.now() - this.history[0].rawTime < 2000)) {
      return this.history[0];
    }

    this.history.unshift(newEntry);
    if (this.history.length > 100) {
      this.history.pop();
    }
    this.saveHistory();
    return newEntry;
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
  }

  deleteEntry(id) {
    this.history = this.history.filter(item => item.id !== id);
    this.saveHistory();
  }

  exportToCSV() {
    if (this.history.length === 0) return false;

    const headers = ['ID', 'Part No (품번)', '포맷', '날짜', '시간'];
    const rows = this.history.map(item => [
      item.id,
      `"${item.code.replace(/"/g, '""')}"`,
      item.format,
      item.date,
      item.timestamp
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `PartNo_Scan_History_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }
}

export const historyManager = new HistoryManager();
