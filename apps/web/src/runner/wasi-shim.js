/**
 * Milestone 5 — minimal WASI (wasi_snapshot_preview1) shim for running
 * browsercc-compiled C++ programs.
 *
 * The compiled candidate programs are WASI command modules: they import a
 * small set of wasi_snapshot_preview1 functions and export their own linear
 * memory plus `_start`. This shim implements exactly the surface our
 * generated harness needs — nothing more:
 *   args / environ (empty), fd_read (stdin), fd_write (stdout/stderr),
 *   fd_close, fd_seek, fd_fdstat_get, fd_prestat_*, proc_exit,
 *   clock_time_get, random_get, sched_yield.
 *
 * DESIGN CONSTRAINT (do not break): `createWasiShim` is fully
 * self-contained — no imports, no module-scope references, no DOM, no Node
 * APIs. The C++ runner worker is a classic Web Worker built from a Blob URL
 * and cannot import relative ES modules, so cpp.js embeds this function via
 * `createWasiShim.toString()`. Keep it that way: everything the function
 * needs must live inside its body.
 *
 * Verified against real browsercc output: `WebAssembly.Module.imports()`
 * on a compiled sample lists environ_get, environ_sizes_get, fd_close,
 * fd_fdstat_get, fd_prestat_get, fd_prestat_dir_name, fd_read, fd_seek,
 * fd_write, proc_exit — all implemented below (plus args_*, clock_time_get,
 * random_get, sched_yield for programs that need them; extra exports in the
 * import object are harmless).
 */

/* eslint-disable no-unused-vars */
export function createWasiShim(options) {
  var opts = options || {};
  var stdinBytes = opts.stdinBytes || new Uint8Array(0);
  var onStdout = opts.onStdout || function () {};
  var onStderr = opts.onStderr || function () {};
  var progArgs = opts.args || ['main.wasm'];

  // WASI errno values we actually return.
  var ESUCCESS = 0;
  var EBADF = 8;
  var ESPIPE = 70;

  var stdinPos = 0;
  var memory = null;
  var exitCode = 0;

  function setMemory(m) {
    memory = m;
  }
  // Fresh views on every call: the module's memory can grow between calls,
  // which detaches older views.
  function bytes() {
    return new Uint8Array(memory.buffer);
  }
  function dataView() {
    return new DataView(memory.buffer);
  }
  function writeU32(ptr, v) {
    dataView().setUint32(ptr, v >>> 0, true);
  }
  function writeU64(ptr, v) {
    dataView().setBigUint64(ptr, BigInt(v), true);
  }
  function readU32(ptr) {
    return dataView().getUint32(ptr, true);
  }

  // Thrown by proc_exit to unwind the wasm frame; the runner catches it via
  // the __wasiExit marker (NOT via instanceof, which breaks across realms).
  function WasiExit(code) {
    this.code = code;
    this.__wasiExit = true;
  }

  var wasiImport = {
    args_get: function (argvPtr, argvBufPtr) {
      var enc = new TextEncoder();
      var mem = bytes();
      var p = argvBufPtr;
      for (var i = 0; i < progArgs.length; i++) {
        var b = enc.encode(progArgs[i]);
        writeU32(argvPtr + i * 4, p);
        mem.set(b, p);
        mem[p + b.length] = 0; // NUL terminator
        p += b.length + 1;
      }
      return ESUCCESS;
    },
    args_sizes_get: function (argcPtr, argvBufSizePtr) {
      var enc = new TextEncoder();
      var size = 0;
      for (var i = 0; i < progArgs.length; i++) {
        size += enc.encode(progArgs[i]).length + 1;
      }
      writeU32(argcPtr, progArgs.length);
      writeU32(argvBufSizePtr, size);
      return ESUCCESS;
    },
    environ_get: function () {
      return ESUCCESS;
    },
    environ_sizes_get: function (environcPtr, environBufSizePtr) {
      writeU32(environcPtr, 0);
      writeU32(environBufSizePtr, 0);
      return ESUCCESS;
    },
    fd_write: function (fd, iovsPtr, iovsLen, nwrittenPtr) {
      if (fd !== 1 && fd !== 2) return EBADF;
      var mem = bytes();
      var total = 0;
      for (var i = 0; i < iovsLen; i++) {
        var base = iovsPtr + i * 8;
        var ptr = readU32(base);
        var len = readU32(base + 4);
        var chunk = mem.slice(ptr, ptr + len);
        if (fd === 1) onStdout(chunk);
        else onStderr(chunk);
        total += len;
      }
      writeU32(nwrittenPtr, total);
      return ESUCCESS;
    },
    fd_read: function (fd, iovsPtr, iovsLen, nreadPtr) {
      if (fd !== 0) return EBADF;
      var mem = bytes();
      var total = 0;
      for (var i = 0; i < iovsLen; i++) {
        if (stdinPos >= stdinBytes.length) break;
        var base = iovsPtr + i * 8;
        var ptr = readU32(base);
        var len = readU32(base + 4);
        var n = Math.min(len, stdinBytes.length - stdinPos);
        mem.set(stdinBytes.subarray(stdinPos, stdinPos + n), ptr);
        stdinPos += n;
        total += n;
        if (n < len) break; // drained stdin; next read hits EOF
      }
      writeU32(nreadPtr, total);
      return ESUCCESS;
    },
    fd_close: function (fd) {
      if (fd !== 0 && fd !== 1 && fd !== 2) return EBADF;
      return ESUCCESS;
    },
    fd_seek: function () {
      return ESPIPE; // pipes/streams are not seekable
    },
    fd_fdstat_get: function (fd, statPtr) {
      if (fd !== 0 && fd !== 1 && fd !== 2) return EBADF;
      var v = dataView();
      // __wasi_fdstat_t: u8 filetype @0, u16 flags @2, u64 rights_base @8,
      // u64 rights_inheriting @16 (24 bytes total).
      v.setUint8(statPtr, 0); // __WASI_FILETYPE_UNKNOWN
      v.setUint16(statPtr + 2, 0, true);
      v.setBigUint64(statPtr + 8, fd === 0 ? 2n : 64n, true); // FD_READ / FD_WRITE
      v.setBigUint64(statPtr + 16, 0n, true);
      return ESUCCESS;
    },
    fd_prestat_get: function () {
      return EBADF; // no preopened directories
    },
    fd_prestat_dir_name: function () {
      return EBADF;
    },
    proc_exit: function (code) {
      exitCode = code | 0;
      throw new WasiExit(exitCode);
    },
    clock_time_get: function (_clockId, _precision, timePtr) {
      writeU64(timePtr, BigInt(Date.now()) * 1000000n); // ns
      return ESUCCESS;
    },
    random_get: function (bufPtr, bufLen) {
      var mem = bytes();
      for (var i = 0; i < bufLen; i++) {
        mem[bufPtr + i] = (Math.random() * 256) | 0;
      }
      return ESUCCESS;
    },
    sched_yield: function () {
      return ESUCCESS;
    },
  };

  return {
    wasiImport: wasiImport,
    setMemory: setMemory,
    WasiExit: WasiExit,
    getExitCode: function () {
      return exitCode;
    },
  };
}
