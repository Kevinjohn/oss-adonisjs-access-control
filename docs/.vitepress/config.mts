import { defineConfig } from 'vitepress'
import { githubLinks, repository } from './github_links.mts'
import { nav, sidebar } from './navigation.mts'

export default defineConfig({
  title: 'Access Control for AdonisJS',
  description: 'Team memberships and a ranked role matrix for AdonisJS applications on Account Kit',
  base: '/oss-adonisjs-access-control/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['maintainers/**'],
  rewrites: { 'README.md': 'index.md', 'reference/README.md': 'reference/index.md' },
  markdown: { config: githubLinks },
  transformPageData(pageData) {
    if (pageData.relativePath.startsWith('reference/api/')) {
      pageData.frontmatter.editLink = false
    }
  },
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: { pattern: `${repository}/edit/main/docs/:path` },
    nav,
    sidebar,
  },
})
