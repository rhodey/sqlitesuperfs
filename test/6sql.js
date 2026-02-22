const fs = require('fs')
const test = require('tape')
const Database = require('better-sqlite3')

const DIR = `./testdir`
const rmr = (path) => fs.rmSync(path, { recursive: true })
const empty = (dir) => {
  const arr = fs.readdirSync(dir, { withFileTypes: true })
  arr.forEach((entry) => {
    const path = `${entry.path}/${entry.name}`
    rmr(path)
  })
}

test('sql select', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')

  const ok0 = db.prepare('select 1 where 1 = ?').all(0)
  t.equal(ok0.length, 0, '0 rows')

  const ok1 = db.prepare('select 1 where 1 = ?').all(1)
  t.equal(ok1.length, 1, '1 row')
  t.equal(ok1[0]['1'], 1, '1 = 1')

  db.close()
  t.end()
})

const table = `
create table users(
  id integer primary key autoincrement,
  create_ms timestamp default current_timestamp,
  uname text not null unique,
  email text unique
)`

test('sql insert', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')
  db.exec(table)

  const ok0 = db.prepare('select id from users').all()
  t.equal(ok0.length, 0, '0 rows')

  const user1 = { uname: 'u1', email: 'e1' }
  let stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')
  let info = stmt.run(user1)
  t.equal(info.changes, 1, '1 insert')

  const user2 = { uname: 'u2', email: 'e2' }
  stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')
  info = stmt.run(user2)
  t.equal(info.changes, 1, '1 insert')

  const ok1 = db.prepare('select * from users where uname = ?').all(user1.uname)
  t.equal(ok1.length, 1, '1 row')
  t.equal(ok1[0]['uname'], user1.uname, 'uname = uname')

  const ok2 = db.prepare('select * from users').all()
  t.equal(ok2.length, 2, '2 row')

  db.close()
  t.end()
})

test('sql txn', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')
  db.exec(table)

  let users = new Array(1000).fill(0)
  users = users.map((z, idx) => {
    const uname = `u${idx}`
    const email = `e${idx}`
    return { uname, email }
  })

  let begin = Date.now()
  const stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')

  const insertMany = db.transaction((users) => {
    for (const user of users) {
      stmt.run(user)
    }
  })

  insertMany(users)
  let ms = Date.now() - begin
  t.pass('insert ok')
  t.pass(`insert ${ms}ms`)

  begin = Date.now()
  const row = db.prepare('select count(id) as c from users').get()
  ms = Date.now() - begin
  t.equal(row.c, users.length, 'count ok')
  t.pass(`count ${ms}ms`)

  db.close()
  t.end()
})

test('sql big txn', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')
  db.exec(table)

  let users = new Array(100_000).fill(0)
  users = users.map((z, idx) => {
    const uname = `u${idx}`
    const email = `e${idx}`
    return { uname, email }
  })

  let begin = Date.now()
  const stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')

  const insertMany = db.transaction((users) => {
    for (const user of users) {
      stmt.run(user)
    }
  })

  insertMany(users)
  let ms = Date.now() - begin
  t.pass('insert ok')
  t.pass(`insert ${ms}ms`)

  begin = Date.now()
  const row = db.prepare('select count(id) as c from users').get()
  ms = Date.now() - begin
  t.equal(row.c, users.length, 'count ok')
  t.pass(`count ${ms}ms`)

  db.close()
  t.end()
})

test('sql two txn', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')
  db.exec(table)

  let users = new Array(200).fill(0)
  users = users.map((z, idx) => {
    const uname = `u${idx}`
    const email = `e${idx}`
    return { uname, email }
  })

  const stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')
  const insertMany = db.transaction((users) => {
    for (const user of users) {
      stmt.run(user)
    }
  })

  for (let c = 0; c < 4; c += 2) {
    const two = users.slice(c, c + 2)
    insertMany(two)
  }
  t.pass(`insert ok`)

  const row = db.prepare('select count(id) as c from users').get()
  t.equal(row.c, 4, 'count ok')

  db.close()
  t.end()
})

test('sql many txn', (t) => {
  empty(DIR)

  const file = `${DIR}/test.db`
  const db = Database(file)
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = FULL')
  db.exec(table)

  let users = new Array(200).fill(0)
  users = users.map((z, idx) => {
    const uname = `u${idx}`
    const email = `e${idx}`
    return { uname, email }
  })

  let begin = Date.now()
  const stmt = db.prepare('insert into users (uname, email) values (@uname, @email)')

  const insertMany = db.transaction((users) => {
    for (const user of users) {
      stmt.run(user)
    }
  })

  let ms = 0
  let avg = 0
  for (let i = 0; i < 10; i++) {
    db.prepare('delete from users').run()
    begin = Date.now()
    for (let c = 0; c < users.length; c += 2) {
      const two = users.slice(c, c + 2)
      insertMany(two)
    }
    ms = Date.now() - begin
    avg += ms
    t.pass(`insert ok ${i}`)
    t.pass(`insert ${i} ${ms}ms`)
  }

  avg = (avg / 10).toFixed(0)
  t.pass(`insert avg ${avg}ms`)

  const row = db.prepare('select count(id) as c from users').get()
  t.equal(row.c, users.length, 'count ok')

  db.close()
  t.end()
})
