# Shell

The main Bobbinry shell application - a Next.js web application that provides the primary user interface for the Bobbinry platform.

## Purpose

The shell is the central hub of the Bobbinry experience. It provides:
- Project management and organization
- Bobbin installation and configuration
- View hosting and coordination
- User authentication and settings
- Real-time collaboration features

## Features

- **Project Management**: Create, organize, and manage writing projects
- **Bobbin Ecosystem**: Install and configure bobbins like Manuscript, Corkboard, etc.
- **View System**: Host and coordinate multiple view components in a unified interface
- **Real-time Updates**: Live collaboration and instant data synchronization
- **Responsive Design**: Works across desktop, tablet, and mobile devices
- **Offline Support**: Service worker for offline functionality
- **Theme System**: Light/dark mode with customizable themes

## Technology Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.x
- **State Management**: Built-in React state + SDK integration
- **Testing**: Jest + Testing Library
- **Build Tool**: Next.js built-in bundling

## Development

### Prerequisites

- Node.js 20+
- Bun 1.0+
- PostgreSQL 14+ (native)

### Setup

```bash
# Install dependencies (from project root)
bun install

# Start development server
bun run dev

# The shell will be available at http://localhost:3100
```

### Environment Variables

```bash
# Required
NEXTAUTH_URL=http://localhost:3100
NEXTAUTH_SECRET=your-nextauth-secret
API_URL=http://localhost:4100

# OAuth Providers (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

### Available Scripts

```bash
# Development
bun run dev          # Start development server on port 3100

# Building
bun run build        # Build for production
bun run start        # Start production server

# Quality Assurance
bun run typecheck    # Run TypeScript compiler check
bun run lint         # Run ESLint
bun run test         # Run Jest tests
```

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── layout.tsx      # Root layout component
│   ├── page.tsx        # Home page
│   ├── projects/       # Project management pages
│   ├── auth/           # Authentication pages
│   └── api/            # API routes (if any)
├── components/         # React components
│   ├── ExtensionProvider.tsx
│   ├── ExtensionSlot.tsx
│   ├── OfflineProvider.tsx
│   ├── ShellLayout.tsx
│   └── ViewRenderer.tsx
├── lib/               # Utility libraries
│   ├── extensions.ts  # Extension/bobbin management
│   └── service-worker.ts
└── styles/           # Global styles and Tailwind config
```

## Key Components

### ShellLayout

The main layout component that provides the application shell structure:

```typescript
import { ShellLayout } from '@/components/ShellLayout';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellLayout>
      {children}
    </ShellLayout>
  );
}
```

### ExtensionProvider

Manages the lifecycle and state of installed bobbins:

```typescript
import { ExtensionProvider } from '@/components/ExtensionProvider';

function App() {
  return (
    <ExtensionProvider>
      <YourAppContent />
    </ExtensionProvider>
  );
}
```

### ViewRenderer

Renders bobbin views as native React components inside the shell:

```typescript
import { ViewRenderer } from '@/components/ViewRenderer';

function ProjectView({ viewConfig }) {
  return (
    <ViewRenderer
      view={viewConfig}
      projectId={currentProject.id}
      onMessage={handleViewMessage}
    />
  );
}
```

### ExtensionSlot

Provides mounting points for dynamic bobbin content:

```typescript
import { ExtensionSlot } from '@/components/ExtensionSlot';

function Sidebar() {
  return (
    <aside>
      <ExtensionSlot name="sidebar.navigation" />
      <ExtensionSlot name="sidebar.tools" />
    </aside>
  );
}
```

## SDK Integration

The shell integrates with the Bobbinry SDK for communication with views and the API:

```typescript
import { BobbinrySDK } from '@bobbinry/sdk';

const sdk = new BobbinrySDK({
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  wsUrl: process.env.NEXT_PUBLIC_WS_URL
});

// Handle workspace events
sdk.bus.on('manuscript.editor.selection.v1', (message) => {
  handleViewMessage(message);
});

// Send data to other bobbins
sdk.bus.emit('shell.data.updated', updatedData);
```

## State Management

The shell uses a combination of React state and the SDK for state management:

### Local State (React)

For UI state, form data, and temporary state:

```typescript
import { useState, useCallback } from 'react';

function ProjectSelector() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectProject = useCallback(async (projectId) => {
    setIsLoading(true);
    try {
      const project = await sdk.projects.get(projectId);
      setSelectedProject(project);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    // Component JSX
  );
}
```

### Global State (SDK)

For shared data and cross-view communication:

```typescript
// Subscribe to global state changes
useEffect(() => {
  const unsubscribe = sdk.data.subscribe('Project', (event) => {
    if (event.type === 'updated') {
      updateProjectInUI(event.entity);
    }
  });

  return unsubscribe;
}, []);
```

## Routing

The shell uses Next.js App Router for navigation:

```
app/
├── page.tsx                    # Home page (/)
├── projects/
│   ├── page.tsx               # Projects list (/projects)
│   ├── [id]/
│   │   ├── page.tsx          # Project detail (/projects/[id])
│   │   └── [view]/
│   │       └── page.tsx      # Project view (/projects/[id]/[view])
├── auth/
│   ├── signin/
│   │   └── page.tsx          # Sign in page
│   └── signup/
│       └── page.tsx          # Sign up page
└── settings/
    └── page.tsx              # User settings
```

## Authentication

The shell uses NextAuth.js for authentication:

```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  // Additional configuration
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

## Offline Support

The shell includes a service worker for offline functionality:

```typescript
// lib/service-worker.ts
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  }
}
```

## Testing

### Unit Tests

```bash
# Run all tests
bun run test

# Run specific test file
bun run test components/ShellLayout.test.tsx
```

### Component Testing

```typescript
// components/__tests__/ShellLayout.test.tsx
import { render, screen } from '@testing-library/react';
import { ShellLayout } from '../ShellLayout';

describe('ShellLayout', () => {
  it('renders navigation and main content', () => {
    render(
      <ShellLayout>
        <div>Test Content</div>
      </ShellLayout>
    );

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });
});
```

## Deployment

### Production Build

```bash
# Build for production
bun run build

# Start production server
bun run start
```

### Production

Use a process manager like PM2 or systemd to run the shell in production.

## Integration with API

The shell communicates with the API server for all data operations:

```typescript
// lib/api.ts
const apiClient = new APIClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  credentials: 'include'
});

export async function createProject(projectData) {
  return apiClient.post('/projects', projectData);
}

export async function getProjects() {
  return apiClient.get('/projects');
}
```

## Contributing

1. Follow the existing component and file structure
2. Use TypeScript for all new code
3. Add tests for new components and features
4. Follow the established naming conventions
5. Update this README when adding new major features

## Performance Considerations

- **Code Splitting**: Components are automatically code-split by Next.js
- **Image Optimization**: Use Next.js `Image` component for optimized images
- **Bundle Analysis**: Run `bun run build` to see bundle size analysis
- **Service Worker**: Implements caching strategies for offline support
