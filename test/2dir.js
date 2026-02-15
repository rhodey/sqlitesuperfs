const fs = require('fs')
const test = require('tape')

const DIR = `./testdir`
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

// todo: mode not consistent on github runner

test('mkdir rmdir', (t) => {
  empty(DIR)
  
  let name = `${DIR}/dir1/dir2`

  try {
    fs.accessSync(name)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.mkdirSync(name)
    t.fail(`no mkdir error`)
  } catch (err) {
    t.pass(`mkdir error`)
    t.equal(err.code, 'ENOENT', `mkdir error ENOENT`)
  }

  try {
    fs.rmdirSync(name)
    t.fail(`no rmdir error`)
  } catch (err) {
    t.pass(`rmdir error`)
    t.equal(err.code, 'ENOENT', `rmdir error ENOENT`)
  }

  try {
    fs.writeFileSync(name, 'hihihi', { flag: 'w' })
    t.fail(`no write error`)
  } catch (err) {
    t.pass(`write error`)
    t.equal(err.code, 'ENOENT', `write error ENOENT`)
  }

  name = `${DIR}/dir1`
  const mode = [0o775, '775']

  fs.mkdirSync(name, { mode: mode[0] })
  t.pass(`mkdir ok`)

  fs.accessSync(name)
  t.pass(`access ok`)

  let stat = fs.statSync(name)
  t.pass(`stat ok`)
  let ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  // t.equal(perms(stat.mode), mode[1], `mode`)

  stat = fs.lstatSync(name)
  t.pass(`lstat ok`)
  ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  // t.equal(perms(stat.mode), mode[1], `mode`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isDirectory(), '1 dir')
  t.equal(arr[0].name, 'dir1', '1 name')

  fs.rmdirSync(name)
  t.pass(`rmdir ok`)

  try {
    fs.accessSync(name)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.statSync(name)
    t.fail(`no stat error`)
  } catch (err) {
    t.pass(`stat error`)
    t.equal(err.code, 'ENOENT', `stat error ENOENT`)
  }

  try {
    fs.lstatSync(name)
    t.fail(`no lstat error`)
  } catch (err) {
    t.pass(`lstat error`)
    t.equal(err.code, 'ENOENT', `lstat error ENOENT`)
  }

  try {
    fs.rmdirSync(name)
    t.fail(`no rmdir error`)
  } catch (err) {
    t.pass(`rmdir error`)
    t.equal(err.code, 'ENOENT', `rmdir error ENOENT`)
  }

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  fs.mkdirSync(name, { mode: mode[0] })
  t.pass(`again mkdir ok`)

  fs.accessSync(name)
  t.pass(`again access ok`)

  stat = fs.statSync(name)
  t.pass(`again stat ok`)
  ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  // t.equal(perms(stat.mode), mode[1], `mode`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`again readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isDirectory(), '1 dir')
  t.equal(arr[0].name, 'dir1', '1 name')

  t.end()
})

