const fs = require('fs')
const test = require('tape')
const Database = require('better-sqlite3')
const { FsLog } = require('tinyraftplus')

const DIR = `./testdir`
const rmr = (path) => fs.rmSync(path, { recursive: true })
const empty = (dir) => {
  const arr = fs.readdirSync(dir, { withFileTypes: true })
  arr.forEach((entry) => {
    const path = `${entry.path}/${entry.name}`
    rmr(path)
  })
}

const toBuf = (obj) => {
  if (obj === null) { return null }
  obj = JSON.stringify(obj)
  return Buffer.from(obj, 'utf8')
}

const toObj = (buf) => {
  if (buf === null) { return null }
  return JSON.parse(buf.toString('utf8'))
}

test('raft append, open, close, new', async (t) => {
  empty(DIR)
  let log = new FsLog(`${DIR}/`, 'test')
  t.teardown(() => log.close())

  await log.del()
  await log.open()
  t.equal(log.seq, -1n, 'seq = -1')
  t.equal(log.head, null, 'head = null')

  // open, close same
  let data = { a: 1 }
  let seq = await log.append(toBuf(data))
  t.equal(seq, 0n, 'seq = 0')
  t.equal(log.seq, 0n, 'seq = 0')
  t.deepEqual(toObj(log.head), data, 'head = data')

  data = { bb: 2 }
  seq = await log.append(toBuf(data))
  t.equal(seq, 1n, 'seq = 1')
  t.equal(log.seq, 1n, 'seq = 1')
  t.deepEqual(toObj(log.head), data, 'head = data')

  data = { ccc: 3 }
  seq = await log.append(toBuf(data))
  t.equal(seq, 2n, 'seq = 2')
  t.equal(log.seq, 2n, 'seq = 2')
  t.deepEqual(toObj(log.head), data, 'head = data')
  await log.close()

  // open, close same
  await log.open()
  t.equal(log.seq, 2n, 'seq = 2 again')
  t.deepEqual(toObj(log.head), data, 'head = data again')

  data = { d: 4 }
  seq = await log.append(toBuf(data))
  t.equal(seq, 3n, 'seq = 3')
  t.equal(log.seq, 3n, 'seq = 3')
  t.deepEqual(toObj(log.head), data, 'head = data')
  await log.close()

  // new
  log = new FsLog(`${DIR}/`, 'test')
  await log.open()
  t.equal(log.seq, 3n, 'seq = 3 again')
  t.deepEqual(toObj(log.head), data, 'head = data again')

  data = { ee: 5 }
  seq = await log.append(toBuf(data))
  t.equal(seq, 4n, 'seq = 4')
  t.equal(log.seq, 4n, 'seq = 4')
  t.deepEqual(toObj(log.head), data, 'head = data')
  t.end()
})

test('raft append one, close, open, append', async (t) => {
  empty(DIR)
  const log = new FsLog(`${DIR}/`, 'test')
  t.teardown(() => log.close())

  await log.del()
  await log.open()

  t.equal(log.seq, -1n, 'seq = -1')
  t.equal(log.head, null, 'head = null')

  let data = { a: 1 }
  let seq = await log.append(toBuf(data))
  t.equal(seq, 0n, 'seq = 0')
  t.equal(log.seq, 0n, 'seq = 0')
  t.deepEqual(toObj(log.head), data, 'head = data')
  await log.close()

  await log.open()
  t.equal(log.seq, 0n, 'seq = 0 again')
  t.deepEqual(toObj(log.head), data, 'head = data again')

  data = { b: 2 }
  seq = await log.append(toBuf(data))
  t.equal(seq, 1n, 'seq = 1')
  t.equal(log.seq, 1n, 'seq = 1')
  t.deepEqual(toObj(log.head), data, 'head = data')
  t.end()
})

test('raft rollback first', async (t) => {
  const rollbackCb = (seq) => {
    if (seq === 0n) { throw new Error('test roll') }
  }

  const opts = { rollbackCb }
  const log = new FsLog(`${DIR}/`, 'test', opts)
  t.teardown(() => log.close())

  await log.del()
  await log.open()

  t.equal(log.seq, -1n, 'seq = -1')
  t.equal(log.head, null, 'head = null')

  try {
    const data = { a: 1 }
    await log.append(toBuf(data))
    t.fail('no error thrown')
  } catch (err) {
    t.ok(err.message.includes('test roll'), 'error thrown')
  }

  t.equal(log.seq, -1n, 'seq = -1 again')
  t.equal(log.head, null, 'head = null again')
  t.end()
})

test('raft rollback second', async (t) => {
  const rollbackCb = (seq) => {
    if (seq === 1n) { throw new Error('test roll') }
  }

  const opts = { rollbackCb }
  const log = new FsLog(`${DIR}/`, 'test', opts)
  t.teardown(() => log.close())

  await log.del()
  await log.open()

  const data = { a: 1 }
  const seq = await log.append(toBuf(data))
  t.equal(seq, 0n, 'seq = 0')
  t.equal(log.seq, 0n, 'seq = 0')
  t.deepEqual(toObj(log.head), data, 'head = data')

  try {
    await log.append(toBuf({ b: 2 }))
    t.fail('no error thrown')
  } catch (err) {
    t.ok(err.message.includes('test roll'), 'error thrown')
  }

  await log.close()
  await log.open()
  t.pass('restart ok')
  t.equal(log.seq, 0n, 'seq = 0 again')
  t.deepEqual(toObj(log.head), data, 'head = data again')
  t.end()
})
