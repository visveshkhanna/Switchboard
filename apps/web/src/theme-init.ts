// Imported first by main.tsx so the saved theme is stamped on <html> before
// anything renders. The page CSP forbids inline scripts, so this cannot live
// in index.html.
import { applyTheme } from './lib/theme.ts'

applyTheme()
