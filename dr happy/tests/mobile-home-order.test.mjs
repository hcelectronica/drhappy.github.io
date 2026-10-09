import test from 'node:test'
import assert from 'node:assert/strict'
import { mobileHomeOrderKey, parseMobileHomeOrder, reorderHomeActions, visibleHomeOrder } from '../src/mobileHomeOrder.ts'

test('saved order is isolated by account and validates stored data', () => {
  assert.notEqual(mobileHomeOrderKey('one'), mobileHomeOrderKey('two'))
  assert.deepEqual(parseMobileHomeOrder(null), [])
  assert.deepEqual(parseMobileHomeOrder('["a","b","a"]'), ['a', 'b'])
  for (const value of ['invalid', '{}', '[1]', '[""]']) assert.throws(() => parseMobileHomeOrder(value))
})

test('available actions preserve saved order and append newly enabled tools', () => {
  assert.deepEqual(visibleHomeOrder(['b', 'hidden', 'a'], ['a', 'b', 'new']), ['b', 'a', 'new'])
  assert.deepEqual(visibleHomeOrder([], ['a', 'b']), ['a', 'b'])
})

test('moving forward or backward shifts other buttons and retains hidden tools', () => {
  const saved = ['a', 'hidden', 'b', 'c']
  const available = ['a', 'b', 'c', 'new']
  const moved = reorderHomeActions(saved, available, 'a', 'c')
  assert.deepEqual(moved, ['b', 'hidden', 'c', 'a', 'new'])
  assert.deepEqual(visibleHomeOrder(moved, ['a', 'hidden', 'b', 'c', 'new']), moved)
  assert.deepEqual(reorderHomeActions(moved, available, 'a', 'b'), ['a', 'hidden', 'b', 'c', 'new'])
  assert.deepEqual(reorderHomeActions(saved, available, 'missing', 'a'), saved)
  assert.deepEqual(reorderHomeActions(saved, available, 'a', 'a'), saved)
})
