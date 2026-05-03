import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  _state, 
  openDB, 
  loadWeekIDB, 
  saveWeekIDB, 
  deleteWeekIDB, 
  listWeekKeysIDB, 
  loadValueIDB, 
  saveValueIDB, 
  deleteValueIDB,
  loadWeek,
  runMigrationIfNeeded
} from './setup.js';

describe('Persistence (IndexedDB)', () => {
  beforeEach(async () => {
    // Opt-in to real IDB implementation (using fake-indexeddb)
    _state.useRealIDB(true);
    
    // Clear the database before each test
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['weeks', 'misc'], 'readwrite');
      tx.objectStore('weeks').clear();
      tx.objectStore('misc').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    
    // Clear localStorage mock
    _state.clearLocalStorage();
  });

  afterEach(() => {
    // Reset back to mock IDB for other tests
    _state.useRealIDB(false);
  });

  describe('Core IDB Operations', () => {
    it('should save and load a week', async () => {
      const weekKey = '2026-01';
      const data = { nodes: [{ id: 'center', type: 'center', label: 'Test' }] };
      
      await saveWeekIDB(weekKey, data);
      const loaded = await loadWeekIDB(weekKey);
      
      expect(loaded).toEqual(data);
    });

    it('should delete a week', async () => {
      const weekKey = '2026-02';
      const data = { nodes: [] };
      
      await saveWeekIDB(weekKey, data);
      await deleteWeekIDB(weekKey);
      const loaded = await loadWeekIDB(weekKey);
      
      expect(loaded).toBeNull();
    });

    it('should list week keys', async () => {
      await saveWeekIDB('2026-01', { nodes: [] });
      await saveWeekIDB('2026-02', { nodes: [] });
      
      const keys = await listWeekKeysIDB();
      expect(keys).toContain('2026-01');
      expect(keys).toContain('2026-02');
      expect(keys.length).toBe(2);
    });

    it('should save and load misc values', async () => {
      const key = 'test-key';
      const value = { some: 'data' };
      
      await saveValueIDB(key, value);
      const loaded = await loadValueIDB(key);
      
      expect(loaded).toEqual(value);
    });

    it('should delete misc values', async () => {
      const key = 'test-key-delete';
      await saveValueIDB(key, 'val');
      await deleteValueIDB(key);
      const loaded = await loadValueIDB(key);
      expect(loaded).toBeUndefined();
    });
  });

  describe('Migration Logic', () => {
    it('should migrate data from localStorage to IndexedDB', async () => {
      const weekData = { nodes: [{ id: 'center', type: 'center', label: 'Legacy' }] };
      const colorsData = { work: { main: '#ff0000' } };
      
      _state.setLocalStorage('zenit-week-2025-52', weekData);
      _state.setLocalStorage('zenit-week-colors', colorsData);
      _state.setLocalStorage('zenit-week-import-pending', 'true');
      
      expect(_state.getLocalStorage('zenit-week-2025-52')).toBeDefined();
      
      await runMigrationIfNeeded();
      
      // Verify in IDB
      const migratedWeek = await loadWeekIDB('2025-52');
      expect(migratedWeek).toEqual(weekData);
      
      const migratedColors = await loadValueIDB('zenit-week-colors');
      expect(migratedColors).toEqual(colorsData);
      
      const migratedPending = await loadValueIDB('zenit-week-import-pending');
      expect(migratedPending).toBe('"true"');
      
      // Verify localStorage is cleaned up
      expect(_state.getLocalStorage('zenit-week-2025-52')).toBeUndefined();
      expect(_state.getLocalStorage('zenit-week-colors')).toBeUndefined();
      expect(_state.getLocalStorage('zenit-week-import-pending')).toBeUndefined();
      expect(_state.getLocalStorage('zenit-week-storage-migrated')).toBe('1');
    });

    it('should not migrate if already migrated', async () => {
      _state.setLocalStorage('zenit-week-storage-migrated', '1');
      _state.setLocalStorage('zenit-week-2025-52', { nodes: [] });
      
      await runMigrationIfNeeded();
      
      const migratedWeek = await loadWeekIDB('2025-52');
      expect(migratedWeek).toBeNull();
      expect(_state.getLocalStorage('zenit-week-2025-52')).toBeDefined();
    });
  });

  describe('Fallback & Errors', () => {
    it('should handle QuotaExceededError', async () => {
      _state.resetIDB();
      const db = await openDB();
      
      const mockTx = {
        objectStore: () => ({
          put: () => ({ onsuccess: null, onerror: null })
        }),
        oncomplete: null,
        onerror: null,
        abort: () => {}
      };
      
      const originalTransaction = db.transaction;
      db.transaction = () => mockTx;

      try {
        const savePromise = saveWeekIDB('any', {});
        
        // Trigger the error on the next tick
        setTimeout(() => {
          const error = new DOMException('Quota exceeded', 'QuotaExceededError');
          if (mockTx.onerror) mockTx.onerror({ target: { error } });
        }, 0);
        
        await expect(savePromise).rejects.toThrow();
        
        const toast = _state.getElement('toast');
        expect(toast.textContent).toBeDefined();
      } finally {
        db.transaction = originalTransaction;
      }
    });

    it('should fall back to localStorage if IDB fails during loadWeek', async () => {
      _state.resetIDB();
      const weekKey = '2026-05';
      const data = { 
        nodes: [
          { id: 'center', type: 'center', label: 'Fallback', children: [] }
        ] 
      };
      
      // Put data in localStorage
      _state.setLocalStorage('zenit-week-' + weekKey, data);
      
      // Mock openDB to fail
      const originalOpenDB = _state.sandbox.openDB;
      _state.sandbox.openDB = () => Promise.reject(new Error('IDB Failure'));
      
      try {
        const loaded = await loadWeek(weekKey);
        const center = (loaded.nodes || []).find(n => n.id === 'center');
        expect(center).toBeDefined();
        expect(center.label).toBe('Fallback');
      } finally {
        _state.sandbox.openDB = originalOpenDB;
      }
    });

    it('should show blocked overlay if IDB is blocked', async () => {
      const overlay = _state.getElement('single-tab-overlay');
      expect(overlay.classList.contains('visible')).toBe(false);
      
      _state.sandbox.onDbBlocked();
      
      expect(overlay.classList.contains('visible')).toBe(true);
    });
  });
});
