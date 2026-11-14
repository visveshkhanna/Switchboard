import { describe, expect, it } from 'vitest'
import type { ToolEntry } from '../profiles/view.ts'
import { ToolIndex, tokenize } from './search.ts'

function entry(server: string, tool: string, description: string): ToolEntry {
  return {
    server,
    tool,
    id: `${server}.${tool}`,
    name: `${server}__${tool}`,
    definition: { name: `${server}__${tool}`, description, inputSchema: { type: 'object' } },
  }
}

const tools = [
  entry('github', 'create_issue', 'Create a new issue in a GitHub repository'),
  entry('github', 'list_issues', 'List issues in a repository'),
  entry('github', 'createPullRequest', 'Open a pull request'),
  entry('linear', 'create_issue', 'Create a Linear issue in a team'),
  entry('slack', 'post_message', 'Send a message to a channel'),
]

describe('tokenize', () => {
  it('splits identifiers and stems plurals', () => {
    expect(tokenize('createPullRequest')).toEqual(['create', 'pull', 'request'])
    expect(tokenize('list_issues')).toEqual(['list', 'issue'])
  })
})

describe('ToolIndex', () => {
  const index = new ToolIndex(tools)

  it('ranks tools that match every term first', () => {
    const hits = index.search('create issue github')
    expect(hits[0]?.entry.id).toBe('github.create_issue')
    expect(hits.map((h) => h.entry.id)).toContain('linear.create_issue')
  })

  it('matches camelCase names and synonyms in descriptions', () => {
    expect(index.search('pull request')[0]?.entry.id).toBe('github.createPullRequest')
    expect(index.search('send slack message')[0]?.entry.id).toBe('slack.post_message')
  })

  it('returns nothing for unrelated queries', () => {
    expect(index.search('weather forecast')).toEqual([])
  })
})
