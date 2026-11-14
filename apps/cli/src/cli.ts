import { brand } from '@switchboard/shared'

declare const __SWITCHBOARD_VERSION__: string
const version = typeof __SWITCHBOARD_VERSION__ === 'string' ? __SWITCHBOARD_VERSION__ : 'dev'

const [command] = process.argv.slice(2)
if (command === '--version' || command === '-v') {
  console.log(version)
} else {
  console.log(`${brand.displayName} ${version}\nUsage: ${brand.name} <command>`)
}
