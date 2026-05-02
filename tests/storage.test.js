import { runMigrationIfNeeded, _state } from './setup.js';

describe('Storage Migration - localStorage to IndexedDB', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
  });

  test('migrates week data and misc keys correctly', async () => {
    const weekData = { nodes: [{ id: 'work', type: 'branch' }] };
    const colorsData = { work: { main: '#ff0000' } };
    
    _state.setLocalStorage('zenit-week-2026-01', weekData);
    _state.setLocalStorage('zenit-week-colors', colorsData);
    
    await runMigrationIfNeeded();
    
    const idbStore = _state.getIDBStore();
    expect(idbStore['week-2026-01']).toEqual(weekData);
    expect(idbStore['val-zenit-week-colors']).toEqual(colorsData);
    
    // Original keys should be removed
    expect(_state.getLocalStorage('zenit-week-2026-01')).toBeUndefined();
    expect(_state.getLocalStorage('zenit-week-colors')).toBeUndefined();
    
    // Migration flag should be set
    expect(_state.getLocalStorage('zenit-week-storage-migrated')).toBe('1');
  });

  test('skips migration if already migrated', async () => {
    _state.setLocalStorage('zenit-week-storage-migrated', '1');
    _state.setLocalStorage('zenit-week-2026-01', { nodes: [] });
    
    await runMigrationIfNeeded();
    
    const idbStore = _state.getIDBStore();
    expect(idbStore['week-2026-01']).toBeUndefined();
    // Key should still exist in localStorage
    expect(_state.getLocalStorage('zenit-week-2026-01')).toBeDefined();
  });

  test('only migrates valid week keys', async () => {
    _state.setLocalStorage('zenit-week-invalid', { nodes: [] });
    _state.setLocalStorage('zenit-week-2026-01', { nodes: [] });
    
    await runMigrationIfNeeded();
    
    const idbStore = _state.getIDBStore();
    expect(idbStore['week-2026-01']).toBeDefined();
    expect(idbStore['week-invalid']).toBeUndefined();
    
    // Invalid key should NOT be removed from localStorage
    expect(_state.getLocalStorage('zenit-week-invalid')).toBeDefined();
  });
});
