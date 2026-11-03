import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRequestId } from '../src/requestId.js';

test('financial request IDs work on an HTTP emulator origin without randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 100 }, () => newRequestId()));
    assert.equal(ids.size, 100);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  }
});
