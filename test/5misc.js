const fs = require('fs')
const test = require('tape')

const DIR = `./testdir`
const UID = process.getuid()
const GID = process.getgid()

const perms = (mode) => (mode & 0o777).toString(8)
const rmr = (path) => fs.rmSync(path, { recursive: true })
const sleep = (ms) => new Promise((res, rej) => setTimeout(res, ms))

const GH = !!process.env.GITHUB_RUN_ID

const empty = (dir) => {
  const arr = fs.readdirSync(dir, { withFileTypes: true })
  arr.forEach((entry) => {
    const path = `${entry.path}/${entry.name}`
    rmr(path)
  })
}

// todo: chown

test('write chmod', (t) => {
  empty(DIR)

  let flags = ['w', 'wx', 'wx+']
  if (GH) { flags = flags.filter((f) => !f.includes('x')) }

  const n = `file1`
  const name = `${DIR}/${n}`
  const mode1 = [0o664, '664']
  const mode2 = [0o666, '666']

  const step = (f) => {
    console.log('flag =>', f)
    empty(DIR)

    const data = 'hihihi'
    fs.writeFileSync(name, data, { flag: f, mode: mode1[0] })
    t.pass(`${f} write ok`)

    fs.accessSync(name)
    t.pass(`${f} access ok`)

    let stat = fs.statSync(name)
    t.pass(`${f} stat ok`)
    let ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode1[1], `${f} mode`)

    stat = fs.lstatSync(name)
    t.pass(`${f} lstat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode1[1], `${f} mode`)

    let arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')

    fs.chmodSync(name, mode2[0])
    t.pass(`${f} chmod ok`)

    fs.accessSync(name)
    t.pass(`${f} access ok`)

    stat = fs.statSync(name)
    t.pass(`${f} stat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    t.equal(perms(stat.mode), mode2[1], `${f} mode`)

    stat = fs.lstatSync(name)
    t.pass(`${f} lstat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    t.equal(perms(stat.mode), mode2[1], `${f} mode`)

    const data2 = fs.readFileSync(name, { encoding: 'utf8' })
    t.pass(`${f} read ok`)
    t.equal(data2, data, `${f} data match`)

    arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')
  }

  for (const f of flags) { step(f) }

  t.end()
})

test('open write chmod', (t) => {
  empty(DIR)

  const n = `file1`
  const name = `${DIR}/${n}`
  const mode1 = [0o664, '664']
  const mode2 = [0o666, '666']

  const fd = fs.openSync(name, 'w')
  t.pass(`open ok`)
  t.equal(typeof fd, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd} >= 0`)

  const data = 'hihihi'
  const count = fs.writeSync(fd, data)
  t.pass(`write ok`)
  t.equal(count, data.length, `write count ok`)

  fs.accessSync(name)
  t.pass(`access ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  let ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  // t.equal(perms(stat.mode), mode1[1], `mode`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  fs.fchmodSync(fd, mode2[0])
  t.pass(`chmod ok`)

  fs.accessSync(name)
  t.pass(`access ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  t.equal(perms(stat.mode), mode2[1], `mode`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  fs.closeSync(fd)
  t.pass(`close ok`)

  const fd2 = fs.openSync(name, 'r')
  t.pass(`open ok`)
  t.equal(typeof fd2, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd2} >= 0`)

  const buf = Buffer.alloc(128)
  const count2 = fs.readSync(fd2, buf)
  t.pass(`read ok`)
  t.equal(count, count2, `read count ok`)
  const data2 = buf.subarray(0, count2).toString('utf8')
  t.equal(data2, data, `data match`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  fs.closeSync(fd2)
  t.pass(`close ok`)

  t.end()
})

test('statfs', (t) => {
  empty(DIR)
  const stat = fs.statfsSync(DIR)
  t.pass(`statfs ok`)
  t.equal(stat.bsize, 4096, `bsize`)
  t.equal(stat.blocks, 0, `blocks`)
  t.equal(stat.bfree, 1_000_000, `bfree`)
  t.equal(stat.bavail, 1_000_000, `bavail`)
  t.equal(stat.files, 0, `files`)
  t.equal(stat.ffree, 1_000_000, `ffree`)
  t.end()
})

const round = (ms) => Math.round(ms / 100) * 100

test('utimes', async (t) => {
  empty(DIR)

  const name = `${DIR}/file`
  fs.writeFileSync(name, 'hihihi')
  t.pass(`write ok`)
  await sleep(1_500)

  let atime = new Date()
  let mtime = new Date(atime.getTime() + 500)
  fs.utimesSync(name, atime, mtime)
  t.pass(`utimes ok`)

  const stat = fs.statSync(name)
  t.pass(`stat ok`)

  atime = round(atime)
  mtime = round(mtime)
  stat.atimeMs = round(stat.atimeMs)
  stat.mtimeMs = round(stat.mtimeMs)
  t.equal(stat.atimeMs, atime, `atime`)
  t.equal(stat.mtimeMs, mtime, `mtime`)

  t.end()
})

test('open utimes', async (t) => {
  empty(DIR)

  const name = `${DIR}/file`
  const fd = fs.openSync(name, 'w')
  t.pass(`open ok`)
  t.equal(typeof fd, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd} >= 0`)
  await sleep(1_500)

  let atime = new Date()
  let mtime = new Date(atime.getTime() + 500)
  fs.futimesSync(fd, atime, mtime)
  t.pass(`utimes ok`)

  const stat = fs.fstatSync(fd)
  t.pass(`stat ok`)

  atime = round(atime)
  mtime = round(mtime)
  stat.atimeMs = round(stat.atimeMs)
  stat.mtimeMs = round(stat.mtimeMs)
  t.equal(stat.atimeMs, atime, `atime`)
  t.equal(stat.mtimeMs, mtime, `mtime`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
})
