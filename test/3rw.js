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

const randn = (min, max) => Math.floor(Math.random() * (max - min)) + min

const rands = (len) => {
  return new Array(len).fill(0).map((_, n) => {
    // n = n % 26
    n = randn(0, 26)
    return String.fromCharCode(97 + n)
  }).join('')
}

test('open read empty', (t) => {
  empty(DIR)

  const name = `${DIR}/file1`
  const fd = fs.openSync(name, 'a+')
  t.pass(`open ok`)
  t.equal(typeof fd, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd} >= 0`)

  const stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, 0, `size`)

  const ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)

  const buf = Buffer.alloc(128)
  const count = fs.readSync(fd, buf)
  t.pass(`read ok`)
  t.equal(count, 0, `count ok`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
})

const openWriteRead = (t, str1) => {
  empty(DIR)

  const name = `${DIR}/file1`
  let fd = fs.openSync(name, 'w+')
  t.pass(`open ok`)
  t.equal(typeof fd, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd} >= 0`)

  let count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, str1.length, `size`)

  const ino = stat.ino
  t.equal(typeof ino, 'number', `ino num`)
  t.ok(ino >= 0, `ino ${ino} >= 0`)

  let buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str1.length, `count ok`)

  buf = buf.subarray(0, count)
  let data = buf.toString('utf8')
  t.equal(data, str1, `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  fd = fs.openSync(name, 'r')
  t.pass(`open ok`)
  t.equal(typeof fd, 'number', `fd num`)
  t.ok(fd >= 0, `fd ${fd} >= 0`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, str1.length, `size`)

  const ino2 = stat.ino
  t.equal(typeof ino2, 'number', `ino num`)
  t.ok(ino2 >= 0, `ino ${ino2} >= 0`)
  t.equal(ino2, ino, `ino2 = ino`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf)
  t.pass(`read ok`)
  t.equal(count, str1.length, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str1, `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('open write read => 0', (t) => {
  const str1 = rands(0)
  openWriteRead(t, str1)
})

test('open write read => 1', (t) => {
  const str1 = rands(1)
  openWriteRead(t, str1)
})

test('open write read => 11', (t) => {
  const str1 = rands(11)
  openWriteRead(t, str1)
})

test('open write read 4095', (t) => {
  const str1 = rands(4095)
  openWriteRead(t, str1)
})

test('open write read => 4096', (t) => {
  const str1 = rands(4096)
  openWriteRead(t, str1)
})

test('open write read => 4097', (t) => {
  const str1 = rands(4097)
  openWriteRead(t, str1)
})

test('open write read => (4096 * 2) - 1', (t) => {
  const str1 = rands((4096 * 2) - 1)
  openWriteRead(t, str1)
})

test('open write read => (4096 * 2)', (t) => {
  const str1 = rands(4096 * 2)
  openWriteRead(t, str1)
})

test('open write read => (4096 * 2) + 1', (t) => {
  const str1 = rands((4096 * 2) + 1)
  openWriteRead(t, str1)
})

const openWriteAppendRead = (t, str1, str2) => {
  empty(DIR)

  const name = `${DIR}/file1`
  let fd = fs.openSync(name, 'w')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, str1.length, `size`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  fd = fs.openSync(name, 'a+')
  t.pass(`open ok`)

  count = fs.writeSync(fd, str2)
  t.pass(`write ok`)
  t.equal(count, str2.length, `count ok`)

  const len = (str1.length + str2.length)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, len, `size`)

  let buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, len, `count ok`)

  buf = buf.subarray(0, count)
  let data = buf.toString('utf8')
  t.equal(data, (str1 + str2), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  fd = fs.openSync(name, 'r')
  t.pass(`open ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf)
  t.pass(`read ok`)
  t.equal(count, len, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, (str1 + str2), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('open write append read => 0, 0', (t) => {
  const str1 = rands(0)
  const str2 = rands(0)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 1, 0', (t) => {
  const str1 = rands(1)
  const str2 = rands(0)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 0, 1', (t) => {
  const str1 = rands(0)
  const str2 = rands(1)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 1, 1', (t) => {
  const str1 = rands(1)
  const str2 = rands(1)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 11, 11', (t) => {
  const str1 = rands(11)
  const str2 = rands(11)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, 1', (t) => {
  const str1 = rands(4095)
  const str2 = rands(1)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 1, 4095', (t) => {
  const str1 = rands(1)
  const str2 = rands(4095)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4096, 1', (t) => {
  const str1 = rands(4096)
  const str2 = rands(1)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 1, 4096', (t) => {
  const str1 = rands(1)
  const str2 = rands(4096)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4097, 1', (t) => {
  const str1 = rands(4097)
  const str2 = rands(1)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 1, 4097', (t) => {
  const str1 = rands(1)
  const str2 = rands(4097)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, 4095', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4095)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, 4096', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4096)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4096, 4095', (t) => {
  const str1 = rands(4096)
  const str2 = rands(4095)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, 4097', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4097)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4097, 4095', (t) => {
  const str1 = rands(4097)
  const str2 = rands(4095)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, 4098', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4098)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, (4096 * 2)', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4096 * 2)
  openWriteAppendRead(t, str1, str2)
})

test('open write append read => 4095, (4096 * 3)', (t) => {
  const str1 = rands(4095)
  const str2 = rands(4096 * 3)
  openWriteAppendRead(t, str1, str2)
})

const openWriteTruncRead = (t, str1, len, str2) => {
  empty(DIR)

  const name = `${DIR}/file1`
  let fd = fs.openSync(name, 'w')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, str1.length, `size`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  const flags = fs.constants.O_RDWR | fs.constants.O_TRUNC
  fd = fs.openSync(name, flags)
  t.pass(`open ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, 0, `size`)

  let buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, 0, `count ok`)

  count = fs.writeSync(fd, str1)
  t.pass(`write ok`)
  t.equal(count, str1.length, `count ok`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, str1.length, `count ok`)

  buf = buf.subarray(0, count)
  let data = buf.toString('utf8')
  t.equal(data, str1, `data match`)

  fs.ftruncateSync(fd, len)
  t.pass(`trunc ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, len, `size`)

  buf = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, buf, 0, buf.length, 0)
  t.pass(`read ok`)
  t.equal(count, len, `count ok`)

  buf = buf.subarray(0, count)
  data = buf.toString('utf8')
  t.equal(data, str2, `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('open write trunc read => 0, 0', (t) => {
  const str1 = rands(0)
  const str2 = str1.slice(0, 0)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 1, 0', (t) => {
  const str1 = rands(1)
  const str2 = str1.slice(0, 0)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 11, 1', (t) => {
  const str1 = rands(11)
  const str2 = str1.slice(0, 1)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 11, 11', (t) => {
  const str1 = rands(11)
  const str2 = str1.slice(0, 11)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 512, 256', (t) => {
  const str1 = rands(512)
  const str2 = str1.slice(0, 256)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 4097, 4096', (t) => {
  const str1 = rands(4097)
  const str2 = str1.slice(0, 4096)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 4096, 4096', (t) => {
  const str1 = rands(4096)
  const str2 = str1.slice(0, 4096)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 8192, 4096', (t) => {
  const str1 = rands(8192)
  const str2 = str1.slice(0, 4096)
  openWriteTruncRead(t, str1, str2.length, str2)
})

test('open write trunc read => 8192, 4000', (t) => {
  const str1 = rands(8192)
  const str2 = str1.slice(0, 4000)
  openWriteTruncRead(t, str1, str2.length, str2)
})

const openWriteWriteRead = (t, buf1, pos, buf2, buf3) => {
  empty(DIR)

  const name = `${DIR}/file1`
  const fd = fs.openSync(name, 'w+')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, buf1)
  t.pass(`write ok`)
  t.equal(count, buf1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, buf1.length, `size`)

  count = fs.writeSync(fd, buf2, 0, buf2.length, pos)
  t.pass(`write ok`)
  t.equal(count, buf2.length, `count ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)

  const len = Math.max(buf1.length, (pos + buf2.length))
  t.equal(stat.size, len, `size`)

  let data = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, data, 0, data.length, 0)
  t.pass(`read ok`)
  t.equal(count, len, `count ok`)

  data = data.subarray(0, len)
  t.ok(data.equals(buf3), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('write write read => 128, 8, 16', (t) => {
  const buf1 = Buffer.from(rands(128))
  const buf2 = Buffer.from(rands(16))
  const pos = 8
  let buf3 = buf1.subarray(0, pos)
  let z = Math.max((pos - buf1.length), 0)
  z = Buffer.alloc(z).fill(0x00)
  buf3 = Buffer.concat([buf3, z, buf2])
  const len = buf3.length
  buf3 = Buffer.concat([buf3, buf1.subarray(len)])
  openWriteWriteRead(t, buf1, pos, buf2, buf3)
})

test('write write read => 64, 128, 16', (t) => {
  const buf1 = Buffer.from(rands(64))
  const buf2 = Buffer.from(rands(16))
  const pos = 128
  let buf3 = buf1.subarray(0, pos)
  let z = Math.max((pos - buf1.length), 0)
  z = Buffer.alloc(z).fill(0x00)
  buf3 = Buffer.concat([buf3, z, buf2])
  const len = buf3.length
  buf3 = Buffer.concat([buf3, buf1.subarray(len)])
  openWriteWriteRead(t, buf1, pos, buf2, buf3)
})

test('write write read => 64, (4096 * 3), 16', (t) => {
  const buf1 = Buffer.from(rands(64))
  const buf2 = Buffer.from(rands(16))
  const pos = 4096 * 3
  let buf3 = buf1.subarray(0, pos)
  let z = Math.max((pos - buf1.length), 0)
  z = Buffer.alloc(z).fill(0x00)
  buf3 = Buffer.concat([buf3, z, buf2])
  const len = buf3.length
  buf3 = Buffer.concat([buf3, buf1.subarray(len)])
  openWriteWriteRead(t, buf1, pos, buf2, buf3)
})

const openWriteWithHoldRead = (t, pos, buf1, buf2) => {
  empty(DIR)

  const name = `${DIR}/file1`
  const fd = fs.openSync(name, 'w+')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, buf1, 0, buf1.length, pos)
  t.pass(`write ok`)
  t.equal(count, buf1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, (pos + buf1.length), `size`)

  let data = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, data, 0, data.length, 0)
  t.pass(`read ok`)
  t.equal(count, (pos + buf1.length), `count ok`)

  data = data.subarray(0, count)
  t.ok(data.equals(buf2), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('write with hole read => 128, 16', (t) => {
  const pos = 128
  const z = Buffer.alloc(pos).fill(0x00)
  const buf1 = Buffer.from(rands(16))
  const buf2 = Buffer.concat([z, buf1])
  openWriteWithHoldRead(t, pos, buf1, buf2)
})

test('write with hole read => 4090, 16', (t) => {
  const pos = 4090
  const z = Buffer.alloc(pos).fill(0x00)
  const buf1 = Buffer.from(rands(16))
  const buf2 = Buffer.concat([z, buf1])
  openWriteWithHoldRead(t, pos, buf1, buf2)
})

test('write with hole read => 4096 * 2, 16', (t) => {
  const pos = 4090 * 2
  const z = Buffer.alloc(pos).fill(0x00)
  const buf1 = Buffer.from(rands(16))
  const buf2 = Buffer.concat([z, buf1])
  openWriteWithHoldRead(t, pos, buf1, buf2)
})

test('write with hole read => 4096 * 2, 4096', (t) => {
  const pos = 4090 * 2
  const z = Buffer.alloc(pos).fill(0x00)
  const buf1 = Buffer.from(rands(4096))
  const buf2 = Buffer.concat([z, buf1])
  openWriteWithHoldRead(t, pos, buf1, buf2)
})

test('write with hole read => 4096 * 2, 4097', (t) => {
  const pos = 4090 * 2
  const z = Buffer.alloc(pos).fill(0x00)
  const buf1 = Buffer.from(rands(4097))
  const buf2 = Buffer.concat([z, buf1])
  openWriteWithHoldRead(t, pos, buf1, buf2)
})

const openWriteTruncGrow = (t, buf1, len, buf2, pos, buf3) => {
  empty(DIR)

  const name = `${DIR}/file1`
  let fd = fs.openSync(name, 'w+')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, buf1)
  t.pass(`write ok`)
  t.equal(count, buf1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, buf1.length, `size`)

  fs.ftruncateSync(fd, len)
  t.pass(`trunc ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, len, `size`)

  count = fs.writeSync(fd, buf2, 0, buf2.length, pos)
  t.pass(`write ok`)
  t.equal(count, buf2.length, `count ok`)

  let data = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, data, 0, data.length, 0)
  t.pass(`read ok`)
  t.equal(count, buf3.length, `count ok`)

  data = data.subarray(0, count)
  t.ok(data.equals(buf3), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('open write trunc read => 16, 64, 64, 128', (t) => {
  const buf1 = Buffer.from(rands(16))
  const len = 64
  const pos = 64
  let z = (len - buf1.length)
  z = Buffer.alloc(z).fill(0x00)
  const buf2 = Buffer.from(rands(128))
  const buf3 = Buffer.concat([buf1, z, buf2])
  openWriteTruncGrow(t, buf1, len, buf2, pos, buf3)
})

test('open write trunc read => 16, 5000, 5000, 128', (t) => {
  const buf1 = Buffer.from(rands(16))
  const len = 5000
  const pos = 5000
  let z = (len - buf1.length)
  z = Buffer.alloc(z).fill(0x00)
  const buf2 = Buffer.from(rands(128))
  const buf3 = Buffer.concat([buf1, z, buf2])
  openWriteTruncGrow(t, buf1, len, buf2, pos, buf3)
})

const openWriteTruncWrite = (t, buf1, len, buf2, pos, buf3) => {
  empty(DIR)

  const name = `${DIR}/file1`
  let fd = fs.openSync(name, 'w+')
  t.pass(`open ok`)

  let count = fs.writeSync(fd, buf1)
  t.pass(`write ok`)
  t.equal(count, buf1.length, `count ok`)

  let stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, buf1.length, `size`)

  fs.ftruncateSync(fd, len)
  t.pass(`trunc ok`)

  stat = fs.fstatSync(fd)
  t.pass(`stat ok`)
  t.equal(stat.size, len, `size`)

  count = fs.writeSync(fd, buf2, 0, buf2.length, pos)
  t.pass(`write ok`)
  t.equal(count, buf2.length, `count ok`)

  let data = Buffer.alloc(1024 * 100)
  count = fs.readSync(fd, data, 0, data.length, 0)
  t.pass(`read ok`)
  t.equal(count, buf3.length, `count ok`)

  data = data.subarray(0, count)
  t.ok(data.equals(buf3), `data match`)

  fs.closeSync(fd)
  t.pass(`close ok`)

  t.end()
}

test('open write trunc write => 64, 32, 16, 32', (t) => {
  const buf1 = Buffer.from(rands(64))
  const len = 32
  let buf3 = buf1.subarray(0, len)
  const pos = 32
  const buf2 = Buffer.from(rands(16))
  buf3 = Buffer.concat([buf3, buf2])
  openWriteTruncWrite(t, buf1, len, buf2, pos, buf3);
})

test('open write trunc write => 4096, 2048, 0, 2048', (t) => {
  const buf1 = Buffer.from(rands(4096))
  const len = 2048
  const pos = 0
  const buf2 = Buffer.from(rands(2048))
  const buf3 = buf2
  openWriteTruncWrite(t, buf1, len, buf2, pos, buf3);
})

test('open write trunc write => 8192, 4096, 0, 4096', (t) => {
  const buf1 = Buffer.from(rands(8192))
  const len = 4096
  const pos = 0
  const buf2 = Buffer.from(rands(4096))
  const buf3 = buf2
  openWriteTruncWrite(t, buf1, len, buf2, pos, buf3);
})
