import { z } from 'zod'

// The page's CSP forbids eval. Without this, zod probes `new Function` while
// the shared schemas are being built and the browser logs a CSP violation.
// Imported first in main.tsx so it runs before any schema module.
z.config({ jitless: true })
