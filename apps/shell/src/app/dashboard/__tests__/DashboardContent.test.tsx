import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DashboardContent } from '../DashboardContent'
import { apiFetch } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
}))

jest.mock('@/components/SiteNav', () => ({
  SiteNav: () => <div>SiteNav</div>,
}))

jest.mock('../RecentActivityPanel', () => ({
  RecentActivityPanel: () => <div>RecentActivityPanel</div>,
}))

jest.mock('../CreateCollectionModal', () => ({
  CreateCollectionModal: () => <div>CreateCollectionModal</div>,
}))

jest.mock('../SortableCollection', () => ({
  SortableCollection: ({ collection }: { collection: { name: string; projects: Array<{ name: string }> } }) => (
    <div data-testid={`collection-${collection.name}`}>
      {collection.projects.map(project => project.name).join(' > ')}
    </div>
  ),
}))

jest.mock('../ProjectCard', () => ({
  ProjectCard: ({ project }: { project: { name: string } }) => (
    <div data-testid="uncategorized-project">{project.name}</div>
  ),
}))

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

describe('DashboardContent', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset()
  })

  it('preserves collection order while sorting uncategorized projects', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(jsonResponse({
        collections: [
          {
            id: 'collection-1',
            name: 'Curated',
            description: null,
            coverImage: null,
            colorTheme: null,
            projects: [
              {
                id: 'project-zulu',
                name: 'Zulu',
                description: null,
                coverImage: null,
                shortUrl: null,
                isArchived: false,
                createdAt: '2026-03-01T00:00:00.000Z',
                updatedAt: '2026-03-01T00:00:00.000Z',
              },
              {
                id: 'project-alpha',
                name: 'Alpha',
                description: null,
                coverImage: null,
                shortUrl: null,
                isArchived: false,
                createdAt: '2026-03-02T00:00:00.000Z',
                updatedAt: '2026-03-02T00:00:00.000Z',
              },
            ],
          },
        ],
        uncategorized: [
          {
            id: 'project-uncat-zulu',
            name: 'Zulu',
            description: null,
            coverImage: null,
            shortUrl: null,
            isArchived: false,
            createdAt: '2026-03-01T00:00:00.000Z',
            updatedAt: '2026-03-03T00:00:00.000Z',
          },
          {
            id: 'project-uncat-alpha',
            name: 'Alpha',
            description: null,
            coverImage: null,
            shortUrl: null,
            isArchived: false,
            createdAt: '2026-03-02T00:00:00.000Z',
            updatedAt: '2026-03-01T00:00:00.000Z',
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        stats: {
          projects: { total: '4', active: '4', archived: '0' },
          collections: { total: '1' },
          entities: { total: '0' },
        },
      }))

    render(
      <DashboardContent
        user={{ id: 'user-1', email: 'writer@example.com', name: 'Writer', emailVerified: true }}
        apiToken="test-token"
      />
    )

    expect(await screen.findByTestId('collection-Curated')).toHaveTextContent('Zulu > Alpha')
    expect(screen.getAllByTestId('uncategorized-project').map(node => node.textContent)).toEqual(['Zulu', 'Alpha'])

    fireEvent.change(screen.getByLabelText('Sort projects'), { target: { value: 'alphabetical' } })

    await waitFor(() => {
      expect(screen.getByTestId('collection-Curated')).toHaveTextContent('Zulu > Alpha')
      expect(screen.getAllByTestId('uncategorized-project').map(node => node.textContent)).toEqual(['Alpha', 'Zulu'])
    })
  })
})
