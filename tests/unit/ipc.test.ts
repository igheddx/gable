import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, ipcContract } from '../../src/shared/ipc';
import { isTrustedSender, validateAndRun } from '../../src/main/ipc';
import { AppError } from '../../src/shared/errors';

describe('ipc input validation', () => {
  const run = vi.fn(() => 'ran');

  it.each([
    ['settings:get', { key: 'not.allowed' }],
    ['settings:get', { key: 'ui.lastVisitedNote', extra: 1 }],
    ['settings:get', 'ui.lastVisitedNote'],
    ['settings:get', null],
    ['settings:set', { key: 'ui.lastVisitedNote', value: 42 }],
    ['settings:set', { key: 'ui.lastVisitedNote', value: 'x'.repeat(2001) }],
    ['settings:set', { key: 'app.demoData', value: '1' }],
    ['app:getInfo', { anything: true }],
  ] as const)('rejects malformed payload for %s without running the handler', async (channel, payload) => {
    run.mockClear();
    const result = await validateAndRun(channel, payload, run);
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: expect.any(String) } });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the handler for a valid payload', async () => {
    run.mockClear();
    const result = await validateAndRun('settings:set', { key: 'ui.lastVisitedNote', value: 'ok' }, run);
    expect(result).toEqual({ ok: true, value: 'ran' });
    expect(run).toHaveBeenCalledWith({ key: 'ui.lastVisitedNote', value: 'ok' });
  });

  it('turns handler exceptions into a generic error that leaks no details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await validateAndRun('app:getInfo', undefined, () => {
      throw new Error('SELECT secret FROM /Users/david/gable.db');
    });
    spy.mockRestore();
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: expect.not.stringContaining('/Users') } });
  });

  it('maps deliberate service errors to safe, specific results', async () => {
    const result = await validateAndRun('properties:archive', { id: 1 }, () => {
      throw new AppError('NOT_FOUND', 'That property no longer exists.');
    });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'That property no longer exists.' } });
  });

  it('rejects company payloads with unknown or wrongly typed fields', async () => {
    for (const payload of [{ id: '1' }, { id: 1.5 }, { id: -1 }, { id: 1, extra: true }]) {
      expect(await validateAndRun('companies:setDefault', payload, run)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(await validateAndRun('properties:list', { scope: 'everything' }, run)).toMatchObject({ ok: false });
    expect(await validateAndRun('properties:list', { scope: 1, pageSize: 100000 }, run)).toMatchObject({ ok: false });
  });

  it('declares a schema for every channel', () => {
    expect(IPC_CHANNELS.sort()).toEqual(Object.keys(ipcContract).sort());
  });
});

describe('sender validation', () => {
  it('accepts only our own origin in the main frame', () => {
    expect(isTrustedSender('file:///app/index.html', ['file://'], true)).toBe(true);
    expect(isTrustedSender('http://localhost:5173/', ['http://localhost:5173'], true)).toBe(true);
    expect(isTrustedSender('https://evil.example/', ['file://'], true)).toBe(false);
    expect(isTrustedSender('http://localhost:9999/', ['http://localhost:5173'], true)).toBe(false);
    expect(isTrustedSender('file:///app/index.html', ['file://'], false)).toBe(false);
    expect(isTrustedSender(undefined, ['file://'], true)).toBe(false);
    expect(isTrustedSender('not a url', ['file://'], true)).toBe(false);
  });
});
