import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten'

/**
 * Runs model-written JavaScript in QuickJS compiled to WebAssembly. The code
 * gets its own heap with no access to Node: no require, fs, process, network
 * or timers. The only way out is the host functions passed in, and every run
 * is bounded in time, memory, tool calls and output.
 */

export interface SandboxBudget {
  timeoutMs: number
  memoryMb: number
  maxToolCalls: number
  maxSourceBytes: number
  maxLogBytes?: number
}

export interface SandboxHost {
  /** Call a tool. Resolves with any JSON-serializable value; rejects with an Error the code can catch. */
  callTool(namespace: string, tool: string, args: unknown, signal: AbortSignal): Promise<unknown>
  /** Extra async functions exposed on the `catalog` global, e.g. search and describe. */
  helpers?: Record<string, (args: unknown[]) => Promise<unknown>>
}

export type SandboxErrorKind = 'syntax' | 'runtime' | 'timeout' | 'memory' | 'budget' | 'aborted'

export interface SandboxResult {
  ok: boolean
  /** The value the code returned, already parsed from JSON. */
  result?: unknown
  error?: { kind: SandboxErrorKind; message: string }
  logs: string[]
  toolCalls: number
  durationMs: number
}

/** Names the sandbox defines itself; server namespaces may not use them. */
export const RESERVED_GLOBALS = new Set([
  'catalog',
  'console',
  'JSON',
  'Math',
  'Date',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Error',
  'Map',
  'Set',
  'RegExp',
  'Symbol',
  'globalThis',
  'undefined',
  'NaN',
  'Infinity',
])

let quickjs: Promise<QuickJSWASMModule> | undefined

const UNDEFINED = '__switchboard_undefined__'

/** Strip Markdown fences and turn the code into an async function expression. */
export function normalizeCode(source: string): string {
  let code = source.trim()
  const fence = code.match(/^```[\w-]*\n([\s\S]*?)\n?```$/)
  if (fence) code = fence[1]!.trim()
  const isFunction =
    /^async\s+function\b/.test(code) ||
    /^async\s*\([^)]*\)\s*=>/.test(code) ||
    /^async\s+[A-Za-z_$][\w$]*\s*=>/.test(code) ||
    /^\([^)]*\)\s*=>/.test(code) ||
    /^function\b/.test(code)
  if (isFunction) return `(${code.replace(/;\s*$/, '')})`
  return `(async () => {\n${code}\n})`
}

