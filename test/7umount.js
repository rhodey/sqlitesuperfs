const test = require('tape')
const split = require('split')
const Database = require('better-sqlite3')
const exec = require('child_process').exec
const spawn = require('child_process').spawn

const DIR = `./testdir`
const GH = !!process.env.GITHUB_RUN_ID
const sleep = (ms) => new Promise((res, rej) => setTimeout(res, ms))

const reset = () => {
  return new Promise((res, rej) => {
    exec('npm run reset', (error, stdout, stderr) => {
      if (error) { return rej(new Error(`reset error ${error.code} ${stderr}`)) }
      res()
    })
  })
}

const umount = () => {
  return new Promise((res, rej) => {
    exec(`fusermount -u -z ${process.cwd()}/testdir`, (error, stdout, stderr) => {
      if (error) { return rej(new Error(`umount error ${error.code} ${stderr}`)) }
      setTimeout(res, 500)
    })
  })
}

const wrapPid = (proc) => {
  return new Promise((res, rej) => {
    proc.once('error', rej)
    if (proc.pid) { res(proc) }
    rej(new Error('no proc pid'))
  })
}

const wrapErrors = (proc, errCb) => {
  proc.on('error', (err) => errCb(new Error(`ssfs error ${err.message}`)))
  proc.stderr.on('error', (err) => errCb(new Error(`ssfs stderr error ${err.message}`)))
  proc.stdout.on('error', (err) => errCb(new Error(`ssfs stdout error ${err.message}`)))
  proc.stderr.once('end', () => errCb(new Error(`ssfs stderr end`)))
  proc.stdout.once('end', () => errCb(new Error(`ssfs stdout end`)))
}

const mount = (errCb) => {
  const bin = `${process.cwd()}/target/debug/sqlitesuperfs`
  const args = ['test1', `${process.cwd()}/testdir`, `-o allow_other`]
  const env = {}
  env['RUST_BACKTRACE'] = '1'
  // env['RUST_LOG'] = 'info'
  env['psql_url'] = 'postgresql://psql:psql@localhost:5432/psql'
  env['encryption_pass'] = 'supersuper'
  const stdio = ['pipe', 'pipe', 'pipe']
  const proc = spawn(bin, args, { stdio, env })
  return new Promise((res, rej) => {
    wrapPid(proc).then((proc) => {
      const log = (line) => {
        line = line.trim()
        if (!line) { return }
        console.log('ssfs >>', line)
        if (line !== 'mounted') { return }
        setTimeout(() => res(proc), GH ? 2_500 : 500)
      }
      proc.stderr.setEncoding('utf8')
      proc.stdout.setEncoding('utf8')
      proc.stderr.pipe(split()).on('data', log)
      proc.stdout.pipe(split()).on('data', log)
      wrapErrors(proc, errCb)
    }).catch(rej)
  })
}

async function testInsert(t, mode, sig) {
  let ended = false
  const errCb = (err) => {
    if (ended) { return }
    t.fail(err.message)
  }

  await reset()
  t.pass('reset ok')

  let child = await mount(errCb)
  t.pass('mount ok')

  const kill = () => {
    ended = true
    child.once('exit', (code) => console.log('ssfs >> exit', code))
    child.kill(sig)
    return sleep(500)
  }

  t.teardown(kill)

  const file = `${DIR}/test.db`
  let db = Database(file)
  db.pragma(`journal_mode = ${mode}`)
  db.pragma('synchronous = FULL')
  t.pass('db ok')

  const table = `create table nums (id integer primary key)`
  db.exec(table)
  t.pass('table ok')

  const ok0 = db.prepare('select id from nums').all()
  t.equal(ok0.length, 0, '0 rows')

  const info = db.prepare('insert into nums (id) values (1)').run()
  t.equal(info.changes, 1, '1 insert')

  await kill()
  await umount()
  ended = false
  child = await mount(errCb)
  t.pass('mount again ok')

  db = Database(file)
  db.pragma(`journal_mode = ${mode}`)
  db.pragma('synchronous = FULL')
  t.pass('db again ok')

  const ok1 = db.prepare('select * from nums where id = 1').all()
  t.equal(ok1.length, 1, '1 row')
  t.equal(ok1[0]?.['id'], 1, 'id = 1')

  db.close()
  t.pass('close ok')
  t.end()
}

test('test insert DELETE SIGINT', (t) => testInsert(t, 'DELETE', 'SIGINT'))
test('test insert TRUNCATE SIGINT', (t) => testInsert(t, 'TRUNCATE', 'SIGINT'))

test('test insert DELETE SIGTERM', (t) => testInsert(t, 'DELETE', 'SIGTERM'))
test('test insert TRUNCATE SIGTERM', (t) => testInsert(t, 'TRUNCATE', 'SIGTERM'))

async function testUpdate(t, mode, sig) {
  let ended = false
  const errCb = (err) => {
    if (ended) { return }
    t.fail(err.message)
  }

  await reset()
  t.pass('reset ok')

  let child = await mount(errCb)
  t.pass('mount ok')

  const kill = () => {
    ended = true
    child.once('exit', (code) => console.log('ssfs >> exit', code))
    child.kill(sig)
    return sleep(500)
  }

  t.teardown(kill)

  const file = `${DIR}/test.db`
  let db = Database(file)
  db.pragma(`journal_mode = ${mode}`)
  db.pragma('synchronous = FULL')
  t.pass('db ok')

  const table = `create table nums (id integer primary key)`
  db.exec(table)
  t.pass('table ok')

  const ok0 = db.prepare('select id from nums').all()
  t.equal(ok0.length, 0, '0 rows')

  let info = db.prepare('insert into nums (id) values (1)').run()
  t.equal(info.changes, 1, '1 insert')

  info = db.prepare('update nums set id = 2 where id = 1').run()
  t.equal(info.changes, 1, '1 update')

  await kill()
  await umount()
  ended = false
  child = await mount(errCb)
  t.pass('mount again ok')

  db = Database(file)
  db.pragma(`journal_mode = ${mode}`)
  db.pragma('synchronous = FULL')
  t.pass('db again ok')

  const ok1 = db.prepare('select * from nums where id = 1').all()
  t.equal(ok1.length, 0, '0 rows')

  const ok2 = db.prepare('select * from nums where id = 2').all()
  t.equal(ok2.length, 1, '1 row')
  t.equal(ok2[0]?.['id'], 2, 'id = 2')

  db.close()
  t.pass('close ok')
  t.end()
}

test('test update DELETE SIGINT', (t) => testUpdate(t, 'DELETE', 'SIGINT'))
test('test update TRUNCATE SIGINT', (t) => testUpdate(t, 'TRUNCATE', 'SIGINT'))

test('test update DELETE SIGTERM', (t) => testUpdate(t, 'DELETE', 'SIGTERM'))
test('test update TRUNCATE SIGTERM', (t) => testUpdate(t, 'TRUNCATE', 'SIGTERM'))
