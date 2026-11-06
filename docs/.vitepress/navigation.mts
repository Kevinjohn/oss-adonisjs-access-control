export const nav = [
  { text: 'Recipes', link: '/recipes/' },
  { text: 'Reference', link: '/reference/' },
]

/** Guide pages arrive with the documentation milestone; the sidebar lists the pages that exist. */
export const sidebar = [
  {
    text: 'Reference',
    items: [
      { text: 'Public API', link: '/reference/' },
      { text: 'Errors', link: '/reference/errors' },
      { text: 'Recipes', link: '/recipes/' },
    ],
  },
]