export async function runInSandbox(
  source: string,
  namespaces: string[],
  host: SandboxHost,
  budget: SandboxBudget,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  const started = performance.now()
  const logs: string[] = []
  let logBytes = 0
  const maxLogBytes = budget.maxLogBytes ?? 64 * 1024
  let toolCalls = 0
  const done = (partial: Omit<SandboxResult, 'logs' | 'toolCalls' | 'durationMs'>): SandboxResult => ({
    ...partial,
    logs,
    toolCalls,
    durationMs: Math.round(performance.now() - started),
  })

  if (Buffer.byteLength(source) > budget.maxSourceBytes) {
    return done({
      ok: false,
      error: { kind: 'budget', message: `Code is larger than ${budget.maxSourceBytes} bytes.` },
    })
  }

  quickjs ??= getQuickJS()
  const QuickJS = await quickjs
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(budget.memoryMb * 1024 * 1024)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + budget.timeoutMs
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
  const vm = runtime.newContext()
  const runAbort = new AbortController()
  const onAbort = () => runAbort.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const pending = new Set<QuickJSDeferredPromise>()
  let disposed = false

  const pump = () => {
    if (disposed) return
    const jobs = runtime.executePendingJobs()
    if (jobs.error) jobs.error.dispose()
  }

  /** A sandbox promise settled by a host promise. */
  const bridge = (work: () => Promise<unknown>): QuickJSHandle => {
    const deferred = vm.newPromise()
    pending.add(deferred)
    work()
      .then(
        (value) => {
          if (disposed) return
          const handle = vm.newString(value === undefined ? UNDEFINED : JSON.stringify(value))
          deferred.resolve(handle)
          handle.dispose()
        },
        (error: unknown) => {
          if (disposed) return
          const handle = vm.newError(error instanceof Error ? error.message : String(error))
          deferred.reject(handle)
          handle.dispose()
        },
      )
      .finally(() => {
        if (disposed) return
        pending.delete(deferred)
        deferred.dispose()
        pump()
      })
    return deferred.handle
  }

  const defineFunction = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
    const handle = vm.newFunction(name, fn)
    vm.setProp(vm.global, name, handle)
    handle.dispose()
  }

  defineFunction('__log', (level, text) => {
    const line = `${vm.getString(level)}: ${vm.getString(text)}`
    if (logBytes < maxLogBytes) {
      logs.push(line.slice(0, maxLogBytes - logBytes))
      logBytes += line.length
      if (logBytes >= maxLogBytes) logs.push('… more output was dropped')
    }
    return undefined
  })

  defineFunction('__call', (nsHandle, toolHandle, argsHandle) => {
    const ns = vm.getString(nsHandle)
    const tool = vm.getString(toolHandle)
    const argsJson = vm.getString(argsHandle)
    return bridge(async () => {
      toolCalls++
      if (toolCalls > budget.maxToolCalls) {
        throw new Error(`Tool call budget exceeded: at most ${budget.maxToolCalls} calls per run.`)
      }
      return host.callTool(ns, tool, argsJson === UNDEFINED ? {} : JSON.parse(argsJson), runAbort.signal)
    })
  })

  defineFunction('__helper', (nameHandle, argsHandle) => {
    const name = vm.getString(nameHandle)
    const args = JSON.parse(vm.getString(argsHandle)) as unknown[]
    return bridge(async () => {
      const helper = host.helpers?.[name]
      if (!helper) throw new Error(`catalog.${name} does not exist.`)
      return helper(args)
    })
  })

  const prelude = `
    const __fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })();
    globalThis.console = Object.freeze({
      log: (...a) => __log('log', a.map(__fmt).join(' ')),
      info: (...a) => __log('info', a.map(__fmt).join(' ')),
      warn: (...a) => __log('warn', a.map(__fmt).join(' ')),
      error: (...a) => __log('error', a.map(__fmt).join(' ')),
      debug: (...a) => __log('debug', a.map(__fmt).join(' ')),
    });
    const __decode = (s) => s === ${JSON.stringify(UNDEFINED)} ? undefined : JSON.parse(s);
    const __namespace = (ns) => new Proxy({}, {
      get(_, tool) {
        if (typeof tool !== 'string' || tool === 'then') return undefined;
        return (input) => __call(ns, tool, input === undefined ? ${JSON.stringify(UNDEFINED)} : JSON.stringify(input)).then(__decode);
      },
    });
    globalThis.catalog = new Proxy({}, {
      get(_, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (...args) => __helper(name, JSON.stringify(args)).then(__decode);
      },
    });
    ${namespaces.map((ns) => `globalThis[${JSON.stringify(ns)}] = __namespace(${JSON.stringify(ns)});`).join('\n')}
    globalThis.__run = async (main) => {
      const value = await main();
      return value === undefined ? ${JSON.stringify(UNDEFINED)} : JSON.stringify(value);
    };
  `

  try {
    const preludeResult = vm.evalCode(prelude, 'prelude.js')
    if (preludeResult.error) {
      const message = errorMessage(vm, preludeResult.error)
      preludeResult.error.dispose()
      throw new Error(`Sandbox setup failed: ${message}`)
    }
    preludeResult.value.dispose()

    const evaluated = vm.evalCode(`__run(${normalizeCode(source)})`, 'code.js')
    if (evaluated.error) {
      const message = errorMessage(vm, evaluated.error)
      evaluated.error.dispose()
      return done({ ok: false, error: classify(message, true) })
    }
    const settled = vm.resolvePromise(evaluated.value)
    evaluated.value.dispose()
    pump()

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()))
    })
    const aborted = new Promise<'aborted'>((resolve) => {
      if (runAbort.signal.aborted) resolve('aborted')
      runAbort.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    })
    const outcome = await Promise.race([settled, timeout, aborted])
    clearTimeout(timer)

    if (outcome === 'timeout') {
      return done({
        ok: false,
        error: { kind: 'timeout', message: `Code ran longer than ${budget.timeoutMs} ms.` },
      })
    }
    if (outcome === 'aborted') {
      return done({ ok: false, error: { kind: 'aborted', message: 'The request was cancelled.' } })
    }
    if (outcome.error) {
      const message = errorMessage(vm, outcome.error)
      outcome.error.dispose()
      return done({ ok: false, error: classify(message, false) })
    }
    const text = vm.getString(outcome.value)
    outcome.value.dispose()
    return done({ ok: true, result: text === UNDEFINED ? undefined : JSON.parse(text) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return done({ ok: false, error: classify(message, false) })
  } finally {
    disposed = true
    runAbort.abort()
    signal?.removeEventListener('abort', onAbort)
    for (const deferred of pending) {
      try {
        deferred.dispose()
      } catch {}
    }
    try {
      vm.dispose()
      runtime.dispose()
    } catch {
      // A run stopped mid-flight can leave objects QuickJS still tracks. The
      // runtime is discarded either way; never let cleanup fail the call.
    }
  }
}

function errorMessage(vm: QuickJSContext, handle: QuickJSHandle): string {
  const value = vm.dump(handle) as { name?: string; message?: string } | string
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && value.message) return `${value.name ?? 'Error'}: ${value.message}`
  return JSON.stringify(value)
}

function classify(message: string, atCompile: boolean): { kind: SandboxErrorKind; message: string } {
  if (/interrupted/i.test(message)) return { kind: 'timeout', message: 'Code ran past its time limit.' }
  if (/out of memory/i.test(message)) return { kind: 'memory', message: 'Code ran out of memory.' }
  if (/budget exceeded/i.test(message)) return { kind: 'budget', message }
  if (atCompile || /^SyntaxError/.test(message)) return { kind: 'syntax', message }
  return { kind: 'runtime', message }
}
