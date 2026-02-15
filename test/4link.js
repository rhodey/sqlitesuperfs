const fs = require('fs')
const test = require('tape')

const DIR = `${process.cwd()}/testdir`
const UID = process.getuid()
const GID = process.getgid()

const perms = (mode) => (mode & 0o777).toString(8)
const rmr = (path) => fs.rmSync(path, { recursive: true })
const sleep = (ms) => new Promise((res, rej) => setTimeout(res, ms))

const empty = (dir) => {
  const arr = fs.readdirSync(dir, { withFileTypes: true })
  arr.forEach((entry) => {
    const path = `${entry.path}/${entry.name}`
    rmr(path)
  })
}

// todo: nlink
// todo: link dirs
// todo: rename links

test('write link', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  try {
    fs.linkSync(file1, file2)
    t.fail(`no link error`)
  } catch (err) {
    t.pass(`link error`)
    t.equal(err.code, 'ENOENT', `link error ENOENT`)
  }

  const str1 = 'hihihi'
  fs.writeFileSync(file1, str1)
  t.pass(`write ok`)

  fs.accessSync(file1)
  t.pass(`access ok`)

  let stat = fs.statSync(file1)
  t.pass(`stat ok`)
  const ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)

  fs.linkSync(file1, file2)
  t.pass(`link ok`)

  fs.accessSync(file1)
  t.pass(`access ok`)

  fs.accessSync(file2)
  t.pass(`access ok`)

  stat = fs.statSync(file2)
  t.pass(`stat ok`)
  const ino2 = stat.ino
  t.equal(typeof ino2, 'number', `ino num`)
  t.ok(ino2 >= 0, `ino ${ino2} >= 0`)
  t.equal(ino2, ino, `ino2 = ino`)

  let data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str1, `data match`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.ok(arr[1].isFile(), '1 file')

  const str2 = 'hellohello'
  const str3 = (str1 + str2)
  fs.writeFileSync(file2, str2, { flag: 'a' })
  t.pass(`write ok`)

  data = fs.readFileSync(file1, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str3, `data match`)

  data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str3, `data match`)

  fs.unlinkSync(file1)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file1)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  fs.accessSync(file2)
  t.pass(`access ok`)

  stat = fs.statSync(file2)
  t.pass(`stat ok`)
  const ino3 = stat.ino
  t.equal(typeof ino3, 'number', `ino num`)
  t.ok(ino3 >= 0, `ino ${ino3} >= 0`)
  t.equal(ino3, ino, `ino3 = ino`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')

  fs.unlinkSync(file2)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  arr = fs.readdirSync(DIR)
  t.pass(`readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  t.end()
})

test('open write link', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  const fd = fs.openSync(file1, 'w+')

  const str1 = 'hihihi'
  let count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  const ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)

  fs.linkSync(file1, file2)
  t.pass(`link ok`)

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  const fd2 = fs.openSync(file2, 'a+')

  stat = fs.fstatSync(fd2)
  t.pass(`stat ok`)
  const ino2 = stat.ino
  t.equal(typeof ino2, 'number', `ino num`)
  t.ok(ino2 >= 0, `ino ${ino2} >= 0`)
  t.equal(ino2, ino, `ino2 = ino`)

  let buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf)
  t.pass(`read ok`)
  t.equal(count, str1.length, `count ok`)

  buf = buf.subarray(0, count)
  let data = buf.toString('utf8')
  t.equal(data, str1, `data match`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.ok(arr[1].isFile(), '1 file')

  const str2 = 'hellohello'
  const str3 = (str1 + str2)
  fs.writeSync(fd2, str2)
  t.pass(`write ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  fs.unlinkSync(file1)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file1)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  fs.accessSync(file2)
  t.pass(`access ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  const ino3 = stat.ino
  t.equal(ino3, ino, `ino3 = ino`)

  stat = fs.fstatSync(fd2)
  t.pass(`stat ok`)
  const ino4 = stat.ino
  t.equal(ino4, ino, `ino4 = ino`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')

  fs.unlinkSync(file2)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  fs.fstatSync(fd2)
  t.pass(`stat ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  arr = fs.readdirSync(DIR)
  t.pass(`readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  fs.closeSync(fd)
  t.pass(`close ok`)

  fs.closeSync(fd2)
  t.pass(`close ok`)

  try {
    fs.openSync(file1, 'r')
    t.fail(`no open error`)
  } catch (err) {
    t.pass(`open error`)
    t.equal(err.code, 'ENOENT', `open error ENOENT`)
  }

  try {
    fs.openSync(file2, 'r')
    t.fail(`no open error`)
  } catch (err) {
    t.pass(`open error`)
    t.equal(err.code, 'ENOENT', `open error ENOENT`)
  }

  t.end()
})

test('write symlink', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  try {
    fs.readlinkSync(file1)
    t.fail(`no readlink error`)
  } catch (err) {
    t.pass(`readlink error`)
    t.equal(err.code, 'ENOENT', `readlink error ENOENT`)
  }

  const str1 = 'hihihi'
  fs.writeFileSync(file1, str1)
  t.pass(`write ok`)

  fs.symlinkSync(file1, file2)
  t.pass(`link ok`)

  fs.accessSync(file1)
  t.pass(`access ok`)

  fs.accessSync(file2)
  t.pass(`access ok`)

  fs.statSync(file1)
  t.pass(`stat ok`)

  fs.statSync(file2)
  t.pass(`stat ok`)

  let path = fs.readlinkSync(file2)
  t.pass(`readlink ok`)
  t.equal(path, file1, `path match`)

  let data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str1, `data match`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')

  const someFile = (arr) => arr.some((e) => e.isFile())
  const someSym = (arr) => arr.some((e) => e.isSymbolicLink())

  t.ok(someFile(arr), '1 file')
  t.ok(someSym(arr), '1 symlink')

  const str2 = 'hellohello'
  const str3 = (str1 + str2)
  fs.writeFileSync(file2, str2, { flag: 'a' })
  t.pass(`write ok`)

  data = fs.readFileSync(file1, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str3, `data match`)

  data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str3, `data match`)

  fs.unlinkSync(file1)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file1)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.statSync(file1)
    t.fail(`no stat error`)
  } catch (err) {
    t.pass(`stat error`)
    t.equal(err.code, 'ENOENT', `stat error ENOENT`)
  }

  try {
    fs.statSync(file2)
    t.fail(`no stat error`)
  } catch (err) {
    t.pass(`stat error`)
    t.equal(err.code, 'ENOENT', `stat error ENOENT`)
  }

  path = fs.readlinkSync(file2)
  t.pass(`readlink ok`)
  t.equal(path, file1, `path match`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isSymbolicLink(), '1 symlink')

  fs.unlinkSync(file2)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.statSync(file2)
    t.fail(`no stat error`)
  } catch (err) {
    t.pass(`stat error`)
    t.equal(err.code, 'ENOENT', `stat error ENOENT`)
  }

  try {
    fs.readlinkSync(file2)
    t.fail(`no readlink error`)
  } catch (err) {
    t.pass(`readlink error`)
    t.equal(err.code, 'ENOENT', `readlink error ENOENT`)
  }

  arr = fs.readdirSync(DIR)
  t.pass(`readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  t.end()
})

test('open write symlink', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  const fd = fs.openSync(file1, 'w+')

  const str1 = 'hihihi'
  let count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  fs.symlinkSync(file1, file2)
  t.pass(`link ok`)

  fs.accessSync(file1)
  t.pass(`access ok`)

  fs.accessSync(file2)
  t.pass(`access ok`)

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  let path = fs.readlinkSync(file2)
  t.pass(`readlink ok`)
  t.equal(path, file1, `path match`)

  const fd2 = fs.openSync(file2, 'a+')

  fs.fstatSync(fd2)
  t.pass(`stat ok`)

  let buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf)
  t.pass(`read ok`)
  t.equal(count, str1.length, `count ok`)

  buf = buf.subarray(0, count)
  let data = buf.toString('utf8')
  t.equal(data, str1, `data match`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')

  const someFile = (arr) => arr.some((e) => e.isFile())
  const someSym = (arr) => arr.some((e) => e.isSymbolicLink())

  t.ok(someFile(arr), '1 file')
  t.ok(someSym(arr), '1 symlink')

  const str2 = 'hellohello'
  const str3 = (str1 + str2)
  fs.writeSync(fd2, str2)
  t.pass(`write ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  fs.unlinkSync(file1)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file1)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  fs.fstatSync(fd2)
  t.pass(`stat ok`)

  path = fs.readlinkSync(file2)
  t.pass(`readlink ok`)
  t.equal(path, file1, `path match`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isSymbolicLink(), '1 symlink')

  fs.unlinkSync(file2)
  t.pass(`unlink ok`)

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.readlinkSync(file2)
    t.fail(`no readlink error`)
  } catch (err) {
    t.pass(`readlink error`)
    t.equal(err.code, 'ENOENT', `readlink error ENOENT`)
  }

  fs.fstatSync(fd)
  t.pass(`stat ok`)

  fs.fstatSync(fd2)
  t.pass(`stat ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd2, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str3.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str3, `data match`)

  arr = fs.readdirSync(DIR)
  t.pass(`readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  fs.closeSync(fd)
  t.pass(`close ok`)

  fs.closeSync(fd2)
  t.pass(`close ok`)

  try {
    fs.openSync(file1, 'r')
    t.fail(`no open error`)
  } catch (err) {
    t.pass(`open error`)
    t.equal(err.code, 'ENOENT', `open error ENOENT`)
  }

  try {
    fs.openSync(file2, 'r')
    t.fail(`no open error`)
  } catch (err) {
    t.pass(`open error`)
    t.equal(err.code, 'ENOENT', `open error ENOENT`)
  }

  t.end()
})
