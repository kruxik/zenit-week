// The one way a test file starts an msw server. A request no handler matches
// fails the test it happened in. msw's own 'error' mode only rejects the
// fetch, and the sync code swallows failed requests, so a missing mock (a
// request to the real Google API) would pass unnoticed.
import { beforeAll, afterEach, afterAll } from 'vitest';

export function useMockServer(server) {
  const unmocked = [];
  const check = () => {
    if (!unmocked.length) return;
    const list = unmocked.splice(0).join(', ');
    throw new Error(`unmocked request(s): ${list} - add a handler for each`);
  };
  beforeAll(() => server.listen({
    onUnhandledRequest(request) {
      unmocked.push(`${request.method} ${request.url.split('?')[0]}`);
      throw new Error(`unmocked request: ${request.method} ${request.url}`);
    },
  }));
  afterEach(check);
  afterAll(() => { server.close(); check(); });
}