test('mkdir rmdir not empty', (t) => {
  empty(DIR)

  const name = `${DIR}/dir1`
  const mode = [0o775, '775']

  fs.mkdirSync(name, { mode: mode[0] })
  t.pass(`mkdir ok`)

  fs.accessSync(name)
  t.pass(`access ok`)

  let stat = fs.statSync(name)
  t.pass(`stat ok`)
  let ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)
  // t.equal(perms(stat.mode), mode[1], `mode`)

  const n = 'file1'
  const nn = `${name}/${n}`

  fs.writeFileSync(nn, 'hihihi', { flag: 'w' })
  t.pass(`write ok`)

  fs.accessSync(nn)
  t.pass(`access file ok`)

  stat = fs.statSync(nn)
  t.pass(`stat file ok`)
  ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)

  let arr = fs.readdirSync(name, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  try {
    fs.rmdirSync(name)
    t.fail(`no rmdir error`)
  } catch (err) {
    t.pass(`rmdir error`)
    t.equal(err.code, 'ENOTEMPTY', `rmdir error ENOTEMPTY`)
  }

  arr = fs.readdirSync(name, { withFileTypes: true })
  t.pass(`again readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  fs.unlinkSync(nn)
  t.pass(`unlink ok`)

  fs.rmdirSync(name)
  t.pass(`rmdir ok`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`again readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  // this time with recursive
  fs.mkdirSync(name, { mode: mode[0] })
  t.pass(`again mkdir ok`)

  fs.accessSync(name)
  t.pass(`again access ok`)

  fs.writeFileSync(nn, 'hihihi', { flag: 'w' })
  t.pass(`again write ok`)

  fs.accessSync(nn)
  t.pass(`again access file ok`)

  stat = fs.statSync(nn)
  t.pass(`again file stat ok`)
  ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)
  t.equal(stat.uid, UID, `uid`)
  t.equal(stat.gid, GID, `gid`)

  arr = fs.readdirSync(name, { withFileTypes: true })
  t.pass(`again readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, n, '1 name')

  fs.rmSync(name, { recursive: true })
  t.pass(`recursive ok`)

  try {
    fs.accessSync(name)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  try {
    fs.accessSync(nn)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`again readdir ok`)
  t.equal(arr.length, 0, '0 entry')

  t.end()
})

test('rename no parent', (t) => {
  empty(DIR)

  const dir1 = `${DIR}/dir1`
  const file1 = `${dir1}/file1`

  fs.mkdirSync(dir1)
  t.pass(`mkdir ok`)

  fs.accessSync(dir1)
  t.pass(`access dir1 ok`)

  const data1 = 'hihihi'
  fs.writeFileSync(file1, data1)
  t.pass(`write file1 ok`)

  fs.accessSync(file1)
  t.pass(`access file1 ok`)

  const dir2 = `${DIR}/dir2`
  const file2 = `${dir2}/file2`

  try {
    fs.renameSync(file1, file2)
    t.fail(`no rename error`)
  } catch (err) {
    t.pass(`rename error`)
    t.equal(err.code, 'ENOENT', `rename error ENOENT`)
  }

  try {
    fs.accessSync(dir2)
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

  t.end()
})

test('dir copy rename', (t) => {
  empty(DIR)

  const dir1 = `${DIR}/dir1`
  const dir2 = `${DIR}/dir2`

  try {
    fs.cpSync(dir1, dir2, { recursive: true })
    t.fail(`no copy error`)
  } catch (err) {
    t.pass(`copy error`)
    t.equal(err.code, 'ENOENT', `copy error ENOENT`)
  }

  try {
    fs.renameSync(dir1, dir2)
    t.fail(`no rename error`)
  } catch (err) {
    t.pass(`rename error`)
    t.equal(err.code, 'ENOENT', `rename error ENOENT`)
  }

  fs.mkdirSync(dir1)
  t.pass(`mkdir ok`)

  fs.cpSync(dir1, dir2, { recursive: true })
  t.pass(`copy ok`)

  fs.accessSync(dir1)
  t.pass(`access dir1 ok`)

  fs.accessSync(dir2)
  t.pass(`access dir2 ok`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')
  t.ok(arr[0].isDirectory(), '2 dir')
  t.ok(arr[1].isDirectory(), '2 dir')

  const file1 = `${dir1}/file1`
  const file2 = `${dir2}/file2`

  const data1 = 'hihihi'
  fs.writeFileSync(file1, data1)
  t.pass(`write file1 ok`)

  fs.cpSync(file1, file2)
  t.pass(`copy file1 ok`)

  fs.accessSync(file1)
  t.pass(`access file1 ok`)

  fs.accessSync(file2)
  t.pass(`access file2 ok`)

  const data2 = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read file2 ok`)
  t.equal(data2, data1, `data match`)

  arr = fs.readdirSync(dir1, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, 'file1', '1 name')

  arr = fs.readdirSync(dir2, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, 'file2', '1 name')

  const dir3 = `${DIR}/dir3`
  const file3 = `${DIR}/dir3/file2`

  fs.cpSync(dir2, dir3, { recursive: true })
  t.pass(`no copy error`)

  fs.accessSync(dir2)
  t.pass(`access dir2 ok`)

  fs.accessSync(dir3)
  t.pass(`access dir3 ok`)

  fs.accessSync(file2)
  t.pass(`access file2 ok`)

  fs.accessSync(file3)
  t.pass(`access file3 ok`)

  const data3 = fs.readFileSync(file3, { encoding: 'utf8' })
  t.pass(`read file3 ok`)
  t.equal(data3, data2, `data match`)

  arr = fs.readdirSync(dir3, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, 'file2', '1 name')

  const file4 = `${DIR}/dir3/file4`
  fs.renameSync(file3, file4)
  t.pass(`rename file3 ok`)

  try {
    fs.accessSync(file3)
    t.fail(`no error`)
  } catch (err) {
    t.pass(`access file3 error`)
    t.equal(err.code, 'ENOENT', `access file3 error ENOENT`)
  }

  fs.accessSync(file4)
  t.pass(`access file4 ok`)

  const data4 = fs.readFileSync(file4, { encoding: 'utf8' })
  t.pass(`read file4 ok`)
  t.equal(data4, data3, `data match`)

  arr = fs.readdirSync(dir3, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, 'file4', '1 name')

  const dir4 = `${DIR}/dir4`
  const file5 = `${DIR}/dir4/file4`

  fs.renameSync(dir3, dir4)
  t.pass(`rename dir3 ok`)

  try {
    fs.accessSync(file4)
    t.fail(`no error`)
  } catch (err) {
    t.pass(`access file4 error`)
    t.equal(err.code, 'ENOENT', `access file4 error ENOENT`)
  }

  fs.accessSync(dir4)
  t.pass(`access dir4 ok`)

  fs.accessSync(file5)
  t.pass(`access file5 ok`)

  const data5 = fs.readFileSync(file5, { encoding: 'utf8' })
  t.pass(`read file5 ok`)
  t.equal(data5, data4, `data match`)

  arr = fs.readdirSync(dir4, { withFileTypes: true })
  t.pass(`readdir dir4 ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 dir')
  t.equal(arr[0].name, 'file4', '1 name')

  t.end()
})
